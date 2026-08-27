import { useEffect, useMemo, useState } from "react";
import { artifactPrefabPath, artifactSourceIdentity } from "../../kernel/prefab-path.js";
import { createPreviewReferenceCatalog } from "../../kernel/preview-reference.js";
import { resolvePreviewReference, walkResolvedPreviewInstances } from "../../kernel/preview-reference-resolver.js";
import { applyStateRootPreviewOverrides, stateRootPreviewPatches } from "../../kernel/preview-values.js";
import { referenceBackdropImage } from "../../kernel/reference-backdrop.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import type { CaptureSession } from "../../schema/ui-capture.js";
import type { UiConcreteSource } from "../../schema/ui-source-schema.js";
import { ArtifactGraphView } from "../rendering/artifact-graph/artifact-graph-view.js";
import { ArtifactPreview } from "../rendering/artifact-renderer/artifact-rendering.js";
import { waitForWebIntrinsicAssets } from "../rendering/intrinsic/intrinsic.js";
import renderingStyles from "../rendering/rendering.module.css";
import { referenceAssetUrl } from "../shared/api/client.js";
import type { ArtifactDocument, ReferenceDocument } from "../shared/types.js";
import { createWebClasses } from "../styles/web-styles.js";
import captureStyles from "./capture.module.css";

async function loadSession(): Promise<CaptureSession> {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) throw new Error("Capture session id is missing");
  const response = await fetch(`/api/capture/session?id=${encodeURIComponent(id)}`);
  const value = (await response.json()) as CaptureSession & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `截图会话请求失败：HTTP ${response.status}`);
  return value;
}

const webClasses = createWebClasses(captureStyles, renderingStyles);

function artifactDocuments(session: CaptureSession): ReadonlyMap<string, ArtifactDocument> {
  const catalog = createSourceCatalog(session.artifacts);
  return new Map(
    [...catalog.entries].map(([artifactKey, entry]) => [
      artifactKey,
      {
        artifactKey,
        artifactType: entry.source.artifactType,
        path: entry.path,
        prefabPath: artifactPrefabPath(artifactSourceIdentity(entry)),
        dependencies: entry.dependencies,
        source: entry.source,
        resolvedSource: entry.resolvedSource,
      },
    ]),
  );
}

function referenceDocuments(session: CaptureSession): ReadonlyMap<string, ReferenceDocument> {
  return new Map(
    (session.references ?? []).map((entry) => [
      entry.reference.referenceKey,
      {
        referenceKey: entry.reference.referenceKey,
        subjectArtifactKey: entry.reference.subjectArtifactKey,
        path: entry.path,
        reference: entry.reference,
      },
    ]),
  );
}

function CapturedReference({
  session,
  artifacts,
  references,
}: {
  readonly session: CaptureSession;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
}) {
  const reference = session.reference!;
  const subject = artifacts.get(reference.subjectArtifactKey)?.resolvedSource;
  const statePreviewPatches = subject ? stateRootPreviewPatches(subject, session.preview?.states ?? {}) : undefined;
  const backdrop =
    session.displayMode === "unityBaseline" ? undefined : referenceBackdropImage(reference.backdrop?.images ?? [], session.viewport);
  return (
    <>
      {backdrop ? (
        <img className={webClasses("reference-backdrop")} src={referenceAssetUrl(backdrop.path)} alt="" draggable={false} />
      ) : null}
      <ArtifactGraphView
        reference={reference}
        referencePath={session.document.path}
        references={references}
        artifacts={artifacts}
        viewport={session.viewport}
        unityBaseline={session.displayMode === "unityBaseline"}
        subjectSessionPatches={statePreviewPatches}
      />
    </>
  );
}

