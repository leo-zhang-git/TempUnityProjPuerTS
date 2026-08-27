import type { UnitySpriteMetrics } from "../../kernel/image-intrinsic.js";
import type { TmpFontMetrics } from "../../kernel/tmp-text.js";
import type { AuthoringAssetEntry, AuthoringAssetKind } from "../asset-catalog.js";
import type { UiAssetOperation, UiAssetOperationResult } from "../ui-asset-move.js";
import type { UiApiRoute, UiApiRouteDefinition } from "./contract.js";

export const assetApiRoutes = {
  "font.source": { method: "GET", path: "/api/font-source", responseKind: "json" },
  "font.metrics": { method: "GET", path: "/api/font-metrics", responseKind: "json" },
  "image.metrics": { method: "GET", path: "/api/image-metrics", responseKind: "json" },
  assets: { method: "GET", path: "/api/assets", responseKind: "json" },
  "assets.refresh": { method: "POST", path: "/api/assets/refresh", responseKind: "json" },
  "assets.operation": { method: "POST", path: "/api/assets/operation", responseKind: "json" },
  asset: { method: "GET", path: "/api/asset", responseKind: "file" },
  "reference.asset": { method: "GET", path: "/api/reference-asset", responseKind: "file" },
} as const satisfies Readonly<Record<string, UiApiRouteDefinition>>;

export interface AssetApiContract {
  readonly "font.source": UiApiRoute<
    "GET",
    { readonly path: string },
    undefined,
    { readonly path: string; readonly sourcePath: string | null }
  >;
  readonly "font.metrics": UiApiRoute<
    "GET",
    { readonly path: string },
    undefined,
    { readonly path: string; readonly metrics: TmpFontMetrics }
  >;
  readonly "image.metrics": UiApiRoute<
    "GET",
    { readonly path: string },
    undefined,
    { readonly path: string; readonly metrics: UnitySpriteMetrics }
  >;
  readonly assets: UiApiRoute<
    "GET",
    { readonly kind?: AuthoringAssetKind },
    undefined,
    { readonly assets: readonly AuthoringAssetEntry[] }
  >;
  readonly "assets.refresh": UiApiRoute<"POST", undefined, undefined, { readonly refreshed: true }>;
  readonly "assets.operation": UiApiRoute<"POST", undefined, UiAssetOperation, UiAssetOperationResult>;
  readonly asset: UiApiRoute<"GET", { readonly path: string }, undefined, ArrayBuffer>;
  readonly "reference.asset": UiApiRoute<"GET", { readonly path: string }, undefined, ArrayBuffer>;
}
