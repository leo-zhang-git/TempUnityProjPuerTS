import { Check, FileInput, LoaderCircle, Search, X } from "lucide-react";
import { useState } from "react";
import type { UiPrefabImportJobResult, UiPrefabImportRequest, UiUnityJobSnapshot } from "../../schema/ui-unity-job.js";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import { type DocumentCatalog, startPrefabImport, waitForUnityJob } from "../shared/api/client.js";
import { UnityJobProgressDetails } from "../shared/unity-job-progress.js";
import { createWebClasses } from "../styles/web-styles.js";
import { SourcePathField } from "../workspace/source-path-field.js";

const webClasses = createWebClasses(sharedStyles, dialogStyles);

export function PrefabImportDialog({
  catalog,
  onClose,
  onImported,
}: {
  readonly catalog: DocumentCatalog;
  readonly onClose: () => void;
  readonly onImported: (artifactKey: string) => void;
}) {
  const [prefabPath, setPrefabPath] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [initialSize, setInitialSize] = useState("");
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<UiUnityJobSnapshot | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UiPrefabImportJobResult | null>(null);
  const draftIssue = explainPrefabImportDraftIssue(prefabPath, sourcePath, initialSize);
  const visibleIssue = draftIssue ?? error;

  const run = async (write: boolean): Promise<void> => {
    if (draftIssue || running) {
      if (draftIssue) setError(draftIssue);
      return;
    }
    setRunning(true);
    setError("");
    try {
      const request: UiPrefabImportRequest = {
        prefabPath: prefabPath.trim().replaceAll("\\", "/"),
        sourcePath: sourcePath.trim().replaceAll("\\", "/"),
        ...(initialSize.trim() ? { initialSize: parseInitialSize(initialSize) } : {}),
        ...(write ? { write: true } : {}),
      };
      const completed = await waitForUnityJob(await startPrefabImport(request), setJob);
      if (completed.result?.kind !== "import") throw new Error("Prefab 导入没有返回有效结果");
      setResult(completed.result);
      if (completed.result.written) onImported(completed.result.source.artifactKey);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };

  const updatePrefabPath = (value: string): void => {
    setPrefabPath(value);
    setError("");
    setResult(null);
    setJob(null);
    const key = prefabArtifactKey(value);
    if (key && !sourcePath.trim()) setSourcePath(`Imported/${key}.ui.json`);
  };

  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={running ? undefined : onClose}>
      <form
        className={webClasses("authoring-dialog prefab-import-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefab-import-title"
        aria-describedby={visibleIssue ? "prefab-import-issue" : undefined}
        aria-invalid={Boolean(draftIssue)}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void run(false);
        }}
      >
        <header>
          <div>
            <FileInput size={15} />
            <strong id="prefab-import-title">导入现有 Prefab</strong>
            <span>{result?.source.artifactKey ?? "迁移"}</span>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} title="关闭" disabled={running}>
            <X size={16} />
          </button>
        </header>
        <div className={webClasses("dialog-fields")}>
          <label>
            <span>Prefab 路径</span>
            <input
              autoFocus
              value={prefabPath}
              onChange={(event) => updatePrefabPath(event.target.value)}
              placeholder="Assets/Resources/UI/Prefab/Widget/Example/Example.prefab"
            />
          </label>
          <SourcePathField
            value={sourcePath}
            catalog={catalog}
            placeholder="Imported/Example.ui.json"
            onChange={(value) => {
              setSourcePath(value);
              setError("");
              setResult(null);
              setJob(null);
            }}
          />
          <label>
            <span>初始尺寸</span>
            <input
              value={initialSize}
              onChange={(event) => {
                setInitialSize(event.target.value);
                setError("");
                setResult(null);
                setJob(null);
              }}
              placeholder="自动或 400x300"
            />
          </label>
          {visibleIssue ? (
            <p className={webClasses("dialog-feedback is-error")} id="prefab-import-issue" role="alert">
              {visibleIssue}
            </p>
          ) : null}
        </div>
        {job ? (
          <div className={webClasses("prefab-import-status")}>
            {running ? <LoaderCircle size={15} /> : null}
            <span>{job.message}</span>
            <div className={webClasses("prefab-import-progress")}>
              <UnityJobProgressDetails job={job} ariaLabel="Prefab 导入进度" />
            </div>
          </div>
        ) : null}
        {result ? (
          <div className={webClasses("prefab-import-result")}>
            <div className={webClasses("prefab-import-summary")}>
              <strong>{result.source.artifactKey}</strong>
              <span>{result.imports.length} 个 Source</span>
              <span>{result.patches.length} 项根节点改动</span>
            </div>
            {result.blockers.length > 0 ? (
              <section className={webClasses("prefab-import-issues")}>
                <strong>导入被阻断</strong>
                {result.blockers.map((blocker) => (
                  <p key={blocker}>{blocker}</p>
                ))}
              </section>
            ) : null}
            {result.blockers.length === 0 ? (
              <div className={webClasses("prefab-import-chain")}>
                {result.imports.map((entry) => (
                  <section key={entry.prefabPath}>
                    <div>
                      <strong>{entry.source.artifactKey}</strong>
                      <span>{entry.sourcePath}</span>
                      <span>{entry.patches.length} 项改动</span>
                      <span>{entry.observationHash?.slice(0, 12) ?? "无 hash"}</span>
                    </div>
                    <pre>{JSON.stringify(entry.source, null, 2)}</pre>
                  </section>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose} disabled={running}>
            取消
          </button>
          <button
            className={webClasses("dialog-secondary")}
            type="submit"
            disabled={Boolean(draftIssue) || running}
            title={draftIssue ?? "预览导入"}
          >
            <Search size={15} />
            预览导入
          </button>
          <button
            className={webClasses("dialog-primary")}
            type="button"
            disabled={running || !result || result.blockers.length > 0}
            title={!result ? "请先预览导入" : result.blockers[0]}
            onClick={() => void run(true)}
          >
            <Check size={15} />
            写入 Source
          </button>
        </footer>
      </form>
    </div>
  );
}

function explainPrefabImportDraftIssue(prefabPath: string, sourcePath: string, initialSize: string): string | undefined {
  const prefab = prefabPath.trim().replaceAll("\\", "/");
  const source = sourcePath.trim().replaceAll("\\", "/");
  if (!prefab) return "Prefab 路径不能为空";
  const match = /^Assets\/Resources\/UI\/Prefab\/(Canvas|Widget|Fragment)\/([A-Z][A-Za-z0-9]*)\/([A-Z][A-Za-z0-9]*)\.prefab$/.exec(prefab);
  if (!match) return "Prefab 路径必须符合 Assets/Resources/UI/Prefab/<Type>/<Key>/<Key>.prefab";
  if (match[2] !== match[3]) return "Prefab 目录名必须与文件名一致";
  if (!source) return "Source 路径不能为空";
  if (!source.endsWith(".ui.json")) return "Source 路径必须以 .ui.json 结尾";
  if (!validInitialSize(initialSize)) return "初始尺寸必须留空，或使用 400x300 格式";
  return undefined;
}

function prefabArtifactKey(value: string): string | undefined {
  const normalized = value.trim().replaceAll("\\", "/");
  const match = /^Assets\/Resources\/UI\/Prefab\/(?:Canvas|Widget|Fragment)\/([A-Z][A-Za-z0-9]*)\/([A-Z][A-Za-z0-9]*)\.prefab$/.exec(normalized);
  return match !== null && match[1] === match[2] ? match[1] : undefined;
}

function validInitialSize(value: string): boolean {
  return !value.trim() || /^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/.test(value.trim());
}

function parseInitialSize(value: string): readonly [number, number] {
  const [width, height] = value.trim().split("x").map(Number);
  return [width!, height!];
}
