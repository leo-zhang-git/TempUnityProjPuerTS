import type { UiApiRouteKey } from "../../../schema/ui-api.js";
import type { ApiResponse } from "../http.js";
import type { RoutedApiRequest } from "../router.js";

export type ApiRouteHandler<K extends UiApiRouteKey = UiApiRouteKey> = (request: RoutedApiRequest<K>) => Promise<ApiResponse>;
export type ApiRouteHandlers = { readonly [K in UiApiRouteKey]: ApiRouteHandler<K> };
export type ApiHandlerGroup<K extends UiApiRouteKey> = { readonly [P in K]: ApiRouteHandler<P> };
