import { stat } from "node:fs/promises";
import { Value } from "@sinclair/typebox/value";
import type { AuthoringAssetKind } from "../../../schema/asset-catalog.js";
import type { UiApiJsonRouteKey, UiApiSuccess } from "../../../schema/ui-api.js";
import type { UiAssetOperation } from "../../../schema/ui-asset-move.js";
import { type AssetIndex, AssetValidationError } from "../../asset-index.js";
import { operateWorkspaceAsset } from "../../asset-move.js";
import { contentType } from "../../mime.js";
import { referenceAssetRoot, safeChildPath, type WorkspacePaths } from "../../workspace.js";
import type { WorkspaceRepository } from "../../workspace-repository.js";
import { uiApiMutableBodySchemas } from "../body-schemas.js";
import { badRequest, notFound, unprocessable } from "../errors.js";
import type { ApiFileResponse, ApiJsonResponse } from "../http.js";
import type { RoutedApiRequest } from "../router.js";
import type { ApiHandlerGroup } from "./types.js";

type AssetRouteKey =
  | "font.source"
  | "font.metrics"
  | "image.metrics"
  | "assets"
  | "assets.refresh"
  | "assets.operation"
  | "asset"
  | "reference.asset";

interface AssetHandlerContext {
  readonly paths: WorkspacePaths;
  readonly assetIndex: AssetIndex;
  readonly repository: WorkspaceRepository;
  readonly transactionConflict: (error: unknown) => never;
  readonly success: <K extends UiApiJsonRouteKey>(key: K, body: UiApiSuccess<K>) => ApiJsonResponse;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredQuery(request: RoutedApiRequest, name: string): string {
  const value = request.url.searchParams.get(name);
  if (!value) throw badRequest(`Missing ${name} parameter`);
  return value;
}

function optionalQuery(request: RoutedApiRequest, name: string): string | undefined {
  const value = request.url.searchParams.get(name);
  if (value === null) return undefined;
  if (!value) throw badRequest(`${name} parameter must not be empty`);
  return value;
}

function workspacePath(root: string, relativePath: string, label: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw badRequest(`${label} must be a workspace-relative path`);
  }
  try {
    return safeChildPath(root, relativePath);
  } catch (error) {
    throw badRequest(`${label} is invalid`, { cause: error });
  }
}

async function fileResponse(path: string, fileContentType: string, cacheControl: string): Promise<ApiFileResponse> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw notFound("API resource not found");
    return { kind: "file", path, size: info.size, contentType: fileContentType, cacheControl };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") throw notFound("API resource not found", { cause: error });
    throw error;
  }
}

export function createAssetHandlers(context: AssetHandlerContext): ApiHandlerGroup<AssetRouteKey> {
  const { assetIndex, paths, repository } = context;
  return {
    "font.source": async (request) => {
      const path = requiredQuery(request, "path");
      workspacePath(paths.assetRoot, path, "Font asset path");
      return context.success("font.source", { path, sourcePath: await assetIndex.sourceFontPath(path) });
    },
    "font.metrics": async (request) => {
      const path = requiredQuery(request, "path");
      workspacePath(paths.assetRoot, path, "Font asset path");
      return context.success("font.metrics", { path, metrics: await assetIndex.tmpFontMetrics(path) });
    },
    "image.metrics": async (request) => {
      const path = requiredQuery(request, "path");
      workspacePath(paths.assetRoot, path, "Image asset path");
      return context.success("image.metrics", { path, metrics: await assetIndex.spriteMetrics(path) });
    },
    assets: async (request) => {
      const requestedKind = optionalQuery(request, "kind");
      if (
        requestedKind !== undefined &&
        requestedKind !== "image" &&
        requestedKind !== "font" &&
        requestedKind !== "animationClip" &&
        requestedKind !== "animatorController"
      ) {
        throw badRequest(`Unsupported asset kind '${requestedKind}'`);
      }
      return context.success("assets", { assets: await assetIndex.assets(requestedKind as AuthoringAssetKind | undefined) });
    },
    "assets.refresh": async () => {
      await assetIndex.refresh();
      return context.success("assets.refresh", { refreshed: true });
    },
    "assets.operation": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["assets.operation"], request.body))
        throw badRequest("Asset operation body does not match the API contract");
      try {
        const result = await operateWorkspaceAsset(paths, request.body as UiAssetOperation);
        await assetIndex.refresh();
        repository.invalidate();
        return context.success("assets.operation", result);
      } catch (error) {
        if (error instanceof AssetValidationError) throw unprocessable({ error: error.message }, { cause: error });
        const message = errorMessage(error);
        if (/^(?:Asset|UI resource)/.test(message)) throw unprocessable({ error: message }, { cause: error });
        context.transactionConflict(error);
      }
    },
    asset: async (request) => {
      const path = workspacePath(paths.assetRoot, requiredQuery(request, "path"), "Asset path");
      return fileResponse(path, contentType(path), "no-cache");
    },
    "reference.asset": async (request) => {
      const path = workspacePath(referenceAssetRoot(paths), requiredQuery(request, "path"), "Reference asset path");
      return fileResponse(path, contentType(path), "no-cache");
    },
  };
}
