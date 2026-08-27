import { Value } from "@sinclair/typebox/value";
import type { UiApiJsonRouteKey, UiApiSuccess, UiSemanticSearchRequest } from "../../../schema/ui-api.js";
import type { SemanticSearchApiService } from "../../semantic-search-service.js";
import { uiApiMutableBodySchemas } from "../body-schemas.js";
import { badRequest } from "../errors.js";
import type { ApiJsonResponse } from "../http.js";
import type { ApiHandlerGroup } from "./types.js";

interface SearchHandlerContext {
  readonly semanticSearchService: SemanticSearchApiService;
  readonly success: <K extends UiApiJsonRouteKey>(key: K, body: UiApiSuccess<K>) => ApiJsonResponse;
}

export function createSearchHandlers(context: SearchHandlerContext): ApiHandlerGroup<"workspace.semanticSearch"> {
  return {
    "workspace.semanticSearch": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["workspace.semanticSearch"], request.body))
        throw badRequest("Semantic search request does not match the API contract");
      const body = request.body as UiSemanticSearchRequest;
      return context.success("workspace.semanticSearch", await context.semanticSearchService.search(body));
    },
  };
}
