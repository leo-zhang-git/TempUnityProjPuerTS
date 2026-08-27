import { useEffect, useState } from "react";
import { createWebClasses } from "../../../styles/web-styles.js";
import artifactStyles from "../artifact-editor-shell.module.css";

const webClasses = createWebClasses(artifactStyles);

export function BinderWidgetIdentity({
  local,
  effective,
  error,
  onChange,
}: {
  readonly local: string;
  readonly effective: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => boolean;
}) {
  const [value, setValue] = useState(local);
  useEffect(() => setValue(local), [local]);
  const commit = (): void => {
    if (value === local) return;
    if (!onChange(value)) setValue(local);
  };
  return (
    <label className={webClasses(`binder-widget-identity ${error ? "is-invalid" : ""}`)} title={error}>
      <span>Widget Type</span>
      <input
        value={value}
        placeholder={effective}
        aria-label="本地 Widget Type"
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setValue(local);
            event.currentTarget.blur();
          }
        }}
      />
      <small>{local ? "本地" : `继承：${effective}`}</small>
    </label>
  );
}
