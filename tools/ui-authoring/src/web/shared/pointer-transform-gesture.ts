type PointerTransformAxis = 0 | 1;

export interface PointerTransformSample {
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export interface PointerTransformUpdate {
  readonly screenDelta: readonly [number, number];
  readonly constrainedScreenDelta: readonly [number, number];
  readonly constrainedAxis?: PointerTransformAxis | undefined;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

interface PointerTransformGestureOptions {
  readonly pointerId: number;
  readonly origin: readonly [number, number];
  readonly captureTarget: HTMLElement;
  readonly axisLock: boolean;
  readonly threshold?: number | undefined;
  readonly onStart: () => void;
  readonly onUpdate: (update: PointerTransformUpdate) => void;
  readonly onFinish: (commit: boolean, started: boolean) => void;
}

export function resolvePointerTransformUpdate(
  origin: readonly [number, number],
  sample: PointerTransformSample,
  axisLock: boolean,
): PointerTransformUpdate {
  const screenDelta = [sample.clientX - origin[0], sample.clientY - origin[1]] as const;
  const constrainedAxis = axisLock && sample.shiftKey ? (Math.abs(screenDelta[0]) >= Math.abs(screenDelta[1]) ? 0 : 1) : undefined;
  const constrainedScreenDelta =
    constrainedAxis === 0 ? ([screenDelta[0], 0] as const) : constrainedAxis === 1 ? ([0, screenDelta[1]] as const) : screenDelta;
  return { screenDelta, constrainedScreenDelta, constrainedAxis, altKey: sample.altKey, shiftKey: sample.shiftKey };
}

export function beginPointerTransformGesture({
  pointerId,
  origin,
  captureTarget,
  axisLock,
  threshold = 3,
  onStart,
  onUpdate,
  onFinish,
}: PointerTransformGestureOptions): void {
  let started = false;
  let frameId: number | undefined;
  let pendingSample: PointerTransformSample | undefined;
  let appliedSample: PointerTransformSample | undefined;

  const sameSample = (left: PointerTransformSample | undefined, right: PointerTransformSample): boolean =>
    left?.clientX === right.clientX && left.clientY === right.clientY && left.altKey === right.altKey && left.shiftKey === right.shiftKey;
  const apply = (sample: PointerTransformSample): void => {
    if (sameSample(appliedSample, sample)) return;
    appliedSample = sample;
    const update = resolvePointerTransformUpdate(origin, sample, axisLock);
    if (!started && Math.hypot(update.screenDelta[0], update.screenDelta[1]) < threshold) return;
    if (!started) {
      started = true;
      onStart();
    }
    onUpdate(update);
  };
  const flush = (): void => {
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    frameId = undefined;
    const sample = pendingSample;
    pendingSample = undefined;
    if (sample) apply(sample);
  };
  const cleanup = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", keydown);
    if (captureTarget.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId);
  };
  const finish = (commit: boolean, finalSample?: PointerTransformSample): void => {
    cleanup();
    if (commit && finalSample) pendingSample = finalSample;
    if (commit) flush();
    else {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      frameId = undefined;
      pendingSample = undefined;
    }
    onFinish(commit, started);
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    event.preventDefault();
    pendingSample = pointerSample(event);
    if (frameId !== undefined) return;
    frameId = requestAnimationFrame(() => {
      frameId = undefined;
      const sample = pendingSample;
      pendingSample = undefined;
      if (sample) apply(sample);
    });
  };
  const end = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) finish(true, pointerSample(event));
  };
  const cancel = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) finish(false);
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    finish(false);
  };

  captureTarget.setPointerCapture?.(pointerId);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", keydown);
}

function pointerSample(event: PointerEvent): PointerTransformSample {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}
