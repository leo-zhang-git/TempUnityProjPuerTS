import type { AuthoringAssetKind } from "./asset-catalog.js";

export interface UiAssetMoveDocumentChange {
  readonly documentKind: "artifact" | "reference";
  readonly documentKey: string;
  readonly path: string;
  readonly references: readonly {
    readonly fieldPath: string;
    readonly nodeId?: string;
  }[];
}

export interface UiAssetMoveReport {
  readonly kind: AuthoringAssetKind;
  readonly from: string;
  readonly to: string;
  readonly written: boolean;
  readonly transport: "preview" | "svn" | "filesystem";
  readonly guid: string;
  readonly moves: readonly { readonly from: string; readonly to: string }[];
  readonly documents: readonly UiAssetMoveDocumentChange[];
  readonly gates: {
    readonly sourceCatalog: "passed";
    readonly references: "passed";
    readonly prototypes: "passed";
    readonly resources: "passed";
  };
}

export type UiAssetOperation =
  | { readonly action: "move"; readonly from: string; readonly to: string }
  | { readonly action: "copy"; readonly from: string; readonly to: string }
  | { readonly action: "delete"; readonly path: string };

export interface UiAssetOperationResult {
  readonly action: UiAssetOperation["action"];
  readonly from: string;
  readonly to?: string;
  readonly written: true;
  readonly transport: "svn" | "filesystem";
  readonly guid: string;
}
