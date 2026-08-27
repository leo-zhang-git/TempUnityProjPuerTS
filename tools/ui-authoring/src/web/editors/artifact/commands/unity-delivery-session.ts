import { useEffect, useRef, useState } from "react";
import { formatSource } from "../../../../kernel/canonical.js";
import { type NodeIdentityWorkspace, planWorkspaceNodeRenames } from "../../../../kernel/node-identity-refactor.js";
import { applyPrefabReconcilePatches, type PrefabReconcileResult } from "../../../../kernel/prefab-observation.js";
import { validateSourceReadiness } from "../../../../kernel/validation.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import type {
  UiPublishExecutionOptions,
  UiPublishScope,
  UiReconcileScope,
  UiUnityJobKind,
  UiUnityJobSnapshot,
  UiUnitySyncJobResult,
} from "../../../../schema/ui-unity-job.js";
import { startUnityPublish, startUnityReconcile, startUnitySync, waitForUnityJob } from "../../../shared/api/client.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../../shared/types.js";
import { validateWorkspaceDocuments } from "../artifact-documents.js";
import type { ArtifactWorkspaceState } from "../artifact-workspace-state.js";
import { nodeIdentityCommitForPlans } from "../node-identity-save.js";

export interface WebPublishOptions {
  readonly confirmScaffold: boolean;
}

const DEFAULT_WEB_PUBLISH_OPTIONS: WebPublishOptions = {
  confirmScaffold: false,
};

function publishExecutionOptions(options: WebPublishOptions): UiPublishExecutionOptions {
  return {
    ...(options.confirmScaffold ? { confirmScaffold: true } : {}),
  };
}

interface UnityDeliverySessionOptions {
  readonly artifact: ArtifactDocument;
  readonly source: UiConcreteSource;
  readonly workspace: ArtifactWorkspaceState;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onSave: () => Promise<boolean>;
  readonly onNotice: (notice: string) => void;
}