function reachableArtifactSources(session: CaptureSession, artifacts: ReadonlyMap<string, ArtifactDocument>): UiConcreteSource[] {
  const rootArtifactKey = session.document.kind === "Reference" ? session.reference?.subjectArtifactKey : session.source?.artifactKey;
  if (!rootArtifactKey) return [];
  const result: UiConcreteSource[] = [];
  const pending = [rootArtifactKey];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const artifactKey = pending.shift()!;
    if (visited.has(artifactKey)) continue;
    visited.add(artifactKey);
    const artifact = artifacts.get(artifactKey);
    if (!artifact) continue;
    result.push(artifact.resolvedSource);
    pending.push(...artifact.dependencies);
  }
  return result;
}

export function captureIntrinsicSources(
  session: CaptureSession,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  references: ReadonlyMap<string, ReferenceDocument>,
): UiConcreteSource[] {
  if (session.document.kind !== "Reference" || !session.reference) return reachableArtifactSources(session, artifacts);

  const sourceCatalog = createSourceCatalog([...artifacts.values()].map((artifact) => ({ path: artifact.path, source: artifact.source })));
  const reference =
    session.displayMode === "unityBaseline"
      ? {
          referenceKey: session.reference.referenceKey,
          subjectArtifactKey: session.reference.subjectArtifactKey,
        }
      : session.reference;
  const subject = artifacts.get(reference.subjectArtifactKey)?.resolvedSource;
  const referenceCatalog = createPreviewReferenceCatalog(
    [
      ...[...references.values()]
        .filter((document) => document.referenceKey !== reference.referenceKey)
        .map((document) => ({ path: document.path, reference: document.reference })),
      { path: session.document.path, reference },
    ],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({
    sourceCatalog,
    referenceCatalog,
    referenceKey: reference.referenceKey,
    ...(subject ? { subjectSessionPatches: stateRootPreviewPatches(subject, session.preview?.states ?? {}) } : {}),
  });
  return resolved.tree
    ? walkResolvedPreviewInstances(resolved.tree).map((instance) => instance.effectiveLayoutSource)
    : reachableArtifactSources(session, artifacts);
}

async function waitForRenderedImages(): Promise<void> {
  await Promise.all(
    [...document.images].map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error(`图片加载失败：${image.src}`)), { once: true });
        });
      }
      if (image.naturalWidth <= 0) throw new Error(`图片加载失败：${image.src}`);
    }),
  );
}

export function CapturePage() {
  const [session, setSession] = useState<CaptureSession>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const artifacts = useMemo(() => (session ? artifactDocuments(session) : new Map<string, ArtifactDocument>()), [session]);
  const references = useMemo(() => (session ? referenceDocuments(session) : new Map<string, ReferenceDocument>()), [session]);

  useEffect(() => {
    document.documentElement.classList.add("capture-document");
    return () => document.documentElement.classList.remove("capture-document");
  }, []);

  useEffect(() => {
    void loadSession()
      .then(setSession)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void waitForWebIntrinsicAssets(captureIntrinsicSources(session, artifacts, references))
      .then(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        await waitForRenderedImages();
        await document.fonts.ready;
        if (active) setReady(true);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [session, artifacts, references]);

  if (error)
    return (
      <main className={webClasses("capture-error")} data-capture-error={error}>
        {error}
      </main>
    );
  if (!session) return <main className={webClasses("capture-loading")}>正在加载截图</main>;

  const style = { width: session.viewport[0], height: session.viewport[1], background: session.background };
  const classes = `capture-root ${session.includeDebug ? "capture-debug" : ""}`;
  const content =
    session.document.kind === "Reference" && session.reference ? (
      <CapturedReference session={session} artifacts={artifacts} references={references} />
    ) : session.source ? (
      <ArtifactPreview
        source={applyStateRootPreviewOverrides(
          createSourceCatalog(session.artifacts).entries.get(session.source.artifactKey)!.resolvedSource,
          session.preview?.states ?? {},
        )}
        artifacts={artifacts}
        viewport={session.viewport}
      />
    ) : (
      <div data-capture-error="Capture document is missing">缺少截图文档</div>
    );

  return (
    <main className={webClasses(classes)} data-capture-root data-capture-ready={ready ? "true" : "false"} style={style}>
      {content}
    </main>
  );
}
