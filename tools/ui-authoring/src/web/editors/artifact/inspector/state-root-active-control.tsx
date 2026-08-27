import { AlertTriangle, LocateFixed, Pencil, X } from "lucide-react";
import type { StateRootActiveControl } from "../../../../kernel/state-root-control.js";
import { stateRootActiveControllers } from "../../../../kernel/state-root-control.js";
import { findNode } from "../../../../kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import { gameObjectDiagnosticLabel, gameObjectName } from "../../../shared/game-object-label.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import dialogStyles from "../../shared/dialog.module.css";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-inspector.module.css";

const webClasses = createWebClasses(sharedStyles, dialogStyles, artifactStyles);

export interface StateRootControlledActiveNode {
  readonly node: UiNode;
  readonly controls: readonly StateRootActiveControl[];
}

export function stateRootControlledActiveNodes(
  source: UiConcreteSource,
  nodes: readonly UiNode[],
): readonly StateRootControlledActiveNode[] {
  return nodes.flatMap((node) => {
    const controls = stateRootActiveControllers(source, node.id);
    return controls.length > 0 ? [{ node, controls }] : [];
  });
}

export function StateRootActiveNotice({ controlledNodes }: { readonly controlledNodes: readonly StateRootControlledActiveNode[] }) {
  if (controlledNodes.length === 0) return null;
  const rootCount = new Set(controlledNodes.flatMap((entry) => entry.controls.map((control) => control.stateRootNodeId))).size;
  return (
    <div className={webClasses("state-root-active-notice")} data-ui="state-root-active-notice">
      <AlertTriangle size={12} />
      <span>
        {controlledNodes.length === 1
          ? `Active 由 ${rootCount} 个 StateRoot 控制`
          : `${controlledNodes.length} 个所选节点的 Active 由 ${rootCount} 个 StateRoot 控制`}
      </span>
    </div>
  );
}

export function StateRootActiveControlDialog({
  source,
  controlledNodes,
  nextActive,
  onClose,
  onConfirmBaseline,
  onSelectNode,
}: {
  readonly source: UiConcreteSource;
  readonly controlledNodes: readonly StateRootControlledActiveNode[];
  readonly nextActive: boolean;
  readonly onClose: () => void;
  readonly onConfirmBaseline: () => void;
  readonly onSelectNode?: ((nodeId: string) => void) | undefined;
}) {
  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={onClose}>
      <section
        className={webClasses("authoring-dialog state-root-active-dialog")}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="state-root-active-dialog-title"
        aria-describedby="state-root-active-dialog-message"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
      >
        <header>
          <div>
            <AlertTriangle size={15} />
            <h2 id="state-root-active-dialog-title">Active 由 StateRoot 控制</h2>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} title="取消">
            <X size={15} />
          </button>
        </header>
        <p className={webClasses("dialog-message")} id="state-root-active-dialog-message">
          当前预览会使用 StateRoot 状态覆盖 Active。继续只会把 Unity 基线改为 {nextActive ? "Active" : "Inactive"}，画面可能保持不变。
        </p>
        <div className={webClasses("state-root-active-control-list")}>
          {controlledNodes.map(({ node, controls }) => (
            <section key={node.id}>
              <strong title={gameObjectDiagnosticLabel(node)}>{gameObjectName(node)}</strong>
              {controls.map((control) => {
                const stateRoot = findNode(source, control.stateRootNodeId);
                const currentValue = control.currentValue;
                return (
                  <div key={control.stateRootNodeId}>
                    <span title={stateRoot ? gameObjectDiagnosticLabel(stateRoot) : control.stateRootNodeId}>
                      {stateRoot ? gameObjectName(stateRoot) : control.stateRootNodeId}
                    </span>
                    <small>
                      {control.currentState} · {currentValue === undefined ? "沿用基线" : currentValue ? "Active" : "Inactive"}
                    </small>
                    <button
                      className={webClasses("dialog-secondary")}
                      type="button"
                      disabled={!onSelectNode}
                      onClick={() => {
                        onSelectNode?.(control.stateRootNodeId);
                        onClose();
                      }}
                    >
                      <LocateFixed size={13} />
                      编辑状态
                    </button>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose}>
            取消
          </button>
          <button className={webClasses("dialog-primary")} type="button" autoFocus onClick={onConfirmBaseline}>
            <Pencil size={13} />
            仍修改 Unity 基线
          </button>
        </footer>
      </section>
    </div>
  );
}
