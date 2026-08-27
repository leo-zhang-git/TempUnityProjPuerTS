import { createContext, useCallback, useContext, useState } from "react";
import {
  type DirectorySortMode,
  parseWorkspaceLocation,
  type WorkspaceLocation,
  workspaceLocationSearch,
} from "./artifact-explorer-model.js";

const RECENT_STORAGE_KEY = "ui-authoring.recent-workspaces.v1";
const SORT_STORAGE_KEY = "ui-authoring.directory-sort.v1";
const RECENT_LIMIT = 30;

export interface RecentWorkspaceLocation {
  readonly location: WorkspaceLocation;
  readonly visitedAt: number;
}

export interface WorkspaceNavigationContextValue {
  readonly recent: readonly RecentWorkspaceLocation[];
  readonly sort: DirectorySortMode;
  readonly setSort: (sort: DirectorySortMode) => void;
  readonly clearRecent: () => void;
  readonly openLocation: (location: WorkspaceLocation) => void;
}

export const WorkspaceNavigationContext = createContext<WorkspaceNavigationContextValue | null>(null);

export function useWorkspaceNavigation(): WorkspaceNavigationContextValue {
  const value = useContext(WorkspaceNavigationContext);
  if (!value) throw new Error("WorkspaceNavigationContext is unavailable");
  return value;
}

interface StoredRecentLocation {
  readonly search: string;
  readonly visitedAt: number;
}

function locationIdentity(location: WorkspaceLocation): string {
  if (location.kind === "overview") return "overview";
  if (location.kind === "artifact") return `artifact:${location.artifactKey}`;
  if (location.kind === "relations") return `relations:${location.artifactKey}`;
  if (location.kind === "reference") return `reference:${location.referenceKey}`;
  if (location.kind === "prototype") return `prototype:${location.prototypeKey}`;
  return `directory:${location.path}`;
}

function loadRecent(): RecentWorkspaceLocation[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((entry): RecentWorkspaceLocation[] => {
        if (!entry || typeof entry !== "object") return [];
        const stored = entry as Partial<StoredRecentLocation>;
        if (typeof stored.search !== "string" || typeof stored.visitedAt !== "number") return [];
        const location = parseWorkspaceLocation(stored.search);
        return location ? [{ location, visitedAt: stored.visitedAt }] : [];
      })
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecent(entries: readonly RecentWorkspaceLocation[]): void {
  try {
    const stored: StoredRecentLocation[] = entries.map((entry) => ({
      search: workspaceLocationSearch(entry.location),
      visitedAt: entry.visitedAt,
    }));
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Local preferences must not block the workspace when storage is unavailable.
  }
}

function loadSort(): DirectorySortMode {
  try {
    return window.localStorage.getItem(SORT_STORAGE_KEY) === "modified" ? "modified" : "name";
  } catch {
    return "name";
  }
}

export function useWorkspaceNavigationState() {
  const [recent, setRecent] = useState<readonly RecentWorkspaceLocation[]>(loadRecent);
  const [sort, setSortState] = useState<DirectorySortMode>(loadSort);

  const recordLocation = useCallback((location: WorkspaceLocation): void => {
    if (location.kind === "overview" || location.kind === "relations") return;
    setRecent((current) => {
      const identity = locationIdentity(location);
      const next = [{ location, visitedAt: Date.now() }, ...current.filter((entry) => locationIdentity(entry.location) !== identity)].slice(
        0,
        RECENT_LIMIT,
      );
      saveRecent(next);
      return next;
    });
  }, []);

  const pruneRecent = useCallback((exists: (location: WorkspaceLocation) => boolean): void => {
    setRecent((current) => {
      const next = current.filter((entry) => exists(entry.location));
      if (next.length !== current.length) saveRecent(next);
      return next;
    });
  }, []);

  const clearRecent = useCallback((): void => {
    setRecent([]);
    saveRecent([]);
  }, []);

  const setSort = useCallback((next: DirectorySortMode): void => {
    setSortState(next);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }, []);

  return {
    recent,
    sort,
    setSort,
    recordLocation,
    pruneRecent,
    clearRecent,
  } as const;
}
