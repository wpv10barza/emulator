import test from "node:test";
import assert from "node:assert/strict";
import { CommandBuffer, KEYBOARD_ROWS, MAX_COMMAND_LENGTH } from "../public/command-input.mjs";

test("command buffer inserts at the touch-selected cursor", () => {
  const buffer = new CommandBuffer("ABCD");
  buffer.setCursor(2);
  buffer.insert("xy");
  assert.equal(buffer.value, "ABxyCD");
  assert.equal(buffer.cursor, 4);
});

test("backspace, arrows, home and end edit without overflow", () => {
  const buffer = new CommandBuffer("ABCD");
  buffer.left();
  buffer.backspace();
  assert.equal(buffer.value, "ABD");
  assert.equal(buffer.cursor, 2);
  buffer.home();
  buffer.insert("x");
  buffer.end();
  assert.equal(buffer.value, "xABD");
  assert.equal(buffer.cursor, 4);
});

test("buffer is capped at the physical keyboard contract", () => {
  const buffer = new CommandBuffer("x".repeat(MAX_COMMAND_LENGTH + 10));
  assert.equal(buffer.value.length, MAX_COMMAND_LENGTH);
  buffer.insert("y");
  assert.equal(buffer.value.length, MAX_COMMAND_LENGTH);
});

test("keyboard exposes numbers, letters and editing rows", () => {
  assert.equal(KEYBOARD_ROWS.length, 4);
  assert.equal(KEYBOARD_ROWS[0].join(""), "1234567890");
  assert.equal(KEYBOARD_ROWS[1].join(""), "qwertyuiop");
  assert.equal(KEYBOARD_ROWS[2][0], "a");
  assert.equal(KEYBOARD_ROWS[3][7], "-");
});
