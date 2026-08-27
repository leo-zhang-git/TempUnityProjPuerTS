import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createWebClasses } from "../../../styles/web-styles.js";
import artifactStyles from "./artifact-inspector.module.css";
import { NumberInput } from "./inspector-field-primitives.js";

const webClasses = createWebClasses(artifactStyles);

export type ColorFieldUpdateMode = "transient";

export interface ColorFieldContinuousEdit {
  readonly begin: () => void;
  readonly commit: () => void;
  readonly cancel: () => void;
}

interface HsvColor {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
  readonly alpha: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function component(value: string, offset: number): number {
  const parsed = Number.parseInt(value.slice(offset, offset + 2), 16);
  return Number.isFinite(parsed) ? parsed : 255;
}

function byteHex(value: number): string {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function opaqueRgb(value: string): string {
  return `#${byteHex(component(value, 1))}${byteHex(component(value, 3))}${byteHex(component(value, 5))}`;
}

function alphaHex(value: string): string {
  return byteHex(component(value, 7));
}

function displayChannel(value: number): number {
  return Math.round(clamp(value) * 1000) / 1000;
}

function writeRgb(value: string, rgb: string): string {
  return `#${rgb}${alphaHex(value)}`;
}

function writeRgbChannel(value: string, channel: 0 | 1 | 2, next: number): string {
  const channels = [component(value, 1), component(value, 3), component(value, 5)];
  channels[channel] = clamp(next) * 255;
  return `#${channels.map(byteHex).join("")}${alphaHex(value)}`;
}

function writeAlpha(value: string, alpha: number): string {
  return `${opaqueRgb(value)}${byteHex(clamp(alpha) * 255)}`;
}

function readHsv(value: string | undefined): HsvColor {
  const color = value ?? "#FFFFFFFF";
  const red = component(color, 1) / 255;
  const green = component(color, 3) / 255;
  const blue = component(color, 5) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const hue =
    delta === 0
      ? 0
      : maximum === red
        ? 60 * (((green - blue) / delta) % 6)
        : maximum === green
          ? 60 * ((blue - red) / delta + 2)
          : 60 * ((red - green) / delta + 4);
  return { hue: (hue + 360) % 360, saturation: maximum === 0 ? 0 : delta / maximum, value: maximum, alpha: component(color, 7) / 255 };
}

function writeColor({ hue, saturation, value, alpha }: HsvColor): string {
  const chroma = value * saturation;
  const sector = hue / 60;
  const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1
      ? [chroma, intermediate, 0]
      : sector < 2
        ? [intermediate, chroma, 0]
        : sector < 3
          ? [0, chroma, intermediate]
          : sector < 4
            ? [0, intermediate, chroma]
            : sector < 5
              ? [intermediate, 0, chroma]
              : [chroma, 0, intermediate];
  const match = value - chroma;
  const hex = (channel: number): string => byteHex((channel + match) * 255);
  return `#${hex(red)}${hex(green)}${hex(blue)}${byteHex(clamp(alpha) * 255)}`;
}

function localRatio(event: ReactPointerEvent<HTMLElement>, horizontal: boolean): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  const size = horizontal ? bounds.width : bounds.height;
  if (size <= 0) return 0;
  return clamp((horizontal ? event.clientX - bounds.left : event.clientY - bounds.top) / size);
}

export function ColorField({
  value,
  onChange,
  mixed = false,
  continuousEdit,
}: {
  readonly value: string | undefined;
  readonly onChange: (value: string, mode?: ColorFieldUpdateMode) => void;
  readonly mixed?: boolean | undefined;
  readonly continuousEdit?: ColorFieldContinuousEdit | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [rgbDraft, setRgbDraft] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  const current = value ?? "#FFFFFFFF";
  const hsv = readHsv(current);
  const rgbValue = opaqueRgb(current).slice(1);
  const rgbIssue = rgbDraft !== undefined && !/^[0-9A-F]{6}$/.test(rgbDraft) ? "请输入 6 位十六进制 RGB" : undefined;
  const start = (): void => {
    if (editing.current || !continuousEdit) return;
    editing.current = true;
    continuousEdit.begin();
  };
  const finish = (): void => {
    if (!editing.current) return;
    editing.current = false;
    continuousEdit?.commit();
  };
  const cancel = (): void => {
    if (!editing.current) return;
    editing.current = false;
    continuousEdit?.cancel();
  };
  const update = (next: HsvColor): void => onChange(writeColor(next), continuousEdit ? "transient" : undefined);
  const updateAlpha = (next: number, mode?: ColorFieldUpdateMode): void => onChange(writeAlpha(current, next), mode);
  const updateChannel = (channel: 0 | 1 | 2, next: number, mode?: ColorFieldUpdateMode): void =>
    onChange(writeRgbChannel(current, channel, next), mode);
  const beginPointer = (event: ReactPointerEvent<HTMLElement>, apply: (event: ReactPointerEvent<HTMLElement>) => void): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start();
    apply(event);
  };
  const movePointer = (event: ReactPointerEvent<HTMLElement>, apply: (event: ReactPointerEvent<HTMLElement>) => void): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) apply(event);
  };
  const finishPointer = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finish();
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (editing.current) cancel();
      else setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const hueColor = `hsl(${hsv.hue} 100% 50%)`;
  const rgbColor = opaqueRgb(current);
  const swatchStyle = { "--color-swatch": current } as CSSProperties;
  return (
    <div className={webClasses("color-field")} ref={root}>
      <button
        className={webClasses("color-swatch")}
        type="button"
        aria-label="颜色"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={mixed ? "多种颜色" : "颜色"}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        style={swatchStyle}
      >
        <span />
      </button>
      <input
        className={webClasses("color-rgb-input")}
        value={rgbDraft ?? (mixed ? "" : rgbValue)}
        placeholder={mixed ? "混合" : "RRGGBB"}
        aria-label="RGB (RRGGBB)"
        aria-invalid={rgbIssue ? true : undefined}
        title={rgbIssue}
        maxLength={6}
        onChange={(event) => {
          const draft = event.currentTarget.value.toUpperCase();
          setRgbDraft(draft);
          if (/^[0-9A-F]{6}$/.test(draft)) onChange(writeRgb(current, draft));
        }}
        onBlur={() => setRgbDraft(undefined)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setRgbDraft(undefined);
          } else if (event.key === "Enter" && !rgbIssue) {
            setRgbDraft(undefined);
          }
        }}
      />
      <label className={webClasses("color-main-alpha")}>
        <span>A</span>
        <NumberInput
          value={displayChannel(hsv.alpha)}
          mixed={mixed}
          minimum={0}
          maximum={1}
          step={0.01}
          ariaLabel="Alpha"
          continuousEdit={continuousEdit}
          onChange={(alpha, mode) => updateAlpha(alpha, mode === "transient" ? mode : undefined)}
        />
      </label>
      {open ? (
        <div
          className={webClasses("color-picker-popover")}
          role="dialog"
          aria-label="颜色"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div
            className={webClasses("color-picker-sv")}
            data-ui="color-picker-sv"
            style={
              {
                "--color-picker-hue": hueColor,
                "--color-picker-x": `${hsv.saturation * 100}%`,
                "--color-picker-y": `${(1 - hsv.value) * 100}%`,
              } as CSSProperties
            }
            onPointerDown={(event) =>
              beginPointer(event, (pointer) =>
                update({ ...hsv, saturation: localRatio(pointer, true), value: 1 - localRatio(pointer, false) }),
              )
            }
            onPointerMove={(event) =>
              movePointer(event, (pointer) =>
                update({ ...hsv, saturation: localRatio(pointer, true), value: 1 - localRatio(pointer, false) }),
              )
            }
            onPointerUp={finishPointer}
            onPointerCancel={cancel}
          >
            <span />
          </div>
          <div className={webClasses("color-picker-channels")}>
            {(["R", "G", "B"] as const).map((label, channel) => (
              <label key={label}>
                <span>{label}</span>
                <NumberInput
                  value={displayChannel(component(current, 1 + channel * 2) / 255)}
                  minimum={0}
                  maximum={1}
                  step={0.01}
                  ariaLabel={label}
                  continuousEdit={continuousEdit}
                  onChange={(next, mode) => updateChannel(channel as 0 | 1 | 2, next, mode === "transient" ? mode : undefined)}
                />
              </label>
            ))}
            <label>
              <span>A</span>
              <NumberInput
                value={displayChannel(hsv.alpha)}
                minimum={0}
                maximum={1}
                step={0.01}
                ariaLabel="Alpha (0-1)"
                continuousEdit={continuousEdit}
                onChange={(alpha, mode) => updateAlpha(alpha, mode === "transient" ? mode : undefined)}
              />
            </label>
          </div>
          <div className={webClasses("color-picker-row color-picker-hue-row")}>
            <span>Hue</span>
            <div
              className={webClasses("color-picker-track color-picker-hue")}
              style={{ "--color-picker-x": `${hsv.hue / 3.6}%` } as CSSProperties}
              onPointerDown={(event) => beginPointer(event, (pointer) => update({ ...hsv, hue: localRatio(pointer, true) * 360 }))}
              onPointerMove={(event) => movePointer(event, (pointer) => update({ ...hsv, hue: localRatio(pointer, true) * 360 }))}
              onPointerUp={finishPointer}
              onPointerCancel={cancel}
            >
              <i />
            </div>
          </div>
          <div className={webClasses("color-picker-row color-picker-alpha-row")}>
            <span>Alpha</span>
            <div
              className={webClasses("color-picker-track color-picker-alpha")}
              data-ui="color-picker-track"
              data-color-channel="alpha"
              style={{ "--color-picker-rgb": rgbColor, "--color-picker-x": `${hsv.alpha * 100}%` } as CSSProperties}
              onPointerDown={(event) =>
                beginPointer(event, (pointer) => updateAlpha(localRatio(pointer, true), continuousEdit ? "transient" : undefined))
              }
              onPointerMove={(event) =>
                movePointer(event, (pointer) => updateAlpha(localRatio(pointer, true), continuousEdit ? "transient" : undefined))
              }
              onPointerUp={finishPointer}
              onPointerCancel={cancel}
            >
              <i />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
