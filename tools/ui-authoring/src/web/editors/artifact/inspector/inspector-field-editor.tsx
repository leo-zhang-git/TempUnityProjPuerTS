import {
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartHorizontal,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
} from "lucide-react";
import type { ReactNode } from "react";
import type { CrosshairEdge, CrosshairPunch } from "../../../../components/crosshair.js";
import type { CustomInspectorControl, InspectorFieldDefinition } from "../../../../registry/component-registry.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import type { DocumentCatalog } from "../../../shared/api/client.js";
import { SelectControl } from "../../../shared/select-control.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-inspector.module.css";
import { ColorField } from "./color-field.js";
import { CrosshairEdgesField, CrosshairPunchField, TemplateMapField } from "./component-custom-inspector-fields.js";
import { AnimationClipListField, AssetField } from "./inspector-asset-fields.js";
import { InspectorFieldFrame, MixedCheckbox, NumberInput, TupleField } from "./inspector-field-primitives.js";
import { ArtifactReferenceField, NodeReferenceField, NodeReferenceListField } from "./inspector-reference-fields.js";
import type {
  AssetPickerRequest,
  ComponentValue,
  FieldCommit,
  InspectorContinuousEdit,
  InspectorOverrideState,
  InspectorUpdateMode,
} from "./inspector-types.js";
import { StateElementsField, StateMapField } from "./state-root-inspector-fields.js";

const webClasses = createWebClasses(sharedStyles, artifactStyles);
const textAlignments = ["topLeft", "top", "topRight", "left", "center", "right", "bottomLeft", "bottom", "bottomRight"] as const;
type TextAlignment = (typeof textAlignments)[number];
type HorizontalTextAlignment = "left" | "center" | "right";
type VerticalTextAlignment = "top" | "middle" | "bottom";

const horizontalTextAlignments = [
  { value: "left", label: "左对齐", Icon: TextAlignStart },
  { value: "center", label: "水平居中", Icon: TextAlignCenter },
  { value: "right", label: "右对齐", Icon: TextAlignEnd },
] as const;
const verticalTextAlignments = [
  { value: "top", label: "顶部对齐", Icon: AlignStartHorizontal },
  { value: "middle", label: "垂直居中", Icon: AlignCenterHorizontal },
  { value: "bottom", label: "底部对齐", Icon: AlignEndHorizontal },
] as const;
const textAlignmentByAxes = {
  "top:left": "topLeft",
  "top:center": "top",
  "top:right": "topRight",
  "middle:left": "left",
  "middle:center": "center",
  "middle:right": "right",
  "bottom:left": "bottomLeft",
  "bottom:center": "bottom",
  "bottom:right": "bottomRight",
} as const satisfies Record<`${VerticalTextAlignment}:${HorizontalTextAlignment}`, TextAlignment>;

function textAlignmentAxes(value: unknown): { readonly horizontal: HorizontalTextAlignment; readonly vertical: VerticalTextAlignment } {
  const alignment = textAlignments.includes(value as TextAlignment) ? (value as TextAlignment) : "topLeft";
  return {
    horizontal:
      alignment.endsWith("Right") || alignment === "right"
        ? "right"
        : alignment.endsWith("Left") || alignment === "left"
          ? "left"
          : "center",
    vertical: alignment.startsWith("bottom") ? "bottom" : alignment.startsWith("top") ? "top" : "middle",
  };
}

export interface FieldEditorProps {
  readonly definition: InspectorFieldDefinition;
  readonly component: ComponentValue;
  readonly source: UiConcreteSource;
  readonly catalog: DocumentCatalog;
  readonly onChange: FieldCommit;
  readonly onComponentChange: (value: ComponentValue, mode?: InspectorUpdateMode) => boolean | void;
  readonly onIndexedSelectionChange?: FieldCommit | undefined;
  readonly indexedSelectionState?: InspectorOverrideState | undefined;
  readonly onResetIndexedSelection?: (() => void) | undefined;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly openAssetPicker: (request: AssetPickerRequest) => void;
  readonly onSelectNode?: ((nodeId: string) => void) | undefined;
  readonly onHoverNode?: ((nodeId: string | undefined) => void) | undefined;
  readonly onNotice?: ((notice: string) => void) | undefined;
  readonly onBlocked?: ((message: string) => void) | undefined;
  readonly onChangeIndex?: ((index: number, value: number, mode?: InspectorUpdateMode) => boolean | void) | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
  readonly mixed?: boolean | undefined;
  readonly stagedReferences?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly indexedSelectionDisabled?: boolean | undefined;
  readonly stateRootStructureEditable?: boolean | undefined;
  readonly stateRootSelectionMode?: "current" | "preview" | undefined;
  readonly stateRootSelectedState?: string | undefined;
  readonly onStateRootCurrentStateChange?: ((value: string) => boolean | void) | undefined;
  readonly onStateRootSelect?: ((value: string) => boolean | void) | undefined;
}

type CustomInspectorFieldRenderer = (props: FieldEditorProps, raw: unknown) => ReactNode;

