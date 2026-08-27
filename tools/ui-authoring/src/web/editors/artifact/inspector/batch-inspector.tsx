import { ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { setUnityImageNativeSize } from "../../../../kernel/image-intrinsic.js";
import { walkNodes } from "../../../../kernel/tree.js";
import {
  type ComponentDefinition,
  componentInspectorFields,
  componentRegistry,
  type InspectorEntryDefinition,
  type InspectorFieldDefinition,
  initialComponent,
  inspectorFieldDefaultValue,
  inspectorFieldValue,
  isInspectorFieldEntry,
  isUseSiteAddable,
} from "../../../../registry/component-registry.js";
import type { AuthoringAssetEntry } from "../../../../schema/asset-catalog.js";
import type { UiComponentType, UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import type { DocumentCatalog } from "../../../shared/api/client.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactShellStyles from "../artifact-editor-shell.module.css";
import { AssetPicker } from "../assets/asset-browser.js";
import type { RectTransformCapabilities } from "../canvas/rect-transform-authoring.js";
import artifactStyles from "./artifact-inspector.module.css";
import { componentUnavailableReason } from "./component-availability.js";
import {
  applyAutoLayoutInspectorMutation,
  autoLayoutDimensionsFor,
  autoLayoutGridCountEditable,
  componentRecord,
  imageSpriteMetrics,
  replaceComponent,
} from "./component-inspector-model.js";
import { applyInspectorFieldMutation, batchVisibleInspectorEntries, resolvedInspectorField } from "./inspector-entry.js";
import { FieldEditor } from "./inspector-field-editor.js";
import { InspectorFieldFrame, InspectorNumericLabel, MixedCheckbox } from "./inspector-field-primitives.js";
import { type InspectorLayoutPresentation, useInspectorLayout } from "./inspector-layout.js";
import type {
  AssetPickerRequest,
  ComponentValue,
  InspectorContinuousEdit,
  InspectorMutation,
  InspectorUpdateMode,
} from "./inspector-types.js";
import { BatchRectTransformSection } from "./rect-transform-sections.js";
import { StateRootActiveControlDialog, StateRootActiveNotice, stateRootControlledActiveNodes } from "./state-root-active-control.js";

const webClasses = createWebClasses(sharedStyles, artifactShellStyles, artifactStyles);

const batchFieldControls = new Set<InspectorFieldDefinition["control"]>([
  "multiline",
  "text",
  "number",
  "optionalNumber",
  "boolean",
  "enum",
  "segmented",
  "color",
  "vector2",
  "vector4",
  "textAlignment",
  "imageAsset",
  "fontAsset",
  "animatorControllerAsset",
]);

function sameInspectorValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function BatchComponentSection({
  type,
  source,
  nodes,
  catalog,
  assets,
  capabilities,
  layout,
  onUpdate,
  onOpenArtifact,
  openAssetPicker,
  useSite,
  continuousEdit,
}: {
  readonly type: UiComponentType;
  readonly source: UiConcreteSource;
  readonly nodes: readonly UiNode[];
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly capabilities: ReadonlyMap<string, RectTransformCapabilities>;
  readonly layout: InspectorLayoutPresentation;
  readonly onUpdate: InspectorMutation;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly openAssetPicker: (request: AssetPickerRequest) => void;
  readonly useSite: boolean;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  const definition = componentRegistry[type];
  const overrideFields = definition.overrideFields as readonly string[];
  const fields = componentInspectorFields(type).filter(
    (field) => batchFieldControls.has(field.control) && (!useSite || overrideFields.includes(field.property)),
  );
  const primary = componentRecord(nodes[0]!, type);
  const inspectorEntries = definition.inspector as readonly InspectorEntryDefinition[];
  const entries = batchVisibleInspectorEntries(
    inspectorEntries,
    nodes.map((node) => componentRecord(node, type)),
    assets,
  ).filter(
    (entry) =>
      !isInspectorFieldEntry(entry) || (batchFieldControls.has(entry.control) && (!useSite || overrideFields.includes(entry.property))),
  );
  const updateField = (property: string, value: unknown, mode?: InspectorUpdateMode): void => {
    onUpdate((node) => {
      const component = componentRecord(node, type);
      const next =
        type === "AutoLayoutGroup"
          ? applyAutoLayoutInspectorMutation(
              definition,
              component,
              property,
              value,
              autoLayoutDimensionsFor(node, layout.rects.get(node.id), component),
            )
          : applyInspectorFieldMutation(definition, component, property, value);
      return replaceComponent(node, type, next);
    }, mode);
  };
  const updateFieldIndex = (property: string, index: number, value: number, mode?: InspectorUpdateMode): void => {
    onUpdate((node) => {
      const component = { ...componentRecord(node, type) };
      const field = fields.find((candidate) => candidate.property === property);
      const count = field?.control === "vector4" ? 4 : 2;
      const fallback = Array.isArray(field?.defaultValue) ? field.defaultValue.map(Number) : Array<number>(count).fill(0);
      const current =
        Array.isArray(component[property]) && (component[property] as unknown[]).length === count
          ? (component[property] as unknown[]).map(Number)
          : fallback;
      component[property] = current.map((entry, currentIndex) => (currentIndex === index ? value : entry));
      return replaceComponent(node, type, component);
    }, mode);
  };
  return (
    <section
      className={webClasses("inspector-section component-section batch-component-section")}
      data-ui="component-section"
      data-component-type={type}
    >
      <header className={webClasses("component-heading")}>
        <button type="button" onClick={() => setExpanded((current) => !current)} title={expanded ? "折叠" : "展开"}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <h3>{definition.label}</h3>
        <span />
      </header>
      {expanded ? (
        <div className={webClasses("component-body")} data-ui="component-body">
          {entries.map((entry) => {
            if (!isInspectorFieldEntry(entry)) {
              const disabledReason = nodes
                .map((node) => capabilities.get(node.id)?.size.find((driver) => driver !== undefined))
                .find((driver) => driver !== undefined);
              const hasMetrics = nodes.every((node) => Boolean(imageSpriteMetrics(componentRecord(node, type), assets)));
              return (
                <div className={webClasses("component-action")} data-ui="component-action" key={`action:${entry.action}`}>
                  <span />
                  <button
                    type="button"
                    disabled={!hasMetrics || Boolean(disabledReason)}
                    title={!hasMetrics ? "Sprite 指标不可用" : disabledReason ? `由 ${disabledReason} 控制` : entry.label}
                    onClick={() =>
                      onUpdate((node) => {
                        const metrics = imageSpriteMetrics(componentRecord(node, type), assets);
                        return metrics ? setUnityImageNativeSize(node, metrics) : node;
                      })
                    }
                  >
                    {entry.label}
                  </button>
                </div>
              );
            }
            const field = entry;
            const components = nodes.map((node) => componentRecord(node, type));
            const autoGridCountField = type === "AutoLayoutGroup" && (field.property === "rowCount" || field.property === "columnCount");
            const autoGridCountDisabled =
              autoGridCountField && components.some((component) => !autoLayoutGridCountEditable(component, field.property));
            const values = components.map((component, index) => {
              if (autoGridCountField && !autoLayoutGridCountEditable(component, field.property)) {
                const dimensions = autoLayoutDimensionsFor(nodes[index]!, layout.rects.get(nodes[index]!.id), component);
                return field.property === "rowCount" ? dimensions.rows : dimensions.columns;
              }
              return component[field.property] ?? inspectorFieldDefaultValue(field, component, inspectorEntries);
            });
            const mixed = values.some((value) => !sameInspectorValue(value, values[0]));
            const displayPrimary = autoGridCountField ? { ...primary, [field.property]: values[0] } : primary;
            const dependentValues = field.optionsBy
              ? components.map((component) => inspectorFieldValue(field.optionsBy!.property, component, inspectorEntries))
              : [];
            const dependentOptionsMixed = dependentValues.some((value) => !sameInspectorValue(value, dependentValues[0]));
            const dependentOptionsReason =
              dependentOptionsMixed && field.optionsBy ? `选中的 ${field.optionsBy.property} 不一致` : undefined;
            const projectFieldDisabled = field.projectDisabledReason !== undefined;
            const wide = field.control === "multiline";
            const numericValue =
              field.control === "number"
                ? Number(displayPrimary[field.property] ?? field.defaultValue ?? 0)
                : field.control === "optionalNumber" &&
                    nodes.every((node) => typeof componentRecord(node, type)[field.property] === "number")
                  ? Number(primary[field.property])
                  : undefined;
            return (
              <div
                className={webClasses(
                  `component-field ${wide ? "is-wide" : ""} ${field.control === "boolean" ? "is-boolean" : ""} ${mixed ? "is-mixed" : ""}`,
                )}
                data-ui="component-field"
                data-field-property={field.property}
                key={field.property}
              >
                <InspectorNumericLabel
                  value={numericValue ?? 0}
                  kind={field.numericKind}
                  minimum={field.minimum}
                  maximum={field.maximum}
                  disabled={projectFieldDisabled || numericValue === undefined}
                  continuousEdit={continuousEdit}
                  onPreview={(value) => updateField(field.property, value, "transient")}
                >
                  {field.label}
                </InspectorNumericLabel>
                <InspectorFieldFrame
                  disabled={projectFieldDisabled || dependentOptionsMixed || autoGridCountDisabled}
                  disabledReason={
                    field.projectDisabledReason ?? (autoGridCountDisabled ? "Auto 根据各对象当前布局计算" : dependentOptionsReason)
                  }
                >
                  <FieldEditor
                    definition={resolvedInspectorField(field, displayPrimary, inspectorEntries)}
                    component={displayPrimary}
                    source={source}
                    catalog={catalog}
                    mixed={mixed}
                    onChange={(value, mode) => updateField(field.property, value, mode)}
                    onChangeIndex={(index, value, mode) => updateFieldIndex(field.property, index, value, mode)}
                    continuousEdit={continuousEdit}
                    onComponentChange={() => {}}
                    onOpenArtifact={onOpenArtifact}
                    openAssetPicker={openAssetPicker}
                    disabled={projectFieldDisabled || autoGridCountDisabled}
                  />
                </InspectorFieldFrame>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function BatchInspector({
  source,
  nodes,
  catalog,
  assets,
  onRefreshAssets,
  capabilities,
  onUpdate,
  onOpenArtifact,
  onSelectNode,
  canAddComponents = true,
  useSite = false,
  openAddComponentRequest = 0,
  continuousEdit,
}: {
  readonly source: UiConcreteSource;
  readonly nodes: readonly UiNode[];
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly onRefreshAssets: () => Promise<void>;
  readonly capabilities: ReadonlyMap<string, RectTransformCapabilities>;
  readonly onUpdate: InspectorMutation;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onSelectNode?: ((nodeId: string) => void) | undefined;
  readonly canAddComponents?: boolean | undefined;
  readonly useSite?: boolean | undefined;
  readonly openAddComponentRequest?: number | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  const [picker, setPicker] = useState<AssetPickerRequest | null>(null);
  const [adding, setAdding] = useState(false);
  const [componentQuery, setComponentQuery] = useState("");
  const [pendingActive, setPendingActive] = useState<boolean | null>(null);
  const layout = useInspectorLayout(source);
  const first = nodes[0]!;
  const active = first.active ?? true;
  const activeMixed = nodes.some((node) => (node.active ?? true) !== active);
  const componentTypes = (Object.keys(componentRegistry) as UiComponentType[]).filter(
    (type) =>
      (componentRegistry[type] as ComponentDefinition).multiEdit !== false && nodes.every((node) => node.components?.[type] !== undefined),
  );
  const allNodes = walkNodes(source).map((entry) => entry.node);
  const available = (Object.keys(componentRegistry) as UiComponentType[]).flatMap((type) => {
    if (useSite && !isUseSiteAddable(type)) return [];
    const missing = nodes.filter((node) => node.components?.[type] === undefined);
    if (
      missing.length === 0 ||
      !`${type} ${componentRegistry[type].label}`.toLocaleLowerCase().includes(componentQuery.toLocaleLowerCase())
    )
      return [];
    const unavailableReason = missing.map((node) => componentUnavailableReason(type, node, source, catalog, useSite)).find(Boolean);
    return [{ type, unavailableReason }];
  });
  const selectionKey = nodes.map((node) => node.id).join("|");
  const controlledActiveNodes = stateRootControlledActiveNodes(source, nodes);
  useEffect(() => {
    if (canAddComponents && openAddComponentRequest > 0) setAdding(true);
  }, [canAddComponents, openAddComponentRequest]);
  useEffect(() => {
    setAdding(false);
    setComponentQuery("");
    setPendingActive(null);
  }, [selectionKey]);
  return (
    <aside className={webClasses("inspector-panel batch-inspector")} data-ui="inspector-panel batch-inspector">
      <div className={webClasses("panel-heading inspector-heading")} data-ui="panel-heading inspector-heading">
        <label className={webClasses("active-toggle")} title="Active">
          <MixedCheckbox
            checked={active}
            mixed={activeMixed}
            onChange={(checked) => {
              if (controlledActiveNodes.length > 0) setPendingActive(checked);
              else onUpdate((node) => ({ ...node, active: checked }));
            }}
          />
          <span />
        </label>
        <h2>{nodes.length} 个对象</h2>
        <small>{useSite ? "引用 · 可覆写" : "多选"}</small>
      </div>
      <StateRootActiveNotice controlledNodes={controlledActiveNodes} />
      <fieldset className={webClasses("inspector-content")} data-ui="inspector-content">
        <BatchRectTransformSection
          nodes={nodes}
          capabilities={capabilities}
          layout={layout}
          onUpdate={onUpdate}
          continuousEdit={continuousEdit}
        />
        {componentTypes.map((type) => (
          <BatchComponentSection
            key={type}
            type={type}
            source={source}
            nodes={nodes}
            catalog={catalog}
            assets={assets}
            capabilities={capabilities}
            layout={layout}
            onUpdate={onUpdate}
            onOpenArtifact={onOpenArtifact}
            openAssetPicker={setPicker}
            useSite={useSite}
            continuousEdit={continuousEdit}
          />
        ))}
        {canAddComponents ? (
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
                        if (
                          onUpdate((node) =>
                            node.components?.[type] !== undefined
                              ? node
                              : replaceComponent(node, type, initialComponent(type, node, allNodes) as ComponentValue),
                          ) !== false
                        ) {
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
      {picker ? (
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
      {pendingActive !== null ? (
        <StateRootActiveControlDialog
          source={source}
          controlledNodes={controlledActiveNodes}
          nextActive={pendingActive}
          onClose={() => setPendingActive(null)}
          onConfirmBaseline={() => {
            const nextActive = pendingActive;
            setPendingActive(null);
            onUpdate((node) => ({ ...node, active: nextActive }));
          }}
          onSelectNode={onSelectNode}
        />
      ) : null}
    </aside>
  );
}
