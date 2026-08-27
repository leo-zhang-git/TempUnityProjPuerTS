import type { AuthoringAssetKind } from "../../../../schema/asset-catalog.js";
import type { UiNode, UiSource } from "../../../../schema/ui-source-schema.js";

export type ComponentValue = Record<string, unknown>;
export type InspectorUpdateMode = "commit" | "local" | "transient";
export type InspectorMutation = (updater: (node: UiNode) => UiNode, mode?: InspectorUpdateMode) => boolean | void;
export type InspectorArtifactSizeMutation = (size: readonly [number, number], mode?: InspectorUpdateMode) => boolean | void;
export type InspectorArtifactMetadataMutation = (field: "displayName" | "description", value: string) => boolean | void;
export type InspectorArtifactMetadata = Pick<UiSource, "displayName" | "description">;
export type FieldCommit = (value: unknown, mode?: InspectorUpdateMode) => boolean | void;
export type InspectorOverrideState = "inherited" | "overridden" | "added" | "conflict";

export interface InspectorContinuousEdit {
  readonly begin: () => void;
  readonly commit: () => void;
  readonly cancel: () => void;
}

export interface AssetPickerRequest {
  readonly kind: AuthoringAssetKind;
  readonly title: string;
  readonly selectedPath?: string | undefined;
  readonly onChoose: (path: string) => void;
}
