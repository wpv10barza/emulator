import test from "node:test";
import assert from "node:assert/strict";
import { createRealBackendServer } from "../lib/real-backend-server.mjs";

const token = "real-backend-test-token";

async function withServer(store, callback) {
  const server = createRealBackendServer({ store, token });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function request(base, path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { "x-3c-device-token": token, "content-type": "application/json", ...(options.headers || {}) }
  });
}

test("vista previa y confirmación escriben mediante el store y verifican el resultado", async () => {
  const calls = [];
  const plan = {
    row: 5,
    task_id: "102496",
    task_name: "Inspección de los paneles de distribución LP & DP :)",
    before: { frequency: 3, unit: "Mes" },
    after: { frequency: 2, unit: "Mes" },
    warnings: []
  };
  const store = {
    health: async () => ({ sheet: "Data", header_row: 4 }),
    preview: async text => { calls.push(["preview", text]); return plan; },
    apply: async (received, options) => {
      calls.push(["apply", received, options]);
      return { row: 5, before: plan.before, after: plan.after, verified: true };
    }
  };

  await withServer(store, async base => {
    const health = await (await fetch(`${base}/api/device/v1/health`)).json();
    assert.equal(health.service, "emulator-real-google-sheets-backend");
    const createdResponse = await request(base, "/api/device/v1/commands", {
      method: "POST",
      body: JSON.stringify({ device_id: "panel-test", request_id: "req-1", text: "Cambia la tarea real a bimestral" })
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    assert.equal(created.status, "pending_confirmation");
    assert.deepEqual(created.preview.after, { frequency: 2, unit: "Mes" });

    const confirmedResponse = await request(base, `/api/device/v1/commands/${created.command_id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ accept_warnings: false })
    });
    assert.equal(confirmedResponse.status, 200);
    const confirmed = await confirmedResponse.json();
    assert.equal(confirmed.command.status, "applied");
    assert.equal(confirmed.command.result.verified, true);
  });
  assert.deepEqual(calls.map(call => call[0]), ["preview", "apply"]);
});

test("rechazar una vista previa no llama apply", async () => {
  let applied = false;
  const store = {
    health: async () => ({ sheet: "Data", header_row: 4 }),
    preview: async () => ({ row: 5, before: {}, after: {}, warnings: [] }),
    apply: async () => { applied = true; }
  };
  await withServer(store, async base => {
    const created = await (await request(base, "/api/device/v1/commands", {
      method: "POST",
      body: JSON.stringify({ device_id: "panel-test", request_id: "req-2", text: "No aplicar" })
    })).json();
    const rejected = await (await request(base, `/api/device/v1/commands/${created.command_id}/reject`, {
      method: "POST",
      body: "{}"
    })).json();
    assert.equal(rejected.command.status, "rejected");
  });
  assert.equal(applied, false);
});
