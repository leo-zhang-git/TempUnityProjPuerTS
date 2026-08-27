import { ChevronDown, ChevronRight } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { EvaluatedRect } from "../../../../kernel/layout.js";
import { walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactShellStyles from "../artifact-editor-shell.module.css";
import type { RectTransformCapabilities } from "../canvas/rect-transform-authoring.js";
import artifactStyles from "./artifact-inspector.module.css";
import { inspectorValueState } from "./inspector-field-presentation.js";
import { InspectorFieldFrame, InspectorNumericLabel, NumberInput, TupleField } from "./inspector-field-primitives.js";
import type { InspectorLayoutPresentation } from "./inspector-layout.js";
import type {
  InspectorArtifactSizeMutation,
  InspectorContinuousEdit,
  InspectorMutation,
  InspectorOverrideState,
  InspectorUpdateMode,
} from "./inspector-types.js";
import {
  type AnchorPreset,
  type AnchorPresetModifiers,
  anchorPresetPreview,
  anchorPresets,
  applyAnchorPreset,
  findAnchorPreset,
  type RectTransformDisplayField,
  rectTransformDisplayFields,
  rectTransformDisplayValue,
  rectTransformFromEvaluated,
  sameRectTransformTopology,
  setRectTransformDisplayValue,
  setRectTransformPivot,
} from "./rect-transform-inspector.js";

const webClasses = createWebClasses(sharedStyles, artifactShellStyles, artifactStyles);

function AnchorPresetGlyph({
  min,
  max,
  preview,
  modifiers = { setPivot: false, setPosition: false },
  mixed = false,
}: {
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  readonly preview?: ReturnType<typeof anchorPresetPreview> | undefined;
  readonly modifiers?: AnchorPresetModifiers | undefined;
  readonly mixed?: boolean | undefined;
}) {
  const rect = preview?.rect ?? { left: 29, top: 29, width: 42, height: 42 };
  const style = {
    "--anchor-min-x": `${10 + min[0] * 80}%`,
    "--anchor-max-x": `${10 + max[0] * 80}%`,
    "--anchor-min-y": `${10 + (1 - min[1]) * 80}%`,
    "--anchor-max-y": `${10 + (1 - max[1]) * 80}%`,
    "--rect-left": `${rect.left}%`,
    "--rect-top": `${rect.top}%`,
    "--rect-width": `${rect.width}%`,
    "--rect-height": `${rect.height}%`,
    "--rect-center-x": `${rect.left + rect.width / 2}%`,
    "--rect-center-y": `${rect.top + rect.height / 2}%`,
    "--pivot-left": `${preview?.pivot[0] ?? 50}%`,
    "--pivot-top": `${preview?.pivot[1] ?? 50}%`,
  } as CSSProperties;
  const stretchX = min[0] !== max[0];
  const stretchY = min[1] !== max[1];
  return (
    <span className={webClasses(`anchor-preset-glyph ${mixed ? "is-mixed" : ""}`)} style={style} aria-hidden="true">
      <span className={webClasses("anchor-preset-parent")} />
      {stretchX ? (
        <span className={webClasses("anchor-preset-stretch is-x")} />
      ) : (
        <span className={webClasses("anchor-preset-guide is-x")} />
      )}
      {stretchY ? (
        <span className={webClasses("anchor-preset-stretch is-y")} />
      ) : (
        <span className={webClasses("anchor-preset-guide is-y")} />
      )}
      <span className={webClasses("anchor-preset-self")} />
      <span className={webClasses("anchor-preset-corner is-min-min")} />
      <span className={webClasses("anchor-preset-corner is-min-max")} />
      <span className={webClasses("anchor-preset-corner is-max-min")} />
      <span className={webClasses("anchor-preset-corner is-max-max")} />
      {modifiers.setPivot ? <span className={webClasses("anchor-preset-pivot")} data-ui="anchor-preset-pivot" /> : null}
    </span>
  );
}

function AnchorPresetSelector({
  rect,
  mixed = false,
  onSelect,
  onSessionStart,
  onSessionEnd,
}: {
  readonly rect: UiNode["rect"];
  readonly mixed?: boolean | undefined;
  readonly onSelect: (preset: AnchorPreset, modifiers: AnchorPresetModifiers) => void;
  readonly onSessionStart?: (() => void) | undefined;
  readonly onSessionEnd?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [modifiers, setModifiers] = useState<AnchorPresetModifiers>({ setPivot: false, setPosition: false });
  const root = useRef<HTMLDivElement>(null);
  const current = findAnchorPreset(rect);
  const close = useCallback((): void => {
    setOpen(false);
    onSessionEnd?.();
  }, [onSessionEnd]);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const closeOnKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        close();
      }
    };
    const updateModifiers = (event: KeyboardEvent): void => {
      if (event.key === "Alt") event.preventDefault();
      const next = { setPivot: event.getModifierState("Shift"), setPosition: event.getModifierState("Alt") };
      setModifiers((currentModifiers) =>
        currentModifiers.setPivot === next.setPivot && currentModifiers.setPosition === next.setPosition ? currentModifiers : next,
      );
    };
    const resetModifiers = (): void => setModifiers({ setPivot: false, setPosition: false });
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnKey, true);
    window.addEventListener("keydown", updateModifiers, true);
    window.addEventListener("keyup", updateModifiers, true);
    window.addEventListener("blur", resetModifiers);
    document.addEventListener("visibilitychange", resetModifiers);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnKey, true);
      window.removeEventListener("keydown", updateModifiers, true);
      window.removeEventListener("keyup", updateModifiers, true);
      window.removeEventListener("blur", resetModifiers);
      document.removeEventListener("visibilitychange", resetModifiers);
    };
  }, [close, open]);
  return (
    <div className={webClasses("anchor-preset-selector")} ref={root}>
      <button
        type="button"
        className={webClasses("anchor-preset-trigger")}
        aria-label="Anchor Presets"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={mixed ? "多个 Anchor Preset 值" : (current?.label ?? "Custom Anchors")}
        onClick={(event) => {
          if (open) {
            close();
            return;
          }
          setModifiers({ setPivot: event.shiftKey, setPosition: event.altKey });
          onSessionStart?.();
          setOpen(true);
        }}
      >
        <AnchorPresetGlyph min={rect.anchorMin} max={rect.anchorMax} mixed={mixed} />
      </button>
      {open ? (
        <div
          className={webClasses("anchor-preset-popover")}
          role="dialog"
          aria-label="Anchor Presets"
          data-set-pivot={modifiers.setPivot}
          data-set-position={modifiers.setPosition}
        >
          <div className={webClasses("anchor-preset-grid")}>
            {anchorPresets.map((preset) => (
              <button
                type="button"
                key={preset.value}
                className={webClasses(!mixed && current?.value === preset.value ? "is-active" : "")}
                aria-label={preset.label}
                title={`${preset.label}\nShift: Pivot\nAlt: Position`}
                onClick={(event) => {
                  onSelect(preset, { setPivot: event.shiftKey, setPosition: event.altKey });
                }}
                onDoubleClick={close}
              >
                <AnchorPresetGlyph
                  min={preset.min}
                  max={preset.max}
                  preview={anchorPresetPreview(preset, modifiers)}
                  modifiers={modifiers}
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function combinedOverrideState(states: readonly (InspectorOverrideState | undefined)[]): InspectorOverrideState | undefined {
  if (states.includes("conflict")) return "conflict";
  if (states.includes("overridden")) return "overridden";
  if (states.includes("added")) return "added";
  return states.every((state) => state === "inherited") ? "inherited" : undefined;
}

function rectFieldDriver(field: RectTransformDisplayField, capabilities: RectTransformCapabilities | undefined): string | undefined {
  if (!capabilities) return undefined;
  const drivers = field.sourceFields.flatMap((sourceField) => {
    const driver = capabilities[sourceField === "anchoredPosition" ? "position" : "size"][field.axis];
    return driver ? [driver] : [];
  });
  return [...new Set(drivers)].join(", ") || undefined;
}

function RectTransformNumberField({
  field,
  value,
  mixed = false,
  drivenBy,
  minimum,
  state,
  continuousEdit,
  onChange,
  onReset,
  scrubPreview,
}: {
  readonly field: RectTransformDisplayField;
  readonly value: number;
  readonly mixed?: boolean | undefined;
  readonly drivenBy?: string | undefined;
  readonly minimum?: number | undefined;
  readonly state?: InspectorOverrideState | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
  readonly onChange: (value: number, mode?: InspectorUpdateMode) => void;
  readonly onReset?: (() => void) | undefined;
  readonly scrubPreview?:
    | { readonly artifactKey: string; readonly nodeId: string; readonly nodeIds: readonly string[]; readonly evaluatedRect: EvaluatedRect }
    | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const baseline = useRef(value);
  const previewElements = useRef(new Map<HTMLElement, { readonly translate: string; readonly scale: number }>());
  const preview = field.key === "posX" || field.key === "posY" ? scrubPreview : undefined;
  const clearPreview = (): void => {
    for (const [element, previous] of previewElements.current) element.style.translate = previous.translate;
    previewElements.current.clear();
  };
  const edit =
    preview && continuousEdit
      ? {
          begin: () => {
            baseline.current = value;
            previewElements.current.clear();
            const selected = document.querySelectorAll<HTMLElement>(
              `[data-owner="${CSS.escape(preview.artifactKey)}"][data-node-id="${CSS.escape(preview.nodeId)}"]`,
            );
            const containers = new Set<HTMLElement>();
            for (const element of selected) {
              const container = element.closest<HTMLElement>("[data-canvas-root], [data-artifact-key]");
              if (!container || containers.has(container)) continue;
              containers.add(container);
              const width = Number.parseFloat(element.style.width);
              const height = Number.parseFloat(element.style.height);
              const scale =
                preview.evaluatedRect.width !== 0 && Number.isFinite(width)
                  ? width / preview.evaluatedRect.width
                  : preview.evaluatedRect.height !== 0 && Number.isFinite(height)
                    ? height / preview.evaluatedRect.height
                    : 1;
              for (const nodeId of preview.nodeIds) {
                for (const target of container.querySelectorAll<HTMLElement>(
                  `[data-owner="${CSS.escape(preview.artifactKey)}"][data-node-id="${CSS.escape(nodeId)}"], [data-selected-node-id="${CSS.escape(nodeId)}"]`,
                )) {
                  previewElements.current.set(target, { translate: target.style.translate, scale });
                }
              }
            }
            continuousEdit.begin();
          },
          commit: continuousEdit.commit,
          cancel: () => {
            clearPreview();
            const input = root.current?.querySelector<HTMLInputElement>("input");
            if (input) input.value = String(baseline.current);
            continuousEdit.cancel();
          },
        }
      : continuousEdit;
  return (
    <div ref={root} className={webClasses(`rect-transform-number ${state ? `is-${state}` : ""}`)}>
      <InspectorNumericLabel
        value={value}
        minimum={minimum}
        disabled={Boolean(drivenBy)}
        continuousEdit={edit}
        onPreview={(next) => {
          if (!preview) {
            onChange(next, "transient");
            return;
          }
          const delta = next - baseline.current;
          for (const [element, previous] of previewElements.current) {
            element.style.translate = field.key === "posX" ? `${delta * previous.scale}px 0` : `0 ${-delta * previous.scale}px`;
          }
          const input = root.current?.querySelector<HTMLInputElement>("input");
          if (input) input.value = String(next);
        }}
        onCommit={
          preview
            ? (next) => {
                clearPreview();
                onChange(next, "transient");
              }
            : undefined
        }
      >
        {field.label}
      </InspectorNumericLabel>
      <InspectorFieldFrame
        state={state}
        disabled={Boolean(drivenBy)}
        disabledReason={drivenBy ? `由 ${drivenBy} 控制` : undefined}
        onReset={onReset}
      >
        <NumberInput
          value={value}
          mixed={mixed}
          minimum={minimum}
          disabled={Boolean(drivenBy)}
          ariaLabel={field.label}
          continuousEdit={continuousEdit}
          onChange={onChange}
        />
      </InspectorFieldFrame>
    </div>
  );
}

export type RectTransformOverrideField = keyof UiNode["rect"];

export function ArtifactSizeSection({
  size,
  onChange,
  state,
  onReset,
  continuousEdit,
}: {
  readonly size: readonly [number, number];
  readonly onChange: InspectorArtifactSizeMutation;
  readonly state?: InspectorOverrideState | undefined;
  readonly onReset?: (() => void) | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className={webClasses("inspector-section component-section")} data-ui="component-section" data-component-type="Artifact">
      <header className={webClasses("component-heading")}>
        <button type="button" onClick={() => setExpanded((current) => !current)} title={expanded ? "折叠" : "展开"}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <h3>Artifact</h3>
        <span />
      </header>
      {expanded ? (
        <div className={webClasses("component-body")} data-ui="component-body">
          <InspectorFieldFrame state={state} onReset={onReset}>
            <TupleField
              label="本地初始尺寸"
              value={size}
              labels={["W", "H"]}
              minimum={1}
              continuousEdit={continuousEdit}
              onChange={(value, mode) => onChange(value as [number, number], mode)}
            />
          </InspectorFieldFrame>
        </div>
      ) : null}
    </section>
  );
}

export function RectTransformSection({
  source,
  node,
  capabilities,
  evaluatedRect,
  parentRect,
  onUpdate,
  overrideState,
  onResetOverride,
  continuousEdit,
}: {
  readonly source: UiConcreteSource;
  readonly node: UiNode;
  readonly capabilities?: RectTransformCapabilities | undefined;
  readonly evaluatedRect?: EvaluatedRect | undefined;
  readonly parentRect?: EvaluatedRect | undefined;
  readonly onUpdate: InspectorMutation;
  readonly overrideState?: ((fieldPath: string) => InspectorOverrideState | undefined) | undefined;
  readonly onResetOverride?: ((fieldPaths: readonly RectTransformOverrideField[]) => void) | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  const anchorPresetBaseline = useRef<UiNode["rect"] | undefined>(undefined);
  const updateRect = (property: keyof UiNode["rect"], value: UiNode["rect"][typeof property], mode?: InspectorUpdateMode): void => {
    onUpdate((current) => ({ ...current, rect: { ...current.rect, [property]: value } }), mode);
  };
  const displayFields = rectTransformDisplayFields(node.rect);
  const displayRect = evaluatedRect && parentRect ? rectTransformFromEvaluated(node.rect, evaluatedRect, parentRect) : node.rect;
  const parentSize: readonly [number, number] = parentRect ? [parentRect.width, parentRect.height] : [0, 0];
  const displayState = (field: RectTransformDisplayField): InspectorOverrideState | undefined =>
    combinedOverrideState(field.sourceFields.map((sourceField) => overrideState?.(sourceField)));
  return (
    <section className={webClasses("inspector-section component-section")} data-ui="component-section" data-component-type="RectTransform">
      <header className={webClasses("component-heading")}>
        <button type="button" onClick={() => setExpanded((current) => !current)} title={expanded ? "折叠" : "展开"}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <h3>Rect Transform</h3>
        <span />
      </header>
      {expanded ? (
        <div className={webClasses("component-body rect-transform-body")} data-ui="component-body">
          <div className={webClasses("rect-transform-layout-grid")}>
            <AnchorPresetSelector
              key={node.id}
              rect={node.rect}
              onSessionStart={() => {
                anchorPresetBaseline.current = node.rect;
              }}
              onSessionEnd={() => {
                anchorPresetBaseline.current = undefined;
              }}
              onSelect={(preset, modifiers) =>
                onUpdate((current) => ({
                  ...current,
                  rect: applyAnchorPreset(anchorPresetBaseline.current ?? current.rect, preset, modifiers, parentSize),
                }))
              }
            />
            {[displayFields.horizontal[0], displayFields.vertical[0], displayFields.horizontal[1], displayFields.vertical[1]].map(
              (field) => {
                const state = displayState(field);
                return (
                  <RectTransformNumberField
                    key={field.key}
                    field={field}
                    value={rectTransformDisplayValue(displayRect, field.key)}
                    drivenBy={rectFieldDriver(field, capabilities)}
                    state={state}
                    continuousEdit={continuousEdit}
                    onChange={(value, mode) =>
                      onUpdate((current) => ({ ...current, rect: setRectTransformDisplayValue(current.rect, field.key, value) }), mode)
                    }
                    onReset={onResetOverride && state === "overridden" ? () => onResetOverride(field.sourceFields) : undefined}
                    scrubPreview={
                      evaluatedRect && (field.key === "posX" || field.key === "posY")
                        ? {
                            artifactKey: source.artifactKey,
                            nodeId: node.id,
                            nodeIds: walkNodes(source)
                              .filter((entry) => entry.path.includes(node.id))
                              .map((entry) => entry.node.id),
                            evaluatedRect,
                          }
                        : undefined
                    }
                  />
                );
              },
            )}
          </div>
          {(["anchorMin", "anchorMax", "pivot"] as const).map((field) => (
            <InspectorFieldFrame
              key={field}
              state={overrideState?.(field)}
              onReset={onResetOverride ? () => onResetOverride([field]) : undefined}
            >
              <TupleField
                label={field === "anchorMin" ? "Anchors Min" : field === "anchorMax" ? "Anchors Max" : "Pivot"}
                value={node.rect[field]}
                labels={["X", "Y"]}
                continuousEdit={continuousEdit}
                onChange={(value, mode) => {
                  if (field === "pivot")
                    onUpdate((current) => ({ ...current, rect: setRectTransformPivot(current.rect, value as [number, number]) }), mode);
                  else updateRect(field, value as [number, number], mode);
                }}
              />
            </InspectorFieldFrame>
          ))}
          <div
            className={webClasses(
              `component-field is-value-${node.rect.rotation === undefined || node.rect.rotation === 0 ? "default" : "modified"}`,
            )}
            data-ui="component-field"
          >
            <InspectorNumericLabel
              value={node.rect.rotation ?? 0}
              continuousEdit={continuousEdit}
              onPreview={(value) => updateRect("rotation", value, "transient")}
            >
              Rotation Z
            </InspectorNumericLabel>
            <InspectorFieldFrame
              state={overrideState?.("rotation")}
              valueState={inspectorValueState(node.rect.rotation ?? 0, 0)}
              onReset={onResetOverride ? () => onResetOverride(["rotation"]) : undefined}
            >
              <NumberInput
                value={node.rect.rotation ?? 0}
                step={0.5}
                ariaLabel="Rotation Z"
                continuousEdit={continuousEdit}
                onChange={(value, mode) => updateRect("rotation", value, mode)}
              />
            </InspectorFieldFrame>
          </div>
          <InspectorFieldFrame
            state={overrideState?.("scale")}
            valueState={inspectorValueState(node.rect.scale ?? [1, 1], [1, 1])}
            onReset={onResetOverride ? () => onResetOverride(["scale"]) : undefined}
          >
            <TupleField
              label="Scale"
              value={node.rect.scale ?? [1, 1]}
              labels={["X", "Y"]}
              continuousEdit={continuousEdit}
              onChange={(value, mode) => updateRect("scale", value as [number, number], mode)}
            />
          </InspectorFieldFrame>
        </div>
      ) : null}
    </section>
  );
}

function mixedTuple(values: readonly (readonly number[])[]): readonly boolean[] {
  return values[0]?.map((value, index) => values.some((candidate) => candidate[index] !== value)) ?? [];
}

export function BatchRectTransformSection({
  nodes,
  capabilities,
  layout,
  onUpdate,
  continuousEdit,
}: {
  readonly nodes: readonly UiNode[];
  readonly capabilities: ReadonlyMap<string, RectTransformCapabilities>;
  readonly layout: InspectorLayoutPresentation;
  readonly onUpdate: InspectorMutation;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  const anchorPresetBaselines = useRef<ReadonlyMap<string, UiNode["rect"]> | undefined>(undefined);
  const first = nodes[0]!;
  const presetValues = nodes.map((node) => findAnchorPreset(node.rect)?.value ?? "custom");
  const presetMixed = presetValues.some((value) => value !== presetValues[0]);
  const sharedTopology = sameRectTransformTopology(nodes.map((node) => node.rect));
  const displayFields = rectTransformDisplayFields(first.rect);
  const displayRect = (node: UiNode): UiNode["rect"] => {
    const evaluated = layout.rects.get(node.id);
    const parent = layout.parents.get(node.id);
    return evaluated && parent ? rectTransformFromEvaluated(node.rect, evaluated, parent) : node.rect;
  };
  const parentSize = (node: UiNode): readonly [number, number] => {
    const parent = layout.parents.get(node.id);
    return parent ? [parent.width, parent.height] : [0, 0];
  };
  const startAnchorPresetSession = (): void => {
    anchorPresetBaselines.current = new Map(nodes.map((node) => [node.id, node.rect]));
  };
  const endAnchorPresetSession = (): void => {
    anchorPresetBaselines.current = undefined;
  };
  const applyPreset = (node: UiNode, preset: AnchorPreset, modifiers: AnchorPresetModifiers): UiNode => ({
    ...node,
    rect: applyAnchorPreset(anchorPresetBaselines.current?.get(node.id) ?? node.rect, preset, modifiers, parentSize(node)),
  });
  const selectionKey = nodes.map((node) => node.id).join("|");
  return (
    <section
      className={webClasses("inspector-section component-section batch-component-section")}
      data-ui="component-section"
      data-component-type="RectTransform"
    >
      <header className={webClasses("component-heading")}>
        <button type="button" onClick={() => setExpanded((current) => !current)} title={expanded ? "折叠" : "展开"}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <h3>Rect Transform</h3>
        <span />
      </header>
      {expanded ? (
        <div className={webClasses("component-body rect-transform-body")} data-ui="component-body">
          {sharedTopology ? (
            <div className={webClasses("rect-transform-layout-grid")}>
              <AnchorPresetSelector
                key={selectionKey}
                rect={first.rect}
                mixed={presetMixed}
                onSessionStart={startAnchorPresetSession}
                onSessionEnd={endAnchorPresetSession}
                onSelect={(preset, modifiers) => onUpdate((node) => applyPreset(node, preset, modifiers))}
              />
              {[displayFields.horizontal[0], displayFields.vertical[0], displayFields.horizontal[1], displayFields.vertical[1]].map(
                (field) => {
                  const values = nodes.map((node) => rectTransformDisplayValue(displayRect(node), field.key));
                  const drivenBy = nodes.map((node) => rectFieldDriver(field, capabilities.get(node.id))).find(Boolean);
                  return (
                    <RectTransformNumberField
                      key={field.key}
                      field={field}
                      value={values[0]!}
                      mixed={values.some((value) => value !== values[0])}
                      drivenBy={drivenBy}
                      continuousEdit={continuousEdit}
                      onChange={(value, mode) =>
                        onUpdate((node) => ({ ...node, rect: setRectTransformDisplayValue(node.rect, field.key, value) }), mode)
                      }
                    />
                  );
                },
              )}
            </div>
          ) : (
            <div className={webClasses("rect-transform-mixed-layout")}>
              <AnchorPresetSelector
                key={selectionKey}
                rect={first.rect}
                mixed
                onSessionStart={startAnchorPresetSession}
                onSessionEnd={endAnchorPresetSession}
                onSelect={(preset, modifiers) => onUpdate((node) => applyPreset(node, preset, modifiers))}
              />
              {(["anchoredPosition", "sizeDelta"] as const).map((field) => {
                const values = nodes.map((node) => displayRect(node)[field]);
                const drivenBy = [0, 1].map((index) =>
                  nodes.map((node) => capabilities.get(node.id)?.[field === "anchoredPosition" ? "position" : "size"][index]).find(Boolean),
                );
                return (
                  <TupleField
                    key={field}
                    label={field === "anchoredPosition" ? "Position" : "Size Delta"}
                    value={values[0]!}
                    mixed={mixedTuple(values)}
                    labels={["X", "Y"]}
                    drivenBy={drivenBy}
                    continuousEdit={continuousEdit}
                    onChange={() => {}}
                    onChangeIndex={(index, value, mode) =>
                      onUpdate((node) => {
                        const next = node.rect[field].map((entry, currentIndex) => (currentIndex === index ? value : entry)) as [
                          number,
                          number,
                        ];
                        return { ...node, rect: { ...node.rect, [field]: next } };
                      }, mode)
                    }
                  />
                );
              })}
            </div>
          )}
          {(["anchorMin", "anchorMax", "pivot"] as const).map((field) => {
            const values = nodes.map((node) => node.rect[field]);
            return (
              <InspectorFieldFrame key={field}>
                <TupleField
                  label={field === "anchorMin" ? "Anchors Min" : field === "anchorMax" ? "Anchors Max" : "Pivot"}
                  value={values[0]!}
                  mixed={mixedTuple(values)}
                  labels={["X", "Y"]}
                  continuousEdit={continuousEdit}
                  onChange={() => {}}
                  onChangeIndex={(index, value, mode) =>
                    onUpdate((node) => {
                      const next = node.rect[field].map((entry, currentIndex) => (currentIndex === index ? value : entry)) as [
                        number,
                        number,
                      ];
                      return {
                        ...node,
                        rect: field === "pivot" ? setRectTransformPivot(node.rect, next) : { ...node.rect, [field]: next },
                      };
                    }, mode)
                  }
                />
              </InspectorFieldFrame>
            );
          })}
          <div className={webClasses("component-field")} data-ui="component-field">
            <InspectorNumericLabel
              value={first.rect.rotation ?? 0}
              continuousEdit={continuousEdit}
              onPreview={(value) => {
                onUpdate((node) => ({ ...node, rect: { ...node.rect, rotation: value } }), "transient");
              }}
            >
              Rotation Z
            </InspectorNumericLabel>
            <NumberInput
              value={first.rect.rotation ?? 0}
              mixed={nodes.some((node) => (node.rect.rotation ?? 0) !== (first.rect.rotation ?? 0))}
              step={0.5}
              ariaLabel="Rotation Z"
              continuousEdit={continuousEdit}
              onChange={(value, mode) => onUpdate((node) => ({ ...node, rect: { ...node.rect, rotation: value } }), mode)}
            />
          </div>
          <TupleField
            label="Scale"
            value={first.rect.scale ?? [1, 1]}
            mixed={mixedTuple(nodes.map((node) => node.rect.scale ?? [1, 1]))}
            labels={["X", "Y"]}
            continuousEdit={continuousEdit}
            onChange={() => {}}
            onChangeIndex={(index, value, mode) =>
              onUpdate(
                (node) => ({
                  ...node,
                  rect: {
                    ...node.rect,
                    scale: (node.rect.scale ?? [1, 1]).map((entry, currentIndex) => (currentIndex === index ? value : entry)) as [
                      number,
                      number,
                    ],
                  },
                }),
                mode,
              )
            }
          />
        </div>
      ) : null}
    </section>
  );
}
