#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";

const token = (process.env.INCUS_WEB_PROVISIONER_TOKEN || "").trim();
const socketPath =
  process.env.INCUS_WEB_PROVISIONER_SOCKET || "/run/incus-web/provisioner.sock";
const host = process.env.INCUS_WEB_PROVISIONER_HOST || "";
const port = Number.parseInt(process.env.INCUS_WEB_PROVISIONER_PORT || "0", 10);
const workspaceId =
  process.env.INCUS_WEB_WORKSPACE_ID || "workspace-incus-web";
const incusProject =
  process.env.INCUS_WEB_INCUS_PROJECT || "default";
const incusContainer =
  process.env.INCUS_WEB_INCUS_CONTAINER || process.env.CONTAINER_NAME || "incus-web";
const commandTimeoutMs = Number.parseInt(
  process.env.INCUS_WEB_PROVISIONER_COMMAND_TIMEOUT_MS || "8000",
  10,
);
const requestTimeoutMs = Number.parseInt(
  process.env.INCUS_WEB_PROVISIONER_REQUEST_TIMEOUT_MS || "9000",
  10,
);
const maxProcessOutputBytes = Number.parseInt(
  process.env.INCUS_WEB_PROVISIONER_MAX_OUTPUT_BYTES || "1048576",
  10,
);
const statusCacheTtlMs = Number.parseInt(
  process.env.INCUS_WEB_PROVISIONER_STATUS_CACHE_TTL_MS || "2000",
  10,
);
const maxConcurrentIncusCommands = Number.parseInt(
  process.env.INCUS_WEB_PROVISIONER_MAX_INCUS_COMMANDS || "4",
  10,
);
let activeIncusCommands = 0;
let statusCache;
let statusInFlight;
const setupPhases = new Set([
  "not_configured",
  "queued",
  "installing_mise",
  "applying_dotfiles",
  "checking_tools",
  "ready",
  "failed",
]);

if (!token) {
  console.error("INCUS_WEB_PROVISIONER_TOKEN is required");
  process.exit(1);
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function assertLoopbackHost(value) {
  if (!["127.0.0.1", "::1", "localhost"].includes(value)) {
    console.error("INCUS_WEB_PROVISIONER_HOST must be loopback-only");
    process.exit(1);
  }
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw new Error("request too large");
    }
  }
  return JSON.parse(body || "{}");
}

async function unlinkExistingSocket(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isSocket()) {
      console.error(`${path} exists and is not a Unix socket`);
      process.exit(1);
    }
    if (await socketAcceptsConnections(path)) {
      console.error(`${path} is already accepting connections`);
      process.exit(1);
    }
    await unlink(path);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return;
    }
    throw err;
  }
}

function socketAcceptsConnections(path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", (err) => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        resolve(false);
        return;
      }
      reject(err);
    });
  });
}

function requireServiceAuth(req, res) {
  if (req.headers.authorization === `Bearer ${token}`) {
    return true;
  }
  send(res, 401, {
    code: "unauthenticated_service",
    message: "invalid provisioner service token",
    retryable: false,
  });
  return false;
}

function operation(command, status, resultOrError) {
  const now = new Date().toISOString();
  const base = {
    id: `host-${command.requestId || "unknown"}-${Date.now()}`,
    requestId: command.requestId || "unknown",
    type: command.type || "GetWorkspaceStatus",
    workspaceId: command.workspace?.id || "unknown",
    status,
    startedAt: now,
    completedAt: now,
  };
  if (status === "succeeded") {
    return { ...base, result: resultOrError };
  }
  return { ...base, error: resultOrError };
}

function error(code, message, retryable = false, details = undefined) {
  return { code, message, retryable, details };
}

function validateWorkspace(command) {
  if (
    command?.workspace?.id !== workspaceId ||
    command?.workspace?.incusProject !== incusProject ||
    command?.workspace?.incusContainer !== incusContainer
  ) {
    return error(
      "metadata_mismatch",
      "workspace tuple did not match host provisioner metadata",
      false,
    );
  }
  return undefined;
}

