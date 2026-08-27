import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createWebClasses } from "../../styles/web-styles.js";
import sharedStyles from "./editor-shell.module.css";
import { type EditorSidebarTab, EditorSidebarTabs } from "./editor-sidebar-tabs.js";

const webClasses = createWebClasses(sharedStyles);
const SIDEBAR_SPLIT_MIN = 0.2;
const SIDEBAR_SPLIT_MAX = 0.8;
const WORKBENCH_SIDEBAR_STORAGE_KEY = "ui-authoring:workbench-sidebar:v3";

interface StoredSidebarLayout {
  readonly views?: unknown;
  readonly focused?: unknown;
  readonly split?: unknown;
}

interface SharedSidebarLayout {
  readonly views: readonly string[];
  readonly focused?: string | undefined;
  readonly split: number;
}

export interface WorkbenchSidebarLayout<Value extends string> {
  readonly views: readonly Value[];
  readonly focused: Value;
  readonly split: number;
}

const EMPTY_SHARED_LAYOUT: SharedSidebarLayout = { views: [], split: 0.5 };
let sharedSidebarLayout: SharedSidebarLayout | undefined;
const sharedSidebarListeners = new Set<() => void>();

function loadSharedSidebarLayout(): SharedSidebarLayout {
  if (typeof window === "undefined") return EMPTY_SHARED_LAYOUT;
  try {
    const stored = JSON.parse(window.localStorage.getItem(WORKBENCH_SIDEBAR_STORAGE_KEY) ?? "null") as StoredSidebarLayout | null;
    const storedViews = Array.isArray(stored?.views) ? stored.views.filter((value): value is string => typeof value === "string") : [];
    const views = [...new Set(storedViews)].slice(0, 2);
    const focused = typeof stored?.focused === "string" && views.includes(stored.focused) ? stored.focused : undefined;
    const split =
      typeof stored?.split === "number" && stored.split >= SIDEBAR_SPLIT_MIN && stored.split <= SIDEBAR_SPLIT_MAX ? stored.split : 0.5;
    return { views, focused, split };
  } catch {
    return EMPTY_SHARED_LAYOUT;
  }
}

function getSharedSidebarLayout(): SharedSidebarLayout {
  if (typeof window === "undefined") return EMPTY_SHARED_LAYOUT;
  sharedSidebarLayout ??= loadSharedSidebarLayout();
  return sharedSidebarLayout;
}

function subscribeSharedSidebarLayout(listener: () => void): () => void {
  sharedSidebarListeners.add(listener);
  return () => sharedSidebarListeners.delete(listener);
}

function sameSharedSidebarLayout(left: SharedSidebarLayout, right: SharedSidebarLayout): boolean {
  return (
    left.focused === right.focused &&
    left.split === right.split &&
    left.views.length === right.views.length &&
    left.views.every((view, index) => view === right.views[index])
  );
}

