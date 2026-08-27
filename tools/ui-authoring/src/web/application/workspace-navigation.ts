import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CANVAS_VIEWPORT_INDEX, editorZoomPolicy } from "../editors/artifact/canvas/artifact-viewport.js";
import type { AuthoringMode } from "../editors/prototype/prototype-editor.js";
import { PREVIEW_CANVAS_ZOOM_POLICY } from "../editors/shared/canvas-viewport.js";
import type { DocumentCatalog } from "../shared/api/client.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../shared/types.js";
import {
  DEFAULT_GRID_SCALE,
  DEFAULT_LIST_SCALE,
  type DirectoryViewMode,
  documentDirectory,
  type GalleryScale,
  normalizeWorkspacePath,
  parseWorkspaceLocation,
  type WorkspaceLocation,
  workspaceLocationSearch,
} from "../workspace/explorer/artifact-explorer-model.js";
import { useWorkspaceNavigationState } from "../workspace/explorer/workspace-navigation-state.js";
import type { WorkspaceSaveStatus } from "../workspace/workspace-editing-context.js";

export function locationExists(location: WorkspaceLocation, catalog: DocumentCatalog): boolean {
  if (location.kind === "overview") return true;
  if (location.kind === "artifact") return catalog.artifacts.some((entry) => entry.artifactKey === location.artifactKey);
  if (location.kind === "relations") return catalog.artifacts.some((entry) => entry.artifactKey === location.artifactKey);
  if (location.kind === "reference") return catalog.references.some((entry) => entry.referenceKey === location.referenceKey);
  if (location.kind === "prototype") {
    const prototypeExists = catalog.prototypes.some((entry) => entry.prototypeKey === location.prototypeKey);
    const referenceExists = !location.referenceKey || catalog.references.some((entry) => entry.referenceKey === location.referenceKey);
    return prototypeExists && referenceExists;
  }
  const path = normalizeWorkspacePath(location.path);
  if (!path) return true;
  if (catalog.directories?.some((entry) => entry.path === path || entry.path.startsWith(`${path}/`))) return true;
  return [...catalog.artifacts, ...catalog.references, ...catalog.prototypes, ...(catalog.unavailable ?? [])].some((entry) => {
    const directory = documentDirectory(entry.path);
    return directory === path || directory.startsWith(`${path}/`);
  });
}

interface WorkspaceNavigationSessionOptions {
  readonly catalog: DocumentCatalog;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly dirty: boolean;
  readonly savePhase: WorkspaceSaveStatus["phase"];
  readonly onNotice: (notice: string) => void;
}

interface RecoveredDocuments {
  readonly artifacts: ReadonlyMap<string, unknown>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
}

