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
const maxUserinfoBytes = Number.parseInt(process.env.USERINFO_MAX_BYTES || "65536", 10);

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers[name.toLowerCase()];
    if (Array.isArray(value) && value[0]) return value[0];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
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
      let received = 0;
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("data", (chunk) => {
        received += chunk.length;
        if (received > maxUserinfoBytes) {
          req.destroy(new Error("userinfo response too large"));
        }
      });
      res.on("end", () => {
        if ((res.statusCode || 500) >= 400) {
          finish({ name: "", email: "" });
          return;
        }

        try {
          const body = Buffer.concat(chunks, received).toString("utf8");
          const info = JSON.parse(body);
          finish({
            name: String(info.user || info.preferred_username || info.name || "").trim(),
            email: String(info.email || "").trim(),
          });
        } catch {
          finish({ name: "", email: "" });
        }
      });
    });

    req.on("timeout", () => req.destroy());
    req.on("error", () => finish({ name: "", email: "" }));
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
  await recordIdentity(req.headers).catch((error) => {
    console.error(`identity record failed for ${req.method} ${req.url}: ${error.message}`);
  });
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
  recordIdentity(req.headers).catch((error) => {
    console.error(`identity record failed for upgrade ${req.url}: ${error.message}`);
  }).finally(() => {
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
