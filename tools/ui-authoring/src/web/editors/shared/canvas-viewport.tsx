import { Focus, ZoomIn, ZoomOut } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useChromePageZoomScale } from "../../shared/chrome-page-zoom.js";
import { createWebClasses } from "../../styles/web-styles.js";
import styles from "./canvas-viewport.module.css";

const webClasses = createWebClasses(styles);

export interface CanvasZoomPolicy {
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const PREVIEW_CANVAS_ZOOM_POLICY: CanvasZoomPolicy = { default: 0.65, min: 0.2, max: 2, step: 0.1 };

function clampCanvasZoom(policy: CanvasZoomPolicy, zoom: number): number {
  return Math.max(policy.min, Math.min(policy.max, zoom));
}

export interface CanvasViewportController {
  readonly bindContainer: (element: HTMLDivElement | null) => void;
  readonly panning: boolean;
  readonly pageZoomScale: number;
  readonly fit: () => void;
  readonly beginPan: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly movePan: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly endPan: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface CanvasViewportOptions {
  readonly contentSize: readonly [number, number];
  readonly zoom: number;
  readonly zoomPolicy: CanvasZoomPolicy;
  readonly onZoom: (zoom: number) => void;
  readonly clampZoom?: ((zoom: number) => number) | undefined;
}

interface PanGesture {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
}

export function useCanvasViewport({
  contentSize,
  zoom,
  zoomPolicy,
  onZoom,
  clampZoom = (value) => clampCanvasZoom(zoomPolicy, value),
}: CanvasViewportOptions): CanvasViewportController {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const pageZoomScale = useChromePageZoomScale();
  const pan = useRef<PanGesture | null>(null);
  const spacePressed = useRef(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      const editingText =
        event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true'], [contenteditable='']");
      if (event.code === "Space" && !editingText) spacePressed.current = true;
    };
    const up = (event: KeyboardEvent): void => {
      if (event.code === "Space") spacePressed.current = false;
    };
    const blur = (): void => {
      spacePressed.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const fit = useCallback((): void => {
    if (!container) return;
    const stage = container.querySelector<HTMLElement>("[data-canvas-stage]");
    const stageBounds = stage?.getBoundingClientRect();
    const contentWidth = stageBounds && stageBounds.width > 0 ? (stageBounds.width * pageZoomScale) / zoom : contentSize[0];
    const contentHeight = stageBounds && stageBounds.height > 0 ? (stageBounds.height * pageZoomScale) / zoom : contentSize[1];
    const next = Math.min(
      ((container.clientWidth - 24) * pageZoomScale) / contentWidth,
      ((container.clientHeight - 24) * pageZoomScale) / contentHeight,
    );
    onZoom(clampZoom(Math.floor(next * 100) / 100));
  }, [clampZoom, container, contentSize, onZoom, pageZoomScale, zoom]);

  const beginPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!container || !(event.button === 1 || (event.button === 0 && spacePressed.current))) return;
      event.preventDefault();
      event.stopPropagation();
      container.setPointerCapture(event.pointerId);
      pan.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: container.scrollLeft,
        top: container.scrollTop,
      };
      setPanning(true);
    },
    [container],
  );

  const movePan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const gesture = pan.current;
      if (!gesture || !container || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      container.scrollLeft = gesture.left - (event.clientX - gesture.x);
      container.scrollTop = gesture.top - (event.clientY - gesture.y);
    },
    [container],
  );

  const endPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const gesture = pan.current;
      if (!gesture || !container || gesture.pointerId !== event.pointerId) return;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      pan.current = null;
      setPanning(false);
    },
    [container],
  );

  const zoomAtPointer = useCallback(
    (event: WheelEvent): void => {
      if (event.ctrlKey) return;
      const root = container?.querySelector<HTMLElement>("[data-canvas-zoom-root]");
      if (!container || !root || event.deltaY === 0) return;
      const next = clampZoom(zoom + (event.deltaY < 0 ? zoomPolicy.step : -zoomPolicy.step));
      if (next === zoom) return;
      event.preventDefault();
      const before = root.getBoundingClientRect();
      const localX = ((event.clientX - before.left) * pageZoomScale) / zoom;
      const localY = ((event.clientY - before.top) * pageZoomScale) / zoom;
      onZoom(next);
      requestAnimationFrame(() => {
        const afterRoot = container.querySelector<HTMLElement>("[data-canvas-zoom-root]");
        if (!afterRoot) return;
        const after = afterRoot.getBoundingClientRect();
        container.scrollLeft += after.left + (localX * next) / pageZoomScale - event.clientX;
        container.scrollTop += after.top + (localY * next) / pageZoomScale - event.clientY;
      });
    },
    [clampZoom, container, onZoom, pageZoomScale, zoom, zoomPolicy.step],
  );

  useEffect(() => {
    if (!container) return;
    container.addEventListener("wheel", zoomAtPointer, { passive: false });
    return () => container.removeEventListener("wheel", zoomAtPointer);
  }, [container, zoomAtPointer]);

  return { bindContainer: setContainer, panning, pageZoomScale, fit, beginPan, movePan, endPan };
}

export function CanvasViewport({
  controller,
  children,
  onPointerDown,
}: {
  readonly controller: CanvasViewportController;
  readonly children: ReactNode;
  readonly onPointerDown?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
}) {
  return (
    <div
      ref={controller.bindContainer}
      className={webClasses(`canvas-scroll ${controller.panning ? "is-panning" : ""}`)}
      style={{ "--canvas-page-zoom-inverse": String(1 / controller.pageZoomScale) } as CSSProperties}
      data-ui="canvas-scroll"
      data-canvas-viewport
      role="region"
      aria-label="Canvas 可视区域"
      onPointerDownCapture={controller.beginPan}
      onPointerMove={controller.movePan}
      onPointerUp={controller.endPan}
      onPointerCancel={controller.endPan}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}

export function CanvasZoomControls({
  zoom,
  zoomPolicy,
  onZoom,
  onFit,
  clampZoom = (value) => clampCanvasZoom(zoomPolicy, value),
}: {
  readonly zoom: number;
  readonly zoomPolicy: CanvasZoomPolicy;
  readonly onZoom: (zoom: number) => void;
  readonly onFit: () => void;
  readonly clampZoom?: ((zoom: number) => number) | undefined;
}) {
  return (
    <div className={webClasses("canvas-zoom-controls")} role="group" aria-label="Canvas 缩放">
      <button type="button" onClick={() => onZoom(clampZoom(zoom - zoomPolicy.step))} disabled={zoom <= zoomPolicy.min} title="缩小">
        <ZoomOut size={13} />
      </button>
      <button className={webClasses("canvas-zoom-value")} data-ui="canvas-zoom-value" type="button" onClick={onFit} title="适合画布">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={() => onZoom(clampZoom(zoom + zoomPolicy.step))} disabled={zoom >= zoomPolicy.max} title="放大">
        <ZoomIn size={13} />
      </button>
      <button type="button" onClick={onFit} title="适合画布">
        <Focus size={13} />
      </button>
    </div>
  );
}
