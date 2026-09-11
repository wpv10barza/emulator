import { createHash } from "node:crypto";

export const STRATEGY_COLUMNS = Object.freeze({
  strategyId: 0,
  taskId: 4,
  name: 5,
  frequency: 11,
  unit: 12,
  deleteMarker: 31
});

const EXPECTED_HEADERS = Object.freeze({
  4: "TareaId",
  5: "Nombre",
  11: "Frecuencia",
  12: "UnidadTiempo",
  31: "Eliminar"
});

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFrequency(text) {
  const normalized = normalizeText(text);
  const numeric = normalized.match(/\bcada\s+(\d+)\s+(mes|meses|ano|anos|dia|dias|semana|semanas|hora|horas)\b/);
  if (numeric) {
    const frequency = Number(numeric[1]);
    if (!Number.isInteger(frequency) || frequency < 1) throw new Error("La frecuencia debe ser un entero positivo.");
    const units = {
      mes: "Mes", meses: "Mes",
      ano: "año", anos: "año",
      dia: "Dia", dias: "Dia",
      semana: "Semana", semanas: "Semana",
      hora: "Hora", horas: "Hora"
    };
    return { frequency, unit: units[numeric[2]], source: numeric[0] };
  }

  const aliases = [
    ["quinquenal", 5, "año"],
    ["cuatrienal", 4, "año"],
    ["bienal", 2, "año"],
    ["anual", 1, "año"],
    ["semestral", 6, "Mes"],
    ["trimestral", 3, "Mes"],
    ["bimestral", 2, "Mes"],
    ["mensual", 1, "Mes"],
    ["semanal", 1, "Semana"],
    ["diaria", 1, "Dia"],
    ["diario", 1, "Dia"]
  ];
  const found = aliases.find(([alias]) => new RegExp(`\\b${alias}\\b`).test(normalized));
  if (!found) {
    throw new Error("No se reconoció la frecuencia. Use mensual, bimestral, trimestral, semestral, anual o cada N meses/años.");
  }
  return { frequency: found[1], unit: found[2], source: found[0] };
}

export function assertStrategyHeaders(headers) {
  for (const [index, expected] of Object.entries(EXPECTED_HEADERS)) {
    const actual = String(headers[Number(index)] ?? "").trim();
    if (actual !== expected) {
      throw new Error(`Contrato inválido: la columna ${columnLetter(Number(index) + 1)} debe ser ${expected}, no ${actual || "vacía"}.`);
    }
  }
}

function columnLetter(number) {
  let value = number;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function findTargetRow(command, rows, dataStartRow) {
  const normalizedCommand = normalizeText(command);
  const candidates = rows
    .map((row, index) => ({
      row,
      rowNumber: dataStartRow + index,
      taskId: String(row?.[STRATEGY_COLUMNS.taskId] ?? "").trim(),
      name: String(row?.[STRATEGY_COLUMNS.name] ?? "").trim(),
      normalizedName: normalizeText(row?.[STRATEGY_COLUMNS.name])
    }))
    .filter(candidate => candidate.normalizedName && normalizedCommand.includes(candidate.normalizedName));

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const longest = Math.max(...candidates.map(candidate => candidate.normalizedName.length));
    const mostSpecific = candidates.filter(candidate => candidate.normalizedName.length === longest);
    if (mostSpecific.length === 1) return mostSpecific[0];
    throw new Error(`La orden coincide con ${candidates.length} filas. Indique el TareaId para evitar una edición ambigua.`);
  }

  const taskIdMatch = normalizedCommand.match(/\b(?:tarea\s*id|tareaid)\s*(\d+)\b/);
  if (taskIdMatch) {
    const byId = rows
      .map((row, index) => ({
        row,
        rowNumber: dataStartRow + index,
        taskId: String(row?.[STRATEGY_COLUMNS.taskId] ?? "").trim(),
        name: String(row?.[STRATEGY_COLUMNS.name] ?? "").trim()
      }))
      .filter(candidate => candidate.taskId === taskIdMatch[1]);
    if (byId.length === 1) return byId[0];
    if (byId.length > 1) throw new Error(`El TareaId ${taskIdMatch[1]} aparece en ${byId.length} filas.`);
  }

  throw new Error("La orden no contiene un Nombre de tarea real ni un TareaId único de la hoja.");
}

function planFingerprint(plan) {
  return createHash("sha256")
    .update(JSON.stringify({
      row: plan.row,
      task_id: plan.task_id,
      task_name: plan.task_name,
      before: plan.before,
      delete_marker: plan.delete_marker
    }))
    .digest("hex");
}

export function buildStrategyPreview({ command, values, headerRow = 4, sheetName = "Data" }) {
  if (!Array.isArray(values) || values.length < 2) throw new Error("La hoja no contiene encabezados y filas de datos.");
  const headers = values[0];
  assertStrategyHeaders(headers);
  const dataStartRow = headerRow + 1;
  const target = findTargetRow(command, values.slice(1), dataStartRow);
  const period = parseFrequency(command);
  const row = target.row;
  const before = {
    frequency: row?.[STRATEGY_COLUMNS.frequency] ?? "",
    unit: row?.[STRATEGY_COLUMNS.unit] ?? ""
  };
  const deleteMarker = String(row?.[STRATEGY_COLUMNS.deleteMarker] ?? "").trim();
  const warnings = [];
  if (/^x$/i.test(deleteMarker)) {
    warnings.push("La columna AF (Eliminar) contiene X. La fila está marcada para eliminación y requiere confirmación explícita.");
  }
  if (String(before.frequency) === String(period.frequency) && normalizeText(before.unit) === normalizeText(period.unit)) {
    warnings.push("La frecuencia solicitada ya coincide con la hoja; no se requiere escritura.");
  }

  const plan = {
    sheet: sheetName,
    row: target.rowNumber,
    strategy_id: String(row?.[STRATEGY_COLUMNS.strategyId] ?? "").trim(),
    task_id: target.taskId,
    task_name: target.name,
    target_range: `${sheetName}!L${target.rowNumber}:M${target.rowNumber}`,
    before,
    after: { frequency: period.frequency, unit: period.unit },
    delete_marker: deleteMarker,
    warnings
  };
  return { ...plan, fingerprint: planFingerprint(plan) };
}

export function assertPlanStillCurrent(plan, rowValues) {
  const current = {
    row: plan.row,
    task_id: String(rowValues?.[STRATEGY_COLUMNS.taskId] ?? "").trim(),
    task_name: String(rowValues?.[STRATEGY_COLUMNS.name] ?? "").trim(),
    before: {
      frequency: rowValues?.[STRATEGY_COLUMNS.frequency] ?? "",
      unit: rowValues?.[STRATEGY_COLUMNS.unit] ?? ""
    },
    delete_marker: String(rowValues?.[STRATEGY_COLUMNS.deleteMarker] ?? "").trim()
  };
  if (planFingerprint(current) !== plan.fingerprint) {
    throw new Error("La fila cambió después de la vista previa. Genere una nueva orden antes de confirmar.");
  }
}
