import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const backendPort = Number(process.env.REAL_BACKEND_PORT || 3000);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const token = String(process.env.ESP32_API_TOKEN || "");
const environment = {
  ...process.env,
  REAL_BACKEND_HOST: "127.0.0.1",
  REAL_BACKEND_PORT: String(backendPort),
  ASSISTANT_BASE_URL: backendUrl,
  BACKEND_TIMEOUT_MS: process.env.BACKEND_TIMEOUT_MS || "15000"
};

async function portIsOpen() {
  return await new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port: backendPort });
    const finish = value => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(750, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function compatibleBackendIsReady() {
  try {
    const response = await fetch(`${backendUrl}/api/device/v1/health`, {
      headers: token ? { "x-3c-device-token": token } : {},
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true && body?.requires_human_confirmation === true;
  } catch {
    return false;
  }
}

const reuseBackend = await compatibleBackendIsReady();
if (!reuseBackend && await portIsOpen()) {
  console.error(`El puerto ${backendPort} está ocupado por un servicio incompatible.`);
  console.error(`Revíselo con: fuser -v ${backendPort}/tcp`);
  console.error(`Luego deténgalo con: fuser -k ${backendPort}/tcp`);
  process.exit(2);
}

const definitions = reuseBackend
  ? [["emulador", "server.mjs"]]
  : [["backend-real", "real-backend.mjs"], ["emulador", "server.mjs"]];

const services = definitions.map(([name, file]) => ({
  name,
  process: spawn(process.execPath, [file], {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit"
  })
}));

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const service of services) {
    if (!service.process.killed) service.process.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

for (const service of services) {
  service.process.once("exit", (code, signal) => {
    if (stopping) return;
    if (code === 0 || signal === "SIGTERM") return stop(0);
    console.error(`${service.name} terminó inesperadamente (${signal || `código ${code}`}).`);
    stop(code || 1);
  });
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

console.log(`Stack real: emulador:8080 -> backend:${backendPort} -> Google Sheets`);
console.log(`ASSISTANT_BASE_URL fijado de forma segura en ${backendUrl}.`);
if (reuseBackend) console.log(`Backend compatible ya activo en ${backendUrl}; se reutilizará.`);