export const customInspectorFieldRenderers = {
  stateName: ({ component, onChange }, raw) => {
    const states = component.states as Record<string, Record<string, boolean>> | undefined;
    const names = Object.keys(states ?? {});
    return (
      <SelectControl
        value={String(raw ?? "")}
        options={names.length > 0 ? names.map((name) => ({ value: name, label: name })) : [{ value: "", label: "无状态" }]}
        onValueChange={onChange}
      />
    );
  },
  stateMap: ({
    source,
    component,
    stateRootStructureEditable = true,
    stateRootSelectionMode = "current",
    stateRootSelectedState,
    onComponentChange,
    onStateRootCurrentStateChange,
    onStateRootSelect,
    openAssetPicker,
    onNotice,
    onBlocked,
  }) => (
    <StateMapField
      source={source}
      component={component}
      structureEditable={stateRootStructureEditable}
      selectionMode={stateRootSelectionMode}
      selectedState={stateRootSelectedState}
      onChange={onComponentChange}
      onCurrentStateChange={onStateRootCurrentStateChange}
      onStateSelect={onStateRootSelect}
      openAssetPicker={openAssetPicker}
      onNotice={onNotice}
      onBlocked={onBlocked}
    />
  ),
  stateElements: ({ source, component, stateRootStructureEditable = true, onComponentChange, openAssetPicker, onNotice, onBlocked }) => (
    <StateElementsField
      source={source}
      component={component}
      structureEditable={stateRootStructureEditable}
      openAssetPicker={openAssetPicker}
      onChange={onComponentChange}
      onNotice={onNotice}
      onBlocked={onBlocked}
    />
  ),
  templateMap: ({ source, onChange }, raw) => (
    <TemplateMapField source={source} value={(raw ?? {}) as Record<string, string>} onChange={onChange} />
  ),
  crosshairEdges: ({ source, onChange, onSelectNode, onHoverNode }, raw) => (
    <CrosshairEdgesField
      source={source}
      value={Array.isArray(raw) ? (raw as CrosshairEdge[]) : []}
      onChange={onChange}
      onSelectNode={onSelectNode}
      onHoverNode={onHoverNode}
    />
  ),
  crosshairPunch: ({ onChange, continuousEdit }, raw) => (
    <CrosshairPunchField value={raw as CrosshairPunch | undefined} onChange={onChange} continuousEdit={continuousEdit} />
  ),
} satisfies Record<CustomInspectorControl, CustomInspectorFieldRenderer>;

function isCustomInspectorControl(control: InspectorFieldDefinition["control"]): control is CustomInspectorControl {
  return control in customInspectorFieldRenderers;
}

