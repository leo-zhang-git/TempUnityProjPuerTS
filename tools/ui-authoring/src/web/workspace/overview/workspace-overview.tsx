import {
  AlertTriangle,
  AppWindow,
  Blocks,
  Box,
  CircleAlert,
  FileJson,
  GitBranch,
  LayoutDashboard,
  type LucideIcon,
  RefreshCw,
  Search,
  UsersRound,
  Workflow,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DocumentCatalog } from "../../../schema/ui-api.js";
import type { UiCollaborationActivityStatus } from "../../../schema/ui-collaboration.js";
import styles from "./workspace-overview.module.css";
import {
  createWorkspaceOverview,
  selectWorkspaceOverviewRows,
  type WorkspaceOverviewDocumentType,
  type WorkspaceOverviewFilter,
  type WorkspaceOverviewRow,
  type WorkspaceOverviewSort,
} from "./workspace-overview-model.js";

export interface WorkspaceOverviewProps {
  readonly catalog: DocumentCatalog;
  readonly dirtyDocumentIds: ReadonlySet<string>;
  readonly activity: UiCollaborationActivityStatus | null;
  readonly activityRefreshing: boolean;
  readonly onRefreshActivity: () => void;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string) => void;
}

const typeOptions: readonly { readonly value: WorkspaceOverviewFilter; readonly label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "Canvas", label: "Canvas" },
  { value: "Widget", label: "Widget" },
  { value: "Fragment", label: "Fragment" },
  { value: "Reference", label: "Reference" },
  { value: "Prototype", label: "Prototype" },
  { value: "Unavailable", label: "不可用" },
];

