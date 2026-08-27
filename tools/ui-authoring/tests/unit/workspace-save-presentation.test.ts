import assert from "node:assert/strict";
import test from "node:test";
import { saveAutoSaveInteraction, workspaceSavePresentation } from "../../src/web/workspace/auto-save-toggle.js";
import type { WorkspaceEditingContextValue } from "../../src/web/workspace/workspace-editing-context.js";

function editing(overrides: Partial<WorkspaceEditingContextValue> = {}): WorkspaceEditingContextValue {
  return {
    dirtyDocuments: new Set(),
    autoSaveEnabled: true,
    saveStatus: { phase: "idle", documentIds: new Set() },
    onAutoSaveEnabled: () => {},
    onAutoSaveDocuments: () => {},
    onOpenChanges: () => {},
    ...overrides,
  };
}

test("workspace save presentation keeps meaningful editor notices while Auto Save is enabled", () => {
  const presentation = workspaceSavePresentation(editing(), new Set(["reference:R"]), false, "已复制结构摘要：root");
  assert.deepEqual(presentation, {
    label: "已复制结构摘要：root",
    state: "idle",
  });
});

test("Save and Auto Save share one interaction rule", () => {
  assert.deepEqual(saveAutoSaveInteraction(false, false), { saveDisabled: true, autoSaveDisabled: false });
  assert.deepEqual(saveAutoSaveInteraction(true, false), { saveDisabled: false, autoSaveDisabled: false });
  assert.deepEqual(saveAutoSaveInteraction(false, true), { saveDisabled: true, autoSaveDisabled: false });
  assert.deepEqual(saveAutoSaveInteraction(true, true), { saveDisabled: true, autoSaveDisabled: true });
});

test("workspace save presentation maps stable save notices and active status", () => {
  assert.deepEqual(workspaceSavePresentation(editing(), new Set(["artifact:A"]), false, "已保存 1 个 Artifact"), {
    label: "已保存",
    state: "saved",
  });
  assert.deepEqual(workspaceSavePresentation(editing(), new Set(["reference:R"]), false, "就绪"), { label: "已保存", state: "saved" });
  assert.deepEqual(
    workspaceSavePresentation(
      editing({ saveStatus: { phase: "saving", documentIds: new Set(["artifact:A"]) } }),
      new Set(["artifact:A"]),
      false,
      "已复制 A",
    ),
    { label: "正在保存", state: "saving" },
  );
});

test("workspace save presentation ignores unrelated dirty and saving documents", () => {
  assert.deepEqual(
    workspaceSavePresentation(
      editing({
        dirtyDocuments: new Set(["artifact:B"]),
        saveStatus: { phase: "saving", documentIds: new Set(["artifact:B"]) },
      }),
      new Set(["artifact:A"]),
      false,
      "就绪",
    ),
    { label: "已保存", state: "saved" },
  );
  assert.deepEqual(workspaceSavePresentation(editing(), new Set(["artifact:A"]), true, "就绪"), {
    label: "已修改",
    state: "modified",
  });
});
