import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createWebClasses } from "../styles/web-styles.js";
import styles from "./select-control.module.css";

const webClasses = createWebClasses(styles);
const MENU_GAP = 3;
const VIEWPORT_PADDING = 6;
const MAX_MENU_HEIGHT = 320;
const MIN_MENU_WIDTH = 160;

export interface SelectControlOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
}

interface SelectControlProps<Value extends string> {
  readonly value: Value;
  readonly options: readonly SelectControlOption<Value>[];
  readonly onValueChange: (value: Value) => void;
  readonly disabled?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly searchable?: boolean | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly emptyLabel?: string | undefined;
  readonly showAllOptionsOnEmptySearch?: boolean | undefined;
}

interface MenuPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
  readonly openAbove: boolean;
}

export function SelectControl<Value extends string>({
  value,
  options,
  onValueChange,
  disabled = false,
  autoFocus = false,
  ariaLabel,
  className,
  title,
  placeholder,
  searchable = false,
  searchPlaceholder = "搜索选项",
  emptyLabel = "没有匹配项",
  showAllOptionsOnEmptySearch = true,
}: SelectControlProps<Value>) {
  const listId = useId();
  const triggerId = `${listId}-trigger`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<number | undefined>(undefined);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const visibleOptions = useMemo(
    () => filterOptions(options, query, !searchable || showAllOptionsOnEmptySearch),
    [options, query, searchable, showAllOptionsOnEmptySearch],
  );
  const visibleSelectedIndex = visibleOptions.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(() => firstEnabledIndex(visibleOptions, visibleSelectedIndex));
  const [position, setPosition] = useState<MenuPosition>();

  useLayoutEffect(() => {
    if (autoFocus) trigger.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const desiredHeight = Math.min(
      MAX_MENU_HEIGHT,
      visibleOptions.length * 24 + 8 + (searchable ? 32 : 0) + (visibleOptions.length === 0 ? 26 : 0),
    );
    const roomBelow = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_PADDING;
    const roomAbove = rect.top - MENU_GAP - VIEWPORT_PADDING;
    const openAbove = roomBelow < Math.min(desiredHeight, 144) && roomAbove > roomBelow;
    const width = Math.min(Math.max(rect.width, MIN_MENU_WIDTH), window.innerWidth - VIEWPORT_PADDING * 2);
    setPosition({
      left: Math.max(VIEWPORT_PADDING, Math.min(rect.left, window.innerWidth - width - VIEWPORT_PADDING)),
      top: openAbove ? rect.top - MENU_GAP : rect.bottom + MENU_GAP,
      width,
      maxHeight: Math.max(72, Math.min(MAX_MENU_HEIGHT, openAbove ? roomAbove : roomBelow)),
      openAbove,
    });
  }, [open, searchable, visibleOptions.length]);

  useLayoutEffect(() => {
    if (open && searchable && position) searchInput.current?.focus();
  }, [open, position, searchable]);

  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    menu.current.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const closeOnResize = (): void => setOpen(false);
    const closeOnScroll = (event: Event): void => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current !== undefined) window.clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  const openMenu = (preferredIndex = selectedIndex, direction: 1 | -1 = 1): void => {
    if (disabled || options.length === 0) return;
    const nextOptions = filterOptions(options, "", !searchable || showAllOptionsOnEmptySearch);
    const preferredValue = options[preferredIndex]?.value;
    const visiblePreferred = nextOptions.findIndex((option) => option.value === preferredValue);
    setQuery("");
    setActiveIndex(firstEnabledIndex(nextOptions, visiblePreferred, direction));
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false): void => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus();
  };

  const commit = (index: number): void => {
    const option = visibleOptions[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    closeMenu(true);
  };

  const move = (offset: -1 | 1): void => {
    const next = nextEnabledIndex(visibleOptions, activeIndex, offset);
    if (next >= 0) setActiveIndex(next);
  };

  const updateSearch = (nextQuery: string): void => {
    const nextOptions = filterOptions(options, nextQuery, showAllOptionsOnEmptySearch);
    const nextSelectedIndex = nextOptions.findIndex((option) => option.value === value);
    setQuery(nextQuery);
    setActiveIndex(firstEnabledIndex(nextOptions, nextSelectedIndex));
  };

  const handleTypeahead = (key: string): void => {
    if (searchable) {
      const nextOptions = filterOptions(options, key, showAllOptionsOnEmptySearch);
      setQuery(key);
      setActiveIndex(firstEnabledIndex(nextOptions, 0));
      setOpen(true);
      return;
    }
    typeahead.current += key.toLocaleLowerCase();
    if (typeaheadTimer.current !== undefined) window.clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = window.setTimeout(() => {
      typeahead.current = "";
    }, 600);
    const match = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typeahead.current));
    if (match >= 0) {
      setActiveIndex(match);
      if (!open) openMenu(match);
    }
  };

  return (
    <div
      className={webClasses(`select ${className ?? ""}`)}
      data-ui-select
      data-select-value={value}
      data-disabled={disabled || undefined}
      title={title}
    >
      <button
        ref={trigger}
        id={triggerId}
        className={webClasses("trigger")}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            else move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            if (!open) openMenu(event.key === "Home" ? 0 : options.length - 1, event.key === "Home" ? 1 : -1);
            else
              setActiveIndex(
                firstEnabledIndex(visibleOptions, event.key === "Home" ? 0 : visibleOptions.length - 1, event.key === "Home" ? 1 : -1),
              );
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) commit(activeIndex);
            else openMenu();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu();
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            handleTypeahead(event.key);
          }
        }}
      >
        <span className={webClasses(`value ${selectedOption ? "" : "is-placeholder"}`)}>
          {selectedOption?.label ?? placeholder ?? value}
        </span>
        <ChevronDown className={webClasses("chevron")} size={12} />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menu}
              className={webClasses(`menu ${position.openAbove ? "open-above" : ""}`)}
              style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
            >
              {searchable ? (
                <label className={webClasses("search")}>
                  <Search size={12} aria-hidden="true" />
                  <input
                    ref={searchInput}
                    value={query}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    aria-controls={listId}
                    aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
                    onChange={(event) => updateSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        move(event.key === "ArrowDown" ? 1 : -1);
                      } else if (event.key === "Home" || event.key === "End") {
                        event.preventDefault();
                        setActiveIndex(
                          firstEnabledIndex(
                            visibleOptions,
                            event.key === "Home" ? 0 : visibleOptions.length - 1,
                            event.key === "Home" ? 1 : -1,
                          ),
                        );
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        commit(activeIndex);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        closeMenu(true);
                      }
                    }}
                  />
                </label>
              ) : null}
              <div
                id={listId}
                className={webClasses("options")}
                role="listbox"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabel ? undefined : triggerId}
              >
                {visibleOptions.map((option, index) => (
                  <button
                    id={`${listId}-${index}`}
                    className={webClasses("option")}
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    data-select-value={option.value}
                    data-active={index === activeIndex || undefined}
                    disabled={option.disabled}
                    title={option.title}
                    onPointerEnter={() => {
                      if (!option.disabled) setActiveIndex(index);
                    }}
                    onClick={() => commit(index)}
                  >
                    <Check className={webClasses("check")} size={11} aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                ))}
                {visibleOptions.length === 0 ? <div className={webClasses("empty")}>{emptyLabel}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function filterOptions<Value extends string>(
  options: readonly SelectControlOption<Value>[],
  query: string,
  showAllOnEmpty: boolean,
): readonly SelectControlOption<Value>[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return showAllOnEmpty ? options : [];
  return options.filter((option) => {
    const searchable = `${option.label}\n${option.value}`.toLocaleLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
}

function firstEnabledIndex<Value extends string>(
  options: readonly SelectControlOption<Value>[],
  preferred: number,
  direction: 1 | -1 = 1,
): number {
  if (options.length === 0) return -1;
  const start = Math.max(0, Math.min(preferred < 0 ? 0 : preferred, options.length - 1));
  for (let step = 0; step < options.length; step += 1) {
    const index = (start + step * direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function nextEnabledIndex<Value extends string>(
  options: readonly SelectControlOption<Value>[],
  current: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;
  const start = current < 0 ? (direction === 1 ? -1 : 0) : current;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (start + step * direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return current;
}
