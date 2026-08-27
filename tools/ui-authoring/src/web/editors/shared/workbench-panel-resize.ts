import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";

export type WorkbenchPanel = "tree" | "inspector" | "project";

type PanelSizes = Readonly<Partial<Record<WorkbenchPanel, number>>>;

export interface WorkbenchPanelResizeController {
  readonly panelStyle: CSSProperties;
  readonly panelSize: (panel: WorkbenchPanel) => number;
  readonly onPointerDown: (panel: WorkbenchPanel, event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (panel: WorkbenchPanel, event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (panel: WorkbenchPanel, event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (panel: WorkbenchPanel, event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onKeyDown: (panel: WorkbenchPanel, event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

const STORAGE_KEY = "ui-authoring:workbench-panel-sizes:v1";
const LEGACY_STORAGE_KEY = "ui-authoring:artifact-panel-sizes:v2";
const PANEL_LIMITS: Readonly<Record<WorkbenchPanel, readonly [number, number]>> = {
  tree: [180, 420],
  inspector: [240, 520],
  project: [140, 480],
};

interface ResizeSession {
  readonly panel: WorkbenchPanel;
  readonly startX: number;
  readonly startY: number;
  readonly startSize: number;
}

function clampPanelSize(panel: WorkbenchPanel, size: number): number {
  const [minimum, maximum] = PANEL_LIMITS[panel];
  return Math.min(maximum, Math.max(minimum, Math.round(size)));
}

function defaultPanelSize(panel: WorkbenchPanel): number {
  const wideLayout = typeof window !== "undefined" && window.innerWidth >= 1600;
  if (panel === "tree") return wideLayout ? 300 : 220;
  if (panel === "inspector") return wideLayout ? 380 : 280;
  return wideLayout ? 260 : 220;
}

function storedPanelSizes(): PanelSizes {
  if (typeof window === "undefined") return {};
  try {
    const text = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null";
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") return {};
    const record = value as Record<string, unknown>;
    const sizes: Partial<Record<WorkbenchPanel, number>> = {};
    for (const panel of ["tree", "inspector", "project"] as const) {
      const size = record[panel];
      if (typeof size === "number" && Number.isFinite(size)) sizes[panel] = clampPanelSize(panel, size);
    }
    return sizes;
  } catch {
    return {};
  }
}

function savePanelSizes(sizes: PanelSizes): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // Resizing remains available for the current session when storage is blocked.
  }
}

export function useWorkbenchPanelResize(): WorkbenchPanelResizeController {
  const [sizes, setSizes] = useState<PanelSizes>(storedPanelSizes);
  const sizesRef = useRef(sizes);
  const sessionRef = useRef<ResizeSession | undefined>(undefined);
  const panelStyle = useMemo(() => {
    type PanelStyle = CSSProperties & Partial<Record<"--tree-panel-width" | "--inspector-panel-width" | "--project-panel-height", string>>;
    const style: PanelStyle = {};
    if (sizes.tree !== undefined) style["--tree-panel-width"] = `${sizes.tree}px`;
    if (sizes.inspector !== undefined) style["--inspector-panel-width"] = `${sizes.inspector}px`;
    if (sizes.project !== undefined) style["--project-panel-height"] = `${sizes.project}px`;
    return style;
  }, [sizes]);

  const panelSize = (panel: WorkbenchPanel): number => sizesRef.current[panel] ?? defaultPanelSize(panel);

  const setPanelSize = (panel: WorkbenchPanel, size: number): PanelSizes => {
    const next = { ...sizesRef.current, [panel]: clampPanelSize(panel, size) };
    sizesRef.current = next;
    setSizes(next);
    return next;
  };

  const updatePointerSize = (panel: WorkbenchPanel, clientX: number, clientY: number): PanelSizes | undefined => {
    const session = sessionRef.current;
    if (!session || session.panel !== panel) return undefined;
    const delta = panel === "project" ? session.startY - clientY : clientX - session.startX;
    return setPanelSize(panel, session.startSize + (panel === "tree" || panel === "project" ? delta : -delta));
  };

  const onPointerDown = (panel: WorkbenchPanel, event: ReactPointerEvent<HTMLDivElement>): void => {
    sessionRef.current = { panel, startX: event.clientX, startY: event.clientY, startSize: panelSize(panel) };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (panel: WorkbenchPanel, event: ReactPointerEvent<HTMLDivElement>): void => {
    updatePointerSize(panel, event.clientX, event.clientY);
  };

  const finishPointerResize = (panel: WorkbenchPanel, event: ReactPointerEvent<HTMLDivElement>): void => {
    const next = updatePointerSize(panel, event.clientX, event.clientY);
    if (next) savePanelSizes(next);
    sessionRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (panel: WorkbenchPanel, event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const direction =
      panel === "project"
        ? event.key === "ArrowUp"
          ? 1
          : event.key === "ArrowDown"
            ? -1
            : 0
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowLeft"
            ? -1
            : 0;
    if (direction === 0) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    const next = setPanelSize(panel, panelSize(panel) + (panel === "tree" || panel === "project" ? direction : -direction) * step);
    savePanelSizes(next);
  };

  return {
    panelStyle,
    panelSize,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointerResize,
    onPointerCancel: finishPointerResize,
    onKeyDown,
  };
}