export default function WorkspaceOverview({
  catalog,
  dirtyDocumentIds,
  activity,
  activityRefreshing,
  onRefreshActivity,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
}: WorkspaceOverviewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkspaceOverviewFilter>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [sort, setSort] = useState<WorkspaceOverviewSort>("modified");
  const model = useMemo(() => createWorkspaceOverview(catalog, dirtyDocumentIds, activity), [activity, catalog, dirtyDocumentIds]);
  const rows = useMemo(
    () => selectWorkspaceOverviewRows(model.rows, query, filter, activeOnly, sort),
    [activeOnly, filter, model.rows, query, sort],
  );
  const open = (entry: WorkspaceOverviewRow): void => {
    if (entry.unavailable) return;
    if (entry.documentKind === "artifact") onOpenArtifact(entry.key);
    if (entry.documentKind === "reference") onOpenReference(entry.key);
    if (entry.documentKind === "prototype") onOpenPrototype(entry.key);
  };
  const activityLabel =
    activity?.connection === "connected"
      ? model.summary.activeCount > 0
        ? `${model.summary.activeCount} 个文档编辑中`
        : "暂无在线编辑"
      : (activity?.message ?? "正在读取在线状态");

  return (
    <main className={styles["overview"]}>
      <header className={styles["overview-heading"]}>
        <div>
          <span>
            <LayoutDashboard size={13} />
            UI Source 工作区
          </span>
          <h1>工作区总览</h1>
        </div>
        <div className={styles["activity-state"]} data-connection={activity?.connection ?? "loading"}>
          <span>
            <UsersRound size={13} />
            {activityLabel}
          </span>
          <button
            type="button"
            onClick={onRefreshActivity}
            disabled={activityRefreshing}
            title="刷新在线编辑状态"
            aria-label="刷新在线编辑状态"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <section className={styles["summary-band"]} aria-label="工作区统计">
        <SummaryMetric label="界面资产" value={model.summary.artifactCount} icon={AppWindow}>
          <span>Canvas {model.summary.canvasCount}</span>
          <span>Widget {model.summary.widgetCount}</span>
          <span>Fragment {model.summary.fragmentCount}</span>
          <div className={styles["type-distribution"]} aria-label="界面资产类型分布">
            <i data-type="canvas" style={{ flexGrow: model.summary.canvasCount }} />
            <i data-type="widget" style={{ flexGrow: model.summary.widgetCount }} />
            <i data-type="fragment" style={{ flexGrow: model.summary.fragmentCount }} />
          </div>
        </SummaryMetric>
        <SummaryMetric label="预览与流程" value={model.summary.referenceCount + model.summary.prototypeCount} icon={Workflow}>
          <span>Reference {model.summary.referenceCount}</span>
          <span>Prototype {model.summary.prototypeCount}</span>
          <span>交互 {model.summary.interactionCount}</span>
        </SummaryMetric>
        <SummaryMetric label="近 7 日保存" value={model.summary.recentCount} icon={RefreshCw}>
          <span>最近保存</span>
          <strong>{formatRelativeTime(model.summary.latestModifiedAt)}</strong>
        </SummaryMetric>
        <SummaryMetric
          label="在线编辑"
          value={model.summary.activeCount}
          icon={UsersRound}
          {...(model.summary.activeCount > 0 ? { tone: "active" as const } : {})}
        >
          <span>本页未保存 {model.rows.filter((entry) => entry.localDirty).length}</span>
          <span>协作会话 {new Set(model.rows.flatMap((entry) => entry.editors.map((editor) => editor.sessionId))).size}</span>
        </SummaryMetric>
        <SummaryMetric
          label="健康状态"
          value={model.summary.problemCount}
          icon={CircleAlert}
          {...(model.summary.problemCount > 0 ? { tone: "warning" as const } : {})}
        >
          <span>不可用 {model.summary.unavailableCount}</span>
          <span>文档总数 {model.summary.totalDocuments}</span>
        </SummaryMetric>
      </section>

      <section className={styles["inventory"]} aria-label="界面清单">
        <header className={styles["inventory-toolbar"]}>
          <div>
            <h2>界面清单</h2>
            <span>
              {rows.length} / {model.summary.totalDocuments}
            </span>
          </div>
          <label className={styles["search"]}>
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索界面清单"
              placeholder="名称、路径或编辑者"
            />
          </label>
          <select value={filter} onChange={(event) => setFilter(event.target.value as WorkspaceOverviewFilter)} aria-label="界面类型">
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className={styles["activity-filter"]} aria-label="编辑状态筛选">
            <button type="button" className={!activeOnly ? styles["is-active"] : undefined} onClick={() => setActiveOnly(false)}>
              全部
            </button>
            <button type="button" className={activeOnly ? styles["is-active"] : undefined} onClick={() => setActiveOnly(true)}>
              编辑中
            </button>
          </div>
          <select value={sort} onChange={(event) => setSort(event.target.value as WorkspaceOverviewSort)} aria-label="界面排序">
            <option value="modified">最近保存</option>
            <option value="name">名称</option>
            <option value="path">路径</option>
          </select>
        </header>

        <div className={styles["document-table"]}>
          <div className={styles["table-heading"]}>
            <span>文档</span>
            <span>类型</span>
            <span>状态</span>
            <span>关联</span>
            <span>最近保存</span>
          </div>
          <div className={styles["table-body"]}>
            {rows.map((entry) => (
              <button
                key={`${entry.id}:${entry.path}`}
                className={styles["document-row"]}
                type="button"
                disabled={entry.unavailable}
                onClick={() => open(entry)}
                data-overview-document={entry.id}
                data-active={entry.active || undefined}
                title={entry.unavailable ? "文档不可加载，请先修复问题" : `打开 ${entry.key}`}
              >
                <span className={styles["document-identity"]}>
                  {typeIcon(entry.type)}
                  <span>
                    <strong>{entry.key}</strong>
                    <small>{entry.path}</small>
                  </span>
                </span>
                <span className={styles["document-type"]} data-type={entry.type.toLocaleLowerCase()}>
                  {entry.type === "Unavailable" ? "不可用" : entry.type}
                </span>
                <span
                  className={styles["document-status"]}
                  data-tone={entry.active ? "active" : entry.problemCount > 0 ? "warning" : "ready"}
                >
                  {statusIcon(entry)}
                  <span>{statusLabel(entry)}</span>
                </span>
                <span className={styles["document-relation"]}>
                  <GitBranch size={12} />
                  {entry.relationLabel}
                </span>
                <time
                  dateTime={entry.modifiedAt > 0 ? new Date(entry.modifiedAt).toISOString() : undefined}
                  title={formatAbsoluteTime(entry.modifiedAt)}
                >
                  {formatRelativeTime(entry.modifiedAt)}
                </time>
              </button>
            ))}
            {rows.length === 0 ? (
              <div className={styles["empty-state"]}>
                <Search size={20} />
                <span>没有符合条件的文档</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function SummaryMetric({
  label,
  value,
  icon: Icon,
  tone,
  children,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: LucideIcon;
  readonly tone?: "active" | "warning";
  readonly children: React.ReactNode;
}) {
  return (
    <article className={styles["summary-metric"]} data-tone={tone}>
      <header>
        <Icon size={14} />
        <span>{label}</span>
      </header>
      <strong>{value}</strong>
      <div>{children}</div>
    </article>
  );
}

function typeIcon(type: WorkspaceOverviewDocumentType): React.ReactNode {
  if (type === "Canvas") return <AppWindow size={15} />;
  if (type === "Widget") return <Box size={15} />;
  if (type === "Fragment") return <Blocks size={15} />;
  if (type === "Reference") return <FileJson size={15} />;
  if (type === "Prototype") return <Workflow size={15} />;
  return <AlertTriangle size={15} />;
}

function statusIcon(entry: WorkspaceOverviewRow): React.ReactNode {
  if (entry.active) return <UsersRound size={12} />;
  if (entry.problemCount > 0) return <CircleAlert size={12} />;
  return <span className={styles["ready-dot"]} />;
}

function statusLabel(entry: WorkspaceOverviewRow): string {
  if (entry.active) {
    const editors = [...new Set(entry.editors.map((editor) => editor.userName))];
    const labels = [...(entry.localDirty ? ["本页"] : []), ...editors];
    return `${labels.join("、")}编辑中`;
  }
  if (entry.problemCount > 0) return `${entry.problemCount} 个问题`;
  return "可用";
}

function formatRelativeTime(timestamp: number): string {
  if (timestamp <= 0) return "未知";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} 小时前`;
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatAbsoluteTime(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "未知";
}
