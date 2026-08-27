import { Box, Copy, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import type { SelectionAddress } from "../../../rendering/selection.js";
import { resolveGameObjectPath } from "../../../shared/game-object-label.js";
import type { ArtifactDocument } from "../../../shared/types.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import artifactStyles from "../artifact-editor-shell.module.css";

const webClasses = createWebClasses(artifactStyles);

export function selectionLocationPathLabels(
  source: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  address: SelectionAddress,
): readonly string[] {
  const rootSource = address.rootArtifactKey === source.artifactKey ? source : artifacts.get(address.rootArtifactKey)?.resolvedSource;
  return rootSource
    ? resolveGameObjectPath(rootSource, artifacts, address.instancePath, address.nodeId).labels
    : [...address.instancePath, address.nodeId];
}

export function SelectionLocation({
  address,
  pathLabels,
  localArtifactKey,
  variant = false,
  baseArtifact,
  visible = true,
  onOpenOwner,
  onCopyOwner,
  onHover,
  overrideControl,
}: {
  readonly address: SelectionAddress;
  readonly pathLabels: readonly string[];
  readonly localArtifactKey: string;
  readonly variant?: boolean;
  readonly baseArtifact?: { readonly artifactKey: string; readonly rootNodeId: string };
  readonly visible?: boolean;
  readonly onOpenOwner: (artifactKey: string, nodeId?: string) => void;
  readonly onCopyOwner: (artifactKey: string) => void;
  readonly onHover: (address: SelectionAddress | undefined) => void;
  readonly overrideControl?: ReactNode;
}) {
  const path = [...address.instancePath, address.nodeId];
  const diagnosticPath = path
    .map((entry, index) => {
      const label = pathLabels[index] ?? entry;
      return label === entry ? entry : `${label} (${entry})`;
    })
    .join(" / ");
  const referenced = address.ownerArtifactKey !== localArtifactKey || address.instancePath.length > 0;
  const ownershipLabel = referenced ? (variant ? "引用 · Binder 可扩展" : "引用 · 可覆写") : variant ? "继承" : "本地";
  return (
    <section
      className={webClasses("selection-location")}
      data-ui="selection-location"
      onPointerEnter={() => onHover(address)}
      onPointerLeave={() => onHover(undefined)}
    >
      <div className={webClasses("selection-location-main")}>
        <div className={webClasses("selection-widget-owner")} title={`Widget 所属 Artifact：${address.ownerArtifactKey}`}>
          <strong>{address.ownerArtifactKey}</strong>
          <button
            type="button"
            onClick={() => onCopyOwner(address.ownerArtifactKey)}
            title="复制 Widget 名称"
            aria-label="复制 Widget 名称"
          >
            <Copy size={11} />
          </button>
        </div>
        <div className={webClasses("selection-breadcrumb")} title={diagnosticPath}>
          {path.map((entry, index) => (
            <span key={`${entry}:${index}`}>{pathLabels[index] ?? entry}</span>
          ))}
        </div>
      </div>
      <div className={webClasses("selection-location-ownership")}>
        <span className={webClasses(`selection-owner ${referenced || variant ? "is-referenced" : ""}`)}>{ownershipLabel}</span>
        {overrideControl}
      </div>
      {!visible ? <em>当前预览不可见</em> : null}
      {referenced ? (
        <button
          className={webClasses("owner-link")}
          type="button"
          onClick={() => onOpenOwner(address.ownerArtifactKey, address.nodeId)}
          title="打开源 Widget"
        >
          <Box size={12} />源 Widget
        </button>
      ) : null}
      {baseArtifact ? (
        <button
          className={webClasses("owner-link")}
          type="button"
          onClick={() => onOpenOwner(baseArtifact.artifactKey, baseArtifact.rootNodeId)}
          title={`打开基础 Artifact ${baseArtifact.artifactKey}`}
        >
          <GitBranch size={12} />
          基础 Artifact
        </button>
      ) : null}
    </section>
  );
}
