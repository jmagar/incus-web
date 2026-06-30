#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "3080", 10);
const webUser = process.env.WEB_USER || "agent";
const skipAptScripts = process.env.DOTFILES_SKIP_APT !== "0";
const setupAllowedEmails = parseList(process.env.SETUP_ALLOWED_EMAILS || "");
const allowKeyPersistence = process.env.SETUP_ALLOW_KEY_PERSISTENCE === "1";
const commandTimeoutMs = Number.parseInt(
  process.env.SETUP_COMMAND_TIMEOUT_MS || "1200000",
  10,
);
const home = `/home/${webUser}`;
const keyPath = `${home}/.config/chezmoi/key.txt`;
const kekPath = "/etc/incus-web/setup-kek";
const encryptedKeyPath = "/var/lib/incus-web/setup/age-key.json";
let applyInFlight = false;

function parseList(value) {
  return new Set(
    value
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value) && value[0]) return value[0].trim();
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function setupActor(req) {
  const email = firstHeader(req.headers, [
    "x-auth-request-email",
    "x-forwarded-email",
    "x-authentik-email",
  ]).toLowerCase();
  const user = firstHeader(req.headers, [
    "x-auth-request-user",
    "x-auth-request-preferred-username",
    "x-forwarded-user",
  ]);
  return { email, user };
}

function authorizeSetup(req) {
  const actor = setupActor(req);
  if (!actor.email) {
    return { ok: false, reason: "missing authenticated email" };
  }
  if (setupAllowedEmails.size === 0) {
    return { ok: false, reason: "SETUP_ALLOWED_EMAILS is empty" };
  }
  if (!setupAllowedEmails.has(actor.email)) {
    return { ok: false, reason: "authenticated user is not allowed to run setup" };
  }
  return { ok: true, actor };
}

function requireSetupAuthorization(req, res) {
  const auth = authorizeSetup(req);
  if (auth.ok) return true;

  send(res, 403, { ok: false, error: auth.reason });
  return false;
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
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

async function ensureKek() {
  await mkdir("/etc/incus-web", { recursive: true, mode: 0o700 });
  if (!existsSync(kekPath)) {
    await writeFile(kekPath, randomBytes(32), { mode: 0o600 });
  }
  return readFile(kekPath);
}

async function storeEncryptedKey(ageKey) {
  await mkdir("/var/lib/incus-web/setup", { recursive: true, mode: 0o700 });
  const kek = await ensureKek();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const encrypted = Buffer.concat([cipher.update(ageKey, "utf8"), cipher.final()]);
  const payload = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
  await writeFile(encryptedKeyPath, JSON.stringify(payload), { mode: 0o600 });
}

async function readEncryptedKey() {
  if (!existsSync(encryptedKeyPath)) {
    return "";
  }
  const kek = await ensureKek();
  const payload = JSON.parse(await readFile(encryptedKeyPath, "utf8"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    kek,
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function installAgeKey(ageKey) {
  await mkdir(`${home}/.config/chezmoi`, { recursive: true, mode: 0o700 });
  await run("chown", [`${webUser}:${webUser}`, `${home}/.config/chezmoi`]);
  await run("chmod", ["700", `${home}/.config/chezmoi`]);
  await writeFile(keyPath, ageKey.endsWith("\n") ? ageKey : `${ageKey}\n`, { mode: 0o600 });
  await run("chown", [`${webUser}:${webUser}`, keyPath]);
  await run("chmod", ["600", keyPath]);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (data) => {
      output += data.toString();
      if (output.length > 12000) {
        output = output.slice(output.length - 12000);
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          child.kill("SIGTERM");
          const error = new Error(`${command} timed out after ${timeoutMs}ms`);
          error.output = output;
          reject(error);
        }, timeoutMs)
      : null;
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve(output);
      } else {
        const error = new Error(`${command} exited ${code}`);
        error.output = output;
        reject(error);
      }
    });
  });
}

function agentBash(script, extraEnv = {}) {
  return run("runuser", [
    "-u",
    webUser,
    "--",
    "env",
    `HOME=${home}`,
    `USER=${webUser}`,
    `LOGNAME=${webUser}`,
    "MISE_HTTP_TIMEOUT=180",
    "MISE_FETCH_REMOTE_VERSIONS_TIMEOUT=60",
    `PATH=${home}/.local/bin:${home}/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin`,
    ...Object.entries(extraEnv).map(([key, value]) => `${key}=${value}`),
    "bash",
    "-lc",
    `cd "$HOME" && ${script}`,
  ]);
}

