import type { ResolvedPreviewReference } from "../../../kernel/preview-reference-resolver.js";
import type { SelectionAddress } from "../../rendering/selection.js";
import type { ArtifactDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { EditorHierarchyTree } from "./editor-hierarchy.js";
import sharedStyles from "./editor-shell.module.css";

const webClasses = createWebClasses(sharedStyles);

export function ResolvedPreviewHierarchy({
  resolved,
  artifacts,
  selection,
  hoveredAddress,
  query,
  frameShortcutEnabled = true,
  onClearQuery,
  onSelect,
  onHover,
  onOpenArtifact,
}: {
  readonly resolved: ResolvedPreviewReference | undefined;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly selection: SelectionAddress;
  readonly hoveredAddress?: SelectionAddress | undefined;
  readonly query: string;
  readonly frameShortcutEnabled?: boolean | undefined;
  readonly onClearQuery: () => void;
  readonly onSelect: (address: SelectionAddress) => void;
  readonly onHover: (address: SelectionAddress | undefined) => void;
  readonly onOpenArtifact: (artifactKey: string) => void;
}) {
  if (!resolved?.tree) return <p className={webClasses("empty-value")}>预览 Hierarchy 不可用</p>;
  return (
    <EditorHierarchyTree
      source={resolved.tree.source}
      artifacts={artifacts}
      selectedAddresses={[selection]}
      primaryAddress={selection}
      hoveredAddress={hoveredAddress}
      resolvedSourceInstance={resolved.tree}
      previewRootArtifactKey={resolved.tree.artifactKey}
      query={query.trim().toLocaleLowerCase("en-US")}
      frameShortcutEnabled={frameShortcutEnabled}
      onClearQuery={onClearQuery}
      authoringEnabled={false}
      structureEditable={false}
      onSelect={onSelect}
      onHover={onHover}
      onOpenArtifact={onOpenArtifact}
    />
  );
}
