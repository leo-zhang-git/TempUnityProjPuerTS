import { AlertTriangle, Clipboard, Download, FileWarning, RefreshCw, ServerCrash, Trash2, X } from "lucide-react";
import { Component, createContext, type ErrorInfo, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { UiRuntimeDiagnostic } from "../../schema/ui-api.js";
import type { UiDiagnostic } from "../../schema/ui-diagnostics.js";
import { createWebClasses } from "../styles/web-styles.js";
import { clearRuntimeDiagnostics, loadRuntimeDiagnostics, reportRuntimeDiagnostic, runtimeDiagnosticsDownloadUrl } from "./api/client.js";
import {
  AGING_RUNTIME_ERROR_MS,
  type DiagnosticsTone,
  isRuntimeTimestampAfter,
  newestRuntimeTimestamp,
  RECENT_RUNTIME_ERROR_MS,
  runtimeNotificationTone,
  runtimeTimestampMs,
} from "./runtime-diagnostics-state.js";
import diagnosticStyles from "./web-diagnostics.module.css";

const webClasses = createWebClasses(diagnosticStyles);
const RUNTIME_ACKNOWLEDGED_KEY = "legma.runtime-diagnostics.acknowledged-through";
const RUNTIME_CLEARED_KEY = "legma.runtime-diagnostics.cleared-through";

interface WebDiagnosticsContextValue {
  readonly report: (reason: unknown, context?: string) => void;
  readonly setProblems: (problems: readonly UiDiagnostic[]) => void;
  readonly openProblems: (path?: string) => void;
}

const WebDiagnosticsContext = createContext<WebDiagnosticsContextValue | null>(null);

export function useWebDiagnostics(): WebDiagnosticsContextValue {
  const value = useContext(WebDiagnosticsContext);
  if (!value) throw new Error("WebDiagnosticsProvider is unavailable");
  return value;
}

export function WebDiagnosticsProvider({ children }: { readonly children: ReactNode }) {
  const [localEntries, setLocalEntries] = useState<readonly UiRuntimeDiagnostic[]>([]);
  const [serverEntries, setServerEntries] = useState<readonly UiRuntimeDiagnostic[]>([]);
  const [problems, setProblems] = useState<readonly UiDiagnostic[]>([]);
  const [view, setView] = useState<"problems" | "runtime" | null>(() => diagnosticsView(window.location.search));
  const [focusedPath, setFocusedPath] = useState(() => new URLSearchParams(window.location.search).get("problem") ?? undefined);
  const [acknowledgedThrough, setAcknowledgedThrough] = useState(() => readSessionTimestamp(RUNTIME_ACKNOWLEDGED_KEY));
  const [clearedThrough, setClearedThrough] = useState(() => readSessionTimestamp(RUNTIME_CLEARED_KEY));
  const [, setToneRevision] = useState(0);

  const report = useCallback((reason: unknown, context?: string): void => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const timestamp = new Date().toISOString();
    const entry: UiRuntimeDiagnostic = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp,
      level: "error",
      source: "client",
      message: context ? `${context}: ${error.message}` : error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
    setLocalEntries((current) => [...current, entry].slice(-100));
    void reportRuntimeDiagnostic({ timestamp, message: entry.message, ...(entry.stack ? { stack: entry.stack } : {}) });
  }, []);

  const refreshRuntimeEntries = useCallback(async (): Promise<void> => {
    try {
      const entries = await loadRuntimeDiagnostics();
      if (clearedThrough && entries.some((entry) => entry.level === "error" && !isRuntimeTimestampAfter(entry.timestamp, clearedThrough))) {
        setServerEntries((await clearRuntimeDiagnostics(clearedThrough)) ?? entries);
      } else {
        setServerEntries(entries);
      }
    } catch {
      // The visible client history remains useful while the local server is unavailable.
    }
  }, [clearedThrough]);

  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      const target = event.target;
      const resource =
        target instanceof HTMLImageElement || target instanceof HTMLScriptElement
          ? target.src
          : target instanceof HTMLLinkElement
            ? target.href
            : undefined;
      report(event.error ?? (event.message || (resource ? `资源加载失败：${resource}` : "未知的窗口错误")), "window.error");
    };
    const onRejection = (event: PromiseRejectionEvent): void => report(event.reason, "unhandled rejection");
    const onApiError = (event: Event): void => {
      const detail = (event as CustomEvent<{ readonly message?: unknown; readonly stack?: unknown }>).detail;
      const error = new Error(typeof detail?.message === "string" ? detail.message : "未知的 API 错误");
      if (typeof detail?.stack === "string") error.stack = detail.stack;
      report(error);
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("ui-authoring:error", onApiError);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("ui-authoring:error", onApiError);
    };
  }, [report]);

  useEffect(() => {
    const onPopState = (): void => {
      setView(diagnosticsView(window.location.search));
      setFocusedPath(new URLSearchParams(window.location.search).get("problem") ?? undefined);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const runtimeEntries = useMemo(
    () =>
      mergeRuntimeEntries(localEntries, serverEntries).filter(
        (entry) => entry.level === "error" && (!clearedThrough || isRuntimeTimestampAfter(entry.timestamp, clearedThrough)),
      ),
    [clearedThrough, localEntries, serverEntries],
  );
  const latestRuntimeTimestamp = newestRuntimeTimestamp(runtimeEntries);
  const acknowledgeRuntime = useCallback((through: string | undefined): void => {
    if (!through) return;
    setAcknowledgedThrough((current) => persistLaterTimestamp(RUNTIME_ACKNOWLEDGED_KEY, current, through));
  }, []);
  const runtimeTone = runtimeNotificationTone(runtimeEntries, acknowledgedThrough, Date.now());
  const overallTone: DiagnosticsTone = problems.length > 0 ? "danger" : runtimeTone;

  useEffect(() => {
    if (view === "runtime") acknowledgeRuntime(latestRuntimeTimestamp);
  }, [acknowledgeRuntime, latestRuntimeTimestamp, view]);

  useEffect(() => {
    const latestUnacknowledged = newestRuntimeTimestamp(
      runtimeEntries.filter((entry) => !acknowledgedThrough || isRuntimeTimestampAfter(entry.timestamp, acknowledgedThrough)),
    );
    if (!latestUnacknowledged || runtimeTone === "muted") return;
    const age = Math.max(0, Date.now() - runtimeTimestampMs(latestUnacknowledged));
    const boundary = runtimeTone === "danger" ? RECENT_RUNTIME_ERROR_MS : AGING_RUNTIME_ERROR_MS;
    const timer = window.setTimeout(() => setToneRevision((revision) => revision + 1), Math.max(50, boundary - age + 50));
    return () => window.clearTimeout(timer);
  }, [acknowledgedThrough, runtimeEntries, runtimeTone]);

  const open = useCallback(
    (nextView: "problems" | "runtime", path?: string): void => {
      const search = new URLSearchParams(window.location.search);
      search.set("diagnostics", nextView);
      if (path) search.set("problem", path);
      else search.delete("problem");
      window.history.pushState(null, "", `${window.location.pathname}?${search.toString()}`);
      if (nextView === "runtime") acknowledgeRuntime(latestRuntimeTimestamp);
      setView(nextView);
      setFocusedPath(path);
    },
    [acknowledgeRuntime, latestRuntimeTimestamp],
  );
  const close = (): void => {
    const search = new URLSearchParams(window.location.search);
    search.delete("diagnostics");
    search.delete("problem");
    const suffix = search.toString();
    window.history.pushState(null, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`);
    setView(null);
    setFocusedPath(undefined);
  };
  useEffect(() => {
    void refreshRuntimeEntries();
  }, [refreshRuntimeEntries, view]);

  const clearRuntime = useCallback((): void => {
    if (!latestRuntimeTimestamp) return;
    setClearedThrough((current) => persistLaterTimestamp(RUNTIME_CLEARED_KEY, current, latestRuntimeTimestamp));
    acknowledgeRuntime(latestRuntimeTimestamp);
    setLocalEntries((current) => current.filter((entry) => isRuntimeTimestampAfter(entry.timestamp, latestRuntimeTimestamp)));
    setServerEntries((current) =>
      current.filter((entry) => entry.level !== "error" || isRuntimeTimestampAfter(entry.timestamp, latestRuntimeTimestamp)),
    );
    void clearRuntimeDiagnostics(latestRuntimeTimestamp).then((entries) => {
      if (entries) setServerEntries(entries);
    });
  }, [acknowledgeRuntime, latestRuntimeTimestamp]);

  const value = useMemo<WebDiagnosticsContextValue>(
    () => ({ report, setProblems, openProblems: (path) => open("problems", path) }),
    [open, report],
  );
  const count = problems.length + runtimeEntries.length;
  return (
    <WebDiagnosticsContext.Provider value={value}>
      <RenderErrorBoundary onError={(error) => report(error, "React render")}>{children}</RenderErrorBoundary>
      {count > 0 && !view ? (
        <button
          className={webClasses(`diagnostics-trigger is-${overallTone}`)}
          data-ui="diagnostics-trigger"
          type="button"
          onClick={() => open(problems.length > 0 ? "problems" : "runtime")}
          title="打开诊断"
          aria-label={`诊断：${count}`}
          data-diagnostics-count={count}
          data-diagnostics-tone={overallTone}
        >
          <AlertTriangle size={15} />
          <span>{count}</span>
        </button>
      ) : null}
      {view ? (
        <DiagnosticsPage
          view={view}
          problems={problems}
          runtimeEntries={runtimeEntries}
          overallTone={overallTone}
          runtimeTone={runtimeTone}
          focusedPath={focusedPath}
          onView={(next) => open(next)}
          onFocus={setFocusedPath}
          onClearRuntime={clearRuntime}
          onClose={close}
        />
      ) : null}
    </WebDiagnosticsContext.Provider>
  );
}

function DiagnosticsPage({
  view,
  problems,
  runtimeEntries,
  overallTone,
  runtimeTone,
  focusedPath,
  onView,
  onFocus,
  onClearRuntime,
  onClose,
}: {
  readonly view: "problems" | "runtime";
  readonly problems: readonly UiDiagnostic[];
  readonly runtimeEntries: readonly UiRuntimeDiagnostic[];
  readonly overallTone: DiagnosticsTone;
  readonly runtimeTone: DiagnosticsTone;
  readonly focusedPath?: string | undefined;
  readonly onView: (view: "problems" | "runtime") => void;
  readonly onFocus: (path: string) => void;
  readonly onClearRuntime: () => void;
  readonly onClose: () => void;
}) {
  const groups = useMemo(() => problemGroups(problems), [problems]);
  const selectedGroup = groups.find((group) => group.path === focusedPath) ?? groups[0];
  const text = view === "problems" ? formatProblems(problems) : formatRuntime(runtimeEntries);
  return (
    <main className={webClasses("diagnostics-page")} aria-label="诊断" data-diagnostics-page>
      <header className={webClasses("diagnostics-header")}>
        <div className={webClasses(`diagnostics-summary is-${overallTone}`)}>
          <AlertTriangle size={18} />
          <strong>诊断</strong>
          <span className={webClasses(`diagnostics-count is-${overallTone}`)}>{problems.length + runtimeEntries.length}</span>
        </div>
        <div className={webClasses("diagnostics-tabs")} role="tablist">
          <button
            className={webClasses(view === "problems" ? "is-active" : "")}
            type="button"
            role="tab"
            aria-selected={view === "problems"}
            onClick={() => onView("problems")}
          >
            <FileWarning size={14} />
            问题 <small className={webClasses(problems.length > 0 ? "is-danger" : "is-muted")}>{problems.length}</small>
          </button>
          <button
            className={webClasses(view === "runtime" ? "is-active" : "")}
            type="button"
            role="tab"
            aria-selected={view === "runtime"}
            onClick={() => onView("runtime")}
          >
            <ServerCrash size={14} />
            运行时错误
            <small className={webClasses(`is-${runtimeTone}`)} data-runtime-tone={runtimeTone}>
              {runtimeEntries.length}
            </small>
          </button>
        </div>
        <div className={webClasses("diagnostics-actions")}>
          {view === "runtime" ? (
            <button type="button" onClick={onClearRuntime} title="清理运行时错误" disabled={runtimeEntries.length === 0}>
              <Trash2 size={15} />
            </button>
          ) : null}
          <button type="button" onClick={() => void navigator.clipboard.writeText(text)} title="复制当前诊断">
            <Clipboard size={15} />
          </button>
          <a href={runtimeDiagnosticsDownloadUrl()} download title="下载错误与日志">
            <Download size={15} />
          </a>
          <button type="button" onClick={() => window.location.reload()} title="重新加载工作区">
            <RefreshCw size={15} />
          </button>
          <button type="button" onClick={onClose} title="关闭诊断">
            <X size={16} />
          </button>
        </div>
      </header>
      {view === "problems" ? (
        <div className={webClasses("diagnostics-layout")}>
          <nav className={webClasses("diagnostics-list")} aria-label="问题文档">
            {groups.map((group) => (
              <button
                key={group.path}
                className={webClasses(group.path === selectedGroup?.path ? "is-active" : "")}
                type="button"
                onClick={() => onFocus(group.path)}
              >
                <FileWarning size={14} />
                <span>
                  <strong>{group.key}</strong>
                  <small>{group.path}</small>
                </span>
                <b>{group.entries.length}</b>
              </button>
            ))}
            {groups.length === 0 ? <p>工作区暂无问题</p> : null}
          </nav>
          <section className={webClasses("diagnostics-detail")}>
            {selectedGroup ? (
              <>
                <header>
                  <div>
                    <strong>{selectedGroup.key}</strong>
                    <span>{selectedGroup.kind}</span>
                  </div>
                  <code>{selectedGroup.path}</code>
                </header>
                <div>
                  {selectedGroup.entries.map((problem, index) => (
                    <article key={`${problem.code}:${index}`}>
                      <div>
                        <code>{problem.code}</code>
                        <span>{problem.category}</span>
                      </div>
                      <p>{problem.message}</p>
                      {problem.identity?.fieldPath ? <small>{problem.identity.fieldPath}</small> : null}
                      <aside>{problem.nextAction}</aside>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p>工作区暂无问题</p>
            )}
          </section>
        </div>
      ) : (
        <section className={webClasses("runtime-list")}>
          {[...runtimeEntries].reverse().map((entry) => (
            <article key={entry.id}>
              <header>
                <time>{new Date(entry.timestamp).toLocaleString()}</time>
                <span>{entry.source}</span>
              </header>
              <strong>{entry.message}</strong>
              {entry.stack ? <pre>{entry.stack}</pre> : null}
            </article>
          ))}
          {runtimeEntries.length === 0 ? <p>暂无运行时错误</p> : null}
        </section>
      )}
    </main>
  );
}

function diagnosticsView(search: string): "problems" | "runtime" | null {
  const value = new URLSearchParams(search).get("diagnostics");
  return value === "problems" || value === "runtime" ? value : null;
}

function mergeRuntimeEntries(local: readonly UiRuntimeDiagnostic[], server: readonly UiRuntimeDiagnostic[]): UiRuntimeDiagnostic[] {
  const result = new Map<string, UiRuntimeDiagnostic>();
  for (const entry of [...server, ...local]) result.set(`${entry.timestamp}\0${entry.source}\0${entry.message}`, entry);
  return [...result.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function readSessionTimestamp(key: string): string | undefined {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistLaterTimestamp(key: string, current: string | undefined, candidate: string): string {
  const next = current && !isRuntimeTimestampAfter(candidate, current) ? current : candidate;
  try {
    window.sessionStorage.setItem(key, next);
  } catch {
    // Session storage is optional; the current page state still tracks acknowledgement.
  }
  return next;
}

function problemGroups(problems: readonly UiDiagnostic[]) {
  const groups = new Map<string, UiDiagnostic[]>();
  for (const problem of problems) groups.set(problem.path, [...(groups.get(problem.path) ?? []), problem]);
  return [...groups]
    .map(([path, entries]) => ({
      path,
      entries,
      key: entries[0]?.identity?.documentKey ?? path.split("/").at(-1) ?? path,
      kind: entries[0]?.identity?.documentKind ?? entries[0]?.owner ?? "workspace",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function formatProblems(problems: readonly UiDiagnostic[]): string {
  return problems
    .map(
      (problem) =>
        `${problem.path}\n[${problem.code}] ${problem.message}${problem.identity?.fieldPath ? `\n${problem.identity.fieldPath}` : ""}\nNext: ${problem.nextAction}`,
    )
    .join("\n\n");
}

function formatRuntime(entries: readonly UiRuntimeDiagnostic[]): string {
  return entries
    .map((entry) => `${entry.timestamp} [${entry.source}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ""}`)
    .join("\n\n");
}

class RenderErrorBoundary extends Component<
  { readonly children: ReactNode; readonly onError: (error: Error) => void },
  { readonly error?: Error }
> {
  state: { readonly error?: Error } = {};
  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    const reported = new Error(error.message);
    reported.stack = [error.stack, info.componentStack].filter(Boolean).join("\n");
    this.props.onError(reported);
  }
  render(): ReactNode {
    if (this.state.error)
      return (
        <main className={webClasses("render-failure")}>
          <AlertTriangle size={26} />
          <h1>页面渲染失败</h1>
          <pre>{this.state.error.message}</pre>
        </main>
      );
    return this.props.children;
  }
}
