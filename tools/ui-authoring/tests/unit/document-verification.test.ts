import assert from "node:assert/strict";
import test from "node:test";
import {
  createDocumentVerificationService,
  DOCUMENT_VERIFICATION_STAGES,
  type DocumentVerificationStage,
  type DocumentVerificationStageRunners,
  verifyDocument,
} from "../../src/server/document-verification.js";

function passingRunners(calls: DocumentVerificationStage[] = []): DocumentVerificationStageRunners {
  return Object.fromEntries(
    DOCUMENT_VERIFICATION_STAGES.map((stage) => [
      stage,
      async () => {
        calls.push(stage);
        return {
          status: "passed" as const,
          diagnostics: [],
          evidence: [{ path: `.runtime\\verification\\${stage}.json`, kind: "report" }],
        };
      },
    ]),
  );
}

test("verification runs a selected subset in fixed order and normalizes evidence", async () => {
  const calls: DocumentVerificationStage[] = [];
  const result = await verifyDocument(
    {
      path: "MainCanvas.ui.json",
      stages: ["project", "validate", "capture"],
    },
    passingRunners(calls),
  );

  assert.deepEqual(calls, ["validate", "capture", "project"]);
  assert.equal(result.status, "passed");
  assert.deepEqual(
    result.stages.map(({ stage, status }) => ({ stage, status })),
    [
      { stage: "validate", status: "passed" },
      { stage: "capture", status: "passed" },
      { stage: "project", status: "passed" },
    ],
  );
  assert.equal(result.stages[0]?.evidence[0]?.path, ".runtime/verification/validate.json");
});

test("failed validation skips selected dependent stages and records the blocker", async () => {
  const calls: DocumentVerificationStage[] = [];
  const runners = passingRunners(calls);
  const result = await verifyDocument(
    {
      path: "MainCanvas.ui.json",
      stages: ["capture", "project", "validate"],
    },
    {
      ...runners,
      validate: async () => {
        calls.push("validate");
        return {
          status: "failed",
          diagnostics: [{ severity: "error", code: "source.invalid", message: "invalid source" }],
        };
      },
    },
  );

  assert.deepEqual(calls, ["validate"]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.stages, [
    {
      stage: "validate",
      status: "failed",
      diagnostics: [{ severity: "error", code: "source.invalid", message: "invalid source" }],
      evidence: [],
    },
    { stage: "capture", status: "skipped", blockedBy: "validate", diagnostics: [], evidence: [] },
    { stage: "project", status: "skipped", blockedBy: "validate", diagnostics: [], evidence: [] },
  ]);
});

test("capture failure does not block project", async () => {
  const calls: DocumentVerificationStage[] = [];
  const result = await verifyDocument(
    {
      path: "MainCanvas.ui.json",
      stages: ["capture", "project"],
    },
    {
      capture: async () => {
        calls.push("capture");
        return { status: "failed", diagnostics: [{ code: "capture.failed", message: "browser unavailable" }] };
      },
      project: async () => {
        calls.push("project");
        return { status: "passed", evidence: [{ path: "tools/ui-authoring/.runtime/projection/MainCanvas.json" }] };
      },
    },
  );

  assert.deepEqual(calls, ["capture", "project"]);
  assert.equal(result.status, "failed");
  assert.deepEqual(
    result.stages.map(({ stage, status }) => ({ stage, status })),
    [
      { stage: "capture", status: "failed" },
      { stage: "project", status: "passed" },
    ],
  );
});

test("runner exceptions become failed diagnostics and later non-validation stages continue", async () => {
  const calls: DocumentVerificationStage[] = [];
  const result = await createDocumentVerificationService({
    inspect: async () => {
      calls.push("inspect");
      throw new Error("inspect exploded");
    },
    render: async () => {
      calls.push("render");
      return { status: "passed" };
    },
  }).verify({ path: "MainCanvas.ui.json", stages: ["render", "inspect"] });

  assert.deepEqual(calls, ["inspect", "render"]);
  assert.equal(result.stages[0]?.status, "failed");
  assert.deepEqual(result.stages[0]?.diagnostics, [
    {
      severity: "error",
      code: "verification.stage.exception",
      message: "inspect exploded",
    },
  ]);
  assert.equal(result.stages[1]?.status, "passed");
});

test("verification rejects unknown, duplicate, empty stages and missing runners", async () => {
  const runners = passingRunners();
  await assert.rejects(verifyDocument({ path: "a.ui.json", stages: ["lint"] }, runners), /Unknown verification stage 'lint'/);
  await assert.rejects(
    verifyDocument({ path: "a.ui.json", stages: ["render", "render"] }, runners),
    /Duplicate verification stage 'render'/,
  );
  await assert.rejects(verifyDocument({ path: "a.ui.json", stages: [] }, runners), /at least one stage/);
  await assert.rejects(verifyDocument({ path: "a.ui.json", stages: ["capture"] }, {}), /No verification runner configured.*capture/);
});

test("verification rejects evidence outside repository-relative paths", async () => {
  for (const path of ["C:\\temp\\capture.png", "/tmp/capture.png", "../capture.png"]) {
    const result = await verifyDocument(
      { path: "a.ui.json", stages: ["capture"] },
      {
        capture: async () => ({ status: "passed", evidence: [{ path }] }),
      },
    );
    assert.equal(result.stages[0]?.status, "failed");
    assert.match(result.stages[0]?.diagnostics[0]?.message ?? "", /evidence path must be relative/);
  }
});
