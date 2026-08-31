import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPlanStillCurrent,
  buildStrategyPreview,
  parseFrequency
} from "../lib/strategy-sheet.mjs";

function fixture({ deleteMarker = "", frequency = 3 } = {}) {
  const headers = Array(32).fill("");
  headers[4] = "TareaId";
  headers[5] = "Nombre";
  headers[11] = "Frecuencia";
  headers[12] = "UnidadTiempo";
  headers[31] = "Eliminar";
  const row = Array(32).fill("");
  row[0] = 99335;
  row[4] = 102496;
  row[5] = "Inspección de los paneles de distribución LP & DP :)";
  row[11] = frequency;
  row[12] = "Mes";
  row[31] = deleteMarker;
  return [headers, row];
}

test("bimestral se convierte en Frecuencia=2 y UnidadTiempo=Mes", () => {
  assert.deepEqual(parseFrequency("cambia a bimestral"), { frequency: 2, unit: "Mes", source: "bimestral" });
});

test("localiza el Nombre real y construye una vista previa L:M", () => {
  const plan = buildStrategyPreview({
    command: "Cambia la Inspección de los paneles de distribución LP & DP :) a bimestral",
    values: fixture()
  });
  assert.equal(plan.row, 5);
  assert.equal(plan.task_id, "102496");
  assert.equal(plan.target_range, "Data!L5:M5");
  assert.deepEqual(plan.before, { frequency: 3, unit: "Mes" });
  assert.deepEqual(plan.after, { frequency: 2, unit: "Mes" });
  assert.deepEqual(plan.warnings, []);
  assertPlanStillCurrent(plan, fixture()[1]);
});

test("advierte cuando AF marca la fila para eliminación", () => {
  const plan = buildStrategyPreview({
    command: "Cambia la Inspección de los paneles de distribución LP & DP :) a bimestral",
    values: fixture({ deleteMarker: "x" })
  });
  assert.match(plan.warnings[0], /marcada para eliminación/i);
});

test("detiene la confirmación si la fila cambió después de la vista previa", () => {
  const values = fixture();
  const plan = buildStrategyPreview({
    command: "Cambia la Inspección de los paneles de distribución LP & DP :) a bimestral",
    values
  });
  const changed = fixture({ frequency: 4 })[1];
  assert.throws(() => assertPlanStillCurrent(plan, changed), /cambió después de la vista previa/i);
});