export function useWorkspaceNavigationSession({ catalog, artifacts, dirty, savePhase, onNotice }: WorkspaceNavigationSessionOptions) {
  const state = useWorkspaceNavigationState();
  const [location, setLocation] = useState<WorkspaceLocation | null>(null);
  const [pendingLocation, setPendingLocation] = useState<WorkspaceLocation | null>(null);
  const [selectedId, setSelectedId] = useState("LaneDodgeCanvas");
  const [viewportIndex, setViewportIndex] = useState(DEFAULT_CANVAS_VIEWPORT_INDEX);
  const [zoom, setZoom] = useState(0.65);
  const [authoringMode, setAuthoringMode] = useState<AuthoringMode>("prototype");
  const locationRef = useRef<WorkspaceLocation | null>(null);
  const defaultArtifactKey = useRef("LaneDodgeCanvas");
  const lastDirectoryView = useRef<DirectoryViewMode>("dependency");
  const lastGalleryScale = useRef<Record<"list" | "grid", GalleryScale>>({ list: DEFAULT_LIST_SCALE, grid: DEFAULT_GRID_SCALE });
  const catalogRef = useRef(catalog);
  const artifactsRef = useRef(artifacts);
  catalogRef.current = catalog;
  artifactsRef.current = artifacts;

  const applyLocation = useCallback(
    (next: WorkspaceLocation, history: "push" | "replace" | "none" = "push", nextSelectedId?: string): boolean => {
      if (!locationExists(next, catalogRef.current)) {
        onNotice("找不到请求打开的 Legma 文档");
        return false;
      }
      const current = locationRef.current;
      const changesDocument = !current || workspaceLocationSearch(current) !== workspaceLocationSearch(next);
      locationRef.current = next;
      if (next.kind === "directory") {
        lastDirectoryView.current = next.view;
        if (next.view !== "dependency") lastGalleryScale.current[next.view] = next.scale;
      }
      setLocation(next);
      if (next.kind === "artifact") {
        const artifact = artifactsRef.current.get(next.artifactKey)!;
        const changesArtifact = current?.kind !== "artifact" || current.artifactKey !== next.artifactKey;
        setSelectedId(nextSelectedId ?? artifact.resolvedSource.root.id);
        if (changesArtifact) {
          setViewportIndex(DEFAULT_CANVAS_VIEWPORT_INDEX);
          setZoom(editorZoomPolicy(artifact.resolvedSource).default);
        }
      } else if (next.kind === "reference" || next.kind === "prototype") {
        if (changesDocument) setZoom(PREVIEW_CANVAS_ZOOM_POLICY.default);
        if (next.kind === "prototype") setAuthoringMode("prototype");
      }
      if (history === "push" && changesDocument) window.history.pushState(null, "", workspaceLocationSearch(next));
      if (history === "replace") window.history.replaceState(null, "", workspaceLocationSearch(next));
      return true;
    },
    [onNotice],
  );

  const initialize = useCallback(
    (next: WorkspaceLocation, defaultArtifact?: ArtifactDocument, initialArtifact?: ArtifactDocument): void => {
      if (defaultArtifact) defaultArtifactKey.current = defaultArtifact.artifactKey;
      locationRef.current = next;
      if (next.kind === "directory") {
        lastDirectoryView.current = next.view;
        if (next.view !== "dependency") lastGalleryScale.current[next.view] = next.scale;
      }
      setLocation(next);
      setAuthoringMode("prototype");
      const selectedArtifact =
        next.kind === "artifact" || next.kind === "relations"
          ? (artifactsRef.current.get(next.artifactKey) ?? initialArtifact)
          : defaultArtifact;
      setSelectedId(selectedArtifact?.resolvedSource.root.id ?? "");
      setViewportIndex(DEFAULT_CANVAS_VIEWPORT_INDEX);
      if (next.kind === "artifact" && selectedArtifact) setZoom(editorZoomPolicy(selectedArtifact.resolvedSource).default);
      else if (next.kind === "reference" || next.kind === "prototype") setZoom(PREVIEW_CANVAS_ZOOM_POLICY.default);
      window.history.replaceState(null, "", workspaceLocationSearch(next));
    },
    [],
  );

  const ensureRecoveredLocation = useCallback((documents: RecoveredDocuments): void => {
    const current = locationRef.current;
    const missingCurrent =
      (current?.kind === "artifact" && !documents.artifacts.has(current.artifactKey)) ||
      (current?.kind === "relations" && !documents.artifacts.has(current.artifactKey)) ||
      (current?.kind === "reference" && !documents.references.has(current.referenceKey)) ||
      (current?.kind === "prototype" && !documents.prototypes.has(current.prototypeKey));
    if (!missingCurrent) return;
    const fallback: WorkspaceLocation = { kind: "directory", path: "", view: "dependency", scale: DEFAULT_GRID_SCALE };
    locationRef.current = fallback;
    setLocation(fallback);
    window.history.replaceState(null, "", workspaceLocationSearch(fallback));
  }, []);

  const openArtifact = useCallback(
    (artifactKey: string, nextSelectedId?: string): void => {
      if (!artifactsRef.current.has(artifactKey)) {
        onNotice(`缺少 Artifact：${artifactKey}`);
        return;
      }
      applyLocation({ kind: "artifact", artifactKey }, "push", nextSelectedId);
    },
    [applyLocation, onNotice],
  );

  const openDirectory = useCallback(
    (path: string): void => {
      const current = locationRef.current;
      const view = current?.kind === "directory" ? current.view : lastDirectoryView.current;
      const scale =
        current?.kind === "directory" ? current.scale : view === "list" ? lastGalleryScale.current.list : lastGalleryScale.current.grid;
      applyLocation({ kind: "directory", path: normalizeWorkspacePath(path), view, scale });
    },
    [applyLocation],
  );

  const openRelations = useCallback(
    (artifactKey: string): void => {
      applyLocation({ kind: "relations", artifactKey });
    },
    [applyLocation],
  );

  const closeRelations = useCallback(
    (artifactKey: string): void => {
      applyLocation({ kind: "artifact", artifactKey }, "replace");
    },
    [applyLocation],
  );

  const changeDirectoryView = useCallback(
    (view: DirectoryViewMode): void => {
      const current = locationRef.current;
      if (current?.kind === "directory") {
        applyLocation({
          ...current,
          view,
          scale: view === "list" ? lastGalleryScale.current.list : view === "grid" ? lastGalleryScale.current.grid : current.scale,
        });
      }
    },
    [applyLocation],
  );

  const changeGalleryScale = useCallback(
    (scale: GalleryScale): void => {
      const current = locationRef.current;
      if (current?.kind === "directory") applyLocation({ ...current, scale });
    },
    [applyLocation],
  );

  const openPrototype = useCallback(
    (prototypeKey: string, referenceKey?: string): void => {
      applyLocation({ kind: "prototype", prototypeKey, ...(referenceKey ? { referenceKey } : {}) });
    },
    [applyLocation],
  );

  const openReference = useCallback(
    (referenceKey: string): void => {
      applyLocation({ kind: "reference", referenceKey });
    },
    [applyLocation],
  );

  useEffect(() => {
    if (location) state.recordLocation(location);
  }, [location, state.recordLocation]);

  useEffect(() => {
    if (catalog.artifacts.length > 0) state.pruneRecent((entry) => locationExists(entry, catalog));
  }, [catalog, state.pruneRecent]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirty && savePhase !== "scheduled" && savePhase !== "saving") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, savePhase]);

  useEffect(() => {
    if (!location || catalog.artifacts.length === 0) return;
    const onPopState = (): void => {
      const requested = parseWorkspaceLocation(window.location.search);
      const fallback: WorkspaceLocation = { kind: "artifact", artifactKey: defaultArtifactKey.current };
      const next = requested && locationExists(requested, catalogRef.current) ? requested : fallback;
      applyLocation(next, "none");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyLocation, catalog.artifacts.length, location]);

  useEffect(() => {
    if (!pendingLocation || !locationExists(pendingLocation, catalog)) return;
    setPendingLocation(null);
    applyLocation(pendingLocation, "push");
  }, [applyLocation, catalog, pendingLocation]);

  const context = useMemo(
    () => ({
      recent: state.recent,
      sort: state.sort,
      setSort: state.setSort,
      clearRecent: state.clearRecent,
      openLocation: (next: WorkspaceLocation) => {
        applyLocation(next);
      },
    }),
    [applyLocation, state],
  );

  return {
    location,
    selectedId,
    setSelectedId,
    viewportIndex,
    setViewportIndex,
    zoom,
    setZoom,
    authoringMode,
    setAuthoringMode,
    recent: state.recent,
    context,
    applyLocation,
    initialize,
    ensureRecoveredLocation,
    queueLocation: setPendingLocation,
    openArtifact,
    openRelations,
    closeRelations,
    openDirectory,
    changeDirectoryView,
    changeGalleryScale,
    openPrototype,
    openReference,
  } as const;
}