export function FieldEditor(props: FieldEditorProps) {
  const {
    definition,
    component,
    source,
    catalog,
    onChange,
    onIndexedSelectionChange,
    indexedSelectionState,
    onResetIndexedSelection,
    onOpenArtifact,
    openAssetPicker,
    onSelectNode,
    onHoverNode,
    onChangeIndex,
    continuousEdit,
    mixed = false,
    stagedReferences = true,
    disabled = false,
    indexedSelectionDisabled = false,
  } = props;
  const raw = component[definition.property];
  const value = raw ?? definition.defaultValue;
  if (definition.control === "multiline")
    return (
      <textarea
        value={mixed ? "" : String(value ?? "")}
        placeholder={mixed ? "混合" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  if (definition.control === "text")
    return (
      <input
        value={mixed ? "" : String(value ?? "")}
        placeholder={mixed ? "混合" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  if (definition.control === "number")
    return (
      <NumberInput
        value={Number(value ?? 0)}
        mixed={mixed}
        minimum={definition.minimum}
        maximum={definition.maximum}
        step={definition.step}
        continuousEdit={continuousEdit}
        onChange={(next, mode) => onChange(next, mode)}
      />
    );
  if (definition.control === "optionalNumber") {
    const enabled = typeof raw === "number";
    return (
      <div className={webClasses("optional-number-field")}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked ? (definition.suggestedValue ?? 0) : undefined)}
        />
        <NumberInput
          value={enabled ? Number(raw) : (definition.suggestedValue ?? 0)}
          minimum={definition.minimum}
          maximum={definition.maximum}
          step={definition.step}
          disabled={!enabled}
          continuousEdit={continuousEdit}
          onChange={(next, mode) => onChange(next, mode)}
        />
      </div>
    );
  }
  if (definition.control === "boolean")
    return (
      <label className={webClasses("check-field")}>
        <MixedCheckbox checked={Boolean(value)} mixed={mixed} onChange={onChange} />
        <span>{mixed ? "混合" : Boolean(value) ? "启用" : "关闭"}</span>
      </label>
    );
  if (definition.control === "enum")
    return (
      <SelectControl
        value={mixed ? "__mixed__" : String(value ?? "")}
        options={[...(mixed ? [{ value: "__mixed__", label: "混合", disabled: true }] : []), ...(definition.options ?? [])]}
        onValueChange={onChange}
      />
    );
  if (definition.control === "segmented")
    return (
      <div className={webClasses(`segmented-control ${mixed ? "is-mixed" : ""}`)}>
        {definition.options?.map((option) => (
          <button
            key={option.value}
            type="button"
            className={webClasses(!mixed && value === option.value ? "is-active" : "")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  if (definition.control === "color")
    return (
      <ColorField value={typeof raw === "string" ? raw : undefined} mixed={mixed} onChange={onChange} continuousEdit={continuousEdit} />
    );
  if (definition.control === "vector2" || definition.control === "vector4") {
    const count = definition.control === "vector2" ? 2 : 4;
    const fallback = Array.isArray(definition.defaultValue) ? definition.defaultValue.map(Number) : Array<number>(count).fill(0);
    const tuple = Array.isArray(raw) && raw.length === count ? raw.map(Number) : fallback;
    return (
      <TupleField
        label=""
        value={tuple}
        mixed={Array(count).fill(mixed)}
        labels={definition.labels ?? (count === 2 ? ["X", "Y"] : ["L", "R", "T", "B"])}
        minimum={definition.minimum}
        maximum={definition.maximum}
        step={definition.step}
        continuousEdit={continuousEdit}
        onChange={(next, mode) => onChange(next, mode)}
        onChangeIndex={onChangeIndex}
      />
    );
  }
  if (definition.control === "textAlignment") {
    const axes = textAlignmentAxes(value);
    return (
      <div className={webClasses(`text-alignment-control ${mixed ? "is-mixed" : ""}`)}>
        <div className={webClasses("text-alignment-axis")} role="group" aria-label="水平文本对齐">
          {horizontalTextAlignments.map(({ value: horizontal, label, Icon }) => (
            <button
              key={horizontal}
              className={webClasses(!mixed && axes.horizontal === horizontal ? "is-active" : "")}
              type="button"
              onClick={() => onChange(textAlignmentByAxes[`${axes.vertical}:${horizontal}`])}
              title={label}
              aria-label={label}
            >
              <Icon size={12} strokeWidth={1.75} />
            </button>
          ))}
        </div>
        <div className={webClasses("text-alignment-axis")} role="group" aria-label="垂直文本对齐">
          {verticalTextAlignments.map(({ value: vertical, label, Icon }) => (
            <button
              key={vertical}
              className={webClasses(!mixed && axes.vertical === vertical ? "is-active" : "")}
              type="button"
              onClick={() => onChange(textAlignmentByAxes[`${vertical}:${axes.horizontal}`])}
              title={label}
              aria-label={label}
            >
              <Icon size={12} strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (definition.control === "nodeReference")
    return (
      <NodeReferenceField
        source={source}
        value={String(raw ?? "")}
        filter={definition.referenceFilter}
        onChange={(next) => onChange(definition.nullable && !next ? null : next)}
        onSelect={onSelectNode}
        onHover={onHoverNode}
      />
    );
  if (definition.control === "nodeReferenceList") {
    const references = Array.isArray(raw) ? raw.map(String) : [];
    const indexed = definition.indexedSelection;
    const selectedIndices =
      indexed && Array.isArray(component[indexed.selectionProperty])
        ? (component[indexed.selectionProperty] as unknown[]).map(Number)
        : undefined;
    const list = (
      <NodeReferenceListField
        source={source}
        value={references}
        filter={definition.referenceFilter}
        selectedIndices={selectedIndices}
        listDisabled={disabled}
        selectionDisabled={indexedSelectionDisabled}
        onChange={onChange}
        onSelectionChange={indexed ? onIndexedSelectionChange : undefined}
        onSelect={onSelectNode}
        onHover={onHoverNode}
      />
    );
    return indexed && indexedSelectionState ? (
      <InspectorFieldFrame state={indexedSelectionState} onReset={onResetIndexedSelection}>
        {list}
      </InspectorFieldFrame>
    ) : (
      list
    );
  }
  if (definition.control === "artifactReference")
    return (
      <ArtifactReferenceField
        source={source}
        catalog={catalog}
        value={String(raw ?? "")}
        staged={stagedReferences}
        onChange={onChange}
        onOpen={onOpenArtifact}
      />
    );
  if (
    definition.control === "imageAsset" ||
    definition.control === "fontAsset" ||
    definition.control === "animationClipAsset" ||
    definition.control === "animatorControllerAsset"
  ) {
    const kind =
      definition.control === "imageAsset"
        ? "image"
        : definition.control === "fontAsset"
          ? "font"
          : definition.control === "animationClipAsset"
            ? "animationClip"
            : "animatorController";
    const selectedPath = typeof raw === "string" ? raw : undefined;
    return (
      <AssetField
        kind={kind}
        value={selectedPath}
        mixed={mixed}
        onChange={onChange}
        onOpen={() => openAssetPicker({ kind, title: definition.label, selectedPath, onChoose: onChange })}
      />
    );
  }
  if (definition.control === "animationClipList")
    return (
      <AnimationClipListField value={Array.isArray(raw) ? raw.map(String) : []} onChange={onChange} openAssetPicker={openAssetPicker} />
    );
  if (isCustomInspectorControl(definition.control)) return customInspectorFieldRenderers[definition.control](props, raw);
  return null;
}
