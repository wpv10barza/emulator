import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const token = "ci-real-stack-token";
const backendPort = 3299;
const emulatorPort = 8299;
const children = [];

function start(file, env) {
  const child = spawn(process.execPath, [file], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  return child;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Servicio no disponible: ${url}`);
}

test.after(() => {
  for (const child of children) child.kill("SIGTERM");
});

test("real:stack reutiliza un backend compatible que ya ocupa el puerto", async () => {
  start("mock-backend.mjs", {
    MOCK_BACKEND_PORT: String(backendPort),
    MOCK_BACKEND_HOST: "127.0.0.1",
    ESP32_API_TOKEN: token
  });
  await waitFor(`http://127.0.0.1:${backendPort}/api/device/v1/health`);

  const stack = start("scripts/start-real-stack.mjs", {
    REAL_BACKEND_PORT: String(backendPort),
    EMULATOR_PORT: String(emulatorPort),
    ESP32_API_TOKEN: token
  });
  let output = "";
  stack.stdout.on("data", chunk => { output += chunk.toString(); });
  await waitFor(`http://127.0.0.1:${emulatorPort}/healthz`);

  assert.match(output, /Backend compatible ya activo/);
  const bridge = await fetch(`http://127.0.0.1:${emulatorPort}/bridge/health`);
  assert.equal(bridge.status, 200);
});
