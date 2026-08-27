import { Check, CheckCircle2, Import as ImportIcon, LoaderCircle, RefreshCw, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { findNode } from "../../../../kernel/tree.js";
import type { UiUnityJobSnapshot, UiUnityReconcileEntry } from "../../../../schema/ui-unity-job.js";
import { gameObjectDiagnosticLabelById } from "../../../shared/game-object-label.js";
import { UnityJobProgressDetails } from "../../../shared/unity-job-progress.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import dialogStyles from "../../shared/dialog.module.css";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-dialogs.module.css";

const webClasses = createWebClasses(sharedStyles, dialogStyles, artifactStyles);

export function UnityReconcileDialog({
  job,
  onClose,
  onRetry,
  onApply,
}: {
  readonly job: UiUnityJobSnapshot;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onApply: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const running = job.status === "queued" || job.status === "running";
  const failed = job.status === "failed";
  const result = job.result?.kind === "reconcile" ? job.result : undefined;
  const entries = result?.entries ?? [];
  const patchCount = entries.reduce((count, entry) => count + entry.patches.length, 0);
  const issueCount = entries.reduce((count, entry) => count + entry.issues.length, 0);
  const needsReview = entries.some((entry) => entry.patches.some((patch) => patch.risk === "review"));
  const canApply = !running && !failed && issueCount === 0 && patchCount > 0 && (!needsReview || reviewConfirmed);
  const elapsedSeconds = Math.max(0, Math.round((now - job.createdAt) / 1000));

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div
      className={webClasses("modal-backdrop")}
      onPointerDown={() => {
        if (!running) onClose();
      }}
    >
      <section
        className={webClasses("authoring-dialog unity-reconcile-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unity-reconcile-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <ImportIcon size={15} />
            <strong id="unity-reconcile-title">回写 Unity 改动</strong>
            <span>{result ? `${result.artifacts.length} 个 Artifact` : job.artifactKey}</span>
          </div>
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭回写窗口"
            disabled={running}
          >
            <X size={16} />
          </button>
        </header>
        <div className={webClasses("unity-reconcile-content")}>
          <section className={webClasses("publish-progress")} data-status={job.status}>
            <div className={webClasses("publish-progress-heading")}>
              <strong>
                {running ? <LoaderCircle size={14} /> : failed || issueCount > 0 ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                {reconcileStatusLabel(job, issueCount)}
              </strong>
              <span>{elapsedSeconds} 秒</span>
            </div>
            <p>{failed ? "回写已停止，请查看下方错误。" : job.message}</p>
            <UnityJobProgressDetails job={job} ariaLabel="Prefab 回写进度" />
          </section>
          {failed ? (
            <section className={webClasses("unity-reconcile-issues publish-error")}>
              <strong>回写错误</strong>
              <pre>{job.error || job.message}</pre>
            </section>
          ) : null}
          {entries.map((entry) => (
            <section className={webClasses("reconcile-artifact")} key={entry.artifactKey}>
              <div className={webClasses("reconcile-artifact-heading")}>
                <strong>{entry.artifactKey}</strong>
                <span>{syncStatusLabel(entry.state.status)}</span>
                <small>{entry.sourcePath}</small>
              </div>
              {entry.issues.length > 0 ? (
                <div className={webClasses("unity-reconcile-issues")}>
                  <strong>已阻断</strong>
                  {entry.issues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              ) : null}
              {entry.unityOnlyComponents.length > 0 ? (
                <div className={webClasses("unity-reconcile-issues")}>
                  <strong>Unity 所属 Component</strong>
                  {entry.unityOnlyComponents.map((component) => (
                    <p key={`${entry.artifactKey}:${component.nodeId}`}>
                      {reconcileNodeLabel(entry, component.nodeId)}: {component.componentTypes.join(", ")}
                    </p>
                  ))}
                </div>
              ) : null}
              {entry.patches.length > 0 ? (
                <div className={webClasses("unity-reconcile-list")}>
                  {entry.patches.map((patch, index) => (
                    <div
                      className={webClasses("unity-reconcile-row")}
                      key={`${entry.artifactKey}:${patch.kind}:${patch.nodeId}:${patch.field}:${index}`}
                    >
                      <strong>{reconcileNodeLabel(entry, patch.nodeId)}</strong>
                      <span>
                        {patch.field}
                        {patch.change ? ` (${patch.change})` : patch.risk === "review" ? "（需检查）" : ""}
                      </span>
                      <code>{valueText(patch.expected)}</code>
                      <i>到</i>
                      <code>{valueText(patch.observed)}</code>
                    </div>
                  ))}
                </div>
              ) : entry.issues.length === 0 ? (
                <p className={webClasses("dialog-message")}>Prefab 与当前 Source 一致。</p>
              ) : null}
            </section>
          ))}
          {needsReview && issueCount === 0 ? (
            <label className={webClasses("unity-reconcile-confirm")}>
              <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.currentTarget.checked)} />
              应用已检查的结构、Binding 或 PrefabRef 改动
            </label>
          ) : null}
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={running}>
            关闭
          </button>
          {failed ? (
            <button className={webClasses("dialog-primary")} type="button" onClick={onRetry}>
              <RefreshCw size={14} />
              重试
            </button>
          ) : null}
          {result ? (
            <button className={webClasses("dialog-primary")} type="button" disabled={!canApply} onClick={onApply}>
              <Check size={15} />
              应用 {patchCount} 项改动
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function reconcileNodeLabel(entry: UiUnityReconcileEntry, nodeId: string): string {
  if (entry.source.sourceKind === "artifact" && findNode(entry.source, nodeId)) return gameObjectDiagnosticLabelById(entry.source, nodeId);
  if (entry.beforeSource.sourceKind === "artifact" && findNode(entry.beforeSource, nodeId))
    return gameObjectDiagnosticLabelById(entry.beforeSource, nodeId);
  return nodeId;
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value || "（空）";
  return JSON.stringify(value);
}

function reconcileStatusLabel(job: UiUnityJobSnapshot, issueCount: number): string {
  if (job.status === "failed") return "回写失败";
  if (issueCount > 0) return "回写被阻断";
  if (job.status === "succeeded") return "回写预览已就绪";
  return "正在检查 Unity 改动";
}

function syncStatusLabel(status: string): string {
  return ({ matches: "无差异", differs: "有差异", missing: "Prefab 缺失" } as Record<string, string>)[status] ?? status;
}
