import type { UnitySpriteMetrics } from "../../../kernel/image-intrinsic.js";
import type { TmpFontMetrics } from "../../../kernel/tmp-text.js";
import type { AuthoringAssetEntry, AuthoringAssetKind } from "../../../schema/asset-catalog.js";
import { uiApiRoutes } from "../../../schema/ui-api.js";
import type { UiAssetOperation, UiAssetOperationResult } from "../../../schema/ui-asset-move.js";
import { apiRequest } from "./transport.js";

const assetRequests = new Map<string, Promise<readonly AuthoringAssetEntry[]>>();
const assetRefreshListeners = new Set<() => void>();

export function subscribeAssetsRefresh(listener: () => void): () => void {
	assetRefreshListeners.add(listener);
	return () => assetRefreshListeners.delete(listener);
}

export async function loadFontSource(path: string): Promise<string | null> {
  return (await apiRequest("font.source", { query: { path } })).sourcePath;
}

export async function loadFontMetrics(path: string): Promise<TmpFontMetrics> {
  return (await apiRequest("font.metrics", { query: { path } })).metrics;
}

export async function loadImageMetrics(path: string): Promise<UnitySpriteMetrics> {
  return (await apiRequest("image.metrics", { query: { path } })).metrics;
}

export async function loadAssets(kind?: AuthoringAssetKind): Promise<readonly AuthoringAssetEntry[]> {
  const query = kind === undefined ? {} : { kind };
  const key = kind ?? "all";
  let request = assetRequests.get(key);
  if (!request) {
    request = apiRequest("assets", { query })
      .then((response) => response.assets)
      .catch((reason: unknown) => {
        assetRequests.delete(key);
        throw reason;
      });
    assetRequests.set(key, request);
  }
  return request;
}

export async function refreshAssets(): Promise<void> {
	await apiRequest("assets.refresh");
	assetRequests.clear();
	for (const listener of [...assetRefreshListeners]) listener();
}

export async function applyAssetOperation(operation: UiAssetOperation): Promise<UiAssetOperationResult> {
  return apiRequest("assets.operation", { body: operation });
}

export function assetUrl(path: string): string {
  return `${uiApiRoutes.asset.path}?path=${encodeURIComponent(path)}`;
}

export function referenceAssetUrl(path: string): string {
  return `${uiApiRoutes["reference.asset"].path}?path=${encodeURIComponent(path)}`;
}
