import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.EMULATOR_PORT || 8080);
const backend = String(process.env.ASSISTANT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
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

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": contentTypes[".json"] });
  response.end(JSON.stringify(body));
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
    body: body ? JSON.stringify(body) : undefined
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

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(root, safePath);
  try {
    const data = await readFile(path);
    response.writeHead(200, { "content-type": contentTypes[extname(path)] || "application/octet-stream" });
    response.end(data);
  } catch {
    sendJson(response, 404, { error: "not found" });
  }
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/bridge/") || url.pathname === "/evidence.json") {
      const handled = await bridge(request, response, url);
      if (handled !== false) return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    evidence.push({ at: new Date().toISOString(), error: String(error) });
    sendJson(response, 502, { error: String(error.message || error) });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Emulador ESP32-S3-4848S040: http://127.0.0.1:${port}`);
  console.log(`Backend Asistente 3C: ${backend}`);
  if (!token) console.warn("ESP32_API_TOKEN no configurado: POST/GET de comandos sera rechazado.");
});
