import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  UiCollaborationActivityStatus,
  UiCollaborationDocument,
  UiCollaborationDocumentStatus,
  UiCollaborationEditor,
  UiCollaborationPresenceRequest,
  UiCollaborationPresenceResult,
  UiCollaborationProfile,
  UiCollaborationSave,
  UiCollaborationSavedDocument,
  UiCollaborationStatus,
} from "../schema/ui-collaboration.js";
import { safeChildPath, type WorkspacePaths } from "./workspace.js";

const execFileAsync = promisify(execFile);
const DEFAULT_REMOTE_URL = "";
const DEFAULT_PROJECT_ID = "puerts-template";
const REQUEST_TIMEOUT_MS = 1_500;

type FetchLike = typeof fetch;

export interface CollaborationApiService {
  profile(): Promise<UiCollaborationProfile>;
  updateProfile(userName: string): Promise<UiCollaborationProfile>;
  status(documents: readonly UiCollaborationDocument[]): Promise<UiCollaborationStatus>;
  activity(documents: readonly UiCollaborationDocument[]): Promise<UiCollaborationActivityStatus>;
  syncPresence(request: UiCollaborationPresenceRequest): Promise<UiCollaborationPresenceResult>;
  recordSaved(documents: readonly UiCollaborationSavedDocument[]): Promise<void>;
}

interface CollaborationServiceOptions {
  readonly remoteUrl?: string;
  readonly projectId?: string;
  readonly actorId?: string;
  readonly userConfigPath?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchLike;
  readonly readSvnBase?: (path: string) => Promise<string | null>;
}

interface RemoteDocumentStatus {
  readonly document: UiCollaborationDocument;
  readonly editors: readonly UiCollaborationEditor[];
  readonly latestSave: UiCollaborationSave | null;
}

export class CollaborationService implements CollaborationApiService {
  private readonly remoteUrl: string;
  private readonly projectId: string;
  private readonly actorId: string;
  private readonly userConfigPath: string;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly fetchRequest: FetchLike;
  private readonly svnBase: (path: string) => Promise<string | null>;

  constructor(
    private readonly paths: WorkspacePaths,
    options: CollaborationServiceOptions = {},
  ) {
    this.environment = options.environment ?? process.env;
    this.remoteUrl = (options.remoteUrl ?? this.environment.LEGMA_COLLAB_SERVER ?? DEFAULT_REMOTE_URL).replace(/\/+$/, "");
    this.projectId = options.projectId ?? this.environment.LEGMA_COLLAB_PROJECT ?? DEFAULT_PROJECT_ID;
    this.actorId = options.actorId ?? randomUUID();
    this.userConfigPath = options.userConfigPath ?? this.environment.LEGMA_USER_CONFIG ?? join(homedir(), ".token-bubble", "user.json");
    this.fetchRequest = options.fetch ?? fetch;
    this.svnBase = options.readSvnBase ?? ((path) => this.readSvnBase(path));
  }

  async profile(): Promise<UiCollaborationProfile> {
    const environmentName = normalizeUserName(this.environment.TOKEN_BUBBLE_USER ?? "");
    if (environmentName) return { actorId: this.actorId, userName: environmentName, source: "environment", editable: false };
    const file = await this.readUserConfig();
    const userName = normalizeUserName(typeof file.user_name === "string" ? file.user_name : "");
    return {
      actorId: this.actorId,
      userName,
      source: userName ? "token-bubble" : "unset",
      editable: true,
    };
  }

