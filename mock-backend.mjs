import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.MOCK_BACKEND_PORT || 3000);
const host = process.env.MOCK_BACKEND_HOST || "0.0.0.0";
const token = process.env.ESP32_API_TOKEN || "ci-emulator-token";
const commandTtlMs = Math.max(1, Number(process.env.MOCK_BACKEND_COMMAND_TTL_MS || 5 * 60 * 1000));
const defaultCredentials = {
  "ci-emulator-token": { plant_id: "plant-a", device_id: "panel-4848s040-3c-emulator" },
  "plant-a-token": { plant_id: "plant-a", device_id: "device-a" },
  "plant-b-token": { plant_id: "plant-b", device_id: "device-b" }
};
let credentials = defaultCredentials;
try {
  credentials = { ...defaultCredentials, ...JSON.parse(process.env.PLANT_DEVICE_TOKENS_JSON || "{}") };
} catch {
  throw new Error("PLANT_DEVICE_TOKENS_JSON invalido.");
}

const commands = new Map();
const idempotency = new Map();

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

function authorized(request, input = {}) {
  const identity = credentials[request.headers["x-3c-device-token"]];
  if (!identity) return { status: 401, error: "Token del dispositivo invalido." };

  const plantId = String(input.plant_id || "");
  const deviceId = String(input.device_id || "");
  if (plantId !== identity.plant_id || deviceId !== identity.device_id) {
    return { status: 403, error: "El token no esta autorizado para esta planta o dispositivo." };
  }
  return identity;
}

function commandVisibleToIdentity(command, identity) {
  return command.plant_id === identity.plant_id && command.device_id === identity.device_id;
}

function expireIfNeeded(command) {
  if (command.status !== "expired" && Date.now() >= command.expires_at) {
    command.status = "expired";
    command.result = undefined;
  }
  return command;
}

function publicCommand(command) {
  expireIfNeeded(command);
  return {
    id: command.id,
    request_id: command.request_id,
    plant_id: command.plant_id,
    device_id: command.device_id,
    status: command.status,
    result: command.result,
    expires_at: command.expires_at
  };
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
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

  let input = {};
  if (request.method === "POST" || request.method === "PATCH") {
    try {
      input = await body(request);
    } catch {
      return send(response, 400, { error: "JSON invalido." });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/device/v1/commands") {
    const identity = authorized(request, input);
    if (identity.status) return send(response, identity.status, { error: identity.error });

    const requestId = String(input.request_id || "");
    const key = `${identity.plant_id}|${identity.device_id}|${requestId}`;
    const existingId = idempotency.get(key);
    if (existingId) {
      const existing = commands.get(existingId);
      if (existing) {
        expireIfNeeded(existing);
        return send(response, 202, {
          command_id: existing.id,
          request_id: existing.request_id,
          plant_id: existing.plant_id,
          device_id: existing.device_id,
          status: existing.status,
          requires_human_confirmation: true,
          idempotent_replay: true,
          status_path: `/api/device/v1/commands/${existing.id}`
        });
      }
    }

    const id = randomUUID();
    const now = Date.now();
    const command = {
      id,
      request_id: requestId,
      plant_id: identity.plant_id,
      device_id: identity.device_id,
      text: String(input.text || ""),
      status: "pending_confirmation",
      result: undefined,
      polls: 0,
      created_at: now,
      expires_at: now + commandTtlMs
    };
    commands.set(id, command);
    if (requestId) idempotency.set(key, id);
    return send(response, 202, {
      command_id: id,
      request_id: command.request_id,
      plant_id: command.plant_id,
      device_id: command.device_id,
      status: command.status,
      requires_human_confirmation: true,
      status_path: `/api/device/v1/commands/${id}`
    });
  }

  if (request.method === "GET" && url.pathname === "/api/device/v1/commands") {
    const identity = authorized(request, {
      plant_id: url.searchParams.get("plant_id"),
      device_id: url.searchParams.get("device_id")
    });
    if (identity.status) return send(response, identity.status, { error: identity.error });

    const commandsForPlant = [...commands.values()]
      .map(expireIfNeeded)
      .filter(command => commandVisibleToIdentity(command, identity));
    const status = url.searchParams.get("status");
    const filtered = status ? commandsForPlant.filter(command => command.status === status) : commandsForPlant;
    return send(response, 200, {
      commands: filtered.map(publicCommand)
    });
  }

  const match = url.pathname.match(/^\/api\/device\/v1\/commands\/([A-Za-z0-9-]+)$/);
  if (request.method === "GET" && match) {
    const command = commands.get(match[1]);
    if (!command) return send(response, 404, { error: "Comando no encontrado." });

    const identity = authorized(request, {
      plant_id: url.searchParams.get("plant_id"),
      device_id: url.searchParams.get("device_id")
    });
    if (identity.status) return send(response, identity.status, { error: identity.error });
    if (!commandVisibleToIdentity(command, identity)) return send(response, 403, { error: "El comando pertenece a otra planta o dispositivo." });

    expireIfNeeded(command);
    if (command.status === "expired") {
      return send(response, 410, { command: publicCommand(command), error: "Comando expirado." });
    }

    command.polls += 1;
    if (command.polls >= 2) {
      command.status = "applied";
      command.result = "Confirmacion simulada en Ubuntu";
    }
    return send(response, 200, { command: publicCommand(command) });
  }

  const resultMatch = url.pathname.match(/^\/api\/device\/v1\/commands\/([A-Za-z0-9-]+)\/result$/);
  if (request.method === "PATCH" && resultMatch) {
    const command = commands.get(resultMatch[1]);
    if (!command) return send(response, 404, { error: "Comando no encontrado." });

    const identity = authorized(request, input);
    if (identity.status) return send(response, identity.status, { error: identity.error });
    if (!commandVisibleToIdentity(command, identity)) return send(response, 403, { error: "El comando pertenece a otra planta o dispositivo." });

    expireIfNeeded(command);
    if (command.status === "expired") return send(response, 410, { command: publicCommand(command), error: "Comando expirado." });

    command.result = String(input.result || "");
    if (input.status) command.status = String(input.status);
    return send(response, 200, { command: publicCommand(command) });
  }

  if (request.method !== "GET" && request.method !== "POST" && request.method !== "PATCH") {
    return send(response, 405, { error: "method not allowed" });
  }
  return send(response, 404, { error: "not found" });
}).listen(port, host, () => {
  console.log(`Backend simulado: http://localhost:${port} (${host})`);
});
