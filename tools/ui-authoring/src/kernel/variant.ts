import type { UiSource, UiVariantSource } from "../schema/ui-source-schema.js";
import { assertValidSource } from "./validation.js";

export interface ArtifactVariantIdentity {
  readonly artifactKey: string;
}

export function createArtifactVariant(base: UiSource, identity: ArtifactVariantIdentity): UiVariantSource {
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: identity.artifactKey,
    artifactType: base.artifactType,
    variantOf: base.artifactKey,
    overrides: [],
  };
  assertValidSource(variant);
  return variant;
}
