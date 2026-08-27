import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { formatSource } from "../../src/kernel/canonical.js";
import { type DeliveryState, deliveryStatePath, formatDeliveryState } from "../../src/kernel/delivery-state.js";
import type { ProjectionNode } from "../../src/kernel/projection.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import type { UiUnityJobProgressStep, UiUnityJobSnapshot } from "../../src/schema/ui-unity-job.js";
import type { UnityBridgeResponse } from "../../src/server/unity-job/contracts.js";
import { type ProgramGateRunner, type UnityJobExecutor, UnityJobService } from "../../src/server/unity-job-service.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";

export function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StatusWidget",
    artifactType: "Widget",
    widgetType: "StatusWidget",
    initialSize: [200, 60],
    root: {
      id: "StatusWidget",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [200, 60] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [200, 60] },
          components: { Text: { text: "Ready", fontSize: 20 } },
        },
      ],
    },
  };
}

export function autoLayoutSource(): UiConcreteSource {
  const value = source();
  const label = value.root.children![0]!;
  label.id = "txt_label";
  label.name = "txt_label";
  return {
    ...value,
    bindings: [{ name: "txt_label", target: { nodeId: "txt_label", componentType: "Text" } }],
    root: { ...value.root, components: { AutoLayoutGroup: { mode: "horizontal", spacing: 8 } } },
  };
}

export function fragmentSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "SharedFragment",
    artifactType: "Fragment",
    initialSize: [120, 30],
    root: {
      id: "SharedFragment",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [120, 30] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [120, 30] },
          components: { Text: { text: "Shared", fontSize: 18 } },
        },
      ],
    },
  };
}

export function sourceWithFragment(): UiConcreteSource {
  const value = source();
  return {
    ...value,
    root: {
      ...value.root,
      children: [
        ...(value.root.children ?? []),
        {
          id: "shared",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, -30], sizeDelta: [120, 30] },
          components: { PrefabRef: { artifactKey: "SharedFragment" } },
        },
      ],
    },
  };
}

export async function fixture(): Promise<{ readonly root: string; readonly paths: WorkspacePaths }> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-unity-job-"));
  const sourceRoot = join(root, "My project", "UIAuthoring", "Sources");
  const assetRoot = join(root, "My project", "Assets", "Resources", "UI");
  const runtimeRoot = join(root, "tools", "ui-authoring", ".runtime");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await writeFile(join(sourceRoot, "StatusWidget.ui.json"), formatSource(source()), "utf8");
  return {
    root,
    paths: {
      repoRoot: root,
      sourceRoot,
      assetRoot,
      runtimeRoot,
      defaultArtifact: "StatusWidget.ui.json",
      defaultPrototype: "Flow.ui-prototype.json",
    },
  };
}

/** 让 fixture workspace 具备 Git 归属，使发布路径能被 workspaceChangePaths 观察到。 */
export async function initGitWorkingCopy(root: string): Promise<void> {
  await promisify(execFile)("git", ["init", "--quiet"], { cwd: root });
}

export async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

export class FakeUnityExecutor implements UnityJobExecutor {
  readonly requests: unknown[] = [];
  readonly prefabImportBasePaths = new Map<string, string | null>();
  formalObservationHasIdentity = true;
  hasExistingFormalObservation = false;
  preserveFormalUnityOnlyComponent = false;
  formalLabelText: string | undefined;
  failAfterApply = false;
  mutatePrefabAfterObservationArtifactKey: string | undefined;

  constructor(readonly root: string) {}

