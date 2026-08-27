import { useRef, useState } from "react";
import { evaluateNumericExpression, isNumericLiteral } from "./numeric-expression.js";

interface NumberInputContinuousEdit<UpdateMode> {
  readonly begin: () => void;
  readonly commit: () => void;
  readonly cancel: () => void;
  readonly mode: UpdateMode;
}

export interface NumberInputProps<UpdateMode = never> {
  readonly value: number;
  readonly onChange: (value: number, mode?: UpdateMode) => unknown;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly step?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly mixed?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly continuousEdit?: NumberInputContinuousEdit<UpdateMode> | undefined;
}

interface NumberDraftResult {
  readonly value?: number | undefined;
  readonly issue?: string | undefined;
}

function numberDraftResult(draft: string, minimum: number | undefined, maximum: number | undefined): NumberDraftResult {
  if (draft.trim() === "") return { issue: "请输入数值" };
  const value = evaluateNumericExpression(draft);
  if (value === undefined) return { issue: "请输入有效数字或算式" };
  if (minimum !== undefined && value < minimum) return { issue: `数值不能小于 ${minimum}` };
  if (maximum !== undefined && value > maximum) return { issue: `数值不能大于 ${maximum}` };
  return { value };
}

function clamp(value: number, minimum: number | undefined, maximum: number | undefined): number {
  return Math.min(maximum ?? Number.POSITIVE_INFINITY, Math.max(minimum ?? Number.NEGATIVE_INFINITY, value));
}

export function NumberInput<UpdateMode = never>({
  value,
  onChange,
  minimum,
  maximum,
  step = 0.5,
  disabled = false,
  mixed = false,
  ariaLabel,
  continuousEdit,
}: NumberInputProps<UpdateMode>) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const editing = useRef(false);
  const result = draft === undefined ? undefined : numberDraftResult(draft, minimum, maximum);
  const displayValue = draft ?? (mixed ? "" : Number.isFinite(value) ? String(value) : "0");
  const begin = (): void => {
    if (!continuousEdit || editing.current) return;
    continuousEdit.begin();
    editing.current = true;
  };
  const finish = (commit: boolean): void => {
    if (!continuousEdit || !editing.current) return;
    editing.current = false;
    if (commit) continuousEdit.commit();
    else continuousEdit.cancel();
  };
  const commit = (): boolean => {
    if (continuousEdit && !editing.current) {
      setDraft(undefined);
      return true;
    }
    if (draft === undefined) {
      finish(true);
      return true;
    }
    if (result?.issue || result?.value === undefined) {
      finish(true);
      return false;
    }
    if (!isNumericLiteral(draft)) onChange(result.value, continuousEdit?.mode);
    setDraft(undefined);
    finish(true);
    return true;
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      role="spinbutton"
      data-numeric-input
      value={displayValue}
      placeholder={draft === undefined && mixed ? "混合" : undefined}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={result?.issue ? true : undefined}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={result?.value ?? (mixed ? undefined : value)}
      title={result?.issue}
      onFocus={begin}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        const nextResult = numberDraftResult(nextDraft, minimum, maximum);
        setDraft(nextDraft);
        if (!nextResult.issue && nextResult.value !== undefined && isNumericLiteral(nextDraft))
          onChange(nextResult.value, continuousEdit?.mode);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(undefined);
          finish(false);
        } else if (event.key === "Enter") {
          if (result?.issue) return;
          event.preventDefault();
          event.stopPropagation();
          if (commit()) event.currentTarget.blur();
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && Number.isFinite(step) && step > 0) {
          event.preventDefault();
          const base = result?.value ?? value;
          const next = clamp(base + (event.key === "ArrowUp" ? step : -step), minimum, maximum);
          setDraft(String(next));
          onChange(next, continuousEdit?.mode);
        }
      }}
    />
  );
}
