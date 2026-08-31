import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResult,
  normalizeStatus,
  stateDefinition,
  stateFromHealth
} from "../public/panel-model.mjs";

test("interpreta la respuesta anidada del backend vigente", () => {
  const payload = { command: { status: "applied", result: "Confirmado en WSL" } };
  assert.equal(normalizeStatus(payload), "applied");
  assert.equal(normalizeResult(payload), "Confirmado en WSL");
});

test("conserva compatibilidad con una respuesta plana", () => {
  assert.equal(normalizeStatus({ status: "rejected" }), "rejected");
});

test("health solo queda listo cuando acepta comandos", () => {
  assert.equal(stateFromHealth({ ok: true, accepts_commands: true }), "ready");
  assert.equal(stateFromHealth({ ok: true, accepts_commands: false }), "error");
});

test("los estados del firmware tienen etiqueta y color", () => {
  for (const state of ["booting", "offline", "ready", "busy", "pending_confirmation", "applied", "rejected", "error"]) {
    assert.ok(stateDefinition(state).label);
    assert.match(stateDefinition(state).background, /^#[0-9a-f]{6}$/i);
  }
});
