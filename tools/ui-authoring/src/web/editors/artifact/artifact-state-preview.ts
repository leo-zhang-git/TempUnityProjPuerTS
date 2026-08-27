import type { StateRootPreviewOverrides } from "../../../kernel/preview-values.js";
import { findNode } from "../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../schema/ui-source-schema.js";

export type ArtifactStateOverrides = StateRootPreviewOverrides;

export function reconcileArtifactStateOverrides(source: UiConcreteSource, overrides: ArtifactStateOverrides): ArtifactStateOverrides {
  const entries = Object.entries(overrides).filter(([nodeId, stateName]) => {
    const stateRoot = findNode(source, nodeId)?.components?.StateRoot;
    return stateRoot?.currentState === stateName && stateName in stateRoot.states;
  });
  if (entries.length === Object.keys(overrides).length) return overrides;
  return Object.fromEntries(entries);
}
