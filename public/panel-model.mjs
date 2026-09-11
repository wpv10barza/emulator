export const PANEL_STATES = Object.freeze({
  booting: { label: "INICIANDO", background: "#0a1226" },
  offline: { label: "SIN CONEXION", background: "#12161e" },
  ready: { label: "WSL DISPONIBLE", background: "#052d1b" },
  busy: { label: "PROCESANDO", background: "#081c3a" },
  pending_confirmation: { label: "ESPERA CONFIRMACION", background: "#442b02" },
  applied: { label: "CAMBIO APLICADO", background: "#02411c" },
  rejected: { label: "ORDEN CANCELADA", background: "#3e1d03" },
  error: { label: "ERROR", background: "#410509" }
});

export function normalizeStatus(payload) {
  return payload?.command?.status ?? payload?.status ?? "error";
}

export function normalizeResult(payload) {
  const result = payload?.command?.result ?? payload?.result ?? "";
  if (typeof result === "string") return result;
  if (result?.verified) return `Fila ${result.row} verificada: ${result.before.frequency} ${result.before.unit} → ${result.after.frequency} ${result.after.unit}`;
  return result?.message ?? "";
}

export function normalizePreview(payload) {
  return payload?.command?.preview ?? payload?.preview ?? null;
}

export function stateFromHealth(payload) {
  return payload?.ok && payload?.accepts_commands ? "ready" : "error";
}

export function stateDefinition(state) {
  return PANEL_STATES[state] ?? PANEL_STATES.error;
}
