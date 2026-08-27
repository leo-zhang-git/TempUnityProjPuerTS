import { type AssetApiContract, assetApiRoutes } from "./assets-api.js";
import { type DeliveryApiContract, deliveryApiRoutes } from "./delivery-api.js";
import { type DiagnosticsApiContract, diagnosticsApiRoutes } from "./diagnostics-api.js";
import { type DocumentApiContract, documentApiRoutes } from "./documents-api.js";
import { type SearchApiContract, searchApiRoutes } from "./search-api.js";
import { type WorkspaceApiContract, workspaceApiRoutes } from "./workspace-api.js";

export const uiApiRoutes = {
  ...workspaceApiRoutes,
  ...documentApiRoutes,
  ...searchApiRoutes,
  ...deliveryApiRoutes,
  ...assetApiRoutes,
  ...diagnosticsApiRoutes,
} as const;

export type UiApiRouteKey = keyof typeof uiApiRoutes;
export type UiApiJsonRouteKey = {
  [K in UiApiRouteKey]: (typeof uiApiRoutes)[K]["responseKind"] extends "json" ? K : never;
}[UiApiRouteKey];

type UiApiContract = WorkspaceApiContract &
  DocumentApiContract &
  SearchApiContract &
  DeliveryApiContract &
  AssetApiContract &
  DiagnosticsApiContract;

export type UiApiQuery<K extends UiApiRouteKey> = UiApiContract[K]["query"];
export type UiApiBody<K extends UiApiRouteKey> = UiApiContract[K]["body"];
export type UiApiSuccess<K extends UiApiRouteKey> = UiApiContract[K]["success"];
