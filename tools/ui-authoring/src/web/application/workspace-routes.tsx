import { FileJson } from "lucide-react";
import { type Dispatch, lazy, type SetStateAction, Suspense } from "react";
import type { UiNodeClipboard } from "../../kernel/node-clipboard.js";
import type { AuthoringAssetEntry } from "../../schema/asset-catalog.js";
import type { UiPrototype, UiReference } from "../../schema/ui-prototype-schema.js";
import { defaultPreviewDocument } from "../editors/artifact/artifact-editor-context-preview.js";
import type { ArtifactWorkspaceState } from "../editors/artifact/artifact-workspace-state.js";
import type { UiComponentClipboard } from "../editors/artifact/inspector/component-clipboard.js";
import type { AuthoringMode } from "../editors/prototype/prototype-editor.js";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import type { PreviewEditorMode } from "../editors/shared/preview-editor-mode.js";
import type { DocumentCatalog } from "../shared/api/client.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../shared/types.js";
import { createWebClasses } from "../styles/web-styles.js";
import type { WorkspaceLocation } from "../workspace/explorer/artifact-explorer-model.js";

const webClasses = createWebClasses(sharedStyles, dialogStyles);

type ArtifactEditorModule = typeof import("../editors/artifact/artifact-editor.js");
let artifactEditorModule: Promise<ArtifactEditorModule> | undefined;

function loadArtifactEditor(): Promise<ArtifactEditorModule> {
  artifactEditorModule ??= import("../editors/artifact/artifact-editor.js");
  return artifactEditorModule;
}

const ArtifactEditor = lazy(async () => ({ default: (await loadArtifactEditor()).ArtifactEditor }));
const ReferenceWorkbench = lazy(async () => ({ default: (await import("../editors/reference/reference-editor.js")).ReferenceWorkbench }));
const PrototypeWorkbench = lazy(async () => ({ default: (await import("../editors/prototype/prototype-editor.js")).PrototypeWorkbench }));
const DirectoryShell = lazy(async () => ({ default: (await import("../workspace/directory/directory-shell.js")).DirectoryShell }));
const WorkspaceRelations = lazy(async () => ({ default: (await import("../workspace/relations/workspace-relations.js")).default }));
const WorkspaceOverview = lazy(async () => ({ default: (await import("../workspace/overview/workspace-overview.js")).default }));

export function preloadArtifactEditor(): void {
  void loadArtifactEditor().catch(() => {
    artifactEditorModule = undefined;
  });
}

function WorkspaceRouteLoading() {
  return (
    <main className={webClasses("loading-state")}>
      <div className={webClasses("loading-mark")} />
      <span>正在加载 Canvas</span>
    </main>
  );
}

interface WorkspaceRoutesProps {
  readonly location: WorkspaceLocation;
  readonly workspace: ArtifactWorkspaceState;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly savedReferences: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly savedPrototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly dirtyDocuments: ReadonlySet<string>;
  readonly collaborationActivity: Parameters<typeof WorkspaceOverview>[0]["activity"];
  readonly collaborationActivityRefreshing: boolean;
  readonly authoringMode: AuthoringMode;
  readonly setAuthoringMode: Dispatch<SetStateAction<AuthoringMode>>;
  readonly previewDisplayMode: PreviewEditorMode;
  readonly setPreviewDisplayMode: Dispatch<SetStateAction<PreviewEditorMode>>;
  readonly selectedId: string;
  readonly setSelectedId: Dispatch<SetStateAction<string>>;
  readonly viewportIndex: number;
  readonly setViewportIndex: Dispatch<SetStateAction<number>>;
  readonly zoom: number;
  readonly setZoom: Dispatch<SetStateAction<number>>;
  readonly notice: string;
  readonly onNotice: (notice: string) => void;
  readonly nodeClipboard: UiNodeClipboard | null;
  readonly onCopyNode: Dispatch<SetStateAction<UiNodeClipboard | null>>;
  readonly componentClipboard: UiComponentClipboard | null;
  readonly onCopyComponent: Dispatch<SetStateAction<UiComponentClipboard | null>>;
  readonly onRefreshActivity: () => void;
  readonly onOpenArtifact: (artifactKey: string, selectedId?: string) => void;
  readonly onOpenRelations: (artifactKey: string) => void;
  readonly onCloseRelations: (artifactKey: string) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly onDirectoryView: Parameters<typeof DirectoryShell>[0]["onView"];
  readonly onGalleryScale: Parameters<typeof DirectoryShell>[0]["onScale"];
  readonly onReloadAssets: () => Promise<void>;
  readonly onCreateDocument: () => void;
  readonly onReferenceDraftChange: (referenceKey: string, reference: UiReference) => void;
  readonly onPrototypeDraftChange: (prototypeKey: string, prototype: UiPrototype) => void;
  readonly onSave: (documentIds: ReadonlySet<string>) => Promise<boolean>;
  readonly onRevertSource: (artifactKey: string, path: string, expectedRevision: string) => Promise<void>;
}

