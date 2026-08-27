import assert from "node:assert/strict";
import test from "node:test";
import { resolveEditorKeyboardCommand } from "../../src/web/editors/artifact/keyboard-commands.js";

function key(key: string, options: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) {
  return {
    key,
    ctrlKey: options.ctrlKey ?? true,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
  };
}

test("routes the supported editor shortcuts", () => {
  assert.equal(resolveEditorKeyboardCommand(key("c"), false), "copy");
  assert.equal(resolveEditorKeyboardCommand(key("x"), false), "cut");
  assert.equal(resolveEditorKeyboardCommand(key("v"), false), "paste");
  assert.equal(resolveEditorKeyboardCommand(key("z"), false), "undo");
  assert.equal(resolveEditorKeyboardCommand(key("z", { shiftKey: true }), false), "redo");
  assert.equal(resolveEditorKeyboardCommand(key("y"), false), "redo");
  assert.equal(resolveEditorKeyboardCommand(key("s"), false), "save");
  assert.equal(resolveEditorKeyboardCommand(key("d"), false), "duplicate");
  assert.equal(resolveEditorKeyboardCommand(key("n", { shiftKey: true }), false), "createEmpty");
  assert.equal(resolveEditorKeyboardCommand(key("F2", { ctrlKey: false }), false), "rename");
  assert.equal(resolveEditorKeyboardCommand(key("v", { ctrlKey: false }), false), "selectTool");
  assert.equal(resolveEditorKeyboardCommand(key("r", { ctrlKey: false }), false), "rectTool");
  assert.equal(resolveEditorKeyboardCommand(key("t", { ctrlKey: false }), false), "textTool");
  assert.equal(resolveEditorKeyboardCommand(key("Escape", { ctrlKey: false }), false), "selectTool");
  assert.equal(resolveEditorKeyboardCommand(key("Delete", { ctrlKey: false }), false), "delete");
  assert.equal(resolveEditorKeyboardCommand(key("Backspace", { ctrlKey: false }), false), "delete");
  assert.equal(resolveEditorKeyboardCommand(key("c", { ctrlKey: false, metaKey: true }), false), "copy");
});

test("keeps text editing commands native while retaining workspace save", () => {
  for (const value of ["c", "v", "z", "y"]) {
    assert.equal(resolveEditorKeyboardCommand(key(value), true), undefined);
  }
  assert.equal(resolveEditorKeyboardCommand(key("z", { shiftKey: true }), true), undefined);
  assert.equal(resolveEditorKeyboardCommand(key("s"), true), "save");
  assert.equal(resolveEditorKeyboardCommand(key("d"), true), undefined);
  assert.equal(resolveEditorKeyboardCommand(key("Delete", { ctrlKey: false }), true), undefined);
  assert.equal(resolveEditorKeyboardCommand(key("c", { altKey: true }), false), undefined);
  assert.equal(resolveEditorKeyboardCommand(key("c", { ctrlKey: false }), false), undefined);
});

test("keeps copy native while ordinary document text is selected", () => {
  assert.equal(resolveEditorKeyboardCommand(key("c"), false, true), undefined);
  assert.equal(resolveEditorKeyboardCommand(key("v"), false, true), "paste");
});
