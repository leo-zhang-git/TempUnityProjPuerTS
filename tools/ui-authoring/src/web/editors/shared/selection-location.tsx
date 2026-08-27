import { Box } from "lucide-react";
import { type SelectionAddress } from "../../rendering/selection.js";
import { createWebClasses } from "../../styles/web-styles.js";
import sharedStyles from "./editor-shell.module.css";

const webClasses = createWebClasses(sharedStyles);

export function ReferenceSelectionLocation({
  selection,
  nodePathLabels,
  visible = true,
  onOpenArtifact,
  onHover,
}: {
  readonly selection: SelectionAddress;
  readonly nodePathLabels: readonly string[];
  readonly visible?: boolean;
  readonly onOpenArtifact: (artifactKey: string, nodeId?: string) => void;
  readonly onHover: (address: SelectionAddress | undefined) => void;
}) {
  const path = [
    { id: selection.rootArtifactKey, label: selection.rootArtifactKey },
    ...selection.instancePath.map((id, index) => ({ id, label: nodePathLabels[index] ?? id })),
    ...(selection.ownerArtifactKey === selection.rootArtifactKey
      ? []
      : [{ id: selection.ownerArtifactKey, label: selection.ownerArtifactKey }]),
    { id: selection.nodeId, label: nodePathLabels[selection.instancePath.length] ?? selection.nodeId },
  ];
  return (
    <section
      className={webClasses("reference-selection-location")}
      onPointerEnter={() => onHover(selection)}
      onPointerLeave={() => onHover(undefined)}
    >
      <span className={webClasses("reference-selection-label")}>已选节点</span>
      <div
        className={webClasses("reference-selection-breadcrumb")}
        title={path.map((entry) => (entry.label === entry.id ? entry.id : `${entry.label} (${entry.id})`)).join(" / ")}
      >
        {path.map((entry, index) => (
          <span key={`${entry.id}:${index}`}>{entry.label}</span>
        ))}
      </div>
      {!visible ? (
        <div className={webClasses("reference-selection-meta")}>
          <em>当前预览不可见</em>
        </div>
      ) : null}
      <button
        className={webClasses("owner-link")}
        type="button"
        onClick={() => onOpenArtifact(selection.ownerArtifactKey, selection.nodeId)}
      >
        <Box size={14} />
        打开源 Artifact
      </button>
    </section>
  );
}
