import { ChevronDown, ChevronUp } from "lucide-react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type SelectedItemEdge = "above" | "below";

interface SelectedItemRevealOptions {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly selectedKey: string | undefined;
  readonly selectedSelector: string | undefined;
  readonly revealRequest?: number | undefined;
}

function editableShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

export function useFrameSelectedShortcut(enabled: boolean, onFrameSelected: () => boolean | void): void {
  const handler = useRef(onFrameSelected);
  handler.current = onFrameSelected;
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key.toLowerCase() !== "f" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        editableShortcutTarget(event.target)
      )
        return;
      if (handler.current() !== false) event.preventDefault();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [enabled]);
}

export function useSelectedItemReveal({ containerRef, selectedKey, selectedSelector, revealRequest = 0 }: SelectedItemRevealOptions) {
  const selector = useRef(selectedSelector);
  const pendingReveal = useRef(false);
  const previousSelectedKey = useRef(selectedKey);
  const previousRevealRequest = useRef(0);
  const [edge, setEdge] = useState<SelectedItemEdge>();
  selector.current = selectedSelector;

  const selectedElement = useCallback((): HTMLElement | null => {
    const container = containerRef.current;
    const currentSelector = selector.current;
    return container && currentSelector ? container.querySelector<HTMLElement>(currentSelector) : null;
  }, [containerRef]);

  const measure = useCallback((): void => {
    const container = containerRef.current;
    const selected = selectedElement();
    if (!container || !selected) {
      setEdge(undefined);
      return;
    }
    const viewport = container.getBoundingClientRect();
    const bounds = selected.getBoundingClientRect();
    const next = bounds.bottom <= viewport.top ? "above" : bounds.top >= viewport.bottom ? "below" : undefined;
    setEdge((current) => (current === next ? current : next));
  }, [containerRef, selectedElement]);

  const reveal = useCallback(
    (block: ScrollLogicalPosition = "nearest"): boolean => {
      const selected = selectedElement();
      if (!selected) {
        pendingReveal.current = Boolean(selector.current);
        setEdge(undefined);
        return false;
      }
      pendingReveal.current = false;
      selected.scrollIntoView({ block, inline: "nearest" });
      setEdge(undefined);
      return true;
    },
    [selectedElement],
  );

  useLayoutEffect(() => {
    const selectionChanged = previousSelectedKey.current !== selectedKey;
    const revealRequested = previousRevealRequest.current !== revealRequest;
    previousSelectedKey.current = selectedKey;
    previousRevealRequest.current = revealRequest;
    if (!selectedKey) {
      pendingReveal.current = false;
      setEdge(undefined);
      return;
    }
    if (selectionChanged) pendingReveal.current = false;
    if (revealRequested) reveal("center");
    else measure();
  }, [measure, reveal, revealRequest, selectedKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const changed = (): void => {
      if (pendingReveal.current) reveal();
      else measure();
    };
    const resizeObserver = new ResizeObserver(changed);
    const mutationObserver = new MutationObserver(changed);
    resizeObserver.observe(container);
    mutationObserver.observe(container, { childList: true, subtree: true });
    container.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      container.removeEventListener("scroll", measure);
    };
  }, [containerRef, measure, reveal]);

  return { edge, measure, reveal };
}

export function SelectedItemEdgeButton({
  edge,
  className,
  onReveal,
  label = "当前选择",
}: {
  readonly edge: SelectedItemEdge | undefined;
  readonly className: string;
  readonly onReveal: () => void;
  readonly label?: string | undefined;
}) {
  if (!edge) return null;
  const title = `${label}在${edge === "above" ? "上方" : "下方"}，点击定位`;
  return (
    <button className={className} type="button" onClick={onReveal} title={title} aria-label={title} data-selection-edge={edge}>
      {edge === "above" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );
}
