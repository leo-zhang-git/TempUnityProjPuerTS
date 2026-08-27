import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UiCollaborationActivityStatus, UiCollaborationProfile, UiCollaborationStatus } from "../../schema/ui-collaboration.js";
import {
  type DocumentCatalog,
  loadCollaborationActivity,
  loadCollaborationProfile,
  loadCollaborationStatus,
  sendCollaborationPresenceBeacon,
  syncCollaborationPresence,
  updateCollaborationProfile,
} from "../shared/api/client.js";
import type { WorkspaceLocation } from "../workspace/explorer/artifact-explorer-model.js";
import { allCollaborationDocuments, currentCollaborationDocuments, dirtyCollaborationDocuments } from "./collaboration-documents.js";
import { presentCollaborationStatus } from "./collaboration-state.js";

const COLLABORATION_POLL_MS = 20_000;
const COLLABORATION_HEARTBEAT_MS = 30_000;

interface CollaborationSessionOptions {
  readonly location: WorkspaceLocation | null;
  readonly catalog: DocumentCatalog;
  readonly dirtyDocuments: ReadonlySet<string>;
}

export function useCollaborationSession({ location, catalog, dirtyDocuments }: CollaborationSessionOptions) {
  const [profile, setProfile] = useState<UiCollaborationProfile | null>(null);
  const [status, setStatus] = useState<UiCollaborationStatus | null>(null);
  const [activity, setActivity] = useState<UiCollaborationActivityStatus | null>(null);
  const [activityRefreshing, setActivityRefreshing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const sessionId = useRef(window.crypto.randomUUID());
  const activityRefreshingRef = useRef(false);

  const activeDocuments = useMemo(() => currentCollaborationDocuments(location, catalog), [catalog, location]);
  const workspaceDocuments = useMemo(() => allCollaborationDocuments(catalog), [catalog]);
  const editingDocuments = useMemo(() => dirtyCollaborationDocuments(dirtyDocuments, catalog), [catalog, dirtyDocuments]);
  const presentation = useMemo(() => presentCollaborationStatus(status), [status]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await loadCollaborationStatus(activeDocuments));
    } catch {
      setStatus(null);
    }
  }, [activeDocuments]);

  const refreshActivity = useCallback(async (): Promise<void> => {
    if (activityRefreshingRef.current) return;
    activityRefreshingRef.current = true;
    setActivityRefreshing(true);
    try {
      setActivity(await loadCollaborationActivity(workspaceDocuments));
    } catch {
      setActivity(null);
    } finally {
      activityRefreshingRef.current = false;
      setActivityRefreshing(false);
    }
  }, [workspaceDocuments]);

  const saveProfile = useCallback(async (userName: string): Promise<void> => {
    setProfile(await updateCollaborationProfile(userName));
    setProfileOpen(false);
  }, []);

  useEffect(() => {
    let active = true;
    void loadCollaborationProfile()
      .then((loaded) => {
        if (active) setProfile(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!profile || !location) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), COLLABORATION_POLL_MS);
    return () => window.clearInterval(interval);
  }, [location, profile, refresh]);

  useEffect(() => {
    if (!profile || location?.kind !== "overview") {
      setActivity(null);
      return;
    }
    void refreshActivity();
    const interval = window.setInterval(() => void refreshActivity(), COLLABORATION_POLL_MS);
    return () => window.clearInterval(interval);
  }, [location, profile, refreshActivity]);

  useEffect(() => {
    if (!profile?.userName) return;
    const sync = (): void => {
      void syncCollaborationPresence(sessionId.current, editingDocuments);
    };
    sync();
    const interval = window.setInterval(sync, COLLABORATION_HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [editingDocuments, profile?.userName]);

  useEffect(() => {
    const releasePresence = (): void => {
      sendCollaborationPresenceBeacon(sessionId.current);
    };
    window.addEventListener("pagehide", releasePresence);
    return () => {
      window.removeEventListener("pagehide", releasePresence);
      releasePresence();
    };
  }, []);

  return {
    profile,
    presentation,
    activity,
    activityRefreshing,
    profileOpen,
    setProfileOpen,
    refresh,
    refreshActivity,
    saveProfile,
  } as const;
}
