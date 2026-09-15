export const MAX_COMMAND_LENGTH = 48;

export class CommandBuffer {
  constructor(seed = "") {
    this.maxLength = MAX_COMMAND_LENGTH;
    this.value = "";
    this.cursor = 0;
    this.set(seed);
  }

  set(value) {
    this.value = String(value ?? "").slice(0, this.maxLength);
    this.cursor = this.value.length;
    return this.value;
  }

  insert(text) {
    const incoming = String(text ?? "");
    if (!incoming || this.value.length >= this.maxLength) return this.value;
    const capacity = this.maxLength - this.value.length;
    const piece = incoming.slice(0, capacity);
    this.value = this.value.slice(0, this.cursor) + piece + this.value.slice(this.cursor);
    this.cursor += piece.length;
    return this.value;
  }

  backspace() {
    if (this.cursor === 0) return this.value;
    this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
    this.cursor -= 1;
    return this.value;
  }

  clear() {
    this.value = "";
    this.cursor = 0;
    return this.value;
  }

  left() {
    this.cursor = Math.max(0, this.cursor - 1);
    return this.cursor;
  }

  right() {
    this.cursor = Math.min(this.value.length, this.cursor + 1);
    return this.cursor;
  }

  home() {
    this.cursor = 0;
    return this.cursor;
  }

  end() {
    this.cursor = this.value.length;
    return this.cursor;
  }

  setCursor(index) {
    this.cursor = Math.max(0, Math.min(this.value.length, Number(index) || 0));
    return this.cursor;
  }
}

export const KEYBOARD_ROWS = [
  ["1","2","3","4","5","6","7","8","9","0"],
  ["q","w","e","r","t","y","u","i","o","p"],
  ["a","s","d","f","g","h","j","k","l","<"],
  ["z","x","c","v","b","n","m","-","_","."]
];
