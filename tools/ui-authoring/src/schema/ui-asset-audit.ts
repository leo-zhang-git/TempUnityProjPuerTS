import type { UiAssetReference } from "../kernel/asset-references.js";
import type { AuthoringAssetCatalogIssue, AuthoringAssetEntry } from "./asset-catalog.js";

export interface UiAssetAuditReport {
  readonly root: "Assets/Resources/UI";
  readonly summary: {
    readonly cataloged: number;
    readonly referencedAssets: number;
    readonly persistedReferences: number;
    readonly prototypeSessionReferences: number;
    readonly unused: number;
    readonly inventoryIssues: number;
  };
  readonly assets: readonly AuthoringAssetEntry[];
  readonly references: readonly UiAssetReference[];
  readonly prototypeSessions: readonly UiAssetReference[];
  readonly unused: readonly AuthoringAssetEntry[];
  readonly issues: readonly AuthoringAssetCatalogIssue[];
}
