import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../esp32-3C/", import.meta.url);
const header = await readFile(new URL("src/command_input.h", root), "utf8");
const implementation = await readFile(new URL("src/command_input.cpp", root), "utf8");
const panel = await readFile(new URL("src/panel_4848s040_main.cpp", root), "utf8");

const checks = [
  ["header exists", header.length > 0],
  ["implementation exists", implementation.length > 0],
  ["panel includes command input", panel.includes('#include "command_input.h"')],
  ["ENVIAR opens editor", panel.includes("commandInput.open(app_config::defaultCommand)")],
  ["edited buffer reaches 3C sender", panel.includes("send3CCommand(command)")],
  ["48-character buffer", /kMaxLength\s*=\s*48/.test(header)],
  ["480x480 screen constants", /kFieldY\s*=\s*207/.test(header) && /kKeyboardY\s*=\s*258/.test(header)],
  ["keyboard width", /kKeyW\s*=\s*44/.test(header)],
  ["keyboard height", /kKeyH\s*=\s*20/.test(header)],
  ["keyboard contains editing actions", /BK/.test(implementation) && /CLR/.test(implementation) && /SPC/.test(implementation)],
];

const failures = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
assert.equal(failures.length, 0, `Physical input contract failed: ${failures.map(([name]) => name).join(", ")}`);
console.log("Physical 480x480 input contract: OK");
