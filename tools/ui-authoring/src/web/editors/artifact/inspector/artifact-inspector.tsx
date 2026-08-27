import { AlertTriangle, ClipboardPaste, Copy, Plus, Search, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { walkNodes } from "../../../../kernel/tree.js";
import { validateSourceReadiness } from "../../../../kernel/validation.js";
import { componentRegistry, initialComponent, isUseSiteAddable } from "../../../../registry/component-registry.js";
import type { AuthoringAssetEntry } from "../../../../schema/asset-catalog.js";
import type { UiComponentType, UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import type { DocumentCatalog } from "../../../shared/api/client.js";
import { gameObjectDiagnosticLabel, gameObjectName } from "../../../shared/game-object-label.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import { ArtifactContextMenu, type ArtifactContextMenuItem } from "../artifact-context-menu.js";
import artifactShellStyles from "../artifact-editor-shell.module.css";
import { AssetPicker } from "../assets/asset-browser.js";
import type { RectTransformCapabilities } from "../canvas/rect-transform-authoring.js";
import artifactStyles from "./artifact-inspector.module.css";
import { componentUnavailableReason } from "./component-availability.js";
import type { UiComponentClipboard } from "./component-clipboard.js";
import { replaceComponent } from "./component-inspector-model.js";
import { ComponentSection } from "./component-section.js";
import { InspectorFieldFrame } from "./inspector-field-primitives.js";
import { useInspectorLayout } from "./inspector-layout.js";
import type {
  AssetPickerRequest,
  ComponentValue,
  InspectorArtifactMetadata,
  InspectorArtifactMetadataMutation,
  InspectorArtifactSizeMutation,
  InspectorContinuousEdit,
  InspectorMutation,
  InspectorOverrideState,
} from "./inspector-types.js";
import { layoutAdvisories } from "./layout-advisories.js";
import { ArtifactSizeSection, type RectTransformOverrideField, RectTransformSection } from "./rect-transform-sections.js";
import { scrollRectAdvisories } from "./scroll-rect-advisories.js";
import { ShapeSoftMaskInspectorFooter } from "./shape-soft-mask-inspector.js";
import { StateRootActiveControlDialog, StateRootActiveNotice, stateRootControlledActiveNodes } from "./state-root-active-control.js";

const webClasses = createWebClasses(sharedStyles, artifactShellStyles, artifactStyles);

interface InspectorProps {
  readonly source: UiConcreteSource;
  readonly node: UiNode;
  readonly stateRootPreviewSource?: UiConcreteSource | undefined;
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly onRefreshAssets: () => Promise<void>;
  readonly onUpdate: InspectorMutation;
  readonly artifactSize?: readonly [number, number] | undefined;
  readonly artifactMetadata?: InspectorArtifactMetadata | undefined;
  readonly onArtifactMetadataChange?: InspectorArtifactMetadataMutation | undefined;
  readonly onArtifactSizeChange?: InspectorArtifactSizeMutation | undefined;
  readonly artifactSizeState?: InspectorOverrideState | undefined;
  readonly onResetArtifactSize?: (() => void) | undefined;
  readonly stateOverrides: Readonly<Record<string, string>>;
  readonly onStatePreview: (nodeId: string, stateName: string) => void;
  readonly stateRootSelectionMode?: "current" | "preview" | undefined;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly rectCapabilities?: RectTransformCapabilities | undefined;
  readonly rectTransformPresentation?: "evaluated" | "authored" | undefined;
  readonly extraSections?: ReactNode;
  readonly externalSections?: ReactNode;
  readonly headerContent?: ReactNode;
  readonly onSelectNode?: ((nodeId: string) => void) | undefined;
  readonly onHoverNode?: ((nodeId: string | undefined) => void) | undefined;
  readonly onNotice?: ((notice: string) => void) | undefined;
  readonly onBlocked?: ((message: string) => void) | undefined;
  readonly variant?: boolean | undefined;
  readonly useSite?: boolean | undefined;
  readonly localVisual?: boolean | undefined;
  readonly readOnly?: boolean | undefined;
  readonly overrideState?:
    | ((componentType: "Node" | "RectTransform" | UiComponentType, fieldPath: string) => InspectorOverrideState)
    | undefined;
  readonly onResetOverride?: ((componentType: "Node" | "RectTransform" | UiComponentType, fieldPath: string) => void) | undefined;
  readonly onResetRectOverrides?: ((fieldPaths: readonly RectTransformOverrideField[]) => void) | undefined;
  readonly componentState?: ((componentType: UiComponentType) => "inherited" | "added") | undefined;
  readonly componentClipboard?: UiComponentClipboard | null | undefined;
  readonly onCopyComponent?: ((componentType: UiComponentType) => void) | undefined;
  readonly onPasteComponent?: ((componentType: UiComponentType) => void) | undefined;
  readonly onCopyNodeId?: (() => void) | undefined;
  readonly openAddComponentRequest?: number | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}

export function Inspector({
  source,
  node,
  stateRootPreviewSource,
  catalog,
  assets,
  onRefreshAssets,
  onUpdate,
  artifactSize,
  artifactMetadata,
  onArtifactMetadataChange,
  onArtifactSizeChange,
  artifactSizeState,
  onResetArtifactSize,
  stateOverrides,
  onStatePreview,
  stateRootSelectionMode = "current",
  onOpenArtifact,
  rectCapabilities,
  rectTransformPresentation = "evaluated",
  extraSections,
  externalSections,
  headerContent,
  onSelectNode,
  onHoverNode,
  onNotice,
  onBlocked,
  variant = false,
  useSite = false,
  localVisual = false,
  readOnly = false,
  overrideState,
  onResetOverride,
  onResetRectOverrides,
  componentState,
  componentClipboard,
  onCopyComponent,
  onPasteComponent,
  onCopyNodeId,
  openAddComponentRequest = 0,
  continuousEdit,
}: InspectorProps) {
  const [picker, setPicker] = useState<AssetPickerRequest | null>(null);
  const [adding, setAdding] = useState(false);
  const [componentQuery, setComponentQuery] = useState("");
  const [componentContext, setComponentContext] = useState<{
    readonly type: UiComponentType;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [pendingActive, setPendingActive] = useState<boolean | null>(null);
  const layout = useInspectorLayout(source);
  useEffect(() => {
    if (openAddComponentRequest > 0 && !variant && !readOnly) setAdding(true);
  }, [openAddComponentRequest, variant, readOnly]);
  useEffect(() => {
    setAdding(false);
    setComponentQuery("");
    setPendingActive(null);
  }, [node.id]);
  const validation = useMemo(() => validateSourceReadiness(source), [source]);
  const issues = validation.issues.filter((issue) => issue.nodeId === node.id || (!issue.nodeId && node.id === source.root.id)).slice(0, 6);
  const advisories = [...layoutAdvisories(source, node.id, layout.rects.get(node.id)), ...scrollRectAdvisories(source, node.id)];
  const componentTypes = Object.keys(componentRegistry) as UiComponentType[];
  const present = new Set(Object.keys(node.components ?? {}));
  const available = componentTypes
    .filter(
      (type) =>
        !present.has(type) &&
        ((!useSite && !localVisual) || isUseSiteAddable(type) || (localVisual && type === "Text")) &&
        `${type} ${componentRegistry[type].label}`.toLocaleLowerCase().includes(componentQuery.toLocaleLowerCase()),
    )
    .map((type) => ({ type, unavailableReason: componentUnavailableReason(type, node, source, catalog, useSite, localVisual) }));
  const stateRoot = node.components?.StateRoot;
  const activeControlSource = stateRootPreviewSource ?? source;
  const controlledActiveNodes = useMemo(() => stateRootControlledActiveNodes(activeControlSource, [node]), [activeControlSource, node]);
  const isLocalArtifactRoot = artifactSize !== undefined && onArtifactSizeChange !== undefined;
  const rectTransformCapabilities =
    isLocalArtifactRoot && rectCapabilities
      ? ({ position: [undefined, undefined], size: rectCapabilities.size } satisfies RectTransformCapabilities)
      : rectCapabilities;

  return (
    <aside className={webClasses("inspector-panel")} data-ui="inspector-panel">
      <div className={webClasses("panel-heading inspector-heading")} data-ui="panel-heading inspector-heading">
        <InspectorFieldFrame
          state={overrideState?.("Node", "active")}
          disabled={readOnly}
          onReset={onResetOverride ? () => onResetOverride("Node", "active") : undefined}
        >
          <label className={webClasses("active-toggle")} title="Active">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={node.active ?? true}
              onChange={(event) => {
                const nextActive = event.target.checked;
                if (controlledActiveNodes.length > 0) setPendingActive(nextActive);
                else onUpdate((current) => ({ ...current, active: nextActive }));
              }}
            />
            <span />
          </label>
        </InspectorFieldFrame>
        <h2 title={gameObjectDiagnosticLabel(node)}>{gameObjectName(node)}</h2>
        <button
          className={webClasses("icon-button inspector-copy-button")}
          type="button"
          onClick={onCopyNodeId}
          disabled={!onCopyNodeId}
          title="复制 Node ID"
          aria-label="复制 Node ID"
        >
          <Copy size={13} />
        </button>
      </div>
      <StateRootActiveNotice controlledNodes={controlledActiveNodes} />
      {headerContent}
      <fieldset className={webClasses("inspector-content")} data-ui="inspector-content" disabled={readOnly}>
        {issues.length > 0 ? (
          <div className={webClasses("inspector-validation")}>
            <AlertTriangle size={14} />
            <div>
              {issues.map((issue) => (
                <span key={`${issue.path}:${issue.code}`}>{issue.message}</span>
              ))}
            </div>
          </div>
        ) : null}
        {advisories.length > 0 ? (
          <div className={webClasses("inspector-advisory")} data-ui="inspector-advisory">
            <AlertTriangle size={14} />
            <div>
              {advisories.map((message) => (
                <span key={message}>{message}</span>
              ))}
            </div>
          </div>
        ) : null}
        {isLocalArtifactRoot ? (
          <ArtifactSizeSection
            size={artifactSize}
            onChange={onArtifactSizeChange}
            state={artifactSizeState}
            onReset={onResetArtifactSize}
            continuousEdit={continuousEdit}
          />
        ) : null}
        {artifactMetadata && onArtifactMetadataChange ? (
          <ArtifactMetadataSection metadata={artifactMetadata} onChange={onArtifactMetadataChange} />
        ) : null}
        <RectTransformSection
          source={source}
          node={node}
          capabilities={rectTransformCapabilities}
          evaluatedRect={!isLocalArtifactRoot && rectTransformPresentation === "evaluated" ? layout.rects.get(node.id) : undefined}
          parentRect={!isLocalArtifactRoot && rectTransformPresentation === "evaluated" ? layout.parents.get(node.id) : undefined}
          onUpdate={onUpdate}
          overrideState={(field) => overrideState?.("RectTransform", field)}
          onResetOverride={
            onResetRectOverrides ??
            (onResetOverride
              ? (fields) => {
                  for (const field of fields) onResetOverride("RectTransform", field);
                }
              : undefined)
          }
          continuousEdit={continuousEdit}
        />
        {componentTypes
          .filter((type) => node.components?.[type] !== undefined)
          .map((type) => (
            <ComponentSection
              key={type}
              type={type}
              source={source}
              node={node}
              catalog={catalog}
              assets={assets}
              rectCapabilities={rectCapabilities}
              evaluatedRect={layout.rects.get(node.id)}
              intrinsic={layout.intrinsic}
              onUpdate={onUpdate}
              onOpenArtifact={onOpenArtifact}
              openAssetPicker={setPicker}
              onSelectNode={onSelectNode}
              onHoverNode={onHoverNode}
              onNotice={onNotice}
              onBlocked={onBlocked}
              stateRootSelectionMode={stateRootSelectionMode}
              stateRootSelectedState={
                stateRoot
                  ? stateRootSelectionMode === "preview"
                    ? (stateOverrides[node.id] ?? stateRoot.currentState)
                    : stateRoot.currentState
                  : undefined
              }
              onStateRootSelect={
                stateRoot
                  ? (stateName) => {
                      onStatePreview(node.id, stateName);
                      return true;
                    }
                  : undefined
              }
              variant={variant}
              useSite={useSite}
              componentState={componentState?.(type)}
              overrideState={(componentType, field) => overrideState?.(componentType, field)}
              onResetOverride={onResetOverride ? (componentType, field) => onResetOverride(componentType, field) : undefined}
              componentClipboard={componentClipboard}
              onCopyComponent={onCopyComponent}
              onPasteComponent={onPasteComponent}
              onContextMenu={(componentType, x, y) => setComponentContext({ type: componentType, x, y })}
              continuousEdit={continuousEdit}
              issues={validation.issues.filter((issue) => issue.nodeId === node.id && issue.componentType === type)}
              footer={
                type === "ShapeSoftMask" ? (
                  <ShapeSoftMaskInspectorFooter source={source} nodeId={node.id} evaluatedRect={layout.rects.get(node.id)} />
                ) : undefined
              }
            />
          ))}
        {extraSections}
        {!variant ? (
          <section className={webClasses("inspector-section add-component-section")}>
            <button className={webClasses("add-component-button")} type="button" onClick={() => setAdding((current) => !current)}>
              <Plus size={13} />
              添加组件
            </button>
            {adding ? (
              <div className={webClasses("add-component-menu")} data-ui="add-component-menu">
                <label>
                  <Search size={12} />
                  <input
                    autoFocus
                    value={componentQuery}
                    onChange={(event) => setComponentQuery(event.target.value)}
                    placeholder="搜索组件"
                  />
                </label>
                <div>
                  {available.map(({ type, unavailableReason }) => (
                    <button
                      key={type}
                      type="button"
                      disabled={Boolean(unavailableReason)}
                      title={unavailableReason}
                      onClick={() => {
                        const value = initialComponent(
                          type,
                          node,
                          walkNodes(source).map((entry) => entry.node),
                        ) as ComponentValue;
                        if (onUpdate((current) => replaceComponent(current, type, value)) !== false) {
                          setAdding(false);
                          setComponentQuery("");
                        }
                      }}
                    >
                      {componentRegistry[type].label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </fieldset>
      {externalSections}
      {!readOnly && picker ? (
        <AssetPicker
          assets={assets}
          kind={picker.kind}
          title={picker.title}
          selectedPath={picker.selectedPath}
          onRefresh={onRefreshAssets}
          onChoose={(asset) => {
            picker.onChoose(asset.path);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
      {componentContext ? (
        <ArtifactContextMenu
          x={componentContext.x}
          y={componentContext.y}
          items={componentContextItems(
            componentContext.type,
            variant || (useSite && componentState?.(componentContext.type) !== "added"),
            componentClipboard,
            onCopyComponent,
            onPasteComponent,
            () => onUpdate((current) => replaceComponent(current, componentContext.type, undefined)),
          )}
          onClose={() => setComponentContext(null)}
        />
      ) : null}
      {pendingActive !== null ? (
        <StateRootActiveControlDialog
          source={activeControlSource}
          controlledNodes={controlledActiveNodes}
          nextActive={pendingActive}
          onClose={() => setPendingActive(null)}
          onConfirmBaseline={() => {
            const nextActive = pendingActive;
            setPendingActive(null);
            onUpdate((current) => ({ ...current, active: nextActive }));
          }}
          onSelectNode={onSelectNode}
        />
      ) : null}
    </aside>
  );
}

function ArtifactMetadataSection({
  metadata,
  onChange,
}: {
  readonly metadata: InspectorArtifactMetadata;
  readonly onChange: InspectorArtifactMetadataMutation;
}) {
  const [displayName, setDisplayName] = useState(metadata.displayName ?? "");
  const [description, setDescription] = useState(metadata.description ?? "");
  useEffect(() => setDisplayName(metadata.displayName ?? ""), [metadata.displayName]);
  useEffect(() => setDescription(metadata.description ?? ""), [metadata.description]);
  const commit = (field: "displayName" | "description", value: string, reset: (value: string) => void): void => {
    const current = metadata[field] ?? "";
    if (value.trim() === current) {
      reset(current);
      return;
    }
    if (onChange(field, value) === false) reset(current);
  };
  return (
    <section className={webClasses("inspector-section artifact-metadata-section")}>
      <h3>Artifact 信息</h3>
      <label>
        <span>中文名</span>
        <input
          value={displayName}
          placeholder="未设置"
          onChange={(event) => setDisplayName(event.target.value)}
          onBlur={() => commit("displayName", displayName, setDisplayName)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDisplayName(metadata.displayName ?? "");
          }}
        />
      </label>
      <label>
        <span>描述</span>
        <textarea
          value={description}
          placeholder="未设置"
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => commit("description", description, setDescription)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDescription(metadata.description ?? "");
          }}
        />
      </label>
    </section>
  );
}

function componentContextItems(
  type: UiComponentType,
  variant: boolean,
  clipboard: UiComponentClipboard | null | undefined,
  onCopy: ((componentType: UiComponentType) => void) | undefined,
  onPaste: ((componentType: UiComponentType) => void) | undefined,
  onRemove: () => void,
): readonly ArtifactContextMenuItem[] {
  return [
    { key: "copy-component", label: "复制 Component", icon: <Copy size={13} />, disabled: !onCopy, onSelect: () => onCopy?.(type) },
    {
      key: "paste-component",
      label: "粘贴 Component 值",
      icon: <ClipboardPaste size={13} />,
      disabled: !onPaste || clipboard?.componentType !== type,
      onSelect: () => onPaste?.(type),
    },
    {
      key: "remove-component",
      label: "移除 Component",
      icon: <Trash2 size={13} />,
      dividerBefore: true,
      danger: true,
      disabled: variant,
      onSelect: onRemove,
    },
  ];
}
