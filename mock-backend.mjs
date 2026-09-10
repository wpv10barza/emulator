import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.MOCK_BACKEND_PORT || 3000);
const host = process.env.MOCK_BACKEND_HOST || "0.0.0.0";
const token = process.env.ESP32_API_TOKEN || "ci-emulator-token";
const commands = new Map();
const startedAt = Date.now();
const metrics = {
  requests_total: 0,
  requests_unauthorized: 0,
  commands_created: 0,
  commands_applied: 0
};

function send(response, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(data.byteLength),
    "cache-control": "no-store"
  });
  response.end(data);
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function authorized(request) {
  return request.headers["x-3c-device-token"] === token;
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  metrics.requests_total += 1;
  console.log(`${new Date().toISOString()} ${request.method} ${url.pathname}`);

  if (request.method === "GET" && url.pathname === "/api/device/v1/health") {
    return send(response, 200, {
      ok: true,
      service: "asistente-3c-device-api-mock",
      accepts_commands: true,
      requires_human_confirmation: true,
      protocol_version: "1.0",
      supports_status_polling: true
    });
  }

  if (request.method === "GET" && url.pathname === "/api/device/v1/metrics") {
    return send(response, 200, {
      ok: true,
      service: "asistente-3c-device-api-mock",
      auth: {
        scheme: "x-3c-device-token",
        configured: Boolean(token)
      },
      uptime_s: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
      commands: {
        pending_confirmation: [...commands.values()].filter(command => command.status === "pending_confirmation").length,
        applied: metrics.commands_applied,
        total_created: metrics.commands_created
      },
      requests: {
        total: metrics.requests_total,
        unauthorized: metrics.requests_unauthorized
      }
    });
  }

  if (!authorized(request)) {
    metrics.requests_unauthorized += 1;
    return send(response, 401, { error: "Token del dispositivo invalido." });
  }

  if (request.method === "POST" && url.pathname === "/api/device/v1/commands") {
    const input = await body(request);
    const id = randomUUID();
    const command = {
      id,
      request_id: input.request_id,
      device_id: input.device_id,
      text: input.text,
      status: "pending_confirmation",
      polls: 0
    };
    commands.set(id, command);
    metrics.commands_created += 1;
    return send(response, 202, {
      command_id: id,
      request_id: command.request_id,
      status: command.status,
      requires_human_confirmation: true,
      status_path: `/api/device/v1/commands/${id}`
    });
  }

  const match = url.pathname.match(/^\/api\/device\/v1\/commands\/([A-Za-z0-9-]+)$/);
  if (request.method === "GET" && match) {
    const command = commands.get(match[1]);
    if (!command) return send(response, 404, { error: "Comando no encontrado." });
    command.polls += 1;
    if (command.polls >= 2 && command.status !== "applied") {
      command.status = "applied";
      command.result = "Confirmacion simulada en Ubuntu";
      metrics.commands_applied += 1;
    }
    return send(response, 200, {
      command: {
        id: command.id,
        request_id: command.request_id,
        device_id: command.device_id,
        status: command.status,
        result: command.result
      }
    });
  }

  return send(response, 404, { error: "not found" });
}).listen(port, host, () => {
  console.log(`Backend simulado: http://localhost:${port} (${host})`);
});