  async execute(
    requestPath: string,
    resultPath: string,
    _logPath = "",
    _signal?: AbortSignal,
    onProgress?: (progress: UiUnityJobProgressStep) => void,
  ): Promise<UnityBridgeResponse> {
    const request = JSON.parse(await readFile(join(this.root, requestPath), "utf8")) as {
      kind?: "observe" | "observe-plan";
      projectionPaths?: string[];
      deliveryStatePaths?: Array<string | null>;
      artifactKeys?: string[];
      artifacts?: string[];
    };
    this.requests.push(request);
    const projectionPaths = request.artifacts
      ? request.artifacts.map((artifact) => join(requestPath, "..", "..", "projection", `${artifact}.projection.json`))
      : (request.projectionPaths ?? []);
    const projections = await Promise.all(
      projectionPaths.map(
        async (path) =>
          JSON.parse(await readFile(join(this.root, path), "utf8")) as {
            artifactKey: string;
            artifactType: "Canvas" | "Widget" | "Fragment";
            prefabPath: string;
            root: ProjectionNode;
          },
      ),
    );
    const projection = projections.at(-1)!;
    if (request.kind === "observe-plan") {
      onProgress?.({
        id: "reconcile.unity-observe",
        label: "读取正式 Prefab",
        status: "running",
        completed: 0,
        total: Math.max(1, request.artifactKeys?.length ?? 0),
      });
      const selected = (request.artifactKeys ?? []).map((artifactKey) => {
        const entry = projections.find((candidate) => candidate.artifactKey === artifactKey);
        if (!entry) throw new Error(`Missing test Projection '${artifactKey}'`);
        return observation(entry, this.formalObservationHasIdentity, false, this.formalLabelText ?? "From Unity");
      });
      onProgress?.({
        id: "reconcile.unity-observe",
        label: "读取正式 Prefab",
        status: "succeeded",
        completed: selected.length,
        total: Math.max(1, selected.length),
      });
      await put(this.root, resultPath, `${JSON.stringify({ ok: true, kind: "observe-plan", observations: selected })}\n`);
      return await this.#readResponse(resultPath);
    }
    if (request.artifacts) {
      onProgress?.({
        id: "publish.unity-import",
        label: "发布正式 Prefab",
        status: "running",
        completed: 0,
        total: projections.length,
        ...(projections[0]?.artifactKey ? { currentItem: projections[0].artifactKey } : {}),
      });
      if (this.preserveFormalUnityOnlyComponent) {
        await put(
          this.root,
          resultPath,
          `${JSON.stringify({
            ok: true,
            kind: "publish-plan",
            publish: {
              delivery: "blocked",
              blockers: [
                {
                  code: "publish.componentUnsupported",
                  artifactKey: projection.artifactKey,
                  message: "Unity-only component is unsupported",
                  path: "/prefab/StatusWidget/Game.LegacyBehaviour",
                },
              ],
            },
          })}\n`,
        );
        return await this.#readResponse(resultPath);
      }
      await this.#applyPublish(projections);
      onProgress?.({
        id: "publish.unity-import",
        label: "发布正式 Prefab",
        status: "succeeded",
        completed: projections.length,
        total: projections.length,
        ...(projections.at(-1)?.artifactKey ? { currentItem: projections.at(-1)!.artifactKey } : {}),
      });
      if (this.failAfterApply) throw new Error("fixture Unity process exited after apply");
      await put(
        this.root,
        resultPath,
        `${JSON.stringify({
          ok: true,
          kind: "publish-plan",
          publish: {
            delivery: "applied",
            imports: projections.map((entry) => ({
              prefabPath: entry.prefabPath,
              beforeHash: "",
              afterHash: "formal",
              noOp: false,
              nodeCount: 2,
              reusedNodes: 0,
              createdNodes: 2,
              removedNodes: 0,
              bindingCount: 0,
              stabilizationPasses: 2,
              auditIssues: [],
              baselineIssues: [],
            })),
            formalObservations: projections.map((entry) => observation(entry, this.formalObservationHasIdentity)),
            generatedInventory: projections.map(generatedBindingPath),
          },
        })}\n`,
      );
      return await this.#readResponse(resultPath);
    }
    if (this.prefabImportBasePaths.has(projection.artifactKey)) {
      const prefabFile = join(this.root, "My project", ...projection.prefabPath.split("/"));
      const rawPrefabHash = createHash("sha256")
        .update(await readFile(prefabFile))
        .digest("hex");
      const basePrefabPath = this.prefabImportBasePaths.get(projection.artifactKey);
      const inheritedWidgetType = basePrefabPath
        ?.split("/")
        .at(-1)
        ?.replace(/\.prefab$/, "");
      await put(
        this.root,
        resultPath,
        `${JSON.stringify({
          ok: true,
          kind: "observe",
          observation: {
            artifactKey: projection.artifactKey,
            artifactType: "Widget",
            prefabPath: projection.prefabPath,
            ...(basePrefabPath ? { basePrefabPath } : {}),
            localWidgetType: basePrefabPath ? "" : projection.artifactKey,
            effectiveWidgetType: inheritedWidgetType ?? projection.artifactKey,
            rawPrefabHash,
            suggestedDesignSize: [320, 180],
            issues: [],
            nodes: [
              {
                id: projection.artifactKey,
                identity: "projection",
                name: projection.artifactKey,
                namePath: [projection.artifactKey],
                parentId: null,
                siblingIndex: 0,
                active: true,
                rect: projection.root.rect,
                components: {},
                completeComponents: true,
                unityOnlyComponents: [],
              },
            ],
            bindings: [],
          },
        })}\n`,
      );
      if (this.mutatePrefabAfterObservationArtifactKey === projection.artifactKey) {
        await writeFile(prefabFile, "changed-after-observation\n", "utf8");
      }
      return await this.#readResponse(resultPath);
    }
    if (projection.artifactKey === "LegacyWidget") {
      const prefabFile = join(this.root, "My project", ...projection.prefabPath.split("/"));
      const rawPrefabHash = createHash("sha256")
        .update(await readFile(prefabFile))
        .digest("hex");
      await put(
        this.root,
        resultPath,
        `${JSON.stringify({
          ok: true,
          kind: "observe",
          observation: {
            artifactKey: "LegacyWidget",
            artifactType: "Widget",
            prefabPath: projection.prefabPath,
            localWidgetType: "LegacyWidget",
            effectiveWidgetType: "LegacyWidget",
            rawPrefabHash,
            suggestedDesignSize: [320, 180],
            issues: [],
            nodes: [
              {
                id: "LegacyWidget",
                identity: "projection",
                name: "LegacyWidget",
                namePath: ["LegacyWidget"],
                parentId: null,
                siblingIndex: 0,
                active: true,
                rect: projection.root.rect,
                components: {},
                completeComponents: true,
                unityOnlyComponents: [],
              },
              {
                id: "txt_label",
                identity: "generated",
                name: "txt_label",
                namePath: ["LegacyWidget", "txt_label"],
                parentId: "LegacyWidget",
                siblingIndex: 0,
                active: true,
                rect: {
                  anchorMin: [0, 1],
                  anchorMax: [0, 1],
                  pivot: [0, 1],
                  anchoredPosition: [0, 0],
                  sizeDelta: [100, 30],
                  rotation: 0,
                  scale: [1, 1],
                },
                components: { Text: { text: "Imported", fontSize: 20 } },
                completeComponents: true,
                unityOnlyComponents: [],
              },
            ],
            bindings: [{ fieldName: "txt_label", nodeId: "txt_label", componentType: "Text" }],
          },
        })}\n`,
      );
      return await this.#readResponse(resultPath);
    }
    const result = {
      ok: true,
      kind: "observe",
      observation: {
        artifactKey: projection.artifactKey,
        prefabPath: projection.prefabPath,
        issues: [],
        nodes: observationNodes(projection.root, [], false, { value: 100 }, false, "From Unity"),
      },
    };
    await mkdir(join(this.root, resultPath, ".."), { recursive: true });
    await writeFile(join(this.root, resultPath), `${JSON.stringify(result)}\n`, "utf8");
    return result as UnityBridgeResponse;
  }

