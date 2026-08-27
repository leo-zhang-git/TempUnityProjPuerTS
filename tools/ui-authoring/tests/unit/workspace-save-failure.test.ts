import assert from "node:assert/strict";
import test from "node:test";

import type { UiDiagnostic } from "../../src/schema/ui-diagnostics.js";
import { attributedSaveFailureDocumentIds } from "../../src/web/application/workspace-save-failure.js";

function diagnostic(kind: "artifact" | "prototype", key: string): UiDiagnostic {
  return {
    path: `${key}.json`,
    severity: "error",
    category: "save",
    code: "save.externalModification",
    message: "changed",
    owner: kind,
    safeFixable: false,
    nextAction: "reload",
    identity: { documentKind: kind, documentKey: key },
  };
}

test("save failure attribution does not copy one Prototype conflict onto its Artifact save-group peer", () => {
  const candidates = ["artifact:A", "prototype:P"];
  const failures = attributedSaveFailureDocumentIds(candidates, [diagnostic("prototype", "P")], (entry) =>
    entry.identity ? `${entry.identity.documentKind}:${entry.identity.documentKey}` : undefined,
  );

  assert.deepEqual([...failures], ["prototype:P"]);
});

test("save failure attribution keeps all candidates when a dependency diagnostic has no candidate identity", () => {
  const candidates = ["artifact:A", "prototype:P"];
  const failures = attributedSaveFailureDocumentIds(candidates, [diagnostic("prototype", "Outside")], (entry) =>
    entry.identity ? `${entry.identity.documentKind}:${entry.identity.documentKey}` : undefined,
  );

  assert.deepEqual([...failures], candidates);
});