  async updateProfile(userName: string): Promise<UiCollaborationProfile> {
    const current = await this.profile();
    if (!current.editable) throw new Error("昵称由 TOKEN_BUBBLE_USER 环境变量管理");
    const normalized = normalizeUserName(userName);
    if (!normalized) throw new Error("昵称不能为空");
    const value = { ...(await this.readUserConfig()), user_name: normalized };
    await mkdir(dirname(this.userConfigPath), { recursive: true });
    const temporaryPath = `${this.userConfigPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.userConfigPath);
    return { actorId: this.actorId, userName: normalized, source: "token-bubble", editable: true };
  }

  async status(documents: readonly UiCollaborationDocument[]): Promise<UiCollaborationStatus> {
    const profile = await this.profile();
    if (documents.length === 0) return { connection: "connected", profile, documents: [] };
    try {
      const [remote, baseHashes] = await Promise.all([
        this.remoteRequest<{ readonly documents: readonly unknown[] }>("/api/status", { projectId: this.projectId, documents }),
        Promise.all(
          documents.map(async (document) => {
            const content = await this.svnBase(document.path);
            return content === null ? null : collaborationContentHash(content);
          }),
        ),
      ]);
      const remoteDocuments = remote.documents.map(parseRemoteDocumentStatus);
      const byIdentity = new Map(remoteDocuments.map((document) => [documentIdentity(document.document), document]));
      const result = documents.map((document, index): UiCollaborationDocumentStatus => {
        const found = byIdentity.get(documentIdentity(document));
        return {
          document,
          svnBaseHash: baseHashes[index] ?? null,
          editors: found?.editors ?? [],
          latestSave: found?.latestSave ?? null,
        };
      });
      return { connection: "connected", profile, documents: result };
    } catch (error) {
      return {
        connection: "unavailable",
        profile,
        documents: [],
        message: `协作服务不可用：${collaborationErrorMessage(error)}`,
      };
    }
  }

  async activity(documents: readonly UiCollaborationDocument[]): Promise<UiCollaborationActivityStatus> {
    const profile = await this.profile();
    if (documents.length === 0) return { connection: "connected", profile, documents: [] };
    try {
      const remote = await this.remoteRequest<{ readonly documents: readonly unknown[] }>("/api/status", {
        projectId: this.projectId,
        documents,
      });
      const byIdentity = new Map(
        remote.documents.map(parseRemoteDocumentStatus).map((document) => [documentIdentity(document.document), document]),
      );
      return {
        connection: "connected",
        profile,
        documents: documents.map((document) => ({
          document,
          editors: byIdentity.get(documentIdentity(document))?.editors ?? [],
        })),
      };
    } catch (error) {
      return {
        connection: "unavailable",
        profile,
        documents: [],
        message: `协作服务不可用：${collaborationErrorMessage(error)}`,
      };
    }
  }

  async syncPresence(request: UiCollaborationPresenceRequest): Promise<UiCollaborationPresenceResult> {
    const profile = await this.profile();
    if (!profile.userName) return { connection: "identity-required", message: "请先设置昵称" };
    try {
      await this.remoteRequest("/api/presence", {
        projectId: this.projectId,
        actor: { actorId: profile.actorId, userName: profile.userName },
        sessionId: request.sessionId,
        documents: request.documents,
      });
      return { connection: "connected" };
    } catch (error) {
      return { connection: "unavailable", message: collaborationErrorMessage(error) };
    }
  }

  async recordSaved(documents: readonly UiCollaborationSavedDocument[]): Promise<void> {
    if (documents.length === 0) return;
    const profile = await this.profile();
    if (!profile.userName) return;
    try {
      await this.remoteRequest("/api/saves", {
        projectId: this.projectId,
        actor: { actorId: profile.actorId, userName: profile.userName },
        documents,
      });
    } catch {
      // Collaboration is advisory and never participates in the save result.
    }
  }

  private async readUserConfig(): Promise<Record<string, unknown>> {
    try {
      const value = JSON.parse(await readFile(this.userConfigPath, "utf8")) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private async readSvnBase(relativePath: string): Promise<string | null> {
    const path = safeChildPath(this.paths.sourceRoot, relativePath);
    try {
      const result = await execFileAsync("svn", ["cat", "--revision", "BASE", "--", path], {
        cwd: this.paths.sourceRoot,
        windowsHide: true,
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return result.stdout;
    } catch {
      return null;
    }
  }

  private async remoteRequest<T = unknown>(path: string, body: unknown): Promise<T> {
    if (!this.remoteUrl) throw new Error("未配置服务地址");
    const response = await this.fetchRequest(`${this.remoteUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  }
}

export function unavailableCollaborationService(userName = ""): CollaborationApiService {
  const profile = { actorId: "local-test", userName, source: userName ? "token-bubble" : "unset", editable: true } as const;
  return {
    profile: async () => profile,
    updateProfile: async () => profile,
    status: async (documents) => ({
      connection: "unavailable",
      profile,
      documents: [],
      ...(documents.length > 0 ? { message: "协作服务未配置" } : {}),
    }),
    activity: async (documents) => ({
      connection: "unavailable",
      profile,
      documents: [],
      ...(documents.length > 0 ? { message: "协作服务未配置" } : {}),
    }),
    syncPresence: async () => ({ connection: userName ? "unavailable" : "identity-required" }),
    recordSaved: async () => {},
  };
}

export function collaborationContentHash(content: string): string {
  let normalized: string;
  try {
    normalized = JSON.stringify(canonicalJson(JSON.parse(content.replace(/^\uFEFF/, ""))));
  } catch {
    normalized = content.replaceAll("\r\n", "\n");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  );
}

function normalizeUserName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function collaborationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /abort|timeout/i.test(message) ? "连接超时" : message;
}

function documentIdentity(document: UiCollaborationDocument): string {
  return `${document.kind}:${document.key}`;
}

function parseRemoteDocumentStatus(value: unknown): RemoteDocumentStatus {
  if (!value || typeof value !== "object") throw new Error("状态响应中的文档无效");
  const candidate = value as { readonly document?: unknown; readonly editors?: unknown; readonly latestSave?: unknown };
  const document = parseDocument(candidate.document);
  if (!Array.isArray(candidate.editors)) throw new Error("状态响应中的编辑者无效");
  return {
    document,
    editors: candidate.editors.map(parseEditor),
    latestSave: candidate.latestSave === null ? null : parseSave(candidate.latestSave),
  };
}

function parseDocument(value: unknown): UiCollaborationDocument {
  if (!value || typeof value !== "object") throw new Error("协作文档无效");
  const candidate = value as Partial<UiCollaborationDocument>;
  if (
    !(["artifact", "reference", "prototype"] as const).includes(candidate.kind as UiCollaborationDocument["kind"]) ||
    typeof candidate.key !== "string" ||
    typeof candidate.path !== "string"
  )
    throw new Error("协作文档无效");
  return { kind: candidate.kind as UiCollaborationDocument["kind"], key: candidate.key, path: candidate.path };
}

function parseEditor(value: unknown): UiCollaborationEditor {
  if (!value || typeof value !== "object") throw new Error("编辑者响应无效");
  const candidate = value as Partial<UiCollaborationEditor>;
  for (const key of ["actorId", "userName", "sessionId", "startedAt", "lastSeenAt"] as const) {
    if (typeof candidate[key] !== "string") throw new Error("编辑者响应无效");
  }
  return candidate as UiCollaborationEditor;
}

function parseSave(value: unknown): UiCollaborationSave {
  if (!value || typeof value !== "object") throw new Error("保存响应无效");
  const candidate = value as Partial<UiCollaborationSave>;
  for (const key of ["actorId", "userName", "path", "savedAt"] as const) {
    if (typeof candidate[key] !== "string") throw new Error("保存响应无效");
  }
  if (candidate.contentHash !== null && typeof candidate.contentHash !== "string") throw new Error("保存 hash 无效");
  return candidate as UiCollaborationSave;
}
