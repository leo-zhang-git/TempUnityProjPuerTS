import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { createWorkspaceChanges } from "../../src/web/application/workspace-changes.js";
import { artifactNodeChangeKinds } from "../../src/web/editors/artifact/artifact-workspace-changes.js";
import type { WorkspaceArtifactMap } from "../../src/web/editors/artifact/artifact-workspace-state.js";

function source(label: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "PanelWidget",
    artifactType: "Widget",
    widgetType: "PanelWidget",
    initialSize: [320, 180],
    root: {
      id: "panelWidget",
      rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [320, 180] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [120, 30] },
          components: { Text: { text: label, fontSize: 16 } },
        },
      ],
    },
  };
}

test("workspace changes expose semantic artifact fields and changed hierarchy nodes", () => {
  const saved: WorkspaceArtifactMap = new Map([["PanelWidget", { path: "PanelWidget.ui.json", source: source("Before") }]]);
  const current: WorkspaceArtifactMap = new Map([["PanelWidget", { path: "PanelWidget.ui.json", source: source("After") }]]);

  const changes = createWorkspaceChanges(saved, current, new Map(), new Map(), new Map(), new Map());
  assert.equal(changes.length, 1);
  assert.ok(
    changes[0]?.changes.some(
      (change) => change.label === "Label (label) · components.Text.text" && change.before === "Before" && change.after === "After",
    ),
  );
  assert.equal(artifactNodeChangeKinds(saved, current, "PanelWidget").get("label"), "modified");
});

test("workspace changes group new and deleted documents", () => {
  const added: WorkspaceArtifactMap = new Map([["PanelWidget", { path: "PanelWidget.ui.json", source: source("New") }]]);
  const changes = createWorkspaceChanges(new Map(), added, new Map(), new Map(), new Map(), new Map());
  assert.equal(changes[0]?.changeKind, "added");
  assert.equal(changes[0]?.id, "artifact:PanelWidget");
});
