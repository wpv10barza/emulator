import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const token = "ci-emulator-token";
const backendPort = 3199;
const emulatorPort = 8199;
const isolationBackendPort = 3299;
const ttlBackendPort = 3399;
const plantTokens = {
  a: "plant-a-token",
  b: "plant-b-token"
};
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

function credentialEnvironment() {
  return {
    PLANT_DEVICE_TOKENS_JSON: JSON.stringify({
      [plantTokens.a]: { plant_id: "plant-a", device_id: "device-a" },
      [plantTokens.b]: { plant_id: "plant-b", device_id: "device-b" }
    })
  };
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

async function jsonRequest(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const payload = await response.json();
  return { response, payload };
}

function authHeaders(tokenName) {
  return { "x-3c-device-token": tokenName };
}

function backendEnvironment(port, extra = {}) {
  return {
    MOCK_BACKEND_PORT: String(port),
    MOCK_BACKEND_HOST: "0.0.0.0",
    ESP32_API_TOKEN: token,
    ...credentialEnvironment(),
    ...extra
  };
}

test.after(() => {
  for (const child of children) child.kill("SIGTERM");
});

test("ejecuta el ciclo health -> pending -> applied en Ubuntu", async () => {
  start("mock-backend.mjs", {
    MOCK_BACKEND_PORT: String(backendPort),
    MOCK_BACKEND_HOST: "0.0.0.0",
    ESP32_API_TOKEN: token
  });
  start("server.mjs", {
    EMULATOR_PORT: String(emulatorPort),
    EMULATOR_HOST: "0.0.0.0",
    ASSISTANT_BASE_URL: `http://127.0.0.1:${backendPort}`,
    ESP32_API_TOKEN: token
  });

  const base = `http://127.0.0.1:${emulatorPort}`;
  await waitFor(`${base}/healthz`);

  const pageStarted = performance.now();
  const pageResponse = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
  const page = await pageResponse.text();
  const pageElapsed = performance.now() - pageStarted;
  assert.equal(pageResponse.status, 200);
  assert.match(page, /Emulador ESP32-S3-4848S040/);
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

test("a-e-h-i-j: aisla tokens, comandos, plantas y claves de idempotencia", async () => {
  start("mock-backend.mjs", backendEnvironment(isolationBackendPort));
  const base = `http://127.0.0.1:${isolationBackendPort}`;
  await waitFor(`${base}/api/device/v1/health`);

  const createA = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.a), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-a", device_id: "device-a", request_id: "req-a-1", text: "A-1" })
  });
  assert.equal(createA.response.status, 202);
  assert.equal(createA.payload.plant_id, "plant-a");
  assert.equal(createA.payload.device_id, "device-a");

  const deniedDeviceB = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.a), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-a", device_id: "device-b", request_id: "req-a-bad-device", text: "D" })
  });
  assert.equal(deniedDeviceB.response.status, 403);

  const deniedPlantB = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.b), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-b", device_id: "device-a", request_id: "req-b-bad-device", text: "E" })
  });
  assert.equal(deniedPlantB.response.status, 403);

  const createB = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.b), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-b", device_id: "device-b", request_id: "req-b-1", text: "B-1" })
  });
  assert.equal(createB.response.status, 202);
  assert.notEqual(createA.payload.command_id, createB.payload.command_id);

  const foreignRead = await jsonRequest(
    base,
    `/api/device/v1/commands/${createB.payload.command_id}?plant_id=plant-a&device_id=device-a`,
    { headers: authHeaders(plantTokens.a) }
  );
  assert.equal(foreignRead.response.status, 403);

  const ownRead = await jsonRequest(
    base,
    `/api/device/v1/commands/${createB.payload.command_id}?plant_id=plant-b&device_id=device-b`,
    { headers: authHeaders(plantTokens.b) }
  );
  assert.equal(ownRead.response.status, 200);

  const foreignUpdate = await jsonRequest(base, `/api/device/v1/commands/${createB.payload.command_id}/result`, {
    method: "PATCH",
    headers: { ...authHeaders(plantTokens.a), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-a", device_id: "device-a", result: "no debe aplicar" })
  });
  assert.equal(foreignUpdate.response.status, 403);

  const ownUpdate = await jsonRequest(base, `/api/device/v1/commands/${createB.payload.command_id}/result`, {
    method: "PATCH",
    headers: { ...authHeaders(plantTokens.b), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-b", device_id: "device-b", result: "resultado B" })
  });
  assert.equal(ownUpdate.response.status, 200);
  assert.equal(ownUpdate.payload.command.plant_id, "plant-b");

  const pendingA = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.a), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-a", device_id: "device-a", request_id: "pending-a", text: "pending A" })
  });
  const pendingB = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.b), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-b", device_id: "device-b", request_id: "pending-b", text: "pending B" })
  });
  assert.equal(pendingA.response.status, 202);
  assert.equal(pendingB.response.status, 202);

  const pendingForA = await jsonRequest(
    base,
    "/api/device/v1/commands?plant_id=plant-a&device_id=device-a&status=pending_confirmation",
    { headers: authHeaders(plantTokens.a) }
  );
  assert.equal(pendingForA.response.status, 200);
  assert.ok(pendingForA.payload.commands.some(command => command.id === pendingA.payload.command_id));
  assert.ok(pendingForA.payload.commands.every(command => command.plant_id === "plant-a"));
  assert.ok(!pendingForA.payload.commands.some(command => command.id === pendingB.payload.command_id));

  const duplicateA = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.a), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-a", device_id: "device-a", request_id: "same-request", text: "first" })
  });
  const replayA = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.a), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-a", device_id: "device-a", request_id: "same-request", text: "second" })
  });
  assert.equal(duplicateA.response.status, 202);
  assert.equal(replayA.response.status, 202);
  assert.equal(replayA.payload.command_id, duplicateA.payload.command_id);
  assert.equal(replayA.payload.idempotent_replay, true);

  const otherScope = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.b), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-b", device_id: "device-b", request_id: "same-request", text: "other scope" })
  });
  assert.equal(otherScope.response.status, 202);
  assert.notEqual(otherScope.payload.command_id, duplicateA.payload.command_id);
});

test("k: el TTL expira comandos sin afectar el contrato normal", async () => {
  start("mock-backend.mjs", backendEnvironment(ttlBackendPort, { MOCK_BACKEND_COMMAND_TTL_MS: "50" }));
  const base = `http://127.0.0.1:${ttlBackendPort}`;
  await waitFor(`${base}/api/device/v1/health`);

  const created = await jsonRequest(base, "/api/device/v1/commands", {
    method: "POST",
    headers: { ...authHeaders(plantTokens.a), "content-type": "application/json" },
    body: JSON.stringify({ plant_id: "plant-a", device_id: "device-a", request_id: "ttl-test", text: "expira" })
  });
  assert.equal(created.response.status, 202);

  await new Promise(resolve => setTimeout(resolve, 100));

  const expired = await jsonRequest(
    base,
    `/api/device/v1/commands/${created.payload.command_id}?plant_id=plant-a&device_id=device-a`,
    { headers: authHeaders(plantTokens.a) }
  );
  assert.equal(expired.response.status, 410);
  assert.equal(expired.payload.command.status, "expired");
});
