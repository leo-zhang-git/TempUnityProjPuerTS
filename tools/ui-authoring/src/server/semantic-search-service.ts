import { createHash } from "node:crypto";
import type {
  UiSemanticSearchCandidate,
  UiSemanticSearchMatch,
  UiSemanticSearchRequest,
  UiSemanticSearchResult,
} from "../schema/ui-api.js";

const DEFAULT_ENDPOINT = "http://192.168.5.114:7012";
const COLLECTION_MODEL = "qwen3.7-text-embedding";
const COLLECTION_DIMENSIONS = 1024;
const COLLECTION_TTL_SECONDS = 7200;
const COLLECTION_TIMEOUT_MS = 65_000;
const COLLECTION_ITEM_BATCH_LIMIT = 1000;
const SEMANTIC_MIN_SCORE = 0.35;
const SEMANTIC_RESULT_LIMIT = 12;
const RETAINED_COLLECTION_LIMIT = 4;

interface CollectionMatch {
  readonly text: string;
  readonly score: number;
}

interface NormalizedSearchTarget {
  readonly query: string;
  readonly fingerprint: string;
  readonly texts: readonly string[];
  readonly idsByText: ReadonlyMap<string, readonly string[]>;
}

class EmbeddingCacheHttpError extends Error {
  constructor(readonly status: number) {
    super(`Embedding cache returned HTTP ${status}`);
    this.name = "EmbeddingCacheHttpError";
  }
}

export interface SemanticSearchApiService {
  search(request: UiSemanticSearchRequest): Promise<UiSemanticSearchResult>;
}

interface EmbeddingCacheSemanticSearchOptions {
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCandidates(candidates: readonly UiSemanticSearchCandidate[]): readonly UiSemanticSearchCandidate[] {
  const textsById = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const id = candidate.id.trim();
    if (!id) continue;
    const texts = textsById.get(id) ?? new Set<string>();
    for (const value of candidate.texts) {
      const text = value.trim();
      if (text) texts.add(text);
    }
    if (texts.size > 0) textsById.set(id, texts);
  }
  return [...textsById]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, texts]) => ({ id, texts: [...texts].sort((left, right) => left.localeCompare(right)) }));
}

function searchTarget(request: UiSemanticSearchRequest): NormalizedSearchTarget | undefined {
  const query = request.query.trim();
  const candidates = normalizeCandidates(request.candidates);
  if (!query || candidates.length === 0) return undefined;
  const idsByText = new Map<string, string[]>();
  for (const candidate of candidates) {
    for (const text of candidate.texts) {
      const ids = idsByText.get(text) ?? [];
      ids.push(candidate.id);
      idsByText.set(text, ids);
    }
  }
  const texts = [...idsByText.keys()].sort((left, right) => left.localeCompare(right));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ model: COLLECTION_MODEL, dimensions: COLLECTION_DIMENSIONS, candidates }))
    .digest("hex");
  return { query, fingerprint, texts, idsByText };
}

export class EmbeddingCacheSemanticSearchService implements SemanticSearchApiService {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly collectionTokens = new Map<string, string>();
  private readonly collectionBuilds = new Map<string, Promise<string>>();

  constructor(options: EmbeddingCacheSemanticSearchOptions = {}) {
    this.endpoint = (options.endpoint ?? process.env.UI_AUTHORING_EMBEDDING_CACHE_URL ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async search(request: UiSemanticSearchRequest): Promise<UiSemanticSearchResult> {
    const target = searchTarget(request);
    if (!target) return { status: "ready", matches: [] };
    try {
      const matches = await this.query(target, true);
      return { status: "ready", matches: aggregateMatches(matches, target.idsByText) };
    } catch {
      return { status: "unavailable", matches: [] };
    }
  }

  private async query(target: NormalizedSearchTarget, rebuildExpired: boolean): Promise<readonly CollectionMatch[]> {
    const token = await this.collectionToken(target);
    try {
      return await this.queryCollection(token, target.query);
    } catch (error) {
      if (rebuildExpired && error instanceof EmbeddingCacheHttpError && (error.status === 404 || error.status === 410)) {
        this.invalidateCollection(target.fingerprint, token);
        return this.query(target, false);
      }
      throw error;
    }
  }

  private async collectionToken(target: NormalizedSearchTarget): Promise<string> {
    const existing = this.collectionTokens.get(target.fingerprint);
    if (existing) {
      this.collectionTokens.delete(target.fingerprint);
      this.collectionTokens.set(target.fingerprint, existing);
      return existing;
    }
    const activeBuild = this.collectionBuilds.get(target.fingerprint);
    if (activeBuild) return activeBuild;
    const build = this.createCollection(target.texts)
      .then((token) => {
        this.collectionTokens.set(target.fingerprint, token);
        while (this.collectionTokens.size > RETAINED_COLLECTION_LIMIT) {
          const oldest = this.collectionTokens.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          this.collectionTokens.delete(oldest);
        }
        return token;
      })
      .finally(() => this.collectionBuilds.delete(target.fingerprint));
    this.collectionBuilds.set(target.fingerprint, build);
    return build;
  }

  private invalidateCollection(fingerprint: string, token: string): void {
    if (this.collectionTokens.get(fingerprint) === token) this.collectionTokens.delete(fingerprint);
  }

  private async createCollection(texts: readonly string[]): Promise<string> {
    const initial = texts.slice(0, COLLECTION_ITEM_BATCH_LIMIT);
    const payload = await this.postJson("/collections", {
      consumer: "ui-authoring-project-search",
      model: COLLECTION_MODEL,
      dimensions: COLLECTION_DIMENSIONS,
      ttl_seconds: COLLECTION_TTL_SECONDS,
      items: initial,
    });
    if (!isRecord(payload) || typeof payload.token !== "string" || !payload.token) throw new Error("Invalid collection response");
    const token = payload.token;
    for (let start = initial.length; start < texts.length; start += COLLECTION_ITEM_BATCH_LIMIT) {
      await this.postJson("/collections/items", { token, items: texts.slice(start, start + COLLECTION_ITEM_BATCH_LIMIT) });
    }
    return token;
  }

  private async queryCollection(token: string, query: string): Promise<readonly CollectionMatch[]> {
    const payload = await this.postJson("/collections/query", {
      token,
      queries: [query],
      limit: SEMANTIC_RESULT_LIMIT,
      threshold: SEMANTIC_MIN_SCORE,
    });
    if (!isRecord(payload) || !Array.isArray(payload.items)) throw new Error("Invalid collection query response");
    return payload.items.map((item) => {
      if (!isRecord(item) || typeof item.text !== "string" || typeof item.score !== "number" || !Number.isFinite(item.score))
        throw new Error("Invalid collection match");
      return { text: item.text, score: item.score };
    });
  }

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTION_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.endpoint}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new EmbeddingCacheHttpError(response.status);
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function aggregateMatches(
  matches: readonly CollectionMatch[],
  idsByText: ReadonlyMap<string, readonly string[]>,
): readonly UiSemanticSearchMatch[] {
  const scores = new Map<string, number>();
  for (const match of matches) {
    for (const id of idsByText.get(match.text) ?? []) scores.set(id, Math.max(scores.get(id) ?? -1, match.score));
  }
  return [...scores]
    .sort(([leftId, leftScore], [rightId, rightScore]) => rightScore - leftScore || leftId.localeCompare(rightId))
    .slice(0, SEMANTIC_RESULT_LIMIT)
    .map(([id, score]) => ({ id, score }));
}
