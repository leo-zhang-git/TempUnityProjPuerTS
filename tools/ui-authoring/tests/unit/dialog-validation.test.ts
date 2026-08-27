import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { type DocumentCreateDraft, explainDocumentCreateDraftIssue } from "../../src/web/application/document-create-model.js";
import {
  explainArtifactIdentityDraftIssue,
  explainNodeCreateDraftIssue,
  type NodeCreateDraft,
  validNodeCreateDraft,
} from "../../src/web/editors/artifact/artifact-editor-controller.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MainCanvas",
    artifactType: "Canvas",
    root: {
      id: "MainCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "existing",
          rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 100] },
        },
      ],
    },
  };
}

function nodeDraft(overrides: Partial<NodeCreateDraft> = {}): NodeCreateDraft {
  return { id: "created", kind: "Node", artifactKey: "", width: 0, height: 0, ...overrides };
}

function documentDraft(overrides: Partial<DocumentCreateDraft> = {}): DocumentCreateDraft {
  return {
    directory: "Screens",
    kind: "Canvas",
    key: "CreatedCanvas",
    sourcePath: "Screens/CreatedCanvas.ui.json",
    width: 1280,
    height: 720,
    rootArtifactKey: "",
    startReferenceKey: "",
    ...overrides,
  };
}

test("Node create validation accepts zero sizeDelta and explains invalid input", () => {
  assert.equal(explainNodeCreateDraftIssue(nodeDraft(), source()), undefined);
  assert.equal(validNodeCreateDraft(nodeDraft()), true);
  assert.equal(explainNodeCreateDraftIssue(nodeDraft({ id: "existing" }), source()), "Node ID 'existing' 已存在");
  assert.equal(explainNodeCreateDraftIssue(nodeDraft({ width: -1 }), source()), "宽度不能小于 0");
  assert.equal(explainNodeCreateDraftIssue(nodeDraft({ height: Number.NaN }), source()), "高度必须是有效数字");
});

test("Artifact and Document identity validation returns actionable reasons", () => {
  assert.equal(
    explainArtifactIdentityDraftIssue({ artifactKey: "invalid", sourcePath: "Screens/Valid.ui.json" }),
    "Artifact key 必须以大写英文字母开头，且只能包含英文字母和数字",
  );
  assert.equal(
    explainArtifactIdentityDraftIssue({ artifactKey: "Valid", sourcePath: "Screens/Valid.json" }),
    "Source path 必须以 .ui.json 结尾",
  );
  assert.equal(explainDocumentCreateDraftIssue(documentDraft()), undefined);
  assert.equal(explainDocumentCreateDraftIssue(documentDraft({ width: 0 })), "宽度必须大于 0");
  assert.equal(explainDocumentCreateDraftIssue(documentDraft({ height: 10.5 })), "高度必须是整数");
});
