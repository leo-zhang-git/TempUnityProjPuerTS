import { createReadStream } from "node:fs";
import type { ServerResponse } from "node:http";
import type { UiApiFailure } from "../../schema/ui-api.js";
import { ApiHttpError } from "./errors.js";

export interface ApiFileResponse {
  readonly kind: "file";
  readonly path: string;
  readonly size: number;
  readonly contentType: string;
  readonly cacheControl: string;
  readonly downloadName?: string;
}

export interface ApiJsonResponse {
  readonly kind: "json";
  readonly body: unknown;
}

export type ApiResponse = ApiFileResponse | ApiJsonResponse;

export function jsonResponse(body: unknown): ApiJsonResponse {
  return { kind: "json", body };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

export function sendApiResponse(response: ServerResponse, result: ApiResponse): void {
  if (result.kind === "json") {
    sendJson(response, 200, result.body);
    return;
  }
  response.writeHead(200, {
    "content-type": result.contentType,
    "content-length": result.size,
    "cache-control": result.cacheControl,
    ...(result.downloadName ? { "content-disposition": `attachment; filename="${result.downloadName.replaceAll('"', "")}"` } : {}),
  });
  createReadStream(result.path).pipe(response);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export function sendApiError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiHttpError) {
    sendJson(response, error.status, error.body);
    return;
  }
  if (isMissingFile(error)) {
    const body: UiApiFailure = { error: "API resource not found" };
    sendJson(response, 404, body);
    return;
  }
  sendJson(response, 500, { error: "Internal server error" } satisfies UiApiFailure);
}
