import {
  normalizeResult,
  normalizeStatus,
  stateDefinition,
  stateFromHealth
} from "/panel-model.mjs";
import { CommandBuffer, KEYBOARD_ROWS } from "/command-input.mjs";

const screen = document.querySelector("#screen");
const stateElement = document.querySelector("#state");
const detailElement = document.querySelector("#detail");
const logElement = document.querySelector("#log");
const commandInputElement = document.querySelector("#command-input");
const keyboardElement = document.querySelector("#keyboard");
const commandBuffer = new CommandBuffer(commandInputElement.value);
let pollTimer;

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

function renderCommandBuffer(focus = true) {
  commandInputElement.value = commandBuffer.value;
  try {
    commandInputElement.setSelectionRange(commandBuffer.cursor, commandBuffer.cursor);
  } catch {
    // Selection is not available until the input is focused in some browsers.
  }
  if (focus) commandInputElement.focus({ preventScroll: true });
}

function setInputMode(enabled) {
  screen.classList.toggle("input-mode", enabled);
  keyboardElement.hidden = !enabled;
  commandInputElement.setAttribute("aria-hidden", enabled ? "false" : "true");
  if (enabled) renderCommandBuffer();
}

function openCommandEditor() {
  clearTimeout(pollTimer);
  commandBuffer.set(commandInputElement.value || "Cambia la tarea J10 a mensual");
  setInputMode(true);
  log("Editor táctil abierto", { maxLength: commandBuffer.maxLength });
}

function closeCommandEditor() {
  setInputMode(false);
  commandInputElement.blur();
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
    render(status, result || (status === "pending_confirmation" ? "Confirme en Asistente 3C" : status));
    log(`GET /api/device/v1/commands/${commandId}`, payload);
    if (status === "pending_confirmation") pollTimer = setTimeout(() => poll(commandId), 2500);
  } catch (error) {
    render("error", error.message);
    log("Fallo de consulta de estado", error.payload);
  }
}

async function sendCommand() {
  const text = commandBuffer.value.trim();
  if (!text) {
    render("error", "Comando vacío");
    log("Envío bloqueado: comando vacío");
    return;
  }
  closeCommandEditor();
  render("busy", "Enviando vista previa");
  try {
    const payload = await jsonFetch("/bridge/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    render("pending_confirmation", "Confirme en Asistente 3C");
    log("POST /api/device/v1/commands", { text, response: payload });
    const commandId = payload.command_id || payload.command?.id;
    if (commandId) poll(commandId);
  } catch (error) {
    render("error", error.message);
    log("Fallo de envío", error.payload);
  }
}

function handleVirtualKey(key) {
  switch (key) {
    case "BK": commandBuffer.backspace(); break;
    case "CLR": commandBuffer.clear(); break;
    case "<-": commandBuffer.left(); break;
    case "->": commandBuffer.right(); break;
    case "HOME": commandBuffer.home(); break;
    case "END": commandBuffer.end(); break;
    case "SPC": commandBuffer.insert(" "); break;
    default: commandBuffer.insert(key); break;
  }
  renderCommandBuffer();
}

commandInputElement.addEventListener("input", () => {
  commandBuffer.set(commandInputElement.value);
  const position = commandInputElement.selectionStart ?? commandBuffer.value.length;
  commandBuffer.setCursor(position);
});
commandInputElement.addEventListener("selectionchange", () => {
  const position = commandInputElement.selectionStart;
  if (typeof position === "number") commandBuffer.setCursor(position);
});

for (const row of KEYBOARD_ROWS) {
  for (const key of row) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key";
    button.dataset.key = key;
    button.textContent = key;
    button.addEventListener("click", () => handleVirtualKey(key));
    keyboardElement.querySelector(".keyboard-letters").appendChild(button);
  }
}

for (const [label, action] of [["SPC", "SPC"], ["BK", "BK"], ["CLR", "CLR"], ["<-", "<-"], ["->", "->"]]) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `key key-special key-${action.replace(/[^a-z]/gi, "")}`;
  button.dataset.key = action;
  button.textContent = label;
  button.addEventListener("click", () => handleVirtualKey(action));
  keyboardElement.querySelector(".keyboard-special").appendChild(button);
}

document.querySelector("#health").addEventListener("click", health);
document.querySelector("#send").addEventListener("click", () => {
  if (!screen.classList.contains("input-mode")) openCommandEditor();
  else sendCommand();
});
document.querySelectorAll("[data-demo]").forEach(button => {
  button.addEventListener("click", () => {
    clearTimeout(pollTimer);
    closeCommandEditor();
    render(button.dataset.demo, "Captura controlada del emulador");
    log(`Modo de captura: ${button.dataset.demo}`);
  });
});

setInputMode(false);
render("booting", "Emulador preparado");
