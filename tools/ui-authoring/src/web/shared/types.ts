import type { UiPrototype, UiReference } from "../../schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiSource } from "../../schema/ui-source-schema.js";
import type { CatalogArtifact, CatalogPrototype, CatalogReference } from "./api/client.js";

export interface ArtifactDocument extends CatalogArtifact {
  readonly revision?: string;
  readonly source: UiSource;
  readonly resolvedSource: UiConcreteSource;
}

export interface ReferenceDocument extends CatalogReference {
  readonly revision?: string;
  readonly reference: UiReference;
}

export interface PrototypeDocument extends CatalogPrototype {
  readonly revision?: string;
  readonly prototype: UiPrototype;
}
