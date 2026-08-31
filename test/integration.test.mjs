import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const token = "ci-emulator-token";
const backendPort = 3199;
const emulatorPort = 8199;
const children = [];

function start(file, environment) {
  const child = spawn(process.execPath, [file], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  return child;
}

async function waitFor(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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

test("ejecuta el ciclo health -> pending -> applied en Ubuntu", async () => {
  start("mock-backend.mjs", {
    MOCK_BACKEND_PORT: String(backendPort),
    ESP32_API_TOKEN: token
  });
  start("server.mjs", {
    EMULATOR_PORT: String(emulatorPort),
    ASSISTANT_BASE_URL: `http://127.0.0.1:${backendPort}`,
    ESP32_API_TOKEN: token
  });

  const base = `http://127.0.0.1:${emulatorPort}`;
  await waitFor(`${base}/`);

  const health = await (await fetch(`${base}/bridge/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.requires_human_confirmation, true);

  const createdResponse = await fetch(`${base}/bridge/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Cambia la tarea J10 a mensual" })
  });
  assert.equal(createdResponse.status, 202);
  const created = await createdResponse.json();
  assert.equal(created.status, "pending_confirmation");

  const first = await (await fetch(`${base}/bridge/commands/${created.command_id}`)).json();
  assert.equal(first.command.status, "pending_confirmation");
  const second = await (await fetch(`${base}/bridge/commands/${created.command_id}`)).json();
  assert.equal(second.command.status, "applied");

  const evidence = await (await fetch(`${base}/evidence.json`)).json();
  assert.equal(evidence.evidence_type, "emulated_integration");
  assert.equal(evidence.events.length, 4);
  assert.deepEqual(evidence.events.map(event => event.status), [200, 202, 200, 200]);
});