function storeSharedSidebarLayout(next: SharedSidebarLayout): void {
  const current = getSharedSidebarLayout();
  if (sameSharedSidebarLayout(current, next)) return;
  sharedSidebarLayout = next;
  try {
    window.localStorage.setItem(WORKBENCH_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The current layout remains usable when browser storage is unavailable.
  }
  for (const listener of sharedSidebarListeners) listener();
}

function resolveSidebarLayout<Value extends string>(
  shared: SharedSidebarLayout,
  values: readonly Value[],
  fallback: Value,
): WorkbenchSidebarLayout<Value> {
  const allowed = new Set<string>(values);
  const supportedViews = shared.views.filter((view): view is Value => allowed.has(view));
  const views = supportedViews.length > 0 ? supportedViews : [fallback];
  const focused = shared.focused && views.includes(shared.focused as Value) ? (shared.focused as Value) : views[0]!;
  return { views, focused, split: shared.split };
}

export function useWorkbenchSidebarLayout<Value extends string>(values: readonly Value[], fallback: Value) {
  const shared = useSyncExternalStore(subscribeSharedSidebarLayout, getSharedSidebarLayout, () => EMPTY_SHARED_LAYOUT);
  const layout = useMemo(() => resolveSidebarLayout(shared, values, fallback), [fallback, shared, values]);
  const select = useCallback(
    (value: Value, additive: boolean): void => {
      const current = resolveSidebarLayout(getSharedSidebarLayout(), values, fallback);
      if (!additive) {
        storeSharedSidebarLayout({ views: [value], focused: value, split: current.split });
        return;
      }
      if (current.views.includes(value)) {
        if (current.views.length === 1) {
          storeSharedSidebarLayout({ views: current.views, focused: value, split: current.split });
          return;
        }
        const views = current.views.filter((candidate) => candidate !== value);
        const focused = current.focused === value ? views[0]! : current.focused;
        storeSharedSidebarLayout({ views, focused, split: current.split });
        return;
      }
      if (current.views.length === 1) {
        storeSharedSidebarLayout({ views: [...current.views, value], focused: value, split: current.split });
        return;
      }
      const views = [...current.views];
      const replaceIndex = Math.max(0, current.views.indexOf(current.focused));
      views[replaceIndex] = value;
      storeSharedSidebarLayout({ views, focused: value, split: current.split });
    },
    [fallback, values],
  );
  const show = useCallback(
    (value: Value): void => {
      const current = resolveSidebarLayout(getSharedSidebarLayout(), values, fallback);
      const views = current.views.includes(value) ? current.views : [value];
      storeSharedSidebarLayout({ views, focused: value, split: current.split });
    },
    [fallback, values],
  );
  const focus = useCallback(
    (value: Value): void => {
      const stored = getSharedSidebarLayout();
      const current = resolveSidebarLayout(stored, values, fallback);
      if (!current.views.includes(value)) return;
      const views = stored.views.includes(value) ? stored.views : current.views;
      storeSharedSidebarLayout({ views, focused: value, split: current.split });
    },
    [fallback, values],
  );
  const setSplit = useCallback((split: number): void => {
    const clamped = Math.min(SIDEBAR_SPLIT_MAX, Math.max(SIDEBAR_SPLIT_MIN, split));
    const current = getSharedSidebarLayout();
    storeSharedSidebarLayout({ ...current, split: clamped });
  }, []);
  return { layout, select, show, focus, setSplit } as const;
}

export function WorkbenchSidebar<Value extends string>({
  label,
  tabs,
  layout,
  onSelect,
  onFocus,
  onSplit,
  render,
}: {
  readonly label: string;
  readonly tabs: readonly EditorSidebarTab<Value>[];
  readonly layout: WorkbenchSidebarLayout<Value>;
  readonly onSelect: (value: Value, additive: boolean) => void;
  readonly onFocus: (value: Value) => void;
  readonly onSplit: (split: number) => void;
  readonly render: (value: Value, focused: boolean) => ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const resize = (clientY: number): void => {
    const bounds = content.current?.getBoundingClientRect();
    if (!bounds || bounds.height <= 0) return;
    onSplit((clientY - bounds.top) / bounds.height);
  };
  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resize(event.clientY);
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientY);
  };
  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const nudgeResize = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onSplit(layout.split + (event.key === "ArrowDown" ? 0.04 : -0.04));
  };
  const labels = new Map(tabs.map((tab) => [tab.value, tab.label]));
  return (
    <>
      <EditorSidebarTabs label={label} tabs={tabs} value={layout.focused} activeValues={layout.views} onChange={onSelect} />
      <div
        ref={content}
        className={webClasses(`workbench-sidebar-content ${layout.views.length > 1 ? "is-split" : "is-single"}`)}
        style={{ "--workbench-sidebar-split": `${layout.split * 100}%` } as CSSProperties}
      >
        {layout.views.map((view, index) => (
          <div key={view} className={webClasses(`workbench-sidebar-slot ${layout.focused === view ? "is-focused" : ""}`)}>
            {index === 1 ? (
              <div
                className={webClasses("workbench-sidebar-resize")}
                role="separator"
                aria-label="调整左侧面板比例"
                aria-orientation="horizontal"
                aria-valuemin={20}
                aria-valuemax={80}
                aria-valuenow={Math.round(layout.split * 100)}
                tabIndex={0}
                data-sidebar-resize
                onPointerDown={beginResize}
                onPointerMove={moveResize}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onKeyDown={nudgeResize}
              />
            ) : null}
            <section
              className={webClasses("workbench-sidebar-pane")}
              aria-label={`${labels.get(view) ?? view} 面板`}
              data-sidebar-pane={view}
              onPointerDownCapture={() => onFocus(view)}
              onFocusCapture={() => onFocus(view)}
            >
              {render(view, layout.focused === view)}
            </section>
          </div>
        ))}
      </div>
    </>
  );
}
