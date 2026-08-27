import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";

const ChromePageZoomContext = createContext(1);
const PAGE_ZOOM_GESTURE_WINDOW_MS = 1_000;
const DEVICE_PIXEL_RATIO_EPSILON = 0.001;
const STORAGE_KEY = "ui-authoring.chrome-page-zoom.v1";

interface StoredPageZoom {
  readonly devicePixelRatio: number;
  readonly pageZoomScale: number;
  readonly screen: string;
}

const listeners = new Set<() => void>();
let observing = false;
let observedDevicePixelRatio = 1;
let pageZoomScale = 1;
let pageZoomGestureUntil = 0;
let resolutionQuery: MediaQueryList | undefined;
let scheduledRefresh: number | undefined;

function currentDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const value = window.devicePixelRatio;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function screenIdentity(): string {
  return `${window.screen.width}x${window.screen.height}`;
}

function storedPageZoom(): StoredPageZoom | undefined {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredPageZoom> | null;
    if (
      !value ||
      !Number.isFinite(value.devicePixelRatio) ||
      !Number.isFinite(value.pageZoomScale) ||
      value.devicePixelRatio! <= 0 ||
      value.pageZoomScale! <= 0 ||
      typeof value.screen !== "string"
    )
      return undefined;
    return value as StoredPageZoom;
  } catch {
    return undefined;
  }
}

function storePageZoom(): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ devicePixelRatio: observedDevicePixelRatio, pageZoomScale, screen: screenIdentity() } satisfies StoredPageZoom),
    );
  } catch {}
}

function observeCurrentResolution(): void {
  resolutionQuery?.removeEventListener("change", refreshPageZoom);
  resolutionQuery = window.matchMedia(`(resolution: ${observedDevicePixelRatio}dppx)`);
  resolutionQuery.addEventListener("change", refreshPageZoom);
}

function refreshPageZoom(): void {
  const nextDevicePixelRatio = currentDevicePixelRatio();
  if (Math.abs(nextDevicePixelRatio - observedDevicePixelRatio) < DEVICE_PIXEL_RATIO_EPSILON) return;
  const previousDevicePixelRatio = observedDevicePixelRatio;
  observedDevicePixelRatio = nextDevicePixelRatio;
  observeCurrentResolution();
  if (Date.now() <= pageZoomGestureUntil) {
    const nextPageZoomScale = pageZoomScale * (nextDevicePixelRatio / previousDevicePixelRatio);
    if (Number.isFinite(nextPageZoomScale) && nextPageZoomScale > 0) {
      pageZoomScale = nextPageZoomScale;
      notify();
    }
  }
  storePageZoom();
}

function beginPageZoomGesture(event: WheelEvent): void {
  if (!event.ctrlKey) return;
  pageZoomGestureUntil = Date.now() + PAGE_ZOOM_GESTURE_WINDOW_MS;
  if (scheduledRefresh !== undefined) window.clearTimeout(scheduledRefresh);
  scheduledRefresh = window.setTimeout(() => {
    scheduledRefresh = undefined;
    refreshPageZoom();
  }, 0);
  window.requestAnimationFrame(refreshPageZoom);
}

function startObserving(): void {
  if (observing || typeof window === "undefined") return;
  observing = true;
  observedDevicePixelRatio = currentDevicePixelRatio();
  const stored = storedPageZoom();
  pageZoomScale =
    stored && stored.screen === screenIdentity() ? stored.pageZoomScale * (observedDevicePixelRatio / stored.devicePixelRatio) : 1;
  storePageZoom();
  window.addEventListener("wheel", beginPageZoomGesture, { capture: true, passive: true });
  window.addEventListener("resize", refreshPageZoom);
  observeCurrentResolution();
}

function stopObserving(): void {
  if (!observing || typeof window === "undefined") return;
  observing = false;
  window.removeEventListener("wheel", beginPageZoomGesture, true);
  window.removeEventListener("resize", refreshPageZoom);
  resolutionQuery?.removeEventListener("change", refreshPageZoom);
  resolutionQuery = undefined;
  if (scheduledRefresh !== undefined) window.clearTimeout(scheduledRefresh);
  scheduledRefresh = undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startObserving();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopObserving();
  };
}

function pageZoomSnapshot(): number {
  return pageZoomScale;
}

export function ChromePageZoomProvider({ children }: { readonly children: ReactNode }) {
  const scale = useSyncExternalStore(subscribe, pageZoomSnapshot, () => 1);
  return <ChromePageZoomContext.Provider value={scale}>{children}</ChromePageZoomContext.Provider>;
}

export function useChromePageZoomScale(): number {
  return useContext(ChromePageZoomContext);
}
