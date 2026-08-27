import { CheckCircle2, Code2, LoaderCircle, RefreshCw, Rocket, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { UiUnityJobSnapshot } from "../../../../schema/ui-unity-job.js";
import { UnityJobProgressDetails } from "../../../shared/unity-job-progress.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import dialogStyles from "../../shared/dialog.module.css";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-dialogs.module.css";

const webClasses = createWebClasses(sharedStyles, dialogStyles, artifactStyles);

export function UnityPublishDialog({
  job,
  onClose,
  onRetry,
  onApplyScaffold,
}: {
  readonly job: UiUnityJobSnapshot;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onApplyScaffold: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const running = job.status === "queued" || job.status === "running";
  const failed = job.status === "failed";
  const result = job.result?.kind === "publish" ? job.result : undefined;
  const delivered = result?.delivery === "delivered";
  const residual =
    job.residualPaths && (job.residualPaths.svnDeliverables.length > 0 || job.residualPaths.gitDeliverables.length > 0)
      ? job.residualPaths
      : undefined;
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
        aria-labelledby="unity-publish-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <Rocket size={15} />
            <strong id="unity-publish-title">发布</strong>
            <span>{result?.artifacts.join(", ") || job.artifactKey}</span>
          </div>
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭发布窗口"
            disabled={running}
          >
            <X size={16} />
          </button>
        </header>
        <div className={webClasses("unity-reconcile-content")}>
          <section className={webClasses("publish-progress")} data-status={job.status}>
            <div className={webClasses("publish-progress-heading")}>
              <strong>
                {running ? <LoaderCircle size={14} /> : delivered ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                {publishStatusLabel(job, result)}
              </strong>
              <span>{elapsedSeconds}s</span>
            </div>
            <p>{failed ? "发布已停止，请查看下方错误。" : job.message}</p>
            <UnityJobProgressDetails job={job} ariaLabel="发布进度" />
          </section>
          {failed ? (
            <section className={webClasses("unity-reconcile-issues publish-error")}>
              <strong>发布错误</strong>
              <pre>{job.error || job.message}</pre>
            </section>
          ) : null}
          {residual ? (
            <section className={webClasses("publish-delivery-paths")}>
              <strong>已落盘的改动，需人工确认并处置</strong>
              {residual.svnDeliverables.length ? (
                <>
                  <p>Unity 工程（My project，用 svn revert）</p>
                  {residual.svnDeliverables.map((path) => (
                    <code key={path}>{path}</code>
                  ))}
                </>
              ) : null}
              {residual.gitDeliverables.length ? (
                <>
                  <p>Git（program，用 git checkout）</p>
                  {residual.gitDeliverables.map((path) => (
                    <code key={path}>{path}</code>
                  ))}
                </>
              ) : null}
            </section>
          ) : null}
          {result && !delivered ? (
            <section className={webClasses("unity-reconcile-issues")}>
              <strong>
                <XCircle size={14} /> 发布被阻断
              </strong>
              {result.blockers.map((blocker) => (
                <p key={`${blocker.code}:${blocker.artifactKey ?? ""}`}>
                  {blocker.artifactKey ? `${blocker.artifactKey}: ` : ""}
                  {blocker.message}
                </p>
              ))}
            </section>
          ) : null}
          {result?.scaffoldPlan.length ? (
            <section className={webClasses("unity-reconcile-list")}>
              {result.scaffoldPlan.map((entry) => (
                <div className={webClasses("unity-reconcile-row")} key={`${entry.artifactKey}:${entry.owner}`}>
                  <strong>{entry.artifactKey}</strong>
                  <span>{entry.owner}</span>
                  <code>{entry.path}</code>
                  <i>{entry.detail}</i>
                </div>
              ))}
            </section>
          ) : null}
          {result?.touchedPaths ? (
            <section className={webClasses("publish-delivery-paths")}>
              <strong>写入路径</strong>
              <p>SVN: {result.touchedPaths.svnDeliverables.length}</p>
              <p>Git: {result.touchedPaths.gitDeliverables.length}</p>
              <p>无关改动: {result.touchedPaths.preExistingUnrelated.length}</p>
            </section>
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
          {result && !delivered && result.scaffoldPlan.length > 0 ? (
            <button className={webClasses("dialog-primary")} type="button" onClick={onApplyScaffold}>
              <Code2 size={14} />
              补齐程序接入并发布
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function publishStatusLabel(
  job: UiUnityJobSnapshot,
  result: Extract<NonNullable<UiUnityJobSnapshot["result"]>, { readonly kind: "publish" }> | undefined,
): string {
  if (job.status === "failed") return "发布失败";
  if (result?.delivery === "delivered") return result.noOp ? "无需发布" : "已发布";
  if (result?.delivery === "blocked") return "发布被阻断";
  return "正在发布";
}
