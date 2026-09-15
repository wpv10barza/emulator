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
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Servicio no disponible: ${url}`);
}

test.after(() => {
  for (const child of children) child.kill("SIGTERM");
});

test("ejecuta el ciclo completo health -> lock -> pending -> applied en Ubuntu", async () => {
  start("mock-backend.mjs", {
    MOCK_BACKEND_PORT: String(backendPort),
    MOCK_BACKEND_HOST: "0.0.0.0",
    ESP32_API_TOKEN: token,
    CELL_LOCK_ACTIVE: "true",
    CELL_LOCK_TTL_S: "120",
    CELL_LOCK_SCOPE: "maintenance-resource-cells"
  });
  start("server.mjs", {
    EMULATOR_PORT: String(emulatorPort),
    EMULATOR_HOST: "0.0.0.0",
    ASSISTANT_BASE_URL: `http://127.0.0.1:${backendPort}`,
    ESP32_API_TOKEN: token
  });

  const base = `http://127.0.0.1:${emulatorPort}`;
  const backendBase = `http://127.0.0.1:${backendPort}`;
  await waitFor(`${base}/healthz`);

  const pageStarted = performance.now();
  const pageResponse = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
  const page = await pageResponse.text();
  const pageElapsed = performance.now() - pageStarted;
  assert.equal(pageResponse.status, 200);
  assert.match(page, /Emulador ESP32-S3-4848S040/);
  assert.match(page, /480 por 480 pixeles/);
  assert.match(page, /ENVIAR 3C/);
  assert.equal(pageResponse.headers.get("content-length"), String(Buffer.byteLength(page)));
  assert.ok(pageElapsed < 1000, `La pagina inicial demoro ${pageElapsed.toFixed(1)} ms`);

  for (const asset of ["/styles.css", "/panel.js", "/panel-model.mjs"]) {
    const response = await fetch(`${base}${asset}`, { signal: AbortSignal.timeout(2000) });
    const body = await response.arrayBuffer();
    assert.equal(response.status, 200, asset);
    assert.equal(response.headers.get("content-length"), String(body.byteLength), asset);
  }

  const health = await (await fetch(`${base}/bridge/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.requires_human_confirmation, true);
  assert.equal(health.cell_lock.active, true);
  assert.equal(health.cell_lock.scope, "maintenance-resource-cells");
  assert.ok(health.cell_lock.ttl_s > 0);

  const rejected = await fetch(`${backendBase}/api/device/v1/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-3c-device-token": "token-invalido"
    },
    body: JSON.stringify({ text: "Cambio no autorizado" })
  });
  assert.equal(rejected.status, 401);

  const metrics = await (await fetch(`${base}/bridge/metrics`)).json();
  assert.equal(metrics.ok, true);
  assert.equal(metrics.auth.scheme, "x-3c-device-token");
  assert.equal(metrics.auth.configured, true);
  assert.equal(metrics.cell_lock.active, true);
  assert.ok(metrics.requests.unauthorized >= 1);

  const createdResponse = await fetch(`${base}/bridge/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Cambia la tarea J10 a mensual" })
  });
  assert.equal(createdResponse.status, 202);
  const created = await createdResponse.json();
  assert.equal(created.status, "pending_confirmation");
  assert.equal(created.cell_lock.active, true);

  const first = await (await fetch(`${base}/bridge/commands/${created.command_id}`)).json();
  assert.equal(first.command.status, "pending_confirmation");
  assert.equal(first.command.cell_lock.active, true);
  const second = await (await fetch(`${base}/bridge/commands/${created.command_id}`)).json();
  assert.equal(second.command.status, "applied");

  const metricsAfter = await (await fetch(`${base}/bridge/metrics`)).json();
  assert.equal(metricsAfter.commands.total_created, 1);
  assert.equal(metricsAfter.commands.applied, 1);
  assert.equal(metricsAfter.commands.pending_confirmation, 0);
  assert.ok(metricsAfter.requests.unauthorized >= 1);

  const evidence = await (await fetch(`${base}/evidence.json`)).json();
  assert.equal(evidence.evidence_type, "emulated_integration");
  assert.equal(evidence.events.length, 7);
  assert.deepEqual(evidence.events.map(event => event.status), [200, 200, 202, 200, 200, 200, 200]);
});
