import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

function send(response, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(data.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(data);
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function safeTokenEqual(expected, candidate) {
  if (!expected || !candidate) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createRealBackendServer({ store, token, now = () => Date.now() }) {
  if (!store) throw new Error("Se requiere un StrategyStore.");
  const commands = new Map();

  function authorized(request) {
    const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const candidate = String(request.headers["x-3c-device-token"] || bearer);
    return safeTokenEqual(token, candidate);
  }

  return createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (request.method === "GET" && url.pathname === "/api/device/v1/health") {
        const sheet = await store.health();
        return send(response, 200, {
          ok: true,
          service: "emulator-real-google-sheets-backend",
          accepts_commands: Boolean(token),
          requires_human_confirmation: true,
          supports_status_polling: true,
          supports_preview: true,
          protocol_version: "1.1",
          target: sheet
        });
      }

      if (!authorized(request)) return send(response, 401, { error: "Token del dispositivo inválido." });

      if (request.method === "POST" && url.pathname === "/api/device/v1/commands") {
        const input = await body(request);
        const text = String(input.text || "").trim();
        const deviceId = String(input.device_id || "").trim();
        const requestId = String(input.request_id || randomUUID()).trim();
        if (!text || !deviceId) return send(response, 400, { error: "device_id y text son obligatorios." });

        const duplicate = [...commands.values()].find(command => command.device_id === deviceId && command.request_id === requestId);
        if (duplicate) return send(response, 200, commandPayload(duplicate, true));

        const preview = await store.preview(text);
        const timestamp = new Date(now()).toISOString();
        const command = {
          id: randomUUID(),
          request_id: requestId,
          device_id: deviceId,
          text,
          status: "pending_confirmation",
          preview,
          created_at: timestamp,
          updated_at: timestamp
        };
        commands.set(command.id, command);
        return send(response, 202, commandPayload(command, false));
      }

      const match = url.pathname.match(/^\/api\/device\/v1\/commands\/([A-Za-z0-9-]+)(?:\/(confirm|reject))?$/);
      if (match) {
        const command = commands.get(match[1]);
        if (!command) return send(response, 404, { error: "Comando no encontrado." });
        if (request.method === "GET" && !match[2]) return send(response, 200, { command });
        if (request.method === "POST" && match[2] === "confirm") {
          if (command.status !== "pending_confirmation") return send(response, 409, { error: "El comando ya fue cerrado.", command });
          const input = await body(request);
          const result = await store.apply(command.preview, { acceptWarnings: input.accept_warnings === true });
          command.status = "applied";
          command.result = result;
          command.updated_at = new Date(now()).toISOString();
          return send(response, 200, { command });
        }
        if (request.method === "POST" && match[2] === "reject") {
          if (command.status !== "pending_confirmation") return send(response, 409, { error: "El comando ya fue cerrado.", command });
          command.status = "rejected";
          command.result = { message: "El usuario rechazó la vista previa; la hoja no fue modificada." };
          command.updated_at = new Date(now()).toISOString();
          return send(response, 200, { command });
        }
      }

      return send(response, 404, { error: "not found" });
    } catch (error) {
      const status = /no tiene acceso|credencial|configurado/i.test(String(error?.message)) ? 503 : 400;
      return send(response, status, { error: String(error?.message || error) });
    }
  });
}

function commandPayload(command, duplicate) {
  return {
    command_id: command.id,
    request_id: command.request_id,
    status: command.status,
    duplicate,
    requires_human_confirmation: true,
    preview: command.preview,
    status_path: `/api/device/v1/commands/${command.id}`,
    confirm_path: `/api/device/v1/commands/${command.id}/confirm`,
    reject_path: `/api/device/v1/commands/${command.id}/reject`
  };
}