export function useUnityDeliverySession({
  artifact,
  source,
  workspace,
  references,
  prototypes,
  onSave,
  onNotice,
}: UnityDeliverySessionOptions) {
  const [unityBusy, setUnityBusy] = useState<UiUnityJobKind | null>(null);
  const [unityReconcileJob, setUnityReconcileJob] = useState<UiUnityJobSnapshot | null>(null);
  const [unityReconcileScope, setUnityReconcileScope] = useState<UiReconcileScope>("current");
  const [unitySyncResult, setUnitySyncResult] = useState<UiUnitySyncJobResult | null>(null);
  const [unitySyncPhase, setUnitySyncPhase] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [unitySyncError, setUnitySyncError] = useState("");
  const [unityPublishJob, setUnityPublishJob] = useState<UiUnityJobSnapshot | null>(null);
  const [unityPublishScope, setUnityPublishScope] = useState<UiPublishScope>("current");
  const [unityPublishOptions, setUnityPublishOptions] = useState<WebPublishOptions>(DEFAULT_WEB_PUBLISH_OPTIONS);
  const [activeUnityPublishOptions, setActiveUnityPublishOptions] = useState<UiPublishExecutionOptions>({});
  const unityBusyRef = useRef<UiUnityJobKind | null>(unityBusy);
  const artifactKeyRef = useRef(artifact.artifactKey);
  unityBusyRef.current = unityBusy;
  artifactKeyRef.current = artifact.artifactKey;
  const unityPublishResult = unityPublishJob?.result?.kind === "publish" ? unityPublishJob.result : null;
  const unitySyncState = unitySyncResult?.state;

  const refreshFormalSync = async (): Promise<void> => {
    if (unityBusyRef.current) return;
    const requestedArtifactKey = artifact.artifactKey;
    setUnityBusy("sync");
    setUnitySyncPhase("checking");
    setUnitySyncError("");
    try {
      onNotice("正在检查 Prefab Diff");
      const completed = await waitForUnityJob(await startUnitySync(artifact.source), (job) => onNotice(job.message));
      if (artifactKeyRef.current !== requestedArtifactKey) return;
      if (completed.result?.kind !== "sync") throw new Error("Prefab Diff 检查未返回有效结果");
      setUnitySyncResult(completed.result);
      setUnitySyncPhase("ready");
      onNotice("Prefab Diff 已更新");
    } catch (reason) {
      if (artifactKeyRef.current !== requestedArtifactKey) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setUnitySyncError(message);
      setUnitySyncPhase("error");
      onNotice(`Prefab Diff 检查失败：${message}`);
    } finally {
      setUnityBusy(null);
    }
  };

  useEffect(() => {
    setUnitySyncResult(null);
    setUnitySyncPhase("idle");
    setUnitySyncError("");
  }, [artifact.artifactKey]);

  const beginReconcilePresentation = (scope: UiReconcileScope): void => {
    const now = Date.now();
    setUnityReconcileScope(scope);
    setUnityReconcileJob({
      id: "local-reconcile",
      kind: "reconcile",
      artifactKey: scope === "all" ? "__all__" : artifact.artifactKey,
      status: "running",
      stage: "saving",
      message:
        scope === "all"
          ? "正在保存工作区，随后回写全部 Prefab"
          : scope === "dependencies"
            ? "正在保存工作区，随后回写当前文件及依赖"
            : "正在保存 Source，随后回写 Prefab",
      createdAt: now,
      updatedAt: now,
    });
  };

  const pullUnityChanges = async (scope: UiReconcileScope = "current"): Promise<void> => {
    if (unityBusy) return;
    beginReconcilePresentation(scope);
    const readiness = validateSourceReadiness(source);
    if (!readiness.valid) {
      const error = `Prefab 回写被阻断：${readiness.issues[0]!.message}`;
      setUnityReconcileJob((current) =>
        current ? { ...current, status: "failed", stage: "failed", message: "Prefab 回写失败", error, updatedAt: Date.now() } : current,
      );
      onNotice(error);
      return;
    }
    setUnityBusy("reconcile");
    try {
      if (!(await onSave())) throw new Error("Prefab 回写被阻断：Source 保存失败");
      const initial = await startUnityReconcile({ source: artifact.source, scope });
      setUnityReconcileJob(initial);
      const completed = await waitForUnityJob(initial, (job) => {
        setUnityReconcileJob(job);
        onNotice(job.message);
      });
      setUnityReconcileJob(completed);
      onNotice(completed.message);
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      setUnityReconcileJob((current) => {
        const now = Date.now();
        return {
          ...(current ?? { id: "local-reconcile", kind: "reconcile" as const, artifactKey: artifact.artifactKey, createdAt: now }),
          status: "failed",
          stage: "failed",
          message: "Prefab 回写失败",
          error,
          updatedAt: now,
        };
      });
      onNotice(error);
    } finally {
      setUnityBusy(null);
    }
  };

  const beginPublishPresentation = (message: string): void => {
    const now = Date.now();
    setUnityPublishJob({
      id: "local-publish",
      kind: "publish",
      artifactKey: artifact.source.artifactKey,
      status: "running",
      stage: "saving",
      message,
      createdAt: now,
      updatedAt: now,
    });
  };

  const failPublishPresentation = (reason: unknown): void => {
    const error = reason instanceof Error ? reason.message : String(reason);
    setUnityPublishJob((current) => {
      const now = Date.now();
      return {
        ...(current ?? { id: "local-publish", kind: "publish" as const, artifactKey: artifact.source.artifactKey, createdAt: now }),
        status: "failed",
        stage: "failed",
        message: "发布失败",
        updatedAt: now,
        error,
      };
    });
    onNotice(error);
  };

  const runPublish = async (scope: UiPublishScope, executionOptions: UiPublishExecutionOptions): Promise<UiUnityJobSnapshot> => {
    if (!(await onSave())) throw new Error("发布被阻断：Source 保存失败");
    const initial = await startUnityPublish({
      source: artifact.source,
      scope,
      ...executionOptions,
    });
    setUnityPublishJob(initial);
    return waitForUnityJob(initial, (job) => {
      setUnityPublishJob(job);
      onNotice(job.message);
    });
  };

  const applyPublishedSync = (result: NonNullable<UiUnityJobSnapshot["result"]> & { readonly kind: "publish" }): void => {
    if (result.delivery !== "delivered" || !result.deliveryStates) return;
    const current = result.deliveryStates.find((entry) => entry.artifactKey === artifact.artifactKey);
    if (!current) return;
    setUnitySyncResult({
      kind: "sync",
      prefabPath: current.observation.prefabPath,
      state: { artifactKey: current.artifactKey, status: "matches", changes: [] },
      patches: [],
      issues: [],
      observation: current.observation,
    });
    setUnitySyncPhase("ready");
  };

  const executeUnityPublish = async (
    scope: UiPublishScope,
    executionOptions: UiPublishExecutionOptions,
    message: string,
  ): Promise<void> => {
    if (unityBusy) return;
    setUnityPublishScope(scope);
    setActiveUnityPublishOptions(executionOptions);
    beginPublishPresentation(message);
    if (scope !== "changes") {
      const readiness = validateSourceReadiness(source);
      if (!readiness.valid) {
        failPublishPresentation(new Error(`发布被阻断：${readiness.issues[0]!.message}`));
        return;
      }
    }
    setUnityBusy("publish");
    try {
      const completed = await runPublish(scope, executionOptions);
      if (completed.result?.kind === "publish") {
        const result = completed.result;
        onNotice(
          result.delivery === "delivered"
            ? result.noOp
              ? result.artifacts.length === 0
                ? "无需发布：没有检测到需要发布的 Source"
                : "无需发布：Source 与 Prefab 已一致"
              : `已发布 ${result.artifacts.length} 个 Prefab`
            : `发布被 ${result.blockers.length} 个阻断项阻断`,
        );
        applyPublishedSync(result);
      }
    } catch (reason) {
      failPublishPresentation(reason);
    } finally {
      setUnityBusy(null);
    }
  };

  const publishPrefab = async (scope: UiPublishScope = "current"): Promise<void> => {
    const executionOptions = publishExecutionOptions(unityPublishOptions);
    setUnityPublishOptions(DEFAULT_WEB_PUBLISH_OPTIONS);
    await executeUnityPublish(
      scope,
      executionOptions,
      scope === "all"
        ? "正在保存工作区，随后发布全部 Prefab"
        : scope === "changes"
          ? "正在保存工作区，随后发布本地改动及依赖"
          : scope === "dependencies"
            ? "正在保存工作区，随后发布当前文件及依赖"
            : "正在保存 Source，随后发布 Prefab",
    );
  };

  const retryUnityPublish = async (): Promise<void> => {
    await executeUnityPublish(unityPublishScope, activeUnityPublishOptions, "正在重试发布");
  };

  const applyUnityPublishScaffold = async (): Promise<void> => {
    if (unityBusy || !unityPublishResult || unityPublishResult.scaffoldPlan.length === 0) return;
    await executeUnityPublish(unityPublishScope, { ...activeUnityPublishOptions, confirmScaffold: true }, "正在补齐程序接入并发布");
  };

  const setUnityPublishOption = (option: keyof WebPublishOptions, enabled: boolean): void => {
    setUnityPublishOptions((current) => ({ ...current, [option]: enabled }));
  };

  const applyUnityReconcile = (): void => {
    const result = unityReconcileJob?.result?.kind === "reconcile" ? unityReconcileJob.result : undefined;
    if (!result || result.entries.some((entry) => entry.issues.length > 0)) return;
    const changed = result.entries.filter((entry) => entry.patches.length > 0);
    if (changed.length === 0) return;
    try {
      const candidate = new Map(workspace.documents);
      for (const entry of changed) {
        const document = candidate.get(entry.artifactKey);
        if (!document || document.source.sourceKind !== entry.source.sourceKind)
          throw new Error(`Artifact '${entry.artifactKey}' 不存在或类型已变化`);
        if (formatSource(document.source) !== formatSource(entry.beforeSource))
          throw new Error(`Unity 回写期间 Artifact '${entry.artifactKey}' 已发生变化`);
        const source =
          document.source.sourceKind === "artifact" && entry.beforeSource.sourceKind === "artifact"
            ? applyPrefabReconcilePatches(
                entry.beforeSource,
                {
                  artifactKey: entry.artifactKey,
                  prefabPath: entry.prefabPath,
                  patches: entry.patches as PrefabReconcileResult["patches"],
                  issues: entry.issues,
                  diagnostics: entry.diagnostics ?? [],
                  unityOnlyComponents: entry.unityOnlyComponents,
                },
                { skipNodeName: true },
              )
            : entry.source;
        candidate.set(entry.artifactKey, { ...document, source });
      }
      validateWorkspaceDocuments(candidate, references, prototypes);
      const identityWorkspace: NodeIdentityWorkspace = {
        artifacts: [...candidate.values()].map((document) => ({ path: document.path, source: document.source })),
        references: [...references.values()].map((document) => ({ path: document.path, reference: document.reference })),
        prototypes: [...prototypes.values()].map((document) => ({ path: document.path, prototype: document.prototype })),
      };
      const renameRequests = changed.flatMap((entry) =>
        entry.beforeSource.sourceKind === "artifact"
          ? entry.patches
              .filter((patch) => patch.kind === "node-name")
              .map((patch) => ({
                artifactKey: entry.artifactKey,
                nodeId: patch.nodeId,
                request: { displayName: patch.observed === undefined ? patch.nodeId : String(patch.observed) },
              }))
          : [],
      );
      const identityPlan = renameRequests.length > 0 ? planWorkspaceNodeRenames(identityWorkspace, renameRequests) : undefined;
      if (identityPlan && (identityPlan.preview.blockers.length > 0 || !identityPlan.result)) {
        throw new Error(identityPlan.preview.blockers.join("\n") || "节点标识协调计划未生成候选结果");
      }
      const finalWorkspace = identityPlan?.result ?? identityWorkspace;
      const nextArtifacts = new Map(finalWorkspace.artifacts.map((entry) => [entry.source.artifactKey, entry]));
      const nextReferences = new Map(finalWorkspace.references.map((entry) => [entry.reference.referenceKey, entry]));
      const nextPrototypes = new Map(finalWorkspace.prototypes.map((entry) => [entry.prototype.prototypeKey, entry]));
      workspace.commitWorkspace(
        (documents) => {
          for (const [artifactKey, entry] of nextArtifacts) {
            const document = documents.artifacts.get(artifactKey);
            if (document) documents.artifacts.set(artifactKey, { ...document, path: entry.path, source: entry.source });
          }
          for (const [referenceKey, entry] of nextReferences) {
            const document = documents.references.get(referenceKey);
            if (document) {
              documents.references.set(referenceKey, {
                ...document,
                reference: entry.reference,
                subjectArtifactKey: entry.reference.subjectArtifactKey,
              });
            }
          }
          for (const [prototypeKey, entry] of nextPrototypes) {
            const document = documents.prototypes.get(prototypeKey);
            if (document) {
              documents.prototypes.set(prototypeKey, {
                ...document,
                prototype: entry.prototype,
                startReferenceKey: entry.prototype.startReferenceKey,
                interactionCount: entry.prototype.interactions.length,
              });
            }
          }
        },
        nodeIdentityCommitForPlans(identityPlan ? [identityPlan] : []),
      );
      setUnityReconcileJob(null);
      const patchCount = changed.reduce((count, entry) => count + entry.patches.length, 0);
      onNotice(`已将 ${patchCount} 项 Unity 改动应用为 ${changed.length} 个文档的未保存改动`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return {
    publishPrefab,
    pullUnityChanges,
    unityBusy,
    unityReconcileJob,
    unityReconcileScope,
    unitySyncResult,
    unitySyncState,
    unitySyncPhase,
    unitySyncError,
    unityPublishJob,
    unityPublishResult,
    unityPublishScope,
    unityPublishOptions,
    setUnityPublishOption,
    refreshFormalSync,
    closeUnityReconcile: (): void => setUnityReconcileJob(null),
    applyUnityReconcile,
    retryUnityReconcile: (): Promise<void> => pullUnityChanges(unityReconcileScope),
    closeUnityPublish: (): void => setUnityPublishJob(null),
    applyUnityPublishScaffold,
    retryUnityPublish,
  } as const;
}
