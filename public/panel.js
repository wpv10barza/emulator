import {
  normalizePreview,
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
const previewElement = document.querySelector("#preview");
const previewTarget = document.querySelector("#preview-target");
const previewBefore = document.querySelector("#preview-before");
const previewAfter = document.querySelector("#preview-after");
const previewWarning = document.querySelector("#preview-warning");
const confirmButton = document.querySelector("#confirm");
const rejectButton = document.querySelector("#reject");
let pollTimer;
let pendingCommandId = "";
let pendingPreview = null;

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
  detailElement.textContent = detail || definition.label;
}

function showPreview(commandId, preview) {
  pendingCommandId = commandId;
  pendingPreview = preview;
  previewElement.hidden = false;
  previewTarget.textContent = `Fila ${preview.row} · TareaId ${preview.task_id || "—"} · ${preview.task_name}`;
  previewBefore.textContent = `${preview.before.frequency} ${preview.before.unit}`;
  previewAfter.textContent = `${preview.after.frequency} ${preview.after.unit}`;
  const warnings = preview.warnings || [];
  previewWarning.hidden = warnings.length === 0;
  previewWarning.textContent = warnings.join(" ");
}

function clearPreview() {
  pendingCommandId = "";
  pendingPreview = null;
  previewElement.hidden = true;
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
    const status = normalizeStatus(payload);
    const result = normalizeResult(payload);
    const preview = normalizePreview(payload);
    render(status, result || (status === "pending_confirmation" ? "Confirme la vista previa" : status));
    log(`GET /api/device/v1/commands/${commandId}`, payload);
    if (status === "pending_confirmation" && preview) showPreview(commandId, preview);
    else if (status === "pending_confirmation") pollTimer = setTimeout(() => poll(commandId), 2500);
    else clearPreview();
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
    render("pending_confirmation", "Confirme la vista previa");
    log("POST /api/device/v1/commands", payload);
    const commandId = payload.command_id || payload.command?.id;
    const preview = normalizePreview(payload);
    if (commandId && preview) showPreview(commandId, preview);
    else if (commandId) poll(commandId);
  } catch (error) {
    render("error", error.message);
    log("Fallo de envio", error.payload);
  }
}

async function decide(action) {
  if (!pendingCommandId) return;
  confirmButton.disabled = true;
  rejectButton.disabled = true;
  try {
    render("busy", action === "confirm" ? "Escribiendo y verificando Google Sheets" : "Cancelando orden");
    const payload = await jsonFetch(`/bridge/commands/${pendingCommandId}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept_warnings: action === "confirm" && Boolean(pendingPreview?.warnings?.length) })
    });
    const status = normalizeStatus(payload);
    render(status, normalizeResult(payload) || status);
    log(`POST decisión ${action}`, payload);
    clearPreview();
  } catch (error) {
    render("error", error.message);
    log(`Fallo al ${action}`, error.payload);
  } finally {
    confirmButton.disabled = false;
    rejectButton.disabled = false;
  }
}

document.querySelector("#health").addEventListener("click", health);
document.querySelector("#send").addEventListener("click", sendCommand);
confirmButton.addEventListener("click", () => decide("confirm"));
rejectButton.addEventListener("click", () => decide("reject"));
document.querySelectorAll("[data-demo]").forEach(button => {
  button.addEventListener("click", () => {
    clearTimeout(pollTimer);
    render(button.dataset.demo, "Captura controlada del emulador");
    log(`Modo de captura: ${button.dataset.demo}`);
  });
});

render("booting", "Emulador preparado");
