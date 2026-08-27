import type { CSSProperties, ReactNode } from "react";
import { createWebClasses } from "../styles/web-styles.js";
import renderingStyles from "./rendering.module.css";

const webClasses = createWebClasses(renderingStyles);

export interface ShapeSoftMaskRenderGroup<T> {
  readonly style: CSSProperties | undefined;
  readonly entries: readonly { readonly entry: T; readonly index: number }[];
}

export function groupShapeSoftMaskEntries<T extends { readonly shapeMaskStyle?: CSSProperties }>(
  entries: readonly T[],
): readonly ShapeSoftMaskRenderGroup<T>[] {
  const groups: { style: CSSProperties | undefined; entries: { entry: T; index: number }[] }[] = [];
  entries.forEach((entry, index) => {
    const style = entry.shapeMaskStyle;
    const current = groups.at(-1);
    if (current && current.style === style) current.entries.push({ entry, index });
    else groups.push({ style, entries: [{ entry, index }] });
  });
  return groups;
}

export function ShapeSoftMaskLayer({
  style,
  zIndex,
  children,
}: {
  readonly style: CSSProperties | undefined;
  readonly zIndex: number;
  readonly children: ReactNode;
}) {
  if (!style) return children;
  return (
    <div className={webClasses("shape-soft-mask-layer")} style={{ zIndex, ...style }}>
      {children}
    </div>
  );
}
