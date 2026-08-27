import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import { defaultReferencePathForArtifact } from "../../../kernel/preview-reference.js";
import type { CaptureRequest } from "../../../schema/ui-capture.js";
import type { PreviewReferenceOwnerScope, UiReference } from "../../../schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../../schema/ui-source-schema.js";
import type { ArtifactDocument, ReferenceDocument } from "../../shared/types.js";
import type { PreviewEditorMode } from "../shared/preview-editor-mode.js";

export function defaultPreviewDocument(
  references: ReadonlyMap<string, ReferenceDocument>,
  artifact: ArtifactDocument,
): ReferenceDocument | undefined {
  const expectedPath = defaultReferencePathForArtifact(artifact.path).replaceAll("\\", "/").toLocaleLowerCase("en-US");
  return [...references.values()].find(
    (document) =>
      document.referenceKey === artifact.artifactKey &&
      document.subjectArtifactKey === artifact.artifactKey &&
      document.path.replaceAll("\\", "/").toLocaleLowerCase("en-US") === expectedPath,
  );
}

function ownerBelongsToSubject(owner: PreviewReferenceOwnerScope | undefined, subjectMountKeys: ReadonlySet<string>): boolean {
  if (!owner || owner.kind === "subject") return true;
  if (owner.kind === "context") return false;
  if (owner.kind === "artifact") return owner.root === "subject";
  return subjectMountKeys.has(owner.mountKey);
}

export function subjectOnlyPreviewReference(reference: UiReference): UiReference {
  const subjectMountKeys = new Set<string>();
  for (let pass = 0; pass < (reference.mounts?.length ?? 0); pass += 1) {
    let changed = false;
    for (const mount of reference.mounts ?? []) {
      if (subjectMountKeys.has(mount.key) || !ownerBelongsToSubject(mount.owner, subjectMountKeys)) continue;
      subjectMountKeys.add(mount.key);
      changed = true;
    }
    if (!changed) break;
  }

  const result = { ...reference };
  delete result.context;
  delete result.viewport;
  delete result.backdrop;
  if (reference.instanceValues)
    result.instanceValues = reference.instanceValues.filter((entry) => ownerBelongsToSubject(entry.owner, subjectMountKeys));
  if (reference.collections)
    result.collections = reference.collections.filter((entry) => ownerBelongsToSubject(entry.owner, subjectMountKeys));
  if (reference.mounts) result.mounts = reference.mounts.filter((entry) => subjectMountKeys.has(entry.key));
  return result;
}

export function defaultPreviewCaptureTarget(
  displayMode: PreviewEditorMode,
  selected: boolean,
  source: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  defaultPreview: ReferenceDocument | undefined,
  viewport: readonly [number, number],
): Pick<CaptureRequest, "path" | "viewport" | "reference"> | undefined {
  if (displayMode === "unityBaseline" || selected || source.artifactType === "Fragment" || !defaultPreview) return undefined;
  const root = artifacts.get(
    defaultPreview.reference.context?.parentArtifactKey ?? defaultPreview.reference.subjectArtifactKey,
  )?.resolvedSource;
  return {
    path: defaultPreview.path,
    viewport:
      source.artifactType === "Canvas" ? viewport : (defaultPreview.reference.viewport ?? (root ? artifactInitialSize(root) : viewport)),
    reference: defaultPreview.reference,
  };
}
