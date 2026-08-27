import type { UiApiRoute, UiApiRouteDefinition } from "./contract.js";

export const searchApiRoutes = {
  "workspace.semanticSearch": { method: "POST", path: "/api/workspace/semantic-search", responseKind: "json" },
} as const satisfies Readonly<Record<string, UiApiRouteDefinition>>;

export interface UiSemanticSearchCandidate {
  readonly id: string;
  readonly texts: readonly string[];
}

export interface UiSemanticSearchRequest {
  readonly query: string;
  readonly candidates: readonly UiSemanticSearchCandidate[];
}

export interface UiSemanticSearchMatch {
  readonly id: string;
  readonly score: number;
}

export interface UiSemanticSearchResult {
  readonly status: "ready" | "unavailable";
  readonly matches: readonly UiSemanticSearchMatch[];
}

export interface SearchApiContract {
  readonly "workspace.semanticSearch": UiApiRoute<"POST", undefined, UiSemanticSearchRequest, UiSemanticSearchResult>;
}