async function applyDotfiles({ repo, ageKey, rememberKey }) {
  if (typeof repo !== "string" || repo.trim().length === 0 || repo.length > 512) {
    throw new Error("dotfiles repo is required");
  }
  if (ageKey !== undefined && (typeof ageKey !== "string" || ageKey.length > 200000)) {
    throw new Error("invalid age key");
  }
  if (ageKey && !ageKey.includes("AGE-SECRET-KEY-")) {
    throw new Error("age key did not look like an age identity file");
  }

  if (rememberKey && !allowKeyPersistence) {
    throw new Error("age key persistence is disabled for this workspace");
  }

  if (!ageKey && allowKeyPersistence) {
    ageKey = await readEncryptedKey();
  }

  if (ageKey) {
    if (rememberKey) {
      await storeEncryptedKey(ageKey);
    }
    await installAgeKey(ageKey);
  }

  let output = "";
  try {
    output += await agentBash('command -v chezmoi >/dev/null || sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin"');
    output += await agentBash('command -v mise >/dev/null || curl -fsSL https://mise.run | sh');
    output += await agentBash('chezmoi init --promptDefaults --force --no-tty "$DOTFILES_REPO"', {
      DOTFILES_REPO: repo.trim(),
    });
    if (skipAptScripts) {
      output += await agentBash('scripts_dir="$HOME/.local/share/chezmoi/.chezmoiscripts"; disabled_dir="$HOME/.local/share/chezmoi/.disabled-chezmoiscripts"; if [[ -d "$scripts_dir" ]]; then shopt -s nullglob; matches=("$scripts_dir"/*apt-packages*); if (( ${#matches[@]} > 0 )); then mkdir -p "$disabled_dir"; mv "${matches[@]}" "$disabled_dir"/; fi; fi');
    }
    output += await agentBash("chezmoi apply --force --no-tty");
    output += await agentBash("mise install");
  } finally {
    await rm(keyPath, { force: true });
    if (!allowKeyPersistence || !rememberKey) {
      await rm(encryptedKeyPath, { force: true });
    }
  }
  return output;
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>incus-web setup</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #07131c; color: #e6f4fb; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(720px, 100%); }
    label { display: block; margin: 18px 0 8px; color: #a7bcc9; }
    input, button, textarea { width: 100%; box-sizing: border-box; border: 1px solid #1d3d4e; background: #0d1f2b; color: #e6f4fb; padding: 12px; border-radius: 6px; font: inherit; }
    button { margin-top: 18px; background: #29b6f6; color: #041018; border: 0; font-weight: 700; cursor: pointer; }
    .row { display: flex; gap: 10px; align-items: center; margin-top: 14px; }
    .row input { width: auto; }
    pre { white-space: pre-wrap; background: #0d1f2b; border: 1px solid #1d3d4e; border-radius: 6px; padding: 12px; min-height: 72px; }
  </style>
</head>
<body>
  <main>
    <h1>Workspace setup</h1>
    <form id="form">
      <label for="repo">Dotfiles repo</label>
      <input id="repo" name="repo" autocomplete="off" placeholder="https://github.com/user/dotfiles.git" required />
      <label for="key">age key file</label>
      <input id="key" name="key" type="file" />
      <div class="row">
        <input id="remember" name="remember" type="checkbox" ${allowKeyPersistence ? "" : "disabled"} />
        <label for="remember" style="margin:0">${allowKeyPersistence ? "Remember encrypted key for future applies" : "Key persistence disabled for this workspace"}</label>
      </div>
      <button type="submit">Apply dotfiles and mise</button>
    </form>
    <h2>Status</h2>
    <pre id="status">Idle.</pre>
  </main>
  <script>
    const form = document.getElementById("form");
    const status = document.getElementById("status");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "Applying...";
      const file = document.getElementById("key").files[0];
      const body = {
        repo: document.getElementById("repo").value,
        rememberKey: document.getElementById("remember").checked,
        ageKey: file ? await file.text() : undefined,
      };
      const response = await fetch("/setup/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      status.textContent = result.ok ? result.output || "Done." : result.error || "Failed.";
    });
  </script>
</body>
</html>`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if ((url.pathname === "/setup" || url.pathname === "/setup/") && req.method === "HEAD") {
      if (!requireSetupAuthorization(req, res)) return;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end();
      return;
    }
    if ((url.pathname === "/setup" || url.pathname === "/setup/") && req.method === "GET") {
      if (!requireSetupAuthorization(req, res)) return;
      send(res, 200, page, "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/setup/apply" && req.method === "POST") {
      if (!requireSetupAuthorization(req, res)) return;
      if (applyInFlight) {
        send(res, 409, { ok: false, error: "setup is already running" });
        return;
      }
      applyInFlight = true;
      try {
        const result = await applyDotfiles(await readJson(req));
        send(res, 200, { ok: true, output: result });
      } finally {
        applyInFlight = false;
      }
      return;
    }
    send(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    send(res, 500, { ok: false, error: error.message, output: error.output });
  }
}).listen(port, host, () => {
  console.log(`incus-web setup listening on http://${host}:${port}`);
});
