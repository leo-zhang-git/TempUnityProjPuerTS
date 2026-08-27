import type { IncomingMessage } from "node:http";
import { type UiApiRouteKey, uiApiRoutes } from "../../schema/ui-api.js";
import { badRequest, notFound } from "./errors.js";

const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;
const routeByMethodAndPath = new Map<string, UiApiRouteKey>(
  Object.entries(uiApiRoutes).map(([key, route]) => [`${route.method} ${route.path}`, key as UiApiRouteKey]),
);

export interface RoutedApiRequest<K extends UiApiRouteKey = UiApiRouteKey> {
  readonly key: K;
  readonly url: URL;
  readonly body: unknown;
  readonly localPort?: number;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_JSON_BODY_BYTES) throw badRequest("Request body exceeds 5 MB");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw badRequest("Request body must contain JSON");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw badRequest("Request body contains invalid JSON", { cause: error });
  }
}

export async function routeApiRequest(request: IncomingMessage): Promise<RoutedApiRequest | null> {
  if (!request.url) return null;
  let url: URL;
  try {
    url = new URL(request.url, "http://127.0.0.1");
  } catch (error) {
    throw badRequest("Request URL is invalid", { cause: error });
  }
  if (!url.pathname.startsWith("/api/")) return null;

  const key = routeByMethodAndPath.get(`${request.method ?? "GET"} ${url.pathname}`);
  if (!key) throw notFound("API route not found");
  const route = uiApiRoutes[key];
  const body =
    route.method === "POST" || route.method === "PUT" ? (key === "assets.refresh" ? undefined : await readJsonBody(request)) : undefined;
  return { key, url, body, ...(request.socket.localPort === undefined ? {} : { localPort: request.socket.localPort }) };
}
