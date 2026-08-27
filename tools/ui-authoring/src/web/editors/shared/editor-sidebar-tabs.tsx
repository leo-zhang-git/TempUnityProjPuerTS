import type { ReactNode } from "react";

import { createWebClasses } from "../../styles/web-styles.js";
import sharedStyles from "./editor-shell.module.css";

const webClasses = createWebClasses(sharedStyles);

export interface EditorSidebarTab<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon: ReactNode;
  readonly title?: string | undefined;
}

export function EditorSidebarTabs<Value extends string>({
  label,
  tabs,
  value,
  activeValues,
  onChange,
}: {
  readonly label: string;
  readonly tabs: readonly EditorSidebarTab<Value>[];
  readonly value: Value;
  readonly activeValues?: readonly Value[] | undefined;
  readonly onChange: (value: Value, additive: boolean) => void;
}) {
  const countClass = tabs.length === 3 ? "sidebar-tabs-three" : tabs.length === 4 ? "sidebar-tabs-four" : "";
  return (
    <div className={webClasses(`sidebar-tabs ${countClass}`)} role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = activeValues ? activeValues.includes(tab.value) : value === tab.value;
        return (
          <button
            key={tab.value}
            className={webClasses(`${active ? "is-active" : ""} ${value === tab.value ? "is-focused" : ""}`)}
            type="button"
            aria-pressed={active}
            title={tab.title}
            onClick={(event) => onChange(tab.value, event.ctrlKey || event.metaKey)}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
