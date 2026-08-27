import { ContextMenu, type ContextMenuItem } from "../../shared/context-menu.js";

export interface ArtifactContextMenuItem extends ContextMenuItem {
  readonly title?: string | undefined;
}

export function ArtifactContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ArtifactContextMenuItem[];
  readonly onClose: () => void;
}) {
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