  async #readResponse(resultPath: string): Promise<UnityBridgeResponse> {
    return JSON.parse(await readFile(join(this.root, resultPath), "utf8")) as UnityBridgeResponse;
  }

  async #applyPublish(projections: readonly { artifactKey: string; prefabPath: string }[]): Promise<void> {
    for (const projection of projections) {
      const target = join(this.root, ...`My project/${projection.prefabPath}`.split("/"));
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, `published:${projection.artifactKey}\n`, "utf8");
    }
  }
}

export class ConcurrencyTrackingExecutor implements UnityJobExecutor {
  active = 0;
  maxActive = 0;

  constructor(readonly delegate: UnityJobExecutor) {}

  async execute(
    requestPath: string,
    resultPath: string,
    logPath: string,
    signal?: AbortSignal,
    onProgress?: (progress: UiUnityJobProgressStep) => void,
  ): Promise<UnityBridgeResponse> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return await this.delegate.execute(requestPath, resultPath, logPath, signal, onProgress);
    } finally {
      this.active -= 1;
    }
  }
}

export class AbortAwareExecutor implements UnityJobExecutor {
  readonly started: Promise<void>;
  calls = 0;
  #markStarted!: () => void;

  constructor() {
    this.started = new Promise((resolve) => {
      this.#markStarted = resolve;
    });
  }

