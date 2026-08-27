export type EditorKeyboardCommand =
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "undo"
  | "redo"
  | "save"
  | "rename"
  | "createEmpty"
  | "selectTool"
  | "rectTool"
  | "textTool";

export interface EditorKeyboardInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export function resolveEditorKeyboardCommand(
  input: EditorKeyboardInput,
  textEditing: boolean,
  documentTextSelected = false,
): EditorKeyboardCommand | undefined {
  const key = input.key.toLowerCase();
  if (!textEditing && !input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && (key === "delete" || key === "backspace"))
    return "delete";
  if (!textEditing && !input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && key === "f2") return "rename";
  if (!textEditing && !input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && key === "escape") return "selectTool";
  if (!textEditing && !input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && key === "v") return "selectTool";
  if (!textEditing && !input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && key === "r") return "rectTool";
  if (!textEditing && !input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && key === "t") return "textTool";
  if ((!input.ctrlKey && !input.metaKey) || input.altKey) return undefined;
  if (textEditing && (key === "c" || key === "v" || key === "z" || key === "y")) return undefined;
  if (documentTextSelected && key === "c") return undefined;
  if (key === "c" && !input.shiftKey) return "copy";
  if (key === "x" && !input.shiftKey && !textEditing) return "cut";
  if (key === "v" && !input.shiftKey) return "paste";
  if (key === "d" && !input.shiftKey && !textEditing) return "duplicate";
  if (key === "n" && input.shiftKey && !textEditing) return "createEmpty";
  if (key === "z") return input.shiftKey ? "redo" : "undo";
  if (key === "y" && !input.shiftKey) return "redo";
  if (key === "s" && !input.shiftKey) return "save";
  return undefined;
}
