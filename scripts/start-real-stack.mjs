import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const backendPort = Number(process.env.REAL_BACKEND_PORT || 3000);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const environment = {
  ...process.env,
  REAL_BACKEND_HOST: "127.0.0.1",
  REAL_BACKEND_PORT: String(backendPort),
  ASSISTANT_BASE_URL: backendUrl,
  BACKEND_TIMEOUT_MS: process.env.BACKEND_TIMEOUT_MS || "15000"
};

const services = [
  ["backend-real", "real-backend.mjs"],
  ["emulador", "server.mjs"]
].map(([name, file]) => ({
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
