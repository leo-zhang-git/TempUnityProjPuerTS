import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import type { UiPublishRequest } from "../../src/schema/ui-unity-job.js";
import { fixture, responseBody, source, startApi, unityJobService } from "./api-test-fixture.js";

test("createApiHandler exposes Unity import, reconcile, publish and job status contracts", async () => {
  const { root, paths } = await fixture();
  const publishRequests: UiPublishRequest[] = [];
  const api = await startApi(paths, undefined, unityJobService(publishRequests));
  try {
    const importResponse = await fetch(`${api.origin}/api/unity/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prefabPath: "Assets/Resources/UI/Prefab/Widget/LegacyWidget/LegacyWidget.prefab",
        sourcePath: "Legacy/LegacyWidget.ui.json",
      }),
    });
    assert.equal(importResponse.status, 200);
    assert.equal(((await responseBody(importResponse)).job as { kind?: unknown }).kind, "import");

    const reconcileResponse = await fetch(`${api.origin}/api/unity/reconcile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: source("A", "current"), scope: "dependencies" }),
    });
    assert.equal(reconcileResponse.status, 200);

    const publishResponse = await fetch(`${api.origin}/api/unity/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: source("A", "current"), confirmScaffold: true }),
    });
    assert.equal(publishResponse.status, 200);
    assert.equal(((await responseBody(publishResponse)).job as { kind?: unknown }).kind, "publish");
    assert.equal(publishRequests[0]?.confirmScaffold, true);
    assert.equal(publishRequests[0]?.runClientTypecheck, false);

    const unrelatedDraft = source("A", "current");
    unrelatedDraft.root.children!.push({
      id: "pendingPrefab",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 100] },
      components: { PrefabRef: { artifactKey: "" } },
    });
    const changesPublishResponse = await fetch(`${api.origin}/api/unity/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: unrelatedDraft, scope: "changes" }),
    });
    assert.equal(changesPublishResponse.status, 200);

    for (const body of [
      { scope: "changes" },
      { source: source("A", "current"), scope: "invalid" },
      { source: source("A", "current"), extra: true },
    ]) {
      const invalidPublishResponse = await fetch(`${api.origin}/api/unity/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(invalidPublishResponse.status, 400);
      assert.match(String((await responseBody(invalidPublishResponse)).error), /API contract/);
    }
    assert.equal(publishRequests.length, 2);

    assert.equal((await fetch(`${api.origin}/api/unity/job?id=job-1`)).status, 200);
    assert.equal((await fetch(`${api.origin}/api/unity/job?id=missing`)).status, 404);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});
