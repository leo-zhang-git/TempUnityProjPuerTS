import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import type { PreviewDisplayMode } from "../../../kernel/preview.js";
import { applyStateRootPreviewOverrides, stateRootPreviewPatches } from "../../../kernel/preview-values.js";
import { resolveStateRootPreviewContext } from "../../../kernel/state-root-control.js";
import { walkNodes } from "../../../kernel/tree.js";
import type { UiReference } from "../../../schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../../schema/ui-source-schema.js";
import { ReferencePreview } from "../../rendering/reference-preview/reference-preview.js";
import { gameObjectDiagnosticLabel, gameObjectName } from "../../shared/game-object-label.js";
import type { ArtifactDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import artifactStyles from "./canvas/artifact-canvas.module.css";

const webClasses = createWebClasses(artifactStyles);
const MIN_PREVIEW_CARD_WIDTH = 176;
const PREVIEW_GRID_GAP = 8;

export interface StateRootPreviewRow {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeLabel: string;
  readonly currentState: string;
  readonly stateNames: readonly string[];
  readonly contextStates: Readonly<Record<string, string>>;
  readonly contextLabel: string;
  readonly issues: readonly string[];
}

export function stateRootPreviewRows(
  source: UiConcreteSource,
  contexts?: UiReference["statePreviewContexts"],
): readonly StateRootPreviewRow[] {
  const entries = walkNodes(source);
  const nodesById = new Map(entries.map(({ node }) => [node.id, node]));
  return entries.flatMap(({ node }) => {
    const stateRoot = node.components?.StateRoot;
    if (!stateRoot) return [];
    const context = resolveStateRootPreviewContext(source, node.id, contexts);
    const contextLabel = Object.entries(context.states)
      .map(([stateRootNodeId, stateName]) => `${gameObjectName(nodesById.get(stateRootNodeId) ?? { id: stateRootNodeId })}: ${stateName}`)
      .join(" · ");
    return [
      {
        nodeId: node.id,
        nodeName: gameObjectName(node),
        nodeLabel: gameObjectDiagnosticLabel(node),
        currentState: stateRoot.currentState,
        stateNames: Object.keys(stateRoot.states),
        contextStates: context.states,
        contextLabel,
        issues: context.issues,
      },
    ];
  });
}

export function responsiveStatePreviewColumns(availableWidth: number, maximumColumns: number): number {
  if (availableWidth <= 0) return maximumColumns;
  const fittingColumns = Math.floor((availableWidth + PREVIEW_GRID_GAP) / (MIN_PREVIEW_CARD_WIDTH + PREVIEW_GRID_GAP));
  return Math.max(1, Math.min(maximumColumns, fittingColumns));
}

export function StateRootPreviewGrid({
  source,
  artifacts,
  references,
  reference,
  referencePath,
  displayMode,
  maximumColumns,
  contexts,
}: {
  readonly source: UiConcreteSource;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly reference: UiReference;
  readonly referencePath?: string | undefined;
  readonly displayMode: Extract<PreviewDisplayMode, "preview" | "unityBaseline">;
  readonly maximumColumns: number;
  readonly contexts?: UiReference["statePreviewContexts"] | undefined;
}) {
  const previewRootKey =
    displayMode === "unityBaseline" ? source.artifactKey : (reference.context?.parentArtifactKey ?? reference.subjectArtifactKey);
  const previewRoot = artifacts.get(previewRootKey)?.resolvedSource ?? source;
  const initialSize =
    displayMode === "unityBaseline" ? artifactInitialSize(source) : (reference.viewport ?? artifactInitialSize(previewRoot));
  const rows = useMemo(() => stateRootPreviewRows(source, contexts), [source, contexts]);
  const root = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const update = (): void => setAvailableWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const responsiveColumns = responsiveStatePreviewColumns(availableWidth, maximumColumns);
  return (
    <div ref={root} className={webClasses("state-preview-scroll")} aria-label="StateRoot 状态总览">
      <div className={webClasses("state-preview-overview")}>
        {rows.map((row) => {
          const columns = Math.min(responsiveColumns, row.stateNames.length);
          const cardWidth =
            availableWidth > 0 ? (availableWidth - PREVIEW_GRID_GAP * Math.max(0, columns - 1)) / columns : initialSize[0] + 36;
          const stateCards = row.stateNames.map((stateName) => {
            const stateOverrides = { ...row.contextStates, [row.nodeId]: stateName };
            const sourceForState = walkNodes(previewRoot).some(({ node }) => node.id === row.nodeId)
              ? applyStateRootPreviewOverrides(previewRoot, stateOverrides)
              : previewRoot;
            const size = sourceForState.artifactType === "Canvas" ? initialSize : artifactInitialSize(sourceForState);
            const scale = sourceForState.artifactType === "Canvas" ? Math.min(1, Math.max(0.1, (cardWidth - 36) / size[0])) : 1;
            return { stateName, size, scale };
          });
          return (
            <section className={webClasses("state-preview-group")} data-state-root-id={row.nodeId} key={row.nodeId}>
              <header className={webClasses("state-preview-group-header")}>
                <strong title={row.nodeLabel}>{row.nodeName}</strong>
                <span>{row.stateNames.length} 个状态</span>
                {row.contextLabel ? <em title={`状态预览上下文：${row.contextLabel}`}>{row.contextLabel}</em> : null}
                {row.issues.length > 0 ? (
                  <em className={webClasses("is-warning")} title={row.issues.join("\n")}>
                    上下文问题
                  </em>
                ) : null}
              </header>
              <div className={webClasses("state-preview-grid")} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {stateCards.map(({ stateName, size, scale }) => {
                  const previewWidth = size[0] * scale;
                  const previewHeight = size[1] * scale;
                  return (
                    <article
                      className={webClasses("state-preview-card")}
                      data-ui="state-preview-card"
                      data-state-name={stateName}
                      key={stateName}
                    >
                      <header className={webClasses("state-preview-card-header")}>
                        <strong>{stateName}</strong>
                        {stateName === row.currentState ? <span>当前</span> : null}
                      </header>
                      <div
                        className={webClasses("state-preview-stage")}
                        style={{ "--state-preview-height": `${previewHeight}px` } as CSSProperties}
                      >
                        <div className={webClasses("state-preview-scale-frame")} style={{ width: previewWidth, height: previewHeight }}>
                          <div className={webClasses("state-preview-scale-content")} style={{ width: previewWidth, height: previewHeight }}>
                            <ReferencePreview
                              reference={reference}
                              referencePath={referencePath}
                              references={references}
                              artifacts={artifacts}
                              viewport={size}
                              embeddedScale={scale}
                              displayMode={displayMode}
                              subjectSessionPatches={stateRootPreviewPatches(source, {
                                ...row.contextStates,
                                [row.nodeId]: stateName,
                              })}
                            />
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
