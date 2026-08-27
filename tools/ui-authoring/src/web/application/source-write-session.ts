import { useCallback, useRef } from "react";
import { reloadBootstrap, revertArtifactToSvnBase } from "../shared/api/client.js";
import { workspaceDocumentId } from "../workspace/workspace-editing-context.js";
import type { WorkspaceDocumentSession } from "./workspace-document-session.js";
import { workspaceDataFromBootstrap } from "./workspace-document-session.js";
import { rebaseWorkspaceDrafts } from "./workspace-external-change-recovery.js";
import type { WorkspaceSaveCoordinator } from "./workspace-save-coordinator.js";

interface SourceWriteSessionOptions {
  readonly documents: WorkspaceDocumentSession;
  readonly saveCoordinator: WorkspaceSaveCoordinator;
  readonly savePhase: "idle" | "scheduled" | "saving" | "failed";
  readonly onWorkspaceReloaded: (bootstrap: Awaited<ReturnType<typeof reloadBootstrap>>) => void;
  readonly onNotice: (notice: string) => void;
}

export function useSourceWriteSession(options: SourceWriteSessionOptions) {
  const optionsRef = useRef(options);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  optionsRef.current = options;

  const runSourceWrite = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    const running = queueRef.current.catch(() => undefined).then(operation);
    queueRef.current = running.catch(() => undefined);
    await running;
  }, []);

  const revertSource = useCallback(
    async (artifactKey: string, path: string, expectedRevision: string): Promise<void> => {
      const currentOptions = optionsRef.current;
      if (currentOptions.savePhase === "saving") throw new Error("Source 正在写入，暂时不能还原 SVN 修改");
      currentOptions.saveCoordinator.cancelScheduled();
      await runSourceWrite(async () => {
        const activeOptions = optionsRef.current;
        const before = activeOptions.documents.workspaceRef.current.readWorkspaceSnapshot();
        const dirtyDocumentIds = new Set(activeOptions.documents.dirtyDocumentsRef.current);
        dirtyDocumentIds.delete(workspaceDocumentId("artifact", artifactKey));

        activeOptions.onNotice("正在还原当前 Source 到 SVN BASE");
        await revertArtifactToSvnBase({ path, expectedRevision });
        const bootstrap = await reloadBootstrap(true);
        const baseline = workspaceDataFromBootstrap(bootstrap);
        const drafts = {
          artifacts: preserveDirtyDocuments("artifact", baseline.artifacts, before.artifacts, dirtyDocumentIds),
          references: preserveDirtyDocuments("reference", baseline.references, before.references, dirtyDocumentIds),
          prototypes: preserveDirtyDocuments("prototype", baseline.prototypes, before.prototypes, dirtyDocumentIds),
        };
        activeOptions.documents.workspaceRef.current.replaceWorkspace(baseline);
        activeOptions.documents.workspaceRef.current.synchronizeWorkspaceDrafts(drafts);
        activeOptions.onWorkspaceReloaded(bootstrap);
        activeOptions.onNotice(`已还原 ${path} 到 SVN BASE`);
      });
    },
    [runSourceWrite],
  );

  const rebaseExternalChanges = useCallback(
    async (documentIds: ReadonlySet<string>): Promise<void> => {
      const currentOptions = optionsRef.current;
      currentOptions.saveCoordinator.cancelScheduled();
      await runSourceWrite(async () => {
        const activeOptions = optionsRef.current;
        activeOptions.onNotice("正在重新读取磁盘版本并合并未保存改动");
        const bootstrap = await reloadBootstrap(true);
        const baseline = workspaceDataFromBootstrap(bootstrap);
        const workspace = activeOptions.documents.workspaceRef.current;
        const current = workspace.readWorkspaceSnapshot();
        const result = rebaseWorkspaceDrafts({
          current: { artifacts: current.artifacts, references: current.references, prototypes: current.prototypes },
          saved: {
            artifacts: current.savedArtifacts,
            references: current.savedReferences,
            prototypes: current.savedPrototypes,
          },
          remote: baseline,
          documentIds,
          protectedDocumentIds: activeOptions.documents.dirtyDocumentsRef.current,
        });
        if (result.conflicts.length > 0) {
          const details = result.conflicts
            .map((conflict) => `${conflict.documentId}（${conflict.fieldPaths.slice(0, 3).join("、")}）`)
            .join("；");
          throw new Error(`磁盘版本与未保存草稿修改了相同字段：${details}。草稿仍保留，请人工确认后再保存。`);
        }
        workspace.applyWorkspaceRebase(result.drafts, result.saved);
        activeOptions.onWorkspaceReloaded(bootstrap);
        activeOptions.onNotice("已合并磁盘版本，正在重试保存");
      });
    },
    [runSourceWrite],
  );

  return { runSourceWrite, revertSource, rebaseExternalChanges } as const;
}

function preserveDirtyDocuments<T>(
  kind: "artifact" | "reference" | "prototype",
  baseline: ReadonlyMap<string, T>,
  current: ReadonlyMap<string, T>,
  dirtyDocumentIds: ReadonlySet<string>,
): Map<string, T> {
  const result = new Map(baseline);
  for (const documentId of dirtyDocumentIds) {
    if (!documentId.startsWith(`${kind}:`)) continue;
    const key = documentId.slice(kind.length + 1);
    const document = current.get(key);
    if (document) result.set(key, document);
    else result.delete(key);
  }
  return result;
}
