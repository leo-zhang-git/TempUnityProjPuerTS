import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import type { UnitySpriteMetrics } from "../kernel/image-intrinsic.js";
import type { TmpFontMetrics } from "../kernel/tmp-text.js";
import { DEFAULT_UI_FONT_ASSET } from "../registry/component-registry.js";
import type {
  AuthoringAssetCatalog,
  AuthoringAssetCatalogIssue,
  AuthoringAssetEntry,
  AuthoringAssetKind,
} from "../schema/asset-catalog.js";
import { parseUnitySpriteAsset, unitySpriteImportMode } from "./sprite-asset.js";
import { parseTmpFontAsset } from "./tmp-font-asset.js";
import { listFiles, safeChildPath } from "./workspace.js";

export class AssetValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AssetValidationError";
    this.code = code;
    this.path = path;
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^Assets\/UI\//i, "");
}

function assetGuid(meta: string): string | undefined {
  return meta.match(/^guid:\s*([0-9a-f]{32})/im)?.[1]?.toLowerCase();
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

export interface AssetIndexOptions {
  readonly unityAssetsRoot?: string | undefined;
  readonly allowFormalOutputSource?: boolean | undefined;
}

export class AssetIndex {
  readonly #assetRoot: string;
  readonly #unityAssetsRoot: string | undefined;
  readonly #allowFormalOutputSource: boolean;
  #pathByGuid: Map<string, string> | null = null;
  #catalog: Promise<AuthoringAssetCatalog> | null = null;
  readonly #fontMetrics = new Map<string, Promise<TmpFontMetrics>>();
  readonly #spriteMetrics = new Map<string, Promise<UnitySpriteMetrics>>();
  #watcher: FSWatcher | undefined;
  #watchRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(assetRoot: string, options: AssetIndexOptions = {}) {
    this.#assetRoot = assetRoot;
    this.#unityAssetsRoot = options.unityAssetsRoot;
    this.#allowFormalOutputSource = options.allowFormalOutputSource === true;
  }

  async sourceFontPath(fontAssetPath: string): Promise<string | null> {
    const path = normalizePath(fontAssetPath);
    const assetPath = safeChildPath(this.#assetRoot, path);
    const content = await readFile(assetPath, "utf8");
    const guid = content.match(/m_SourceFontFileGUID:\s*([0-9a-f]{32})/i)?.[1]?.toLowerCase();
    if (!guid) return null;
    const pathByGuid = await this.#guids();
    return pathByGuid.get(guid) ?? null;
  }

  async tmpFontMetrics(fontAssetPath: string): Promise<TmpFontMetrics> {
    const path = normalizePath(fontAssetPath);
    let pending = this.#fontMetrics.get(path);
    if (!pending) {
      pending = readFile(safeChildPath(this.#assetRoot, path), "utf8").then(parseTmpFontAsset);
      this.#fontMetrics.set(path, pending);
    }
    return pending;
  }

  async spriteMetrics(spritePath: string): Promise<UnitySpriteMetrics> {
    const path = normalizePath(spritePath);
    let pending = this.#spriteMetrics.get(path);
    if (!pending) {
      const fullPath = safeChildPath(this.#assetRoot, path);
      pending = Promise.all([readFile(fullPath), readFile(`${fullPath}.meta`, "utf8")]).then(([image, meta]) => {
        const mode = unitySpriteImportMode(meta);
        if (mode !== "single") throw new Error(`Image asset '${path}' must be imported as Sprite / Single`);
        return parseUnitySpriteAsset(image, meta);
      });
      this.#spriteMetrics.set(path, pending);
    }
    return pending;
  }

  async asset(kind: AuthoringAssetKind, requestedPath: string): Promise<AuthoringAssetEntry> {
    const path = normalizePath(requestedPath);
    const segments = requestedPath.replaceAll("\\", "/").split("/");
    if (
      !path ||
      requestedPath.includes("\\") ||
      /^[/\\]|^[A-Za-z]:/.test(requestedPath) ||
      segments.includes("..") ||
      path !== requestedPath.replaceAll("\\", "/") ||
      (!this.#allowFormalOutputSource && path.startsWith("Prefab/"))
    ) {
      throw new AssetValidationError(
        "resource.path",
        requestedPath,
        `UI resource '${requestedPath}' must use a Source-relative path under Assets/Resources/UI.`,
      );
    }
    const fullPath = safeChildPath(this.#assetRoot, path);
    let content: Uint8Array | string;
    try {
      content = kind === "image" ? await readFile(fullPath) : await readFile(fullPath, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        throw new AssetValidationError("resource.missing", path, `UI resource '${path}' does not exist.`, { cause: error });
      throw error;
    }
    let meta: string;
    try {
      meta = await readFile(`${fullPath}.meta`, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        throw new AssetValidationError("resource.metaMissing", path, `UI resource '${path}' has no Unity .meta file.`, { cause: error });
      throw error;
    }
    const guid = assetGuid(meta);
    if (!guid) throw new AssetValidationError("resource.guidMissing", path, `UI resource '${path}' .meta has no valid GUID.`);

    if (kind === "image") {
      if (!path.toLowerCase().endsWith(".png"))
        throw new AssetValidationError("resource.type", path, `Image resource '${path}' must be a PNG Sprite.`);
      const mode = unitySpriteImportMode(meta);
      if (mode !== "single") {
        throw new AssetValidationError(
          "resource.spriteImportMode",
          path,
          `Image resource '${path}' must be imported as Sprite / Single; current mode is '${mode}'.`,
        );
      }
      let metrics: UnitySpriteMetrics;
      try {
        metrics = parseUnitySpriteAsset(content as Uint8Array, meta);
      } catch (error) {
        throw new AssetValidationError("resource.metrics", path, `Image resource '${path}' has invalid intrinsic metrics.`, {
          cause: error,
        });
      }
      return this.#entry("image", path, guid, {
        type: "sprite",
        importer: { kind: "TextureImporter", textureType: "Sprite", spriteMode: "single" },
        metrics,
      });
    }

    if (kind === "animatorController") {
      if (!path.toLowerCase().endsWith(".controller"))
        throw new AssetValidationError("resource.type", path, `Animator Controller resource '${path}' must use the .controller extension.`);
      if (!/^AnimatorController:/m.test(content as string))
        throw new AssetValidationError("resource.type", path, `Animator Controller resource '${path}' is not a Unity Animator Controller.`);
      return this.#entry("animatorController", path, guid, {
        type: "animatorController",
        importer: { kind: "NativeFormatImporter" },
        metrics: {},
      });
    }

    if (kind === "animationClip") {
      if (!path.toLowerCase().endsWith(".anim"))
        throw new AssetValidationError("resource.type", path, `Animation Clip resource '${path}' must use the .anim extension.`);
      if (!/^AnimationClip:/m.test(content as string))
        throw new AssetValidationError("resource.type", path, `Animation Clip resource '${path}' is not a Unity Animation Clip.`);
      return this.#entry("animationClip", path, guid, {
        type: "animationClip",
        importer: { kind: "NativeFormatImporter" },
        metrics: {},
      });
    }

    if (!path.toLowerCase().endsWith(".asset"))
      throw new AssetValidationError("resource.type", path, `Font resource '${path}' must be a TMP Font Asset.`);
    const fontContent = content as string;
    const sourceFontGuid = fontContent.match(/m_SourceFontFileGUID:\s*([0-9a-f]{32})/i)?.[1]?.toLowerCase();
    if (!sourceFontGuid) throw new AssetValidationError("resource.type", path, `Font resource '${path}' is not a TMP Font Asset.`);
    let metrics: TmpFontMetrics;
    try {
      metrics = parseTmpFontAsset(fontContent);
    } catch (error) {
      throw new AssetValidationError("resource.metrics", path, `TMP Font Asset '${path}' has invalid intrinsic metrics.`, { cause: error });
    }
    return this.#entry("font", path, guid, {
      type: "tmpFont",
      importer: {
        kind: "NativeFormatImporter",
        sourceFontGuid,
        sourceFontPath: (await this.#guids()).get(sourceFontGuid) ?? null,
      },
      metrics: {
        atlasPopulationMode: metrics.atlasPopulationMode,
        pointSize: metrics.pointSize,
        scale: metrics.scale,
        lineHeight: metrics.lineHeight,
        ascentLine: metrics.ascentLine,
        descentLine: metrics.descentLine,
        characterCount: Object.keys(metrics.characters).length,
      },
    });
  }

  async catalog(): Promise<AuthoringAssetCatalog> {
    if (!this.#catalog) this.#catalog = this.#buildCatalog();
    return this.#catalog;
  }

  async assets(kind?: AuthoringAssetKind): Promise<readonly AuthoringAssetEntry[]> {
    const assets = (await this.catalog()).assets;
    return kind ? assets.filter((entry) => entry.kind === kind) : assets;
  }

  async refresh(): Promise<void> {
    this.#pathByGuid = null;
    this.#catalog = null;
    this.#fontMetrics.clear();
    this.#spriteMetrics.clear();
  }

  startWatching(): void {
    if (this.#watcher) return;
    try {
      this.#watcher = watch(this.#assetRoot, { recursive: true }, (_eventType, filename) => {
        const path = typeof filename === "string" ? filename.replaceAll("\\", "/").toLowerCase() : "";
        if (path && !/\.(?:png|asset|controller|meta)$/.test(path)) return;
        this.#scheduleRefresh();
      });
    } catch {
      // Manual refresh and per-request reads remain available when recursive watch is unavailable.
    }
  }

  close(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
    if (this.#watchRefreshTimer !== undefined) clearTimeout(this.#watchRefreshTimer);
    this.#watchRefreshTimer = undefined;
  }

  async #guids(): Promise<Map<string, string>> {
    if (!this.#pathByGuid) this.#pathByGuid = await this.#buildGuidMap();
    return this.#pathByGuid;
  }

  async #buildGuidMap(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const metaPath of await listFiles(this.#assetRoot, ".meta")) {
      const content = await readFile(safeChildPath(this.#assetRoot, metaPath), "utf8");
      const guid = assetGuid(content);
      if (!guid) continue;
      const assetPath = metaPath.slice(0, -".meta".length);
      result.set(guid, relative(this.#assetRoot, safeChildPath(this.#assetRoot, assetPath)).replaceAll("\\", "/"));
    }
    return result;
  }

  async #buildCatalog(): Promise<AuthoringAssetCatalog> {
    const issues: AuthoringAssetCatalogIssue[] = [];
    const assets: AuthoringAssetEntry[] = [];
    const candidates: Array<{ readonly kind: AuthoringAssetKind; readonly path: string }> = [
      ...(await listFiles(this.#assetRoot, ".png")).map((path) => ({ kind: "image" as const, path })),
      ...(await listFiles(this.#assetRoot, ".anim")).map((path) => ({ kind: "animationClip" as const, path })),
      ...(await listFiles(this.#assetRoot, ".controller")).map((path) => ({ kind: "animatorController" as const, path })),
    ];
    for (const path of await listFiles(this.#assetRoot, ".asset")) {
      const content = await readFile(safeChildPath(this.#assetRoot, path), "utf8");
      if (/m_SourceFontFileGUID:\s*[0-9a-f]{32}/i.test(content)) candidates.push({ kind: "font", path });
    }
    for (const candidate of candidates) {
      try {
        assets.push(await this.asset(candidate.kind, candidate.path));
      } catch (error) {
        if (!(error instanceof AssetValidationError)) throw error;
        issues.push({ path: error.path, code: error.code, message: error.message });
      }
    }
    issues.push(...(await this.#defaultFontContractIssues()));

    const pathOwners = new Map<string, AuthoringAssetEntry>();
    const guidOwners = new Map<string, AuthoringAssetEntry>();
    for (const entry of assets) {
      const pathKey = entry.path.toLocaleLowerCase("en-US");
      const pathOwner = pathOwners.get(pathKey);
      if (pathOwner)
        issues.push({
          path: entry.path,
          code: "resource.pathDuplicate",
          message: `UI resources '${pathOwner.path}' and '${entry.path}' collide case-insensitively.`,
        });
      else pathOwners.set(pathKey, entry);
      const guidOwner = guidOwners.get(entry.guid);
      if (guidOwner)
        issues.push({
          path: entry.path,
          code: "resource.guidDuplicate",
          message: `UI resources '${guidOwner.path}' and '${entry.path}' share GUID '${entry.guid}'.`,
        });
      else guidOwners.set(entry.guid, entry);
    }
    assets.sort((left, right) => left.path.localeCompare(right.path));
    issues.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
    return { assets, issues };
  }

  async #defaultFontContractIssues(): Promise<AuthoringAssetCatalogIssue[]> {
    if (!this.#unityAssetsRoot) return [];
    const settingsPath = safeChildPath(this.#unityAssetsRoot, "TextMesh Pro/Resources/TMP Settings.asset");
    const defaultFontMetaPath = `${safeChildPath(this.#assetRoot, DEFAULT_UI_FONT_ASSET)}.meta`;
    let settings: string;
    try {
      settings = await readFile(settingsPath, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      return [
        {
          path: DEFAULT_UI_FONT_ASSET,
          code: "resource.defaultFontSettingsMissing",
          message: "Unity TMP Settings asset is missing; the UI Authoring default font contract cannot be verified.",
        },
      ];
    }
    const settingsGuid = settings.match(/m_defaultFontAsset:\s*\{[^\r\n}]*guid:\s*([0-9a-f]{32})/i)?.[1]?.toLowerCase();
    if (!settingsGuid)
      return [
        {
          path: DEFAULT_UI_FONT_ASSET,
          code: "resource.defaultFontSettingsInvalid",
          message: "Unity TMP Settings has no valid m_defaultFontAsset GUID.",
        },
      ];

    let fontMeta: string;
    try {
      fontMeta = await readFile(defaultFontMetaPath, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      return [
        {
          path: DEFAULT_UI_FONT_ASSET,
          code: "resource.defaultFontMetaMissing",
          message: `Default UI font '${DEFAULT_UI_FONT_ASSET}' has no Unity .meta file.`,
        },
      ];
    }
    const fontGuid = assetGuid(fontMeta);
    if (!fontGuid)
      return [
        {
          path: DEFAULT_UI_FONT_ASSET,
          code: "resource.defaultFontGuidMissing",
          message: `Default UI font '${DEFAULT_UI_FONT_ASSET}' .meta has no valid GUID.`,
        },
      ];
    return settingsGuid === fontGuid
      ? []
      : [
          {
            path: DEFAULT_UI_FONT_ASSET,
            code: "resource.defaultFontMismatch",
            message: `Unity TMP Settings default font GUID '${settingsGuid}' does not match '${DEFAULT_UI_FONT_ASSET}' GUID '${fontGuid}'.`,
          },
        ];
  }

  #entry(
    kind: AuthoringAssetKind,
    path: string,
    guid: string,
    details: Pick<AuthoringAssetEntry, "type" | "importer" | "metrics">,
  ): AuthoringAssetEntry {
    const directory = dirname(path).replaceAll("\\", "/");
    return {
      kind,
      ...details,
      path: path.replaceAll("\\", "/"),
      guid,
      name: basename(path),
      directory: directory === "." ? "" : directory,
    };
  }

  #scheduleRefresh(): void {
    if (this.#watchRefreshTimer !== undefined) clearTimeout(this.#watchRefreshTimer);
    this.#watchRefreshTimer = setTimeout(() => {
      this.#watchRefreshTimer = undefined;
      void this.refresh();
    }, 100);
  }
}
