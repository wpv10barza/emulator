import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.EMULATOR_PORT || 8080);
const host = process.env.EMULATOR_HOST || "0.0.0.0";
const backend = String(process.env.ASSISTANT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const backendTimeoutMs = Math.max(250, Number(process.env.BACKEND_TIMEOUT_MS || 5000));
const token = process.env.ESP32_API_TOKEN || "";
const deviceId = process.env.DEVICE_ID || "panel-4848s040-3c-emulator";
const evidence = [];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendBuffer(response, status, body, contentType) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": String(data.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(data);
}

function sendJson(response, status, body) {
  sendBuffer(response, status, JSON.stringify(body), contentTypes[".json"]);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function callBackend(method, path, body) {
  const started = performance.now();
  const headers = { accept: "application/json" };
  if (token) headers["x-3c-device-token"] = token;
  if (body) headers["content-type"] = "application/json";
  const response = await fetch(`${backend}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(backendTimeoutMs)
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  evidence.push({
    at: new Date().toISOString(),
    method,
    path,
    status: response.status,
    elapsed_ms: Number((performance.now() - started).toFixed(2)),
    response: payload
  });
  return { status: response.status, payload };
}

async function bridge(request, response, url) {
  if (request.method === "GET" && url.pathname === "/bridge/health") {
    const result = await callBackend("GET", "/api/device/v1/health");
    return sendJson(response, result.status, result.payload);
  }

  if (request.method === "POST" && url.pathname === "/bridge/commands") {
    const input = await readBody(request);
    const result = await callBackend("POST", "/api/device/v1/commands", {
      device_id: deviceId,
      request_id: `${deviceId}-${randomUUID()}`,
      text: String(input.text || "Cambia la tarea J10 a mensual")
    });
    return sendJson(response, result.status, result.payload);
  }

  const statusMatch = url.pathname.match(/^\/bridge\/commands\/([A-Za-z0-9-]+)$/);
  if (request.method === "GET" && statusMatch) {
    const result = await callBackend("GET", `/api/device/v1/commands/${statusMatch[1]}`);
    return sendJson(response, result.status, result.payload);
  }

  if (request.method === "GET" && url.pathname === "/evidence.json") {
    return sendJson(response, 200, {
      evidence_type: "emulated_integration",
      target: "ESP32-S3-4848S040 UI 480x480",
      backend,
      device_id: deviceId,
      generated_at: new Date().toISOString(),
      events: evidence
    });
  }
  return false;
}

async function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    return sendJson(response, 405, { error: "method not allowed" });
  }
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(root, safePath);
  try {
    const data = await readFile(path);
    const contentType = contentTypes[extname(path)] || "application/octet-stream";
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        "content-type": contentType,
        "content-length": String(data.byteLength),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      return response.end();
    }
    sendBuffer(response, 200, data, contentType);
  } catch {
    sendJson(response, 404, { error: "not found" });
  }
}

const server = createServer(async (request, response) => {
  const started = performance.now();
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    response.once("finish", () => {
      const elapsed = (performance.now() - started).toFixed(1);
      console.log(`${request.method} ${url.pathname} ${response.statusCode} ${elapsed}ms`);
    });
    if (request.method === "GET" && url.pathname === "/healthz") {
      return sendJson(response, 200, { ok: true, service: "esp32-4848s040-emulator" });
    }
    if (url.pathname.startsWith("/bridge/") || url.pathname === "/evidence.json") {
      const handled = await bridge(request, response, url);
      if (handled !== false) return;
    }
    await serveStatic(request, response, url.pathname);
  } catch (error) {
    evidence.push({ at: new Date().toISOString(), error: String(error) });
    sendJson(response, 502, { error: String(error.message || error) });
  }
});

server.requestTimeout = Math.max(backendTimeoutMs + 2000, 7000);
server.headersTimeout = 5000;
server.keepAliveTimeout = 3000;
server.on("error", error => {
  console.error(`No se pudo iniciar el emulador en ${host}:${port}: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Emulador ESP32-S3-4848S040: http://localhost:${port}`);
  console.log(`Escuchando para WSL/contenedor en ${host}:${port}`);
  console.log(`Backend Asistente 3C: ${backend}`);
  if (!token) console.warn("ESP32_API_TOKEN no configurado: POST/GET de comandos sera rechazado.");
});