export function WorkspaceRoutes(props: WorkspaceRoutesProps) {
  const { location, workspace, artifacts, references, savedReferences, prototypes, savedPrototypes, catalog, assets, dirtyDocuments } =
    props;

  if (location.kind === "overview") {
    return (
      <Suspense fallback={<WorkspaceRouteLoading />}>
        <WorkspaceOverview
          catalog={catalog}
          dirtyDocumentIds={dirtyDocuments}
          activity={props.collaborationActivity}
          activityRefreshing={props.collaborationActivityRefreshing}
          onRefreshActivity={props.onRefreshActivity}
          onOpenArtifact={props.onOpenArtifact}
          onOpenReference={props.onOpenReference}
          onOpenPrototype={props.onOpenPrototype}
        />
      </Suspense>
    );
  }
  if (location.kind === "relations") {
    const artifact = artifacts.get(location.artifactKey);
    if (!artifact)
      return (
        <main className={webClasses("fatal-state")}>
          <FileJson size={28} />
          <h1>缺少 Artifact</h1>
          <pre>{location.artifactKey}</pre>
        </main>
      );
    return (
      <Suspense fallback={<WorkspaceRouteLoading />}>
        <WorkspaceRelations
          artifactKey={artifact.artifactKey}
          artifacts={artifacts}
          references={references}
          prototypes={prototypes}
          onBack={() => props.onCloseRelations(artifact.artifactKey)}
          onOpenArtifact={props.onOpenArtifact}
          onOpenReference={props.onOpenReference}
          onOpenPrototype={props.onOpenPrototype}
        />
      </Suspense>
    );
  }
  if (location.kind === "reference") {
    const document = references.get(location.referenceKey);
    if (!document)
      return (
        <main className={webClasses("fatal-state")}>
          <FileJson size={28} />
          <h1>缺少 Reference</h1>
          <pre>{location.referenceKey}</pre>
        </main>
      );
    const currentDirty = dirtyDocuments.has(`reference:${document.referenceKey}`);
    return (
      <Suspense fallback={<WorkspaceRouteLoading />}>
        <ReferenceWorkbench
          key={document.path}
          catalog={catalog}
          assets={assets}
          artifacts={artifacts}
          references={references}
          prototypes={prototypes}
          document={document}
          savedDocument={savedReferences.get(document.referenceKey) ?? document}
          draft={workspace.dirty}
          dirty={currentDirty}
          captureOverlays={workspace.transaction.upserts}
          captureDeletedPaths={workspace.transaction.deletes.map((entry) => entry.path)}
          displayMode={props.previewDisplayMode}
          onDisplayMode={props.setPreviewDisplayMode}
          zoom={props.zoom}
          onZoom={props.setZoom}
          onSave={props.onSave}
          onDraftChange={(reference) => props.onReferenceDraftChange(document.referenceKey, reference)}
          onOpenDirectory={props.onOpenDirectory}
          onOpenArtifact={props.onOpenArtifact}
          onOpenReference={props.onOpenReference}
          onOpenPrototype={props.onOpenPrototype}
          onRefreshAssets={props.onReloadAssets}
          onNotice={props.onNotice}
        />
      </Suspense>
    );
  }
  if (location.kind === "prototype") {
    const document = prototypes.get(location.prototypeKey);
    if (!document)
      return (
        <main className={webClasses("fatal-state")}>
          <FileJson size={28} />
          <h1>缺少 Prototype</h1>
          <pre>{location.prototypeKey}</pre>
        </main>
      );
    return (
      <Suspense fallback={<WorkspaceRouteLoading />}>
        <PrototypeWorkbench
          key={`${document.path}:${location.referenceKey ?? ""}`}
          mode={props.authoringMode}
          catalog={catalog}
          assets={assets}
          artifacts={artifacts}
          references={references}
          prototypes={prototypes}
          savedReferences={savedReferences}
          prototypeDocument={document}
          savedPrototype={savedPrototypes.get(document.prototypeKey) ?? document}
          initialReferenceKey={location.referenceKey}
          zoom={props.zoom}
          onZoom={props.setZoom}
          onMode={props.setAuthoringMode}
          dirty={dirtyDocuments.has(`prototype:${document.prototypeKey}`)}
          onSave={props.onSave}
          onPrototypeDraftChange={(prototype) => props.onPrototypeDraftChange(document.prototypeKey, prototype)}
          onReferenceDraftChange={props.onReferenceDraftChange}
          onOpenArtifact={props.onOpenArtifact}
          onOpenDirectory={props.onOpenDirectory}
          onOpenReference={props.onOpenReference}
          onOpenPrototype={props.onOpenPrototype}
          onRefreshAssets={props.onReloadAssets}
          onNotice={props.onNotice}
        />
      </Suspense>
    );
  }
  if (location.kind === "directory") {
    return (
      <Suspense fallback={<WorkspaceRouteLoading />}>
        <DirectoryShell
          directory={location.path}
          view={location.view}
          scale={location.scale}
          catalog={catalog}
          assets={assets}
          artifacts={artifacts}
          references={references}
          prototypes={prototypes}
          onOpenDirectory={props.onOpenDirectory}
          onView={props.onDirectoryView}
          onScale={props.onGalleryScale}
          onOpenArtifact={props.onOpenArtifact}
          onOpenReference={props.onOpenReference}
          onOpenPrototype={props.onOpenPrototype}
          onRefreshAssets={props.onReloadAssets}
          onNotice={props.onNotice}
          dirty={false}
          canUndo={workspace.canUndo}
          canRedo={workspace.canRedo}
          onUndo={workspace.undo}
          onRedo={workspace.redo}
          onCreate={props.onCreateDocument}
        />
      </Suspense>
    );
  }
  const artifact = artifacts.get(location.artifactKey);
  if (!artifact)
    return (
      <main className={webClasses("fatal-state")}>
        <FileJson size={28} />
        <h1>缺少 Artifact</h1>
        <pre>{location.artifactKey}</pre>
      </main>
    );
  const defaultPreview = defaultPreviewDocument(references, artifact);
  const artifactDocumentIds = new Set([
    `artifact:${artifact.artifactKey}`,
    ...(defaultPreview ? [`reference:${defaultPreview.referenceKey}`] : []),
  ]);
  return (
    <Suspense fallback={<WorkspaceRouteLoading />}>
      <ArtifactEditor
        artifact={artifact}
        workspace={workspace}
        artifacts={artifacts}
        references={references}
        savedReferences={savedReferences}
        prototypes={prototypes}
        catalog={catalog}
        assets={assets}
        onRefreshAssets={props.onReloadAssets}
        selectedId={props.selectedId}
        onSelect={props.setSelectedId}
        onOpenArtifact={props.onOpenArtifact}
        onOpenRelations={props.onOpenRelations}
        onOpenDirectory={props.onOpenDirectory}
        onOpenReference={props.onOpenReference}
        onOpenPrototype={props.onOpenPrototype}
        onReferenceDraftChange={props.onReferenceDraftChange}
        onPrototypeDraftChange={props.onPrototypeDraftChange}
        onSave={() => props.onSave(artifactDocumentIds)}
        onRevertSource={props.onRevertSource}
        nodeClipboard={props.nodeClipboard}
        onCopyNode={props.onCopyNode}
        componentClipboard={props.componentClipboard}
        onCopyComponent={props.onCopyComponent}
        viewportIndex={props.viewportIndex}
        onViewport={props.setViewportIndex}
        zoom={props.zoom}
        onZoom={props.setZoom}
        notice={props.notice}
        onNotice={props.onNotice}
        displayMode={props.previewDisplayMode}
        onDisplayMode={props.setPreviewDisplayMode}
      />
    </Suspense>
  );
}
