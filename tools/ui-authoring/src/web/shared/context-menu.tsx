import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createWebClasses } from "../styles/web-styles.js";
import contextMenuStyles from "./context-menu.module.css";

const webClasses = createWebClasses(contextMenuStyles);

export interface ContextMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly danger?: boolean | undefined;
  readonly dividerBefore?: boolean | undefined;
  readonly children?: readonly ContextMenuItem[] | undefined;
  readonly onSelect?: (() => void) | undefined;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [submenuKey, setSubmenuKey] = useState<string>();
  useLayoutEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);
  useEffect(() => {
    const closeOnPointer = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const close = (): void => onClose();
    window.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 252));
  const top = Math.max(8, Math.min(y, window.innerHeight - Math.min(560, items.length * 34 + 16) - 8));
  return (
    <div
      ref={root}
      className={webClasses("menu")}
      role="menu"
      style={{ left, top, maxHeight: Math.max(120, window.innerHeight - top - 8) }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        if (buttons.length === 0) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : event.key === "ArrowDown"
                ? (current + 1) % buttons.length
                : (current - 1 + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }}
    >
      {items.map((item) => (
        <div className={webClasses("item")} key={item.key} onPointerEnter={() => setSubmenuKey(item.children ? item.key : undefined)}>
          <button
            className={webClasses(`${item.dividerBefore ? "divider" : ""} ${item.danger ? "danger" : ""}`)}
            type="button"
            role="menuitem"
            aria-label={item.label}
            aria-haspopup={item.children ? "menu" : undefined}
            aria-expanded={item.children ? submenuKey === item.key : undefined}
            disabled={item.disabled}
            title={item.disabledReason}
            onClick={() => {
              if (item.children) {
                setSubmenuKey(item.key);
                return;
              }
              item.onSelect?.();
              onClose();
            }}
          >
            <span className={webClasses("icon")}>{item.icon}</span>
            <span className={webClasses("copy")}>
              <strong>{item.label}</strong>
              {item.disabled && item.disabledReason ? <small>{item.disabledReason}</small> : null}
            </span>
            {item.children ? <span className={webClasses("submenu-arrow")}>›</span> : null}
          </button>
          {item.children && submenuKey === item.key ? (
            <div className={webClasses(`submenu ${x > window.innerWidth - 480 ? "open-left" : ""}`)} role="menu" aria-label={item.label}>
              {item.children.map((child) => (
                <button
                  key={child.key}
                  type="button"
                  role="menuitem"
                  aria-label={child.label}
                  disabled={child.disabled}
                  title={child.disabledReason}
                  onClick={() => {
                    child.onSelect?.();
                    onClose();
                  }}
                >
                  <span className={webClasses("icon")}>{child.icon}</span>
                  <span className={webClasses("copy")}>
                    <strong>{child.label}</strong>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
