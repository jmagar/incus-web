#!/usr/bin/env node
import { createServer, request as httpRequest } from "node:http";
import net from "node:net";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";

const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "3090", 10);
const targetHost = process.env.TARGET_HOST || "127.0.0.1";
const targetPort = Number.parseInt(process.env.TARGET_PORT || "3000", 10);
const identityPath = process.env.IDENTITY_PATH || "/run/incus-web/identity-label";
const oauth2ProxyUrl = process.env.OAUTH2_PROXY_URL || "";

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value) && value[0]) return value[0];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2 || parts[1].length > 65536) return {};

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function labelFromBearer(headers) {
  const authorization = firstHeader(headers, ["authorization"]);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return { name: "", email: "" };

  const claims = decodeJwtPayload(match[1]);
  const name = String(
    claims.name ||
    claims.preferred_username ||
    [claims.given_name, claims.family_name].filter(Boolean).join(" ") ||
    claims.user ||
    claims.sub ||
    "",
  ).trim();
  const email = String(claims.email || "").trim();
  return { name, email };
}

function queryUserinfo(headers) {
  if (!oauth2ProxyUrl) return Promise.resolve({ name: "", email: "" });

  const cookie = firstHeader(headers, ["cookie"]);
  if (!cookie) return Promise.resolve({ name: "", email: "" });

  let url;
  try {
    url = new URL("/oauth2/userinfo", oauth2ProxyUrl);
  } catch {
    return Promise.resolve({ name: "", email: "" });
  }

  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      protocol: url.protocol,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: {
        cookie,
        accept: "application/json",
      },
      timeout: 1500,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if ((res.statusCode || 500) >= 400) {
          resolve({ name: "", email: "" });
          return;
        }

        try {
          const body = Buffer.concat(chunks, 65536).toString("utf8");
          const info = JSON.parse(body);
          resolve({
            name: String(info.user || info.preferred_username || info.name || "").trim(),
            email: String(info.email || "").trim(),
          });
        } catch {
          resolve({ name: "", email: "" });
        }
      });
    });

    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve({ name: "", email: "" }));
    req.end();
  });
}

async function recordIdentity(headers) {
  let name = firstHeader(headers, [
    "x-auth-request-name",
    "x-auth-request-preferred-username",
    "x-forwarded-preferred-username",
    "x-forwarded-user",
    "x-auth-request-user",
  ]);
  let email = firstHeader(headers, [
    "x-auth-request-email",
    "x-forwarded-email",
    "x-forwarded-user",
  ]);

  if (!name && !email) {
    ({ name, email } = labelFromBearer(headers));
  }

  if (!name && !email) {
    ({ name, email } = await queryUserinfo(headers));
  }

  const label = name && email && name !== email ? `${name} <${email}>` : name || email;
  if (!label) return;

  await mkdir("/run/incus-web", { recursive: true, mode: 0o755 });
  const tmpPath = `${identityPath}.tmp`;
  await writeFile(tmpPath, `${label}\n`, { mode: 0o644 });
  await rename(tmpPath, identityPath);
}

async function proxyHttp(req, res) {
  await recordIdentity(req.headers).catch(() => {});
  const upstream = httpRequest({
    hostname: targetHost,
    port: targetPort,
    method: req.method,
    path: req.url,
    headers: req.headers,
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`terminal upstream error: ${error.message}\n`);
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  recordIdentity(req.headers).catch(() => {}).finally(() => {
    const upstream = net.connect(targetPort, targetHost, () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) upstream.write(`${name}: ${item}\r\n`);
      } else if (value !== undefined) {
        upstream.write(`${name}: ${value}\r\n`);
      }
    }
    upstream.write("\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on("error", close);
    socket.on("error", close);
  });
}

const server = createServer(proxyHttp);
server.on("upgrade", proxyUpgrade);
await unlink(identityPath).catch(() => {});
server.listen(port, host, () => {
  console.log(`incus-web identity proxy listening on http://${host}:${port} -> http://${targetHost}:${targetPort}`);
});
