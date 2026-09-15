import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const panel = await readFile(new URL("../public/panel.js", import.meta.url), "utf8");

test("screen contains a real in-panel command editor and virtual keyboard", () => {
  assert.match(html, /id="command-input"[^>]*type="text"/);
  assert.match(html, /id="keyboard"[^>]*hidden/);
  assert.match(html, /id="health">PROBAR WSL/);
  assert.match(html, /id="send">ENVIAR 3C/);
  assert.match(panel, /new CommandBuffer\(commandInputElement\.value\)/);
  assert.match(panel, /body: JSON\.stringify\(\{ text \}\)/);
});

test("keyboard is spatially separated from the 82px action buttons", () => {
  assert.match(css, /\.keyboard \{ position: absolute; top: 250px; left: 11px; width: 458px; height: 116px; \}/);
  assert.match(css, /\.touch-row button \{ width: 210px; height: 82px;/);
  assert.match(css, /bottom: 28px;/);
  assert.match(css, /overflow: hidden/);
});
