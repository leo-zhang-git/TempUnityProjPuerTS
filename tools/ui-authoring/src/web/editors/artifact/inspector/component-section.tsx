import { AlertTriangle, ChevronDown, ChevronRight, ClipboardPaste, Copy, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { AutoLayoutGridDimensions } from "../../../../components/auto-layout-group.js";
import { setUnityImageNativeSize } from "../../../../kernel/image-intrinsic.js";
import type { EvaluatedRect, LayoutIntrinsicProvider } from "../../../../kernel/layout.js";
import type { ValidationIssue } from "../../../../kernel/validation.js";
import { componentRegistry, type InspectorFieldDefinition, isInspectorFieldEntry } from "../../../../registry/component-registry.js";
import type { AuthoringAssetEntry } from "../../../../schema/asset-catalog.js";
import type { UiComponentType, UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import type { DocumentCatalog } from "../../../shared/api/client.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import type { RectTransformCapabilities } from "../canvas/rect-transform-authoring.js";
import artifactStyles from "./artifact-inspector.module.css";
import type { UiComponentClipboard } from "./component-clipboard.js";
import {
  applyAutoLayoutInspectorMutation,
  autoLayoutDimensionsFor,
  autoLayoutGridCountEditable,
  componentRecord,
  imageSpriteMetrics,
  replaceComponent,
} from "./component-inspector-model.js";
import { applyInspectorFieldMutation, resolvedInspectorField, visibleInspectorEntries } from "./inspector-entry.js";
import { FieldEditor } from "./inspector-field-editor.js";
import { inspectorValueState } from "./inspector-field-presentation.js";
import { InspectorFieldFrame, InspectorNumericLabel, MixedCheckbox } from "./inspector-field-primitives.js";
import type {
  AssetPickerRequest,
  ComponentValue,
  InspectorContinuousEdit,
  InspectorMutation,
  InspectorOverrideState,
  InspectorUpdateMode,
} from "./inspector-types.js";
import { ensureTextMinimumHeight } from "./text-size-authoring.js";

const webClasses = createWebClasses(sharedStyles, artifactStyles);

interface ComponentSectionProps {
  readonly type: UiComponentType;
  readonly source: UiConcreteSource;
  readonly node: UiNode;
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly rectCapabilities?: RectTransformCapabilities | undefined;
  readonly evaluatedRect?: EvaluatedRect | undefined;
  readonly intrinsic?: LayoutIntrinsicProvider | undefined;
  readonly onUpdate: InspectorMutation;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly openAssetPicker: (request: AssetPickerRequest) => void;
  readonly onSelectNode?: ((nodeId: string) => void) | undefined;
  readonly onHoverNode?: ((nodeId: string | undefined) => void) | undefined;
  readonly onNotice?: ((notice: string) => void) | undefined;
  readonly onBlocked?: ((message: string) => void) | undefined;
  readonly stateRootSelectionMode?: "current" | "preview" | undefined;
  readonly stateRootSelectedState?: string | undefined;
  readonly onStateRootSelect?: ((stateName: string) => boolean | void) | undefined;
  readonly variant?: boolean | undefined;
  readonly useSite?: boolean | undefined;
  readonly componentState?: "inherited" | "added" | undefined;
  readonly overrideState?: ((componentType: UiComponentType, fieldPath: string) => InspectorOverrideState | undefined) | undefined;
  readonly onResetOverride?: ((componentType: UiComponentType, fieldPath: string) => void) | undefined;
  readonly componentClipboard?: UiComponentClipboard | null | undefined;
  readonly onCopyComponent?: ((componentType: UiComponentType) => void) | undefined;
  readonly onPasteComponent?: ((componentType: UiComponentType) => void) | undefined;
  readonly onContextMenu?: ((componentType: UiComponentType, x: number, y: number) => void) | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
  readonly issues?: readonly ValidationIssue[] | undefined;
  readonly footer?: ReactNode;
}

const autoLayoutAxisGroups = [
  { label: "Control Child Size", width: "childControlWidth", height: "childControlHeight" },
  { label: "Use Child Scale", width: "childScaleWidth", height: "childScaleHeight" },
  { label: "Force Expand", width: "childForceExpandWidth", height: "childForceExpandHeight" },
] as const;
const autoLayoutAxisProperties = new Set<string>(autoLayoutAxisGroups.flatMap((group) => [group.width, group.height]));

export function ComponentSection({
  type,
  source,
  node,
  catalog,
  assets,
  rectCapabilities,
  evaluatedRect,
  intrinsic,
  onUpdate,
  onOpenArtifact,
  openAssetPicker,
  onSelectNode,
  onHoverNode,
  onNotice,
  onBlocked,
  stateRootSelectionMode = "current",
  stateRootSelectedState,
  onStateRootSelect,
  variant = false,
  useSite = false,
  componentState,
  overrideState,
  onResetOverride,
  componentClipboard,
  onCopyComponent,
  onPasteComponent,
  onContextMenu,
  continuousEdit,
  issues = [],
  footer,
}: ComponentSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const definition = componentRegistry[type];
  const component = componentRecord(node, type);
  const entries = visibleInspectorEntries(definition.inspector, component, assets);
  const gridDimensions: AutoLayoutGridDimensions | undefined =
    type === "AutoLayoutGroup" && (component.mode ?? "horizontal") === "grid"
      ? autoLayoutDimensionsFor(node, evaluatedRect, component)
      : undefined;
  const updateComponent = (next: ComponentValue, mode?: InspectorUpdateMode): boolean =>
    onUpdate((current) => {
      const updated = replaceComponent(current, type, next);
      return type === "Text" && intrinsic
        ? ensureTextMinimumHeight(updated, evaluatedRect?.width ?? Math.max(0, updated.rect.sizeDelta[0]), intrinsic, rectCapabilities)
        : updated;
    }, mode) !== false;
  const setField = (property: string, value: unknown, mode?: InspectorUpdateMode): boolean => {
    const next =
      type === "AutoLayoutGroup" && gridDimensions
        ? applyAutoLayoutInspectorMutation(definition, component, property, value, gridDimensions)
        : applyInspectorFieldMutation(definition, component, property, value);
    return updateComponent(next, mode);
  };
  const renderAutoLayoutAxisToggle = (property: string, label: string): ReactNode => {
    const field = definition.inspector.find(
      (entry): entry is InspectorFieldDefinition => isInspectorFieldEntry(entry) && entry.property === property,
    )!;
    const fieldState = overrideState?.(type, property);
    const value = Boolean(component[property] ?? field.defaultValue);
    const valueState = inspectorValueState(component[property] ?? field.defaultValue, field.defaultValue);
    const disabled =
      (variant || useSite) && componentState !== "added" && !(definition.overrideFields as readonly string[]).includes(property);
    return (
      <InspectorFieldFrame
        key={property}
        state={fieldState}
        valueState={valueState}
        disabled={disabled}
        disabledReason={disabled ? "该继承字段不在 PrefabRef 使用位置或 Variant 的覆写范围内" : undefined}
        onReset={onResetOverride ? () => onResetOverride(type, property) : undefined}
      >
        <label className={webClasses("check-field auto-layout-axis-toggle")}>
          <MixedCheckbox checked={value} mixed={false} onChange={(next) => setField(property, next)} />
          <span>{label}</span>
        </label>
      </InspectorFieldFrame>
    );
  };
  return (
    <section
      data-component-type={type}
      data-ui="component-section"
      className={webClasses(
        `inspector-section component-section ${componentState ? `is-${componentState}` : ""} ${issues.length > 0 ? "is-invalid" : ""}`,
      )}
    >
      <header
        className={webClasses(`component-heading ${issues.length > 0 ? "is-invalid" : ""}`)}
        title={issues.map((entry) => entry.message).join("\n") || undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu?.(type, event.clientX, event.clientY);
        }}
      >
        <button type="button" onClick={() => setExpanded((current) => !current)} title={expanded ? "折叠" : "展开"}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <h3>{definition.label}</h3>
        <div className={webClasses("component-heading-actions")}>
          {issues.length > 0 ? (
            <AlertTriangle className={webClasses("component-error-icon")} size={12} aria-label="组件配置不完整" />
          ) : null}
          <button type="button" disabled={!onCopyComponent} onClick={() => onCopyComponent?.(type)} title={`复制 ${definition.label} 属性`}>
            <Copy size={12} />
          </button>
          <button
            type="button"
            disabled={!onPasteComponent || componentClipboard?.componentType !== type}
            onClick={() => onPasteComponent?.(type)}
            title={`粘贴 ${definition.label} 属性`}
          >
            <ClipboardPaste size={12} />
          </button>
          <button
            type="button"
            disabled={variant || (useSite && componentState !== "added")}
            onClick={() => onUpdate((current) => replaceComponent(current, type, undefined))}
            title={
              variant
                ? "Variant 不能删除继承组件"
                : useSite && componentState !== "added"
                  ? "PrefabRef 使用位置不能删除继承 Component"
                  : `删除 ${definition.label}`
            }
          >
            <Trash2 size={12} />
          </button>
        </div>
      </header>
      {expanded ? (
        <div className={webClasses("component-body")} data-ui="component-body">
          {entries.map((entry) => {
            if (!isInspectorFieldEntry(entry)) {
              const metrics = imageSpriteMetrics(component, assets);
              const drivenBy = rectCapabilities?.size.find((driver) => driver !== undefined);
              return (
                <div className={webClasses("component-action")} data-ui="component-action" key={`action:${entry.action}`}>
                  <span />
                  <button
                    type="button"
                    disabled={!metrics || Boolean(drivenBy)}
                    title={!metrics ? "Sprite 指标不可用" : drivenBy ? `由 ${drivenBy} 控制` : entry.label}
                    onClick={() => metrics && onUpdate((current) => setUnityImageNativeSize(current, metrics))}
                  >
                    {entry.label}
                  </button>
                </div>
              );
            }
            const field = entry;
            if (type === "StateRoot" && (field.property === "currentState" || field.property === "elements")) return null;
            if (type === "AutoLayoutGroup" && autoLayoutAxisProperties.has(field.property)) {
              if (field.property !== autoLayoutAxisGroups[0].width) return null;
              return (
                <div className={webClasses("auto-layout-axis-groups")} key="auto-layout-axis-groups">
                  {autoLayoutAxisGroups.map((group) => (
                    <div className={webClasses("auto-layout-axis-group")} key={group.label}>
                      <span>{group.label}</span>
                      <div>
                        {renderAutoLayoutAxisToggle(group.width, "Width")}
                        {renderAutoLayoutAxisToggle(group.height, "Height")}
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            const wide =
              field.control === "multiline" ||
              field.control === "nodeReferenceList" ||
              field.control === "stateMap" ||
              field.control === "stateElements" ||
              field.control === "templateMap" ||
              field.control === "crosshairEdges" ||
              field.control === "crosshairPunch";
            const autoLayoutGridCountField =
              type === "AutoLayoutGroup" && (field.property === "rowCount" || field.property === "columnCount");
            const computedGridCount =
              autoLayoutGridCountField && !autoLayoutGridCountEditable(component, field.property) && gridDimensions
                ? field.property === "rowCount"
                  ? gridDimensions.rows
                  : gridDimensions.columns
                : undefined;
            const displayComponent = computedGridCount === undefined ? component : { ...component, [field.property]: computedGridCount };
            const stateRootComposite = type === "StateRoot" && field.control === "stateMap";
            const stateRootStructuralField = type === "StateRoot" && (field.control === "stateMap" || field.control === "stateElements");
            const stateRootStructureEditable = !stateRootStructuralField || !((variant || useSite) && componentState !== "added");
            const overrideProperty = stateRootComposite ? "currentState" : field.property;
            const fieldState = overrideState?.(type, overrideProperty);
            const valueState = inspectorValueState(displayComponent[field.property] ?? field.defaultValue, field.defaultValue);
            const inheritedFieldDisabled =
              !stateRootStructuralField &&
              (variant || useSite) &&
              componentState !== "added" &&
              !(definition.overrideFields as readonly string[]).includes(field.property);
            const projectFieldDisabled = field.projectDisabledReason !== undefined;
            const fieldDisabled = inheritedFieldDisabled || computedGridCount !== undefined || projectFieldDisabled;
            const indexedSelectionDisabled = field.indexedSelection
              ? (variant || useSite) &&
                componentState !== "added" &&
                !(definition.overrideFields as readonly string[]).includes(field.indexedSelection.selectionProperty)
              : false;
            const indexedSelectionState = field.indexedSelection
              ? overrideState?.(type, field.indexedSelection.selectionProperty)
              : undefined;
            const fieldIssues = issues.filter((entry) => entry.fieldPath === field.property);
            const numericValue =
              field.control === "number"
                ? Number(displayComponent[field.property] ?? field.defaultValue ?? 0)
                : field.control === "optionalNumber" && typeof displayComponent[field.property] === "number"
                  ? Number(displayComponent[field.property])
                  : undefined;
            return (
              <div
                className={webClasses(
                  `component-field ${wide ? "is-wide" : ""} ${stateRootComposite ? "is-state-root-editor" : ""} ${field.control === "boolean" ? "is-boolean" : ""} ${fieldState ? `is-${fieldState}` : ""} ${valueState ? `is-value-${valueState}` : ""} ${fieldIssues.length > 0 ? "is-invalid" : ""}`,
                )}
                data-ui="component-field"
                data-field-property={field.property}
                title={fieldIssues.map((entry) => entry.message).join("\n") || undefined}
                key={field.property}
              >
                <InspectorNumericLabel
                  value={numericValue ?? 0}
                  kind={field.numericKind}
                  minimum={field.minimum}
                  maximum={field.maximum}
                  disabled={fieldDisabled || numericValue === undefined}
                  continuousEdit={continuousEdit}
                  onPreview={(value) => setField(field.property, value, "transient")}
                >
                  {field.label}
                </InspectorNumericLabel>
                <InspectorFieldFrame
                  state={fieldState}
                  valueState={valueState}
                  disabled={field.indexedSelection ? fieldDisabled && indexedSelectionDisabled : fieldDisabled}
                  disabledReason={
                    field.projectDisabledReason ??
                    (computedGridCount !== undefined
                      ? "Auto 根据当前布局计算"
                      : inheritedFieldDisabled
                        ? "该继承字段不在 PrefabRef 使用位置或 Variant 的覆写范围内"
                        : undefined)
                  }
                  onReset={onResetOverride ? () => onResetOverride(type, overrideProperty) : undefined}
                >
                  <FieldEditor
                    definition={resolvedInspectorField(field, displayComponent, definition.inspector)}
                    component={displayComponent}
                    source={source}
                    catalog={catalog}
                    onChange={(value, mode) => setField(field.property, value, mode)}
                    onComponentChange={updateComponent}
                    onIndexedSelectionChange={
                      field.indexedSelection ? (value, mode) => setField(field.indexedSelection!.selectionProperty, value, mode) : undefined
                    }
                    indexedSelectionState={indexedSelectionState}
                    onResetIndexedSelection={
                      field.indexedSelection && onResetOverride
                        ? () => onResetOverride(type, field.indexedSelection!.selectionProperty)
                        : undefined
                    }
                    onOpenArtifact={onOpenArtifact}
                    openAssetPicker={openAssetPicker}
                    onSelectNode={onSelectNode}
                    onHoverNode={onHoverNode}
                    onNotice={onNotice}
                    onBlocked={onBlocked}
                    continuousEdit={continuousEdit}
                    disabled={fieldDisabled}
                    indexedSelectionDisabled={indexedSelectionDisabled}
                    stateRootStructureEditable={stateRootStructureEditable}
                    stateRootSelectionMode={stateRootSelectionMode}
                    stateRootSelectedState={stateRootSelectedState}
                    onStateRootCurrentStateChange={stateRootComposite ? (value) => setField("currentState", value) : undefined}
                    onStateRootSelect={stateRootComposite ? onStateRootSelect : undefined}
                  />
                </InspectorFieldFrame>
              </div>
            );
          })}
          {footer}
        </div>
      ) : null}
    </section>
  );
}
