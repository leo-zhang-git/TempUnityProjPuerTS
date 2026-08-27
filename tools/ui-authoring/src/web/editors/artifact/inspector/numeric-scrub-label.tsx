import { type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createWebClasses } from "../../../styles/web-styles.js";
import artifactStyles from "./artifact-inspector.module.css";
import {
  applyNumericScrubDelta,
  NUMERIC_SCRUB_DEAD_ZONE,
  type NumericScrubAxis,
  type NumericScrubKind,
  numericScrubAcceleration,
  numericScrubNiceDelta,
  numericScrubSensitivity,
} from "./numeric-scrub.js";

const webClasses = createWebClasses(artifactStyles);

interface NumericScrubLifecycle {
  readonly begin: () => void;
  readonly preview: (value: number) => void;
  readonly commit: (value: number) => void;
  readonly cancel: () => void;
}

interface NumericScrubLabelProps {
  readonly value: number;
  readonly kind?: NumericScrubKind | undefined;
  readonly minimum?: number | undefined;
  readonly maximum?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  readonly lifecycle: NumericScrubLifecycle;
  readonly children: ReactNode;
}

interface ActiveScrub {
  readonly element: HTMLSpanElement;
  readonly pointerId: number;
  readonly sensitivity: number;
  readonly kind: NumericScrubKind;
  readonly minimum: number | undefined;
  readonly maximum: number | undefined;
  readonly lifecycle: NumericScrubLifecycle;
  readonly cleanup: () => void;
  lastClientX: number;
  lastClientY: number;
  accumulatedX: number;
  accumulatedY: number;
  currentValue: number;
  axis: NumericScrubAxis;
  dragging: boolean;
  frameId: number | undefined;
  previewPending: boolean;
}

export function NumericScrubLabel({
  value,
  kind = "float",
  minimum,
  maximum,
  disabled = false,
  className,
  lifecycle,
  children,
}: NumericScrubLabelProps) {
  const active = useRef<ActiveScrub | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const flushPreview = (current: ActiveScrub): void => {
    if (!current.previewPending) return;
    if (current.frameId !== undefined) cancelAnimationFrame(current.frameId);
    current.frameId = undefined;
    current.previewPending = false;
    current.lifecycle.preview(current.currentValue);
  };

  const schedulePreview = (current: ActiveScrub): void => {
    current.previewPending = true;
    if (current.frameId !== undefined) return;
    current.frameId = requestAnimationFrame(() => {
      current.frameId = undefined;
      if (active.current !== current || !current.previewPending) return;
      current.previewPending = false;
      current.lifecycle.preview(current.currentValue);
    });
  };

  const finish = (commit: boolean, updateState = true): void => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    current.cleanup();
    if (commit && current.dragging) flushPreview(current);
    else if (current.frameId !== undefined) cancelAnimationFrame(current.frameId);
    try {
      if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    } catch {
      // The browser may release capture before delivering pointercancel.
    }
    if (current.dragging) {
      if (commit) current.lifecycle.commit(current.currentValue);
      else current.lifecycle.cancel();
    }
    if (updateState) setScrubbing(false);
  };

  const move = (event: PointerEvent): void => {
    const current = active.current;
    if (!current || event.pointerId !== current.pointerId) return;
    let deltaX = event.clientX - current.lastClientX;
    let deltaY = event.clientY - current.lastClientY;
    current.lastClientX = event.clientX;
    current.lastClientY = event.clientY;
    current.accumulatedX += deltaX;
    current.accumulatedY += deltaY;
    event.preventDefault();
    if (!current.dragging) {
      if (Math.hypot(current.accumulatedX, current.accumulatedY) <= NUMERIC_SCRUB_DEAD_ZONE) return;
      current.dragging = true;
      current.lifecycle.begin();
      setScrubbing(true);
      deltaX = current.accumulatedX;
      deltaY = current.accumulatedY;
      current.accumulatedX = 0;
      current.accumulatedY = 0;
    }
    const acceleration = numericScrubAcceleration(event.shiftKey, event.altKey);
    const delta = numericScrubNiceDelta(deltaX, deltaY, acceleration, current.axis);
    current.axis = delta.axis;
    const nextValue = applyNumericScrubDelta(
      current.currentValue,
      delta.value,
      current.sensitivity,
      current.kind,
      current.minimum,
      current.maximum,
    );
    if (Object.is(nextValue, current.currentValue)) return;
    current.currentValue = nextValue;
    schedulePreview(current);
  };

  const pointerUp = (event: PointerEvent): void => {
    if (event.pointerId === active.current?.pointerId) finish(true);
  };
  const pointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === active.current?.pointerId) finish(false);
  };
  const keyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    finish(false);
  };
  const blur = (): void => finish(false);

  useEffect(() => () => finish(false, false), []);

  const pointerDown = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (disabled || event.button !== 0 || event.pointerType !== "mouse" || !Number.isFinite(value)) return;
    const sensitivity = numericScrubSensitivity(value, kind);
    if (sensitivity === 0) return;
    finish(false);
    event.preventDefault();
    const element = event.currentTarget;
    const cleanup = (): void => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerCancel);
      document.removeEventListener("keydown", keyDown);
      window.removeEventListener("blur", blur);
    };
    active.current = {
      element,
      pointerId: event.pointerId,
      sensitivity,
      kind,
      minimum,
      maximum,
      lifecycle,
      cleanup,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      accumulatedX: 0,
      accumulatedY: 0,
      currentValue: value,
      axis: "x",
      dragging: false,
      frameId: undefined,
      previewPending: false,
    };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a fallback; document listeners still retain the gesture.
    }
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerCancel);
    document.addEventListener("keydown", keyDown);
    window.addEventListener("blur", blur);
  };

  return (
    <span
      className={`${className ?? ""} ${webClasses(`numeric-scrub-label ${scrubbing ? "is-scrubbing" : ""}`)}`.trim()}
      data-numeric-scrub={disabled ? undefined : kind}
      onPointerDown={pointerDown}
    >
      {children}
    </span>
  );
}
