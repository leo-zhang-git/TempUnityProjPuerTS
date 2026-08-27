import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseCliInvocation } from "../../src/cli/arguments.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import { runCli, source } from "./cli-test-fixture.js";

test("naming-audit is a read-only workspace command with reverse consumer evidence", async () => {
  assert.equal(parseCliInvocation(["naming-audit"]).command, "naming-audit");
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-naming-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Audit");
  const sourcePath = join(sourceDirectory, "AuditCanvas.ui.json");
  const referencePath = join(sourceDirectory, "AuditCanvas.ui-reference.json");
  const prototypePath = join(sourceDirectory, "AuditFlow.ui-prototype.json");
  await mkdir(sourceDirectory, { recursive: true });

  const document = source();
  document.bindings = [{ name: "titleText", target: { nodeId: "label", componentType: "Text" } }];
  const reference: UiReference = {
    referenceKey: "AuditCanvas",
    subjectArtifactKey: "MainCanvas",
    values: { titleText: { text: "Audit" } },
  };
  const prototype: UiPrototype = {
    prototypeKey: "AuditFlow",
    startReferenceKey: "AuditCanvas",
    interactions: [
      {
        referenceKey: "AuditCanvas",
        trigger: { kind: "Tap", target: { rootArtifactKey: "MainCanvas", nodeId: "label", componentType: "Text" } },
        actions: [{ kind: "SetValue", owner: { kind: "subject" }, fieldName: "titleText", capability: "text", value: "Changed" }],
      },
    ],
  };
  await writeFile(sourcePath, formatSource(document), "utf8");
  await writeFile(referencePath, formatReference(reference), "utf8");
  await writeFile(prototypePath, formatPrototype(prototype), "utf8");
  const before = await readFile(sourcePath, "utf8");

  try {
    await assert.rejects(runCli(workspaceRoot, ["naming-audit", "Audit/AuditCanvas.ui.json"]), /does not accept a document path/);
    const report = JSON.parse((await runCli(workspaceRoot, ["naming-audit"])).stdout) as {
      files: { artifact: number; reference: number; prototype: number };
      summary: {
        bindings: number;
        violatingBindings: number;
        violations: number;
        ruleCounts: { format: number; prefix: number; node_name: number; primary_reference: number; unconfirmed_type: number };
        consumerOccurrences: number;
        consumerDocuments: number;
      };
      findings: Array<{ bindingName: string; consumers: Array<{ kind: string; key: string; location: string }> }>;
    };
    assert.deepEqual(report.files, { artifact: 1, reference: 1, prototype: 1 });
    assert.deepEqual(report.summary, {
      bindings: 1,
      violatingBindings: 1,
      violations: 2,
      ruleCounts: { format: 1, prefix: 1, node_name: 0, primary_reference: 0, unconfirmed_type: 0 },
      consumerOccurrences: 2,
      consumerDocuments: 2,
    });
    assert.equal(report.findings[0]?.bindingName, "titleText");
    assert.deepEqual(
      report.findings[0]?.consumers.map((consumer) => [consumer.kind, consumer.key, consumer.location]),
      [
        ["prototype", "AuditFlow", "/interactions/0/actions/0/fieldName"],
        ["reference", "AuditCanvas", "/values/titleText"],
      ],
    );
    assert.equal(await readFile(sourcePath, "utf8"), before);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
