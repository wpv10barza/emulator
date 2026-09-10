import {
  normalizeResult,
  normalizeStatus,
  stateDefinition,
  stateFromHealth
} from "/panel-model.mjs";

const screen = document.querySelector("#screen");
const stateElement = document.querySelector("#state");
const detailElement = document.querySelector("#detail");
const logElement = document.querySelector("#log");
const commandElement = document.querySelector("#command");
let pollTimer;
let cellLock = { active: false, ttl_s: 0, scope: "" };

function log(message, payload) {
  const suffix = payload ? `\n${JSON.stringify(payload, null, 2)}` : "";
  logElement.textContent = `[${new Date().toISOString()}] ${message}${suffix}\n\n${logElement.textContent}`;
}

function render(state, detail = "") {
  const definition = stateDefinition(state);
  screen.dataset.state = state;
  screen.style.background = definition.background;
  screen.style.setProperty("--screen-bg", definition.background);
  stateElement.textContent = definition.label;
  const lockDetail = cellLock.active
    ? `Bloqueo temporal activo (${Math.ceil(cellLock.ttl_s)} s)`
    : "Bloqueo temporal inactivo";
  detailElement.textContent = detail ? `${detail} · ${lockDetail}` : `${definition.label} · ${lockDetail}`;
}

function setCellLock(payload) {
  const next = payload?.cell_lock || {};
  cellLock = {
    active: next.active === true,
    ttl_s: Number(next.ttl_s || 0),
    scope: String(next.scope || "")
  };
}

async function jsonFetch(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
  return payload;
}

async function health() {
  render("busy", "Verificando endpoint WSL");
  try {
    const payload = await jsonFetch("/bridge/health");
    setCellLock(payload);
    const state = stateFromHealth(payload);
    render(state, state === "ready" ? "Endpoint 3C conectado" : "Backend no disponible");
    log("GET /api/device/v1/health", payload);
  } catch (error) {
    render("error", error.message);
    log("Fallo de health", error.payload);
  }
}

async function poll(commandId) {
  clearTimeout(pollTimer);
  try {
    const payload = await jsonFetch(`/bridge/commands/${commandId}`);
    setCellLock(payload.command);
    const status = normalizeStatus(payload);
    const result = normalizeResult(payload);
    render(status, result || (status === "pending_confirmation" ? "Confirme en Asistente 3C" : status));
    log(`GET /api/device/v1/commands/${commandId}`, payload);
    if (status === "pending_confirmation") pollTimer = setTimeout(() => poll(commandId), 2500);
  } catch (error) {
    render("error", error.message);
    log("Fallo de consulta de estado", error.payload);
  }
}

async function sendCommand() {
  render("busy", "Enviando vista previa");
  try {
    const payload = await jsonFetch("/bridge/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: commandElement.value })
    });
    setCellLock(payload);
    render("pending_confirmation", "Confirme en Asistente 3C");
    log("POST /api/device/v1/commands", payload);
    const commandId = payload.command_id || payload.command?.id;
    if (commandId) poll(commandId);
  } catch (error) {
    render("error", error.message);
    log("Fallo de envio", error.payload);
  }
}

document.querySelector("#health").addEventListener("click", health);
document.querySelector("#send").addEventListener("click", sendCommand);
document.querySelectorAll("[data-demo]").forEach(button => {
  button.addEventListener("click", () => {
    clearTimeout(pollTimer);
    render(button.dataset.demo, "Captura controlada del emulador");
    log(`Modo de captura: ${button.dataset.demo}`);
  });
});

render("booting", "Emulador preparado");
