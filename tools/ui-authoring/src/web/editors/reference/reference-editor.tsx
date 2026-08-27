import {
  BookOpen,
  Box,
  Camera,
  Copy,
  FileDiff,
  FolderOpen,
  GitFork,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import { resolveBinderBindings } from "../../../kernel/binder.js";
import { type ResolvedPreviewReference, walkResolvedPreviewInstances } from "../../../kernel/preview-reference-resolver.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import { findNode } from "../../../kernel/tree.js";
import type { AuthoringAssetEntry } from "../../../schema/asset-catalog.js";
import type { CaptureArtifactOverlay, CaptureClip, CaptureRequest } from "../../../schema/ui-capture.js";
import type { UiReference } from "../../../schema/ui-prototype-schema.js";
import { CaptureDialog, type CaptureDialogOptions } from "../../capture/capture-dialog.js";
import { ReferencePreview } from "../../rendering/reference-preview/reference-preview.js";
import { isSelectionAddressRendered, type SelectionAddress } from "../../rendering/selection.js";
import { type DocumentCatalog } from "../../shared/api/client.js";
import { gameObjectName, resolveGameObjectPath } from "../../shared/game-object-label.js";
import { LegmaMark } from "../../shared/legma-mark.js";
import { SelectControl } from "../../shared/select-control.js";
import { ThemeToggle } from "../../shared/theme.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { SaveAutoSaveControl, workspaceSavePresentation } from "../../workspace/auto-save-toggle.js";
import { documentDirectory } from "../../workspace/explorer/artifact-explorer-model.js";
import { ProjectPanel } from "../../workspace/project/project-panel.js";
import { useWorkspaceEditing, workspaceDocumentId } from "../../workspace/workspace-editing-context.js";
import { CanvasViewport, CanvasZoomControls, PREVIEW_CANVAS_ZOOM_POLICY, useCanvasViewport } from "../shared/canvas-viewport.js";
import sharedStyles from "../shared/editor-shell.module.css";
import { EditorSidebarTabs } from "../shared/editor-sidebar-tabs.js";
import { PanelResizeHandle } from "../shared/panel-resize-handle.js";
import { type PreviewEditorMode, previewDisplayMode } from "../shared/preview-editor-mode.js";
import { PreviewRelations } from "../shared/preview-relations.js";
import { type ReferenceDirectEditRequest, ReferenceEditor } from "../shared/reference-document-inspector.js";
import { ReferenceChangesInspector, ReferenceNodeInspector } from "../shared/reference-workbench-inspector.js";
import { ResolvedPreviewHierarchy } from "../shared/resolved-preview-hierarchy.js";
import { ReferenceSelectionLocation } from "../shared/selection-location.js";
import { useWorkbenchPanelResize } from "../shared/workbench-panel-resize.js";
import { useWorkbenchSidebarLayout, WorkbenchSidebar } from "../shared/workbench-sidebar.js";
import referenceStyles from "./reference-editor.module.css";

const webClasses = createWebClasses(sharedStyles, referenceStyles);
type ReferenceSidebarView = "project" | "hierarchy" | "relations";
const REFERENCE_SIDEBAR_VIEWS: readonly ReferenceSidebarView[] = ["project", "hierarchy", "relations"];

type ReferenceValueScope = "subject" | "context";

interface ReferenceQuickEdit {
  readonly address: SelectionAddress;
  readonly scope: ReferenceValueScope;
  readonly fieldName: string;
  readonly capability: "text" | "state";
  readonly inherited: string;
  readonly options?: readonly string[];
  readonly value: string;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function startsWithPath(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((entry, index) => path[index] === entry);
}

function setReferenceValue(
  reference: UiReference,
  scope: ReferenceValueScope,
  fieldName: string,
  capability: string,
  value: unknown | undefined,
): UiReference {
  const currentValues = scope === "subject" ? reference.values : reference.context?.values;
  const currentPatch = currentValues?.[fieldName] ?? {};
  const nextPatch = { ...currentPatch };
  if (value === undefined) delete nextPatch[capability];
  else nextPatch[capability] = value;
  const nextValues = { ...(currentValues ?? {}) };
  if (Object.keys(nextPatch).length > 0) nextValues[fieldName] = nextPatch;
  else delete nextValues[fieldName];
  if (scope === "subject") {
    const next = { ...reference };
    if (Object.keys(nextValues).length > 0) next.values = nextValues;
    else delete next.values;
    return next;
  }
  if (!reference.context) return reference;
  const context = { ...reference.context };
  if (Object.keys(nextValues).length > 0) context.values = nextValues;
  else delete context.values;
  return { ...reference, context };
}

export function ReferenceWorkbench({
  catalog,
  assets,
  artifacts,
  references,
  prototypes,
  document,
  savedDocument,
  draft,
  dirty,
  captureOverlays,
  captureDeletedPaths,
  onSave,
  onDraftChange,
  onOpenDirectory,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
  onRefreshAssets,
  onNotice,
  displayMode,
  onDisplayMode,
  zoom,
  onZoom,
}: {
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly document: ReferenceDocument;
  readonly savedDocument: ReferenceDocument;
  readonly draft: boolean;
  readonly dirty: boolean;
  readonly captureOverlays: readonly CaptureArtifactOverlay[];
  readonly captureDeletedPaths: readonly string[];
  readonly onSave: (documentIds: ReadonlySet<string>) => Promise<boolean>;
  readonly onDraftChange: (reference: UiReference) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenArtifact: (artifactKey: string, selectedId?: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly onRefreshAssets: () => Promise<void> | void;
  readonly onNotice: (notice: string) => void;
  readonly displayMode: PreviewEditorMode;
  readonly onDisplayMode: (mode: PreviewEditorMode) => void;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
}) {
  const editing = useWorkspaceEditing();
  const [notice, setNotice] = useState("就绪");
  const reportNotice = useCallback(
    (next: string): void => {
      setNotice(next);
      onNotice(next);
    },
    [onNotice],
  );
  const [previewReference, setPreviewReference] = useState(document.reference);
  const [resolved, setResolved] = useState<ResolvedPreviewReference>();
  const [captureOpen, setCaptureOpen] = useState(false);
  const sidebar = useWorkbenchSidebarLayout(REFERENCE_SIDEBAR_VIEWS, "project");
  const [inspectorView, setInspectorView] = useState<"node" | "reference" | "changes">("node");
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const panelResize = useWorkbenchPanelResize();
  const [hierarchyQuery, setHierarchyQuery] = useState("");
  const [quickEdit, setQuickEdit] = useState<ReferenceQuickEdit | null>(null);
  const [directEdit, setDirectEdit] = useState<ReferenceDirectEditRequest>();
  const sourceCatalog = useMemo(
    () => createSourceCatalog([...artifacts.values()].map((entry) => ({ path: entry.path, source: entry.source }))),
    [artifacts],
  );
  const rootArtifactKey =
    displayMode === "unityBaseline"
      ? previewReference.subjectArtifactKey
      : (previewReference.context?.parentArtifactKey ?? previewReference.subjectArtifactKey);
  const rootArtifact = artifacts.get(rootArtifactKey);
  const configuredViewport =
    previewReference.viewport ?? (rootArtifact ? artifactInitialSize(rootArtifact.resolvedSource) : ([1, 1] as const));
  const [viewport, setViewport] = useState<readonly [number, number]>(configuredViewport);
  const viewportController = useCanvasViewport({
    contentSize: viewport,
    zoom,
    zoomPolicy: PREVIEW_CANVAS_ZOOM_POLICY,
    onZoom,
  });
  const rootNodeId = rootArtifact?.resolvedSource.root.id ?? rootArtifactKey;
  const [selection, setSelection] = useState<SelectionAddress>({
    rootArtifactKey,
    instancePath: [],
    ownerArtifactKey: rootArtifactKey,
    nodeId: rootNodeId,
  });
  const selectionPath = rootArtifact
    ? resolveGameObjectPath(rootArtifact.resolvedSource, artifacts, selection.instancePath, selection.nodeId)
    : undefined;
  const [hoveredSelection, setHoveredSelection] = useState<SelectionAddress>();
  const [selectionVisible, setSelectionVisible] = useState(true);
  useEffect(() => setViewport(configuredViewport), [configuredViewport[0], configuredViewport[1], rootArtifactKey]);
  useEffect(() => {
    if (displayMode === "editPreview") setInspectorView("reference");
  }, [displayMode]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSelectionVisible(isSelectionAddressRendered(selection)));
    return () => cancelAnimationFrame(frame);
  }, [selection, previewReference, displayMode]);

  const requestReferenceEdit = (update: (reference: UiReference) => UiReference): void => {
    setDirectEdit((current) => ({ id: (current?.id ?? 0) + 1, update }));
  };
  const selectAddress = (address: SelectionAddress): void => {
    setSelection(address);
    setInspectorView("node");
  };
  const beginQuickEdit = (address: SelectionAddress): void => {
    if (displayMode !== "editPreview" || !resolved?.tree) return;
    const instances = walkResolvedPreviewInstances(resolved.tree);
    const selectedInstance = instances.find(
      (entry) => entry.artifactKey === address.ownerArtifactKey && samePath(entry.instancePath, address.instancePath),
    );
    const subjectInstance = resolved.subjectInstanceKey
      ? instances.find((entry) => entry.instanceKey === resolved.subjectInstanceKey)
      : undefined;
    if (!selectedInstance || !subjectInstance) return;
    const inSubject = startsWithPath(selectedInstance.instancePath, subjectInstance.instancePath);
    const scope: ReferenceValueScope = inSubject ? "subject" : "context";
    const ownerArtifactKey = scope === "subject" ? previewReference.subjectArtifactKey : previewReference.context?.parentArtifactKey;
    const basePath = scope === "subject" ? subjectInstance.instancePath : [];
    if (!ownerArtifactKey) return;
    const binding = resolveBinderBindings(sourceCatalog, ownerArtifactKey).find(
      (entry) =>
        entry.targetOwnerArtifactKey === address.ownerArtifactKey &&
        entry.target.nodeId === address.nodeId &&
        samePath([...basePath, ...(entry.target.instancePath ?? [])], address.instancePath),
    );
    const owner = artifacts.get(address.ownerArtifactKey)?.resolvedSource;
    const node = owner ? findNode(owner, address.nodeId) : undefined;
    if (!binding || !node) {
      setNotice("该节点没有可用于 Reference 值的 Binder 字段");
      return;
    }
    const currentValues = scope === "subject" ? previewReference.values : previewReference.context?.values;
    if (binding.componentType === "Text" && node.components?.Text) {
      const inherited = node.components.Text.text ?? "";
      setQuickEdit({
        address,
        scope,
        fieldName: binding.fieldName,
        capability: "text",
        inherited,
        value: String(currentValues?.[binding.fieldName]?.text ?? inherited),
      });
      return;
    }
    if (binding.componentType === "StateRoot" && node.components?.StateRoot) {
      const inherited = node.components.StateRoot.currentState;
      setQuickEdit({
        address,
        scope,
        fieldName: binding.fieldName,
        capability: "state",
        inherited,
        options: Object.keys(node.components.StateRoot.states),
        value: String(currentValues?.[binding.fieldName]?.state ?? inherited),
      });
      return;
    }
    setNotice(`Binder '${binding.fieldName}' 请在右侧 Reference 值 Inspector 中编辑`);
  };
  const commitQuickEdit = (): void => {
    if (!quickEdit) return;
    requestReferenceEdit((reference) =>
      setReferenceValue(
        reference,
        quickEdit.scope,
        quickEdit.fieldName,
        quickEdit.capability,
        quickEdit.value === quickEdit.inherited ? undefined : quickEdit.value,
      ),
    );
    setNotice(`已更新${quickEdit.scope === "subject" ? "主体" : "上下文"}值：${quickEdit.fieldName}.${quickEdit.capability}`);
    setQuickEdit(null);
  };
  const save = async (): Promise<void> => {
    setNotice("正在保存当前文档");
    if (await onSave(documentIds)) setNotice("当前文档已保存");
  };
  const copySelectedSummary = async (): Promise<void> => {
    const instance = resolved?.tree
      ? walkResolvedPreviewInstances(resolved.tree).find(
          (entry) => entry.artifactKey === selection.ownerArtifactKey && samePath(entry.instancePath, selection.instancePath),
        )
      : undefined;
    const node = instance ? findNode(instance.source, selection.nodeId) : undefined;
    if (!instance || !node) return;
    await navigator.clipboard.writeText(
      `${JSON.stringify({ instanceKey: instance.instanceKey, role: instance.role, placement: instance.placement, node }, null, 2)}\n`,
    );
    setNotice(`已复制结构摘要：${gameObjectName(node)}`);
  };
  const selectedClip: CaptureClip = {
    nodeId: selection.nodeId,
    ...(selection.instancePath.length > 0 ? { instancePath: selection.instancePath } : {}),
  };
  const captureRequest = (options: CaptureDialogOptions): CaptureRequest => ({
    path: document.path,
    reference: previewReference,
    overlays: captureOverlays,
    deletedPaths: captureDeletedPaths,
    ...(displayMode === "unityBaseline" ? { displayMode: "unityBaseline" as const } : {}),
    ...(draft || JSON.stringify(previewReference) !== JSON.stringify(document.reference) ? { draft: true } : {}),
    ...(options.selected ? { clip: selectedClip } : {}),
    ...(options.scale === 2 ? { scale: 2 } : {}),
    ...(options.background !== "transparent" ? { background: options.background } : {}),
    ...(options.includeDebug ? { includeDebug: true } : {}),
  });
  const documentIds = new Set([workspaceDocumentId("reference", document.referenceKey)]);
  const savePresentation = workspaceSavePresentation(editing, documentIds, dirty, notice);
  const hasSavableChanges = dirty;

  return (
    <main
      className={webClasses(
        `editor-shell reference-shell ${treeCollapsed ? "is-tree-collapsed" : ""} ${inspectorCollapsed ? "is-inspector-collapsed" : ""}`,
      )}
      style={panelResize.panelStyle}
    >
      <header className={webClasses("topbar reference-topbar")}>
        <div className={webClasses("brand-block")}>
          <LegmaMark className={webClasses("legma-mark")} />
          <strong>
            {document.referenceKey}
            {editing.dirtyDocuments.has(workspaceDocumentId("reference", document.referenceKey)) ? " *" : ""}
          </strong>
        </div>
        <div className={webClasses("toolbar-group")}>
          <div className={webClasses("mode-segments")} role="group" aria-label="预览显示模式">
            <button
              className={webClasses(displayMode === "preview" ? "is-active" : "")}
              type="button"
              onClick={() => onDisplayMode("preview")}
            >
              预览
            </button>
            <button
              className={webClasses(displayMode === "editPreview" ? "is-active" : "")}
              type="button"
              onClick={() => onDisplayMode("editPreview")}
            >
              编辑预览
            </button>
            <button
              className={webClasses(displayMode === "unityBaseline" ? "is-active" : "")}
              type="button"
              onClick={() => onDisplayMode("unityBaseline")}
            >
              Unity 基线
            </button>
          </div>
          <span className={webClasses("toolbar-divider")} />
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => setTreeCollapsed((value) => !value)}
            title={treeCollapsed ? "展开左侧栏" : "折叠左侧栏"}
          >
            {treeCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
          <SaveAutoSaveControl
            hasSavableChanges={hasSavableChanges}
            documentIds={documentIds}
            onSave={save}
            saveTitle="保存"
            saveButtonClassName={webClasses("icon-button")}
            iconSize={15}
          />
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={editing.onOpenChanges}
            disabled={editing.dirtyDocuments.size === 0}
            title="查看改动"
          >
            <FileDiff size={15} />
          </button>
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => onOpenDirectory(documentDirectory(document.path))}
            title="返回所属目录"
          >
            <FolderOpen size={15} />
          </button>
          <button className={webClasses("icon-button")} type="button" onClick={() => setCaptureOpen(true)} title="截图">
            <Camera size={15} />
          </button>
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => setInspectorCollapsed((value) => !value)}
            title={inspectorCollapsed ? "展开 Inspector" : "折叠 Inspector"}
          >
            {inspectorCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
          </button>
          <span className={webClasses("toolbar-divider")} />
          <ThemeToggle className={webClasses("icon-button")} />
        </div>
        <div className={webClasses("directory-topbar-meta")}>
          <span>{previewReference.subjectArtifactKey}</span>
          <span>
            {viewport[0]} x {viewport[1]}
          </span>
        </div>
      </header>
      <aside
        className={webClasses(`tree-panel ${sidebar.layout.views.includes("hierarchy") ? "is-hierarchy-view" : ""}`)}
        data-ui="tree-panel"
        data-sidebar-view={sidebar.layout.focused}
      >
        <WorkbenchSidebar
          label="Reference 侧栏"
          layout={sidebar.layout}
          onSelect={sidebar.select}
          onFocus={sidebar.focus}
          onSplit={sidebar.setSplit}
          tabs={[
            { value: "project", label: "Project", icon: <FolderOpen size={13} /> },
            {
              value: "hierarchy",
              label: "Hierarchy",
              icon: <Layers3 size={13} />,
              title: `${resolved?.tree ? walkResolvedPreviewInstances(resolved.tree).length : 0} 个实例`,
            },
            { value: "relations", label: "关系", icon: <GitFork size={13} />, title: "Reference 依赖图" },
          ]}
          render={(sidebarView, focused) =>
            sidebarView === "project" ? (
              <ProjectPanel
                dock="left"
                catalog={catalog}
                assets={assets}
                selectedDocumentPath={document.path}
                frameShortcutEnabled={focused}
                onRefreshAssets={onRefreshAssets}
                onOpenDirectory={onOpenDirectory}
                onOpenArtifact={onOpenArtifact}
                onOpenReference={onOpenReference}
                onOpenPrototype={onOpenPrototype}
                onNotice={reportNotice}
              />
            ) : sidebarView === "hierarchy" ? (
              <>
                <div className={webClasses("hierarchy-controls is-readonly")}>
                  <label>
                    <Search size={13} />
                    <input
                      value={hierarchyQuery}
                      onChange={(event) => setHierarchyQuery(event.target.value)}
                      placeholder="实例 / 节点 / Component"
                    />
                  </label>
                  <button
                    className={webClasses("icon-button")}
                    type="button"
                    onClick={() => void copySelectedSummary()}
                    title="复制当前节点结构摘要"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <ResolvedPreviewHierarchy
                  resolved={resolved}
                  artifacts={artifacts}
                  selection={selection}
                  hoveredAddress={hoveredSelection}
                  query={hierarchyQuery}
                  frameShortcutEnabled={focused}
                  onClearQuery={() => setHierarchyQuery("")}
                  onSelect={selectAddress}
                  onHover={setHoveredSelection}
                  onOpenArtifact={onOpenArtifact}
                />
              </>
            ) : (
              <PreviewRelations
                root={{ kind: "reference", key: document.referenceKey }}
                artifacts={artifacts}
                references={references}
                prototypes={prototypes}
                onOpenArtifact={onOpenArtifact}
                onOpenReference={onOpenReference}
                onOpenPrototype={onOpenPrototype}
              />
            )
          }
        />
      </aside>
      <PanelResizeHandle panel="tree" resize={panelResize} />
      <section className={webClasses("workspace-panel reference-workspace")}>
        <div className={webClasses("canvas-meta")}>
          <span>
            {displayMode === "unityBaseline"
              ? "Unity 基线"
              : previewReference.context
                ? `${previewReference.subjectArtifactKey} 位于 ${previewReference.context.parentArtifactKey}`
                : previewReference.subjectArtifactKey}
          </span>
          <CanvasZoomControls zoom={zoom} zoomPolicy={PREVIEW_CANVAS_ZOOM_POLICY} onZoom={onZoom} onFit={viewportController.fit} />
          <span>
            {viewport[0]} x {viewport[1]}
          </span>
        </div>
        <CanvasViewport controller={viewportController}>
          <ReferencePreview
            reference={previewReference}
            referencePath={document.path}
            references={references}
            artifacts={artifacts}
            embeddedScale={zoom}
            displayMode={previewDisplayMode(displayMode)}
            selectedAddress={selection}
            hoveredAddress={hoveredSelection}
            onSelectAddress={selectAddress}
            onEditAddress={beginQuickEdit}
            onHoverAddress={setHoveredSelection}
            onViewportChange={setViewport}
            onResolved={setResolved}
          />
        </CanvasViewport>
        {quickEdit ? (
          <div className={webClasses("reference-quick-edit")} role="dialog" aria-label="编辑 Reference 值">
            <strong>
              {quickEdit.fieldName}.{quickEdit.capability}
            </strong>
            {quickEdit.options ? (
              <SelectControl
                autoFocus
                value={quickEdit.value}
                options={quickEdit.options.map((option) => ({ value: option, label: option }))}
                onValueChange={(value) => setQuickEdit({ ...quickEdit, value })}
              />
            ) : (
              <textarea autoFocus value={quickEdit.value} onChange={(event) => setQuickEdit({ ...quickEdit, value: event.target.value })} />
            )}
            <div>
              <button type="button" onClick={() => setQuickEdit(null)}>
                取消
              </button>
              <button type="button" onClick={commitQuickEdit}>
                写入值
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <PanelResizeHandle panel="inspector" resize={panelResize} />
      <aside className={webClasses("inspector-panel reference-inspector")} data-ui="inspector-panel">
        <EditorSidebarTabs
          label="Reference Inspector"
          value={inspectorView}
          onChange={setInspectorView}
          tabs={[
            { value: "node", label: "节点", icon: <Box size={13} /> },
            { value: "reference", label: "Reference", icon: <BookOpen size={13} /> },
            { value: "changes", label: "改动", icon: <FileDiff size={13} /> },
          ]}
        />
        {inspectorView === "node" ? (
          <>
            <ReferenceSelectionLocation
              selection={selection}
              nodePathLabels={selectionPath?.labels ?? [...selection.instancePath, selection.nodeId]}
              visible={selectionVisible}
              onOpenArtifact={onOpenArtifact}
              onHover={setHoveredSelection}
            />
            <ReferenceNodeInspector
              selection={selection}
              resolved={resolved}
              artifacts={artifacts}
              editable={displayMode === "editPreview"}
              onEditValue={() => beginQuickEdit(selection)}
              onEditReference={() => setInspectorView("reference")}
              onOpenArtifact={onOpenArtifact}
            />
          </>
        ) : inspectorView === "reference" ? (
          <ReferenceEditor
            document={document}
            savedReference={savedDocument.reference}
            artifacts={artifacts}
            references={references}
            directEdit={directEdit}
            onDraftChange={(reference) => {
              setPreviewReference(reference);
              onDraftChange(reference);
            }}
          />
        ) : (
          <ReferenceChangesInspector
            reference={previewReference}
            resolved={resolved}
            onEditReference={() => setInspectorView("reference")}
          />
        )}
      </aside>
      <footer className={webClasses("statusbar")}>
        <span className={webClasses(`dirty-dot is-${savePresentation.state}`)} />
        <span title={savePresentation.title}>{savePresentation.label}</span>
        <span className={webClasses("status-path")}>{document.path}</span>
      </footer>
      {captureOpen ? (
        <CaptureDialog
          title={document.referenceKey}
          selectedLabel={selectionPath?.namePath ?? selectedClip.nodeId}
          buildRequest={captureRequest}
          onClose={() => setCaptureOpen(false)}
        />
      ) : null}
    </main>
  );
}