function run(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let releaseSlot;
    try {
      releaseSlot = acquireIncusSlot();
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    let outputBytes = 0;
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
      if (releaseSlot) releaseSlot();
      if (err) reject(err);
      else resolve(value);
    };
    const terminate = (reason) => {
      killProcessGroup(child, "SIGTERM");
      setTimeout(() => killProcessGroup(child, "SIGKILL"), 1000).unref();
      finish(new Error(reason));
    };
    const abort = () => terminate(`${command} aborted`);
    const append = (target) => (data) => {
      outputBytes += data.length;
      if (outputBytes > maxProcessOutputBytes) {
        terminate(`${command} exceeded output limit`);
        return;
      }
      const value = data.toString();
      if (target === "stdout") stdout += value;
      else stderr += value;
    };
    child.stdout.on("data", append("stdout"));
    child.stderr.on("data", append("stderr"));
    const timer = setTimeout(() => {
      terminate(`${command} timed out`);
    }, commandTimeoutMs);
    timer.unref();
    if (signal) {
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    child.on("error", (err) => {
      finish(err);
    });
    child.on("close", (code) => {
      if (code === 0) finish(undefined, stdout);
      else finish(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

function acquireIncusSlot() {
  if (activeIncusCommands >= maxConcurrentIncusCommands) {
    throw new Error("incus concurrency limit reached");
  }
  activeIncusCommands += 1;
  return () => {
    activeIncusCommands = Math.max(0, activeIncusCommands - 1);
  };
}

function killProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function incusJson(args, options) {
  const output = await run("incus", ["--project", incusProject, ...args], options);
  return JSON.parse(output || "{}");
}

async function incusText(args, options) {
  return (await run("incus", ["--project", incusProject, ...args], options)).trim();
}

async function getWorkspaceStatus(command, options) {
  const state = await incusJson(
    ["query", `/1.0/instances/${incusContainer}/state`],
    options,
  );
  const instance = await incusJson(
    ["query", `/1.0/instances/${incusContainer}`],
    options,
  );
  const cpuLimit = await optionalText([
    "config",
    "get",
    incusContainer,
    "limits.cpu",
  ], options);
  const memoryLimit = await optionalText([
    "config",
    "get",
    incusContainer,
    "limits.memory",
  ], options);
  const rootDiskSize = await optionalText([
    "config",
    "device",
    "get",
    incusContainer,
    "root",
    "size",
  ], options);

  return {
    workspaceId: command.workspace.id,
    state: mapIncusState(state.status_code),
    incusProject: command.workspace.incusProject,
    incusContainer: command.workspace.incusContainer,
    cpuCount: parseCpuLimit(cpuLimit),
    memoryUsedBytes: numberValue(state.memory?.usage),
    memoryLimitBytes: parseByteLimit(memoryLimit),
    rootDiskLimitBytes: parseByteLimit(rootDiskSize),
    setupPhase: setupPhase(instance.config?.["user.incus-web.setup-phase"]),
    lastCheckedAt: new Date().toISOString(),
  };
}

async function getCachedWorkspaceStatus(command, options) {
  const now = Date.now();
  if (statusCache && statusCache.expiresAt > now) {
    return statusCache.value;
  }
  if (statusInFlight) {
    return statusInFlight;
  }
  statusInFlight = getWorkspaceStatus(command, options)
    .then((status) => {
      statusCache = {
        value: status,
        expiresAt: Date.now() + statusCacheTtlMs,
      };
      return status;
    })
    .finally(() => {
      statusInFlight = undefined;
    });
  return statusInFlight;
}

async function optionalText(args, options) {
  try {
    return await incusText(args, options);
  } catch {
    return "";
  }
}

function mapIncusState(statusCode) {
  switch (statusCode) {
    case 101:
      return "running";
    case 102:
      return "stopped";
    default:
      return "degraded";
  }
}

function parseCpuLimit(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function setupPhase(value) {
  return setupPhases.has(value) ? value : "not_configured";
}

function parseByteLimit(value) {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)([kmgt]?i?b?)?$/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const unit = (match[2] || "b").toLowerCase();
  const multipliers = {
    b: 1,
    k: 1000,
    kb: 1000,
    kib: 1024,
    m: 1000 ** 2,
    mb: 1000 ** 2,
    mib: 1024 ** 2,
    g: 1000 ** 3,
    gb: 1000 ** 3,
    gib: 1024 ** 3,
    t: 1000 ** 4,
    tb: 1000 ** 4,
    tib: 1024 ** 4,
  };
  return Math.round(amount * (multipliers[unit] || 1));
}

async function handleCommand(command, options) {
  const mismatch = validateWorkspace(command);
  if (mismatch) {
    return operation(command, "failed", mismatch);
  }
  if (command.version !== "provisioner.v1") {
    return operation(
      command,
      "failed",
      error("invalid_input", "unsupported provisioner contract version"),
    );
  }
  if (command.type !== "GetWorkspaceStatus") {
    return operation(
      command,
      "failed",
      error(
        "invalid_state",
        `${command.type} is not enabled in the host provisioner yet`,
      ),
    );
  }
  try {
    return operation(
      command,
      "succeeded",
      await getCachedWorkspaceStatus(command, options),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return operation(
      command,
      "failed",
      error(
        message.includes("concurrency limit") ? "timeout" : "incus_unavailable",
        message.includes("concurrency limit")
          ? "workspace status is temporarily busy"
          : "failed to read workspace status from Incus",
        true,
      ),
    );
  }
}

const server = createServer(async (req, res) => {
  const controller = new AbortController();
  const requestTimer = setTimeout(() => controller.abort(), requestTimeoutMs);
  requestTimer.unref();
  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });
  try {
    if (req.method !== "POST" || req.url !== "/v1/operations") {
      send(res, 404, { error: "not found" });
      return;
    }
    if (!requireServiceAuth(req, res)) return;
    send(res, 200, await handleCommand(await readJson(req), {
      signal: controller.signal,
    }));
  } catch (err) {
    send(res, 400, {
      code: "invalid_input",
      message: err instanceof Error ? err.message : "invalid request",
      retryable: false,
    });
  } finally {
    clearTimeout(requestTimer);
  }
});

if (host && port > 0) {
  assertLoopbackHost(host);
  server.listen(port, host, () => {
    console.log(`incus-web provisioner listening on http://${host}:${port}`);
  });
} else {
  await mkdir(socketPath.split("/").slice(0, -1).join("/") || ".", {
    recursive: true,
    mode: 0o755,
  });
  await unlinkExistingSocket(socketPath);
  server.listen(socketPath, async () => {
    await chmod(socketPath, 0o600);
    console.log(`incus-web provisioner listening on ${socketPath}`);
  });
}
