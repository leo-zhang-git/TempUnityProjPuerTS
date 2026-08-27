import { createWebClasses } from "../../styles/web-styles.js";
import sharedStyles from "./editor-shell.module.css";
import type { WorkbenchPanel, WorkbenchPanelResizeController } from "./workbench-panel-resize.js";

const webClasses = createWebClasses(sharedStyles);

export function PanelResizeHandle({ panel, resize }: { readonly panel: WorkbenchPanel; readonly resize: WorkbenchPanelResizeController }) {
  const sideName = panel === "tree" ? "左侧栏" : panel === "inspector" ? "Inspector" : "底部 Project";
  const [minimum, maximum] = panel === "tree" ? [180, 420] : panel === "inspector" ? [240, 520] : [140, 480];
  const dimension = panel === "project" ? "高度" : "宽度";
  return (
    <div
      className={webClasses(`panel-resize-handle ${panel}-panel-resize-handle`)}
      role="separator"
      aria-label={`调整${sideName}${dimension}`}
      aria-orientation={panel === "project" ? "horizontal" : "vertical"}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={resize.panelSize(panel)}
      data-panel-resize={panel}
      tabIndex={0}
      title={`拖拽或使用方向键调整${sideName}${dimension}`}
      onPointerDown={(event) => resize.onPointerDown(panel, event)}
      onPointerMove={(event) => resize.onPointerMove(panel, event)}
      onPointerUp={(event) => resize.onPointerUp(panel, event)}
      onPointerCancel={(event) => resize.onPointerCancel(panel, event)}
      onKeyDown={(event) => resize.onKeyDown(panel, event)}
    />
  );
}