  async execute(_requestPath: string, _resultPath: string, _logPath: string, signal?: AbortSignal): Promise<UnityBridgeResponse> {
    this.calls += 1;
    this.#markStarted();
    return await new Promise<UnityBridgeResponse>((_resolve, reject) => {
      const abort = (): void => reject(new Error("fixture executor aborted"));
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

function generatedBindingPath(projection: {
  readonly artifactKey: string;
  readonly artifactType: "Canvas" | "Widget" | "Fragment";
}): string {
  const name = projection.artifactKey.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const kind = projection.artifactType === "Canvas" ? "canvas" : "widget";
  return `TsProj/src/ui/generated/${kind}/${name}-ui.ts`;
}

export function observation(
  projection: {
    artifactKey: string;
    prefabPath: string;
    localWidgetType?: string;
    effectiveWidgetType?: string;
    root: ProjectionNode;
  },
  includeIdentity: boolean,
  includeUnityOnly = false,
  labelText?: string,
): unknown {
  return {
    artifactKey: projection.artifactKey,
    prefabPath: projection.prefabPath,
    ...(projection.localWidgetType !== undefined ? { localWidgetType: projection.localWidgetType } : {}),
    ...(projection.effectiveWidgetType !== undefined ? { effectiveWidgetType: projection.effectiveWidgetType } : {}),
    ...(includeIdentity ? { prefabGuid: "0123456789abcdef0123456789abcdef" } : {}),
    issues: [],
    ...(includeUnityOnly
      ? {
          diagnostics: [
            {
              code: "component.unityOnly.unregistered",
              message: "StatusWidget contains Unity component 'Game.LegacyBehaviour' without a registered Source or Unity-only owner",
              path: "/prefab/StatusWidget/Game.LegacyBehaviour",
              nodeId: "StatusWidget",
              componentType: "Game.LegacyBehaviour",
            },
          ],
        }
      : {}),
    nodes: observationNodes(projection.root, [], includeIdentity, { value: 100 }, includeUnityOnly, labelText),
  };
}

export function deliveryStateFixture(): DeliveryState {
  return {
    prefabGuid: "0123456789abcdef0123456789abcdef",
    nodes: { StatusWidget: "100" },
  };
}

export async function putDeliveryState(root: string, state = deliveryStateFixture()): Promise<void> {
  await put(root, deliveryStatePath("StatusWidget"), formatDeliveryState(state));
}

function observationNodes(
  root: ProjectionNode,
  parentPath: readonly string[] = [],
  includeIdentity = false,
  nextId = { value: 100 },
  includeUnityOnly = false,
  labelText?: string,
): unknown[] {
  const namePath = [...parentPath, root.name];
  const components = structuredClone(root.components) as Record<string, Record<string, unknown>>;
  const prefabPath = components.PrefabRef?.prefabPath;
  if (root.id === "label" && components.Text && labelText !== undefined) components.Text.text = labelText;
  const localFileId = String(nextId.value++);
  return [
    {
      id: root.id,
      name: root.name,
      namePath,
      active: root.active,
      rect: root.rect,
      components,
      completeComponents: true,
      ...(typeof prefabPath === "string" ? { prefabPath } : {}),
      unityOnlyComponents: includeUnityOnly && root.id === "StatusWidget" ? ["Game.LegacyBehaviour"] : [],
      ...(includeUnityOnly && root.id === "StatusWidget"
        ? { unityOnlySnapshots: [{ componentType: "Game.LegacyBehaviour", fields: { alpha: 0.75 } }] }
        : {}),
      ...(includeIdentity ? { localFileId } : {}),
    },
    ...root.children.flatMap((child) => observationNodes(child, namePath, includeIdentity, nextId, includeUnityOnly, labelText)),
  ];
}

export class FakeProgramGate implements ProgramGateRunner {
  prepareCalls = 0;
  calls = 0;
  failure: Error | undefined;

  async prepareClientTypecheck(): Promise<void> {
    this.prepareCalls += 1;
  }

  async runClientTypecheck(): Promise<void> {
    this.calls += 1;
    if (this.failure) throw this.failure;
  }
}

export async function putProgramContract(root: string): Promise<void> {
  await put(root, "TsProj/src/ui/widgets/status-widget.ts", "export class StatusWidget {}\n");
}

export async function putReverseCanvasContract(root: string): Promise<void> {
  await put(root, "TsProj/src/ui/canvas/main-canvas.ts", "export class MainCanvas {}\n");
  await put(root, "TsProj/src/ui/widgets/status-widget.ts", "export class StatusWidget {}\n");
}

export function canvasSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MainCanvas",
    artifactType: "Canvas",
    root: {
      id: "MainCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "statusWidget",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [200, 60] },
          components: { PrefabRef: { artifactKey: "StatusWidget" } },
        },
      ],
    },
  };
}

export async function putEmptyProgramContract(root: string): Promise<void> {
  await mkdir(join(root, "TsProj", "src", "ui", "widgets"), { recursive: true });
}

export async function completed(service: UnityJobService, initial: UiUnityJobSnapshot): Promise<UiUnityJobSnapshot> {
  const deadline = Date.now() + 5_000;
  let current = initial;
  while ((current.status === "queued" || current.status === "running") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    current = service.job(initial.id)!;
  }
  return current;
}
