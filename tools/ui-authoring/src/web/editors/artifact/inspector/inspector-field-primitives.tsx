import { Lock, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { type NumberInputProps, NumberInput as SharedNumberInput } from "../../../shared/number-input.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-inspector.module.css";
import type { InspectorValueState } from "./inspector-field-presentation.js";
import type { InspectorContinuousEdit, InspectorOverrideState, InspectorUpdateMode } from "./inspector-types.js";
import type { NumericScrubKind } from "./numeric-scrub.js";
import { NumericScrubLabel } from "./numeric-scrub-label.js";

const webClasses = createWebClasses(sharedStyles, artifactStyles);

export function NumberInput({
  continuousEdit,
  ...props
}: Omit<NumberInputProps<InspectorUpdateMode>, "continuousEdit"> & {
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  return <SharedNumberInput {...props} continuousEdit={continuousEdit ? { ...continuousEdit, mode: "transient" } : undefined} />;
}

interface InspectorFieldFrameProps {
  readonly state?: InspectorOverrideState | undefined;
  readonly valueState?: InspectorValueState | undefined;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly onReset?: (() => void) | undefined;
  readonly children: ReactNode;
}

export function InspectorFieldFrame({ state, valueState, disabled = false, disabledReason, onReset, children }: InspectorFieldFrameProps) {
  const stateTitle =
    state === "overridden"
      ? "当前层已覆写"
      : state === "added"
        ? "当前使用位置新增"
        : state === "conflict"
          ? "字段冲突"
          : state === "inherited"
            ? "继承自基础 Artifact"
            : undefined;
  return (
    <fieldset
      className={webClasses(`inspector-field-frame ${state ? `is-${state}` : ""} ${valueState ? `is-value-${valueState}` : ""}`)}
      disabled={disabled}
      title={disabledReason}
    >
      {children}
      {disabled && disabledReason ? <Lock className={webClasses("inspector-lock-marker")} size={10} aria-label={disabledReason} /> : null}
      {state ? (
        <span
          className={webClasses("inspector-state-marker")}
          data-ui="inspector-state-marker"
          title={stateTitle}
          aria-label={stateTitle}
        />
      ) : null}
      {state === "overridden" && onReset ? (
        <button type="button" onClick={onReset} title="还原为继承值" aria-label="还原为继承值">
          <RotateCcw size={11} />
        </button>
      ) : null}
    </fieldset>
  );
}

export function InspectorNumericLabel({
  value,
  kind = "float",
  minimum,
  maximum,
  className,
  disabled = false,
  continuousEdit,
  onPreview,
  onCommit,
  children,
}: {
  readonly value: number;
  readonly kind?: NumericScrubKind | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
  readonly onPreview: (value: number) => void;
  readonly onCommit?: ((value: number) => void) | undefined;
  readonly children: ReactNode;
}) {
  if (disabled || !continuousEdit) return <span className={className}>{children}</span>;
  return (
    <NumericScrubLabel
      value={value}
      kind={kind}
      minimum={minimum}
      maximum={maximum}
      className={className}
      lifecycle={{
        begin: continuousEdit.begin,
        preview: onPreview,
        commit: (next) => {
          onCommit?.(next);
          continuousEdit.commit();
        },
        cancel: continuousEdit.cancel,
      }}
    >
      {children}
    </NumericScrubLabel>
  );
}

export function TupleField({
  label,
  value,
  labels,
  onChange,
  onChangeIndex,
  minimum,
  maximum,
  step,
  drivenBy = [],
  mixed = [],
  continuousEdit,
}: {
  readonly label: string;
  readonly value: readonly number[];
  readonly labels: readonly string[];
  readonly onChange: (value: number[], mode?: InspectorUpdateMode) => void;
  readonly onChangeIndex?: ((index: number, value: number, mode?: InspectorUpdateMode) => void) | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly step?: number | undefined;
  readonly drivenBy?: readonly (string | undefined)[] | undefined;
  readonly mixed?: readonly boolean[] | undefined;
  readonly continuousEdit?: InspectorContinuousEdit | undefined;
}) {
  return (
    <div className={webClasses(`inspector-row tuple-row tuple-${value.length}`)} data-ui="inspector-row">
      <span className={webClasses("field-label")}>{label}</span>
      <div className={webClasses("tuple-inputs")}>
        {value.map((item, index) => (
          <label
            className={webClasses(`number-field ${drivenBy[index] ? "is-driven" : ""}`)}
            data-ui="number-field"
            key={labels[index] ?? index}
            title={drivenBy[index] ? `由 ${drivenBy[index]} 控制` : undefined}
          >
            <InspectorNumericLabel
              value={item}
              minimum={minimum}
              maximum={maximum}
              disabled={Boolean(drivenBy[index])}
              continuousEdit={continuousEdit}
              onPreview={(next) =>
                onChangeIndex
                  ? onChangeIndex(index, next, "transient")
                  : onChange(
                      value.map((current, currentIndex) => (currentIndex === index ? next : current)),
                      "transient",
                    )
              }
            >
              {labels[index] ?? index}
            </InspectorNumericLabel>
            <NumberInput
              value={item}
              mixed={mixed[index]}
              minimum={minimum}
              maximum={maximum}
              step={step}
              disabled={Boolean(drivenBy[index])}
              continuousEdit={continuousEdit}
              onChange={(next, mode) =>
                onChangeIndex
                  ? onChangeIndex(index, next, mode)
                  : onChange(
                      value.map((current, currentIndex) => (currentIndex === index ? next : current)),
                      mode,
                    )
              }
            />
            {drivenBy[index] ? <small>受控</small> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

export function MixedCheckbox({
  checked,
  mixed,
  onChange,
}: {
  readonly checked: boolean;
  readonly mixed: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={input}
      type="checkbox"
      checked={!mixed && checked}
      aria-checked={mixed ? "mixed" : checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
