import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Box,
  CornerDownRight,
  FileDiff,
  FolderOpen,
  GitFork,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Redo2,
  Search,
  Square,
  ToggleRight,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import { graphTargetKey, resolveArtifactUseSite } from "../../../kernel/artifact-use-site.js";
import { resolveBinderBindings } from "../../../kernel/binder.js";
import { previewReferenceOwnerRootArtifactKey } from "../../../kernel/preview-reference.js";
import { type ResolvedPreviewReference, walkResolvedPreviewInstances } from "../../../kernel/preview-reference-resolver.js";
import {
  applyPrototypeInteraction,
  createPrototypeSession,
  findPrototypeInteraction,
  prototypeOwnerValues,
} from "../../../kernel/prototype.js";
import { formatPrototype } from "../../../kernel/prototype-canonical.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import { findNode } from "../../../kernel/tree.js";
import { componentPreview } from "../../../registry/component-registry.js";
import type { AuthoringAssetEntry } from "../../../schema/asset-catalog.js";
import type { GraphTarget, PreviewReferenceOwnerScope, PrototypeAction, UiReference } from "../../../schema/ui-prototype-schema.js";
import type { UiBindingComponentType } from "../../../schema/ui-source-schema.js";
import { ReferencePreview } from "../../rendering/reference-preview/reference-preview.js";
import { isSelectionAddressRendered, type SelectionAddress } from "../../rendering/selection.js";
import { type DocumentCatalog } from "../../shared/api/client.js";
import { resolveGameObjectPath } from "../../shared/game-object-label.js";
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
import { useSerializedDocumentState } from "../shared/document-state.js";
import sharedStyles from "../shared/editor-shell.module.css";
import { EditorSidebarTabs } from "../shared/editor-sidebar-tabs.js";
import { PanelResizeHandle } from "../shared/panel-resize-handle.js";
import { PreviewRelations } from "../shared/preview-relations.js";
import { ReferenceEditor } from "../shared/reference-document-inspector.js";
import { ReferenceChangesInspector, ReferenceNodeInspector } from "../shared/reference-workbench-inspector.js";
import { ResolvedPreviewHierarchy } from "../shared/resolved-preview-hierarchy.js";
import { ReferenceSelectionLocation } from "../shared/selection-location.js";
import { useWorkbenchPanelResize } from "../shared/workbench-panel-resize.js";
import { useWorkbenchSidebarLayout, WorkbenchSidebar } from "../shared/workbench-sidebar.js";
import prototypeStyles from "./prototype-editor.module.css";

export type AuthoringMode = "prototype" | "present";

const webClasses = createWebClasses(sharedStyles, prototypeStyles);
type PrototypeSidebarView = "project" | "flow" | "hierarchy" | "relations";
const PROTOTYPE_SIDEBAR_VIEWS: readonly PrototypeSidebarView[] = ["project", "flow", "hierarchy", "relations"];

interface PrototypeValueTarget {
  readonly key: string;
  readonly owner: PreviewReferenceOwnerScope;
  readonly ownerLabel: string;
  readonly fieldName: string;
  readonly capability: string;
  readonly componentType: UiBindingComponentType;
  readonly options?: readonly string[];
  readonly defaultValue: unknown;
}

function ownerKey(owner: PreviewReferenceOwnerScope): string {
  return JSON.stringify(owner);
}

function ownerLabel(
  owner: PreviewReferenceOwnerScope,
  reference: UiReference,
  sourceCatalog: ReturnType<typeof createSourceCatalog>,
): string {
  if (owner.kind === "subject") return "主体";
  if (owner.kind === "context") return "上下文";
  const root = previewReferenceOwnerRootArtifactKey(reference, owner);
  const source = root ? sourceCatalog.entries.get(root.artifactKey)?.resolvedSource : undefined;
  const path = source && root ? resolveGameObjectPath(source, sourceCatalog.entries, root.instancePath).namePath : "";
  if (owner.kind === "artifact") return `${owner.root === "subject" ? "主体" : "上下文"}${path ? `/${path}` : ""}`;
  return `挂载/${owner.mountKey}${path ? `/${path}` : ""}`;
}

function actionKindLabel(kind: PrototypeAction["kind"]): string {
  if (kind === "Navigate") return "跳转";
  if (kind === "Back") return "返回";
  return "设置值";
}

function referenceValueOwners(
  reference: UiReference,
  resolved: ResolvedPreviewReference | undefined,
): readonly PreviewReferenceOwnerScope[] {
  const owners = new Map<string, PreviewReferenceOwnerScope>();
  const add = (owner: PreviewReferenceOwnerScope): void => {
    owners.set(ownerKey(owner), owner);
  };
  add({ kind: "subject" });
  if (reference.context) add({ kind: "context" });
  for (const entry of reference.instanceValues ?? []) add(entry.owner);
  for (const mount of reference.mounts ?? []) add({ kind: "mount", mountKey: mount.key });
  if (resolved?.tree) {
    const instances = walkResolvedPreviewInstances(resolved.tree);
    const subject = resolved.subjectInstanceKey ? instances.find((entry) => entry.instanceKey === resolved.subjectInstanceKey) : undefined;
    for (const instance of instances) {
      if (instance.instanceKey === resolved.subjectInstanceKey || (instance.role === "context" && instance.instancePath.length === 0))
        continue;
      if (instance.placement.kind === "mount") {
        add({ kind: "mount", mountKey: instance.placement.mountKey });
        continue;
      }
      const inSubject = subject && subject.instancePath.every((part, index) => instance.instancePath[index] === part);
      const basePath = inSubject ? subject.instancePath : [];
      const instancePath = instance.instancePath.slice(basePath.length);
      if (instancePath.length > 0) add({ kind: "artifact", root: inSubject ? "subject" : "context", instancePath: [...instancePath] });
    }
  }
  return [...owners.values()];
}

function valueTargetsForReference(
  reference: UiReference,
  resolved: ResolvedPreviewReference | undefined,
  sourceCatalog: ReturnType<typeof createSourceCatalog>,
): readonly PrototypeValueTarget[] {
  const result: PrototypeValueTarget[] = [];
  for (const owner of referenceValueOwners(reference, resolved)) {
    const root = previewReferenceOwnerRootArtifactKey(reference, owner);
    if (!root) continue;
    let artifactKey: string;
    try {
      artifactKey = resolveArtifactUseSite(sourceCatalog, {
        rootArtifactKey: root.artifactKey,
        ...(root.instancePath.length > 0 ? { instancePath: [...root.instancePath] } : {}),
      }).source.artifactKey;
    } catch {
      continue;
    }
    for (const binding of resolveBinderBindings(sourceCatalog, artifactKey)) {
      const capabilities = ["active", ...Object.keys(componentPreview(binding.componentType)?.fields ?? {})];
      for (const capability of capabilities) {
        const definition = componentPreview(binding.componentType)?.fields[capability];
        const targetSource = sourceCatalog.entries.get(binding.targetOwnerArtifactKey)?.resolvedSource;
        const targetNode = targetSource ? findNode(targetSource, binding.target.nodeId) : undefined;
        const options = definition?.handler === "stateRootState" ? Object.keys(targetNode?.components?.StateRoot?.states ?? {}) : undefined;
        const defaultValue = capability === "active" ? true : (options?.[0] ?? definition?.defaultValue ?? "");
        const target = { owner, fieldName: binding.fieldName, capability };
        result.push({
          key: JSON.stringify(target),
          owner,
          ownerLabel: ownerLabel(owner, reference, sourceCatalog),
          fieldName: binding.fieldName,
          capability,
          componentType: binding.componentType,
          ...(options && options.length > 0 ? { options } : {}),
          defaultValue,
        });
      }
    }
  }
  return result;
}

interface PrototypeWorkbenchProps {
  readonly mode: AuthoringMode;
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly savedReferences: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypeDocument: PrototypeDocument;
  readonly savedPrototype: PrototypeDocument;
  readonly initialReferenceKey?: string | undefined;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
  readonly onMode: (mode: AuthoringMode) => void;
  readonly dirty: boolean;
  readonly onSave: (documentIds: ReadonlySet<string>) => Promise<boolean>;
  readonly onPrototypeDraftChange: (prototype: PrototypeDocument["prototype"]) => void;
  readonly onReferenceDraftChange: (referenceKey: string, reference: ReferenceDocument["reference"]) => void;
  readonly onOpenArtifact: (artifactKey: string, selectedId?: string) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly onRefreshAssets: () => Promise<void> | void;
  readonly onNotice: (notice: string) => void;
}

export function PrototypeWorkbench({
  mode,
  catalog,
  assets,
  artifacts,
  references,
  prototypes,
  savedReferences,
  prototypeDocument,
  savedPrototype,
  initialReferenceKey,
  zoom,
  onZoom,
  onMode,
  dirty,
  onSave,
  onPrototypeDraftChange,
  onReferenceDraftChange,
  onOpenArtifact,
  onOpenDirectory,
  onOpenReference,
  onOpenPrototype,
  onRefreshAssets,
  onNotice,
}: PrototypeWorkbenchProps) {
  const editing = useWorkspaceEditing();
  const document = useSerializedDocumentState(prototypeDocument.prototype, formatPrototype, savedPrototype.prototype);
  const sourceCatalog = useMemo(
    () => createSourceCatalog([...artifacts.values()].map((entry) => ({ path: entry.path, source: entry.source }))),
    [artifacts],
  );
  const [currentReferenceKey, setCurrentReferenceKey] = useState(
    initialReferenceKey && references.has(initialReferenceKey) ? initialReferenceKey : document.source.startReferenceKey,
  );
  const [selectedTarget, setSelectedTarget] = useState<GraphTarget | null>(null);
  const [notice, setNotice] = useState("就绪");
  const reportNotice = useCallback(
    (next: string): void => {
      setNotice(next);
      onNotice(next);
    },
    [onNotice],
  );
  const startReference = references.get(document.source.startReferenceKey)?.reference;
  const startViewport: readonly [number, number] = startReference
    ? (startReference.viewport ??
      (() => {
        const rootSource = artifacts.get(startReference.context?.parentArtifactKey ?? startReference.subjectArtifactKey)?.resolvedSource;
        return rootSource ? artifactInitialSize(rootSource) : ([1, 1] as const);
      })())
    : [1, 1];
  const [session, setSession] = useState(() => createPrototypeSession(document.source, startViewport, startReference));
  const currentReferenceDocument = references.get(mode === "present" ? session.currentReferenceKey : currentReferenceKey);
  const currentReference = currentReferenceDocument?.reference;
  const [draftReference, setDraftReference] = useState(currentReference);
  const [resolvedPreviewState, setResolvedPreviewState] = useState<{
    readonly referenceKey: string;
    readonly resolved: ResolvedPreviewReference;
  }>();
  const resolvedPreview =
    resolvedPreviewState && resolvedPreviewState.referenceKey === currentReferenceDocument?.referenceKey
      ? resolvedPreviewState.resolved
      : undefined;
  const setResolvedPreview = useCallback(
    (resolved: ResolvedPreviewReference) => {
      if (!currentReferenceDocument) return;
      setResolvedPreviewState({ referenceKey: currentReferenceDocument.referenceKey, resolved });
    },
    [currentReferenceDocument],
  );
  const initialRootArtifactKey = currentReference
    ? (currentReference.context?.parentArtifactKey ?? currentReference.subjectArtifactKey)
    : "";
  const initialRootNodeId = artifacts.get(initialRootArtifactKey)?.resolvedSource.root.id ?? initialRootArtifactKey;
  const [selection, setSelection] = useState<SelectionAddress>({
    rootArtifactKey: initialRootArtifactKey,
    instancePath: [],
    ownerArtifactKey: initialRootArtifactKey,
    nodeId: initialRootNodeId,
  });
  const selectionRoot = artifacts.get(selection.rootArtifactKey)?.resolvedSource;
  const selectionPath = selectionRoot
    ? resolveGameObjectPath(selectionRoot, artifacts, selection.instancePath, selection.nodeId)
    : undefined;
  const [hoveredSelection, setHoveredSelection] = useState<SelectionAddress>();
  const [selectionVisible, setSelectionVisible] = useState(true);
  const sidebar = useWorkbenchSidebarLayout(PROTOTYPE_SIDEBAR_VIEWS, "flow");
  const [inspectorView, setInspectorView] = useState<"node" | "reference" | "changes" | "interaction">("interaction");
  const [hierarchyQuery, setHierarchyQuery] = useState("");
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const panelResize = useWorkbenchPanelResize();
  const selectedInteraction = selectedTarget ? findPrototypeInteraction(document.source, currentReferenceKey, selectedTarget) : undefined;
  const referenceKeys = [...references.keys()].sort();
  const valueTargets = useMemo(
    () => (currentReference ? valueTargetsForReference(draftReference ?? currentReference, resolvedPreview, sourceCatalog) : []),
    [currentReference, draftReference, resolvedPreview, sourceCatalog],
  );
  const currentViewport: readonly [number, number] =
    currentReference?.viewport ??
    (() => {
      const rootSource = currentReference
        ? artifacts.get(currentReference.context?.parentArtifactKey ?? currentReference.subjectArtifactKey)?.resolvedSource
        : undefined;
      return rootSource ? artifactInitialSize(rootSource) : ([1, 1] as const);
    })();
  const viewportController = useCanvasViewport({
    contentSize: currentViewport,
    zoom,
    zoomPolicy: PREVIEW_CANVAS_ZOOM_POLICY,
    onZoom,
  });

  useEffect(() => {
    setSelectedTarget(null);
    const nextReference = references.get(currentReferenceKey)?.reference;
    if (!nextReference) return;
    const rootArtifactKey = nextReference.context?.parentArtifactKey ?? nextReference.subjectArtifactKey;
    const rootNodeId = artifacts.get(rootArtifactKey)?.resolvedSource.root.id ?? rootArtifactKey;
    setSelection({ rootArtifactKey, instancePath: [], ownerArtifactKey: rootArtifactKey, nodeId: rootNodeId });
  }, [currentReferenceKey, references, artifacts]);
  useEffect(() => setDraftReference(currentReference), [currentReferenceKey, currentReference]);
  useEffect(() => onPrototypeDraftChange(document.source), [document.source, onPrototypeDraftChange]);
  const savedPrototypeText = useMemo(() => formatPrototype(savedPrototype.prototype), [savedPrototype.prototype]);
  useEffect(() => {
    if (formatPrototype(document.source) === savedPrototypeText) document.markSaved(savedPrototype.prototype);
  }, [document.source, document.markSaved, savedPrototype.prototype, savedPrototypeText]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSelectionVisible(isSelectionAddressRendered(selection)));
    return () => cancelAnimationFrame(frame);
  }, [selection, draftReference, currentReferenceKey]);

  const pageDocumentIds = new Set([
    workspaceDocumentId("prototype", document.source.prototypeKey),
    ...(currentReferenceDocument ? [workspaceDocumentId("reference", currentReferenceDocument.referenceKey)] : []),
  ]);
  const hasSavableChanges = [...pageDocumentIds].some((documentId) => editing.dirtyDocuments.has(documentId));
  const save = async (): Promise<void> => {
    setNotice("正在保存当前文档");
    if (await onSave(pageDocumentIds)) setNotice("当前文档已保存");
  };
  const savePresentation = workspaceSavePresentation(editing, pageDocumentIds, dirty, notice);

  const setActions = (actions: readonly PrototypeAction[]): void => {
    if (!selectedTarget) return;
    document.commit((prototype) => {
      const targetKey = graphTargetKey(selectedTarget);
      const retained = prototype.interactions.filter(
        (interaction) => interaction.referenceKey !== currentReferenceKey || graphTargetKey(interaction.trigger.target) !== targetKey,
      );
      if (actions.length === 0) return { ...prototype, interactions: retained };
      return {
        ...prototype,
        interactions: [
          ...retained,
          { referenceKey: currentReferenceKey, trigger: { kind: "Tap", target: selectedTarget }, actions: [...actions] },
        ],
      };
    });
  };

  const defaultValueAction = (): PrototypeAction | undefined => {
    const target = valueTargets[0];
    return target
      ? {
          kind: "SetValue",
          owner: target.owner,
          fieldName: target.fieldName,
          capability: target.capability,
          value: structuredClone(target.defaultValue),
        }
      : undefined;
  };

  const addAction = (kind: PrototypeAction["kind"]): void => {
    const actions = [...(selectedInteraction?.actions ?? [])];
    if (kind === "Back") actions.push({ kind: "Back" });
    if (kind === "Navigate")
      actions.push({ kind: "Navigate", referenceKey: referenceKeys.find((key) => key !== currentReferenceKey) ?? currentReferenceKey });
    if (kind === "SetValue") {
      const action = defaultValueAction();
      if (!action) {
        setNotice("当前 Reference 没有 Binder 值目标");
        return;
      }
      actions.push(action);
    }
    setActions(actions);
  };

  const updateAction = (index: number, action: PrototypeAction): void => {
    const actions = [...(selectedInteraction?.actions ?? [])];
    actions[index] = action;
    setActions(actions);
  };

  const moveAction = (index: number, direction: -1 | 1): void => {
    const actions = [...(selectedInteraction?.actions ?? [])];
    const nextIndex = index + direction;
    if (!actions[index] || nextIndex < 0 || nextIndex >= actions.length) return;
    [actions[index], actions[nextIndex]] = [actions[nextIndex]!, actions[index]!];
    setActions(actions);
  };

  const removeAction = (index: number): void =>
    setActions((selectedInteraction?.actions ?? []).filter((_, actionIndex) => actionIndex !== index));

  const setStartReference = (referenceKey: string): void => {
    document.commit((prototype) => ({ ...prototype, startReferenceKey: referenceKey }));
    setCurrentReferenceKey(referenceKey);
  };

  const beginPresent = (): void => {
    setSession(createPrototypeSession(document.source, startViewport, references.get(document.source.startReferenceKey)?.reference));
    onMode("present");
  };

  const presentTap = (target: GraphTarget): void => {
    const interaction = findPrototypeInteraction(document.source, session.currentReferenceKey, target);
    if (interaction) setSession((current) => applyPrototypeInteraction(current, interaction));
  };

  const selectPrototypeAddress = (address: SelectionAddress): void => {
    setSelection(address);
    const owner = artifacts.get(address.ownerArtifactKey)?.resolvedSource;
    const node = owner ? findNode(owner, address.nodeId) : undefined;
    const target = node?.components?.ButtonEx
      ? {
          rootArtifactKey: address.rootArtifactKey,
          instancePath: [...address.instancePath],
          nodeId: address.nodeId,
          componentType: "ButtonEx",
        }
      : null;
    setSelectedTarget(target);
    setInspectorView(target ? "interaction" : "node");
  };

  const selectTapTarget = (target: GraphTarget): void => {
    setSelectedTarget(target);
    const instance = resolvedPreview?.tree
      ? walkResolvedPreviewInstances(resolvedPreview.tree).find(
          (entry) => entry.instancePath.join("/") === (target.instancePath ?? []).join("/"),
        )
      : undefined;
    setSelection({
      rootArtifactKey: target.rootArtifactKey,
      instancePath: target.instancePath ?? [],
      ownerArtifactKey: instance?.artifactKey ?? target.rootArtifactKey,
      nodeId: target.nodeId,
    });
    setInspectorView("interaction");
  };

  if (!currentReferenceDocument || !currentReference)
    return (
      <main className={webClasses("fatal-state")}>
        <Box size={28} />
        <h1>缺少 Reference</h1>
        <pre>{mode === "present" ? session.currentReferenceKey : currentReferenceKey}</pre>
      </main>
    );

  if (mode === "present") {
    const subjectSessionValues = prototypeOwnerValues(session, session.currentReferenceKey, { kind: "subject" });
    const contextSessionValues = prototypeOwnerValues(session, session.currentReferenceKey, { kind: "context" });
    const instanceSessionValues: Record<string, NonNullable<typeof subjectSessionValues>> = {};
    if (resolvedPreview?.tree) {
      const instances = walkResolvedPreviewInstances(resolvedPreview.tree);
      const subject = resolvedPreview.subjectInstanceKey
        ? instances.find((entry) => entry.instanceKey === resolvedPreview.subjectInstanceKey)
        : undefined;
      const owners = document.source.interactions
        .filter((interaction) => interaction.referenceKey === session.currentReferenceKey)
        .flatMap((interaction) => interaction.actions.flatMap((action) => (action.kind === "SetValue" ? [action.owner] : [])));
      for (const owner of owners) {
        if (owner.kind === "subject" || owner.kind === "context") continue;
        let instanceKey: string | undefined;
        if (owner.kind === "artifact") {
          const base = owner.root === "subject" ? (subject?.instancePath ?? []) : [];
          const path = [...base, ...owner.instancePath];
          instanceKey = instances.find((entry) => entry.instancePath.join("/") === path.join("/"))?.instanceKey;
        } else {
          const mount = resolvedPreview.generatedSessionData.find((entry) => entry.kind === "mount" && entry.mountKey === owner.mountKey);
          const mountInstance = mount ? instances.find((entry) => entry.instanceKey === mount.instanceKey) : undefined;
          const path = mountInstance ? [...mountInstance.instancePath, ...(owner.instancePath ?? [])] : undefined;
          instanceKey = path ? instances.find((entry) => entry.instancePath.join("/") === path.join("/"))?.instanceKey : undefined;
        }
        const values = prototypeOwnerValues(session, session.currentReferenceKey, owner);
        if (instanceKey && values) instanceSessionValues[instanceKey] = values;
      }
    }
    return (
      <main className={webClasses("present-shell")}>
        <ReferencePreview
          reference={currentReference}
          referencePath={currentReferenceDocument.path}
          references={references}
          artifacts={artifacts}
          viewport={session.viewport}
          subjectSessionValues={subjectSessionValues}
          contextSessionValues={contextSessionValues}
          instanceSessionValues={instanceSessionValues}
          onTap={presentTap}
          onResolved={setResolvedPreview}
          className={webClasses("present-canvas-host")}
        />
        <div className={webClasses("present-controls")}>
          <button
            className={webClasses("present-control")}
            type="button"
            onClick={() =>
              setSession((current) => ({
                ...current,
                currentReferenceKey: current.backStack.at(-1) ?? current.currentReferenceKey,
                backStack: current.backStack.slice(0, -1),
              }))
            }
            disabled={session.backStack.length === 0}
            title="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <button className={webClasses("present-control")} type="button" onClick={() => onMode("prototype")} title="退出演示">
            <X size={18} />
          </button>
        </div>
      </main>
    );
  }

  const selectedKey = selectedTarget ? graphTargetKey(selectedTarget) : undefined;
  return (
    <main
      className={webClasses(
        `editor-shell prototype-shell ${treeCollapsed ? "is-tree-collapsed" : ""} ${inspectorCollapsed ? "is-inspector-collapsed" : ""}`,
      )}
      style={panelResize.panelStyle}
    >
      <header className={webClasses("topbar prototype-topbar")}>
        <div className={webClasses("brand-block")}>
          <LegmaMark className={webClasses("legma-mark")} />
          <strong>
            {document.source.prototypeKey}
            {editing.dirtyDocuments.has(workspaceDocumentId("prototype", document.source.prototypeKey)) ? " *" : ""}
          </strong>
        </div>
        <div className={webClasses("toolbar-group")}>
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => onOpenDirectory(documentDirectory(prototypeDocument.path))}
            title="返回所属目录"
          >
            <FolderOpen size={16} />
          </button>
          <span className={webClasses("toolbar-divider")} />
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => setTreeCollapsed((value) => !value)}
            title={treeCollapsed ? "展开左侧栏" : "折叠左侧栏"}
          >
            {treeCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button className={webClasses("icon-button")} type="button" onClick={document.undo} disabled={!document.canUndo} title="撤销">
            <Undo2 size={17} />
          </button>
          <button className={webClasses("icon-button")} type="button" onClick={document.redo} disabled={!document.canRedo} title="重做">
            <Redo2 size={17} />
          </button>
          <SaveAutoSaveControl
            hasSavableChanges={hasSavableChanges}
            documentIds={pageDocumentIds}
            onSave={save}
            saveTitle="保存"
            saveButtonClassName={webClasses("icon-button")}
            iconSize={17}
          />
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={editing.onOpenChanges}
            disabled={editing.dirtyDocuments.size === 0}
            title="查看改动"
          >
            <FileDiff size={16} />
          </button>
          <span className={webClasses("toolbar-divider")} />
          <ThemeToggle className={webClasses("icon-button")} />
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => setInspectorCollapsed((value) => !value)}
            title={inspectorCollapsed ? "展开 Inspector" : "折叠 Inspector"}
          >
            {inspectorCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
        <button className={webClasses("projection-button prototype-play")} type="button" onClick={beginPresent}>
          <Play size={15} />
          开始演示
        </button>
      </header>

      <aside
        className={webClasses(`tree-panel flow-panel ${sidebar.layout.views.includes("hierarchy") ? "is-hierarchy-view" : ""}`)}
        data-ui="tree-panel"
        data-sidebar-view={sidebar.layout.focused}
      >
        <WorkbenchSidebar
          label="Prototype 侧栏"
          layout={sidebar.layout}
          onSelect={sidebar.select}
          onFocus={sidebar.focus}
          onSplit={sidebar.setSplit}
          tabs={[
            { value: "project", label: "Project", icon: <FolderOpen size={13} /> },
            { value: "flow", label: "流程", icon: <ToggleRight size={13} /> },
            { value: "hierarchy", label: "Hierarchy", icon: <Layers3 size={13} /> },
            { value: "relations", label: "关系", icon: <GitFork size={13} /> },
          ]}
          render={(sidebarView, focused) =>
            sidebarView === "project" ? (
              <ProjectPanel
                dock="left"
                catalog={catalog}
                assets={assets}
                selectedDocumentPath={prototypeDocument.path}
                frameShortcutEnabled={focused}
                onRefreshAssets={onRefreshAssets}
                onOpenDirectory={onOpenDirectory}
                onOpenArtifact={onOpenArtifact}
                onOpenReference={onOpenReference}
                onOpenPrototype={onOpenPrototype}
                onNotice={reportNotice}
              />
            ) : sidebarView === "flow" ? (
              <div className={webClasses("prototype-flow-view")}>
                <div className={webClasses("panel-heading compact")}>
                  <div>
                    <span className={webClasses("panel-kicker")}>流程</span>
                    <h2>Reference</h2>
                  </div>
                  <span className={webClasses("node-count")}>{references.size}</span>
                </div>
                <label className={webClasses("prototype-start-reference")}>
                  <span>起始 Reference</span>
                  <SelectControl
                    value={document.source.startReferenceKey}
                    options={referenceKeys.map((referenceKey) => ({ value: referenceKey, label: referenceKey }))}
                    onValueChange={setStartReference}
                  />
                </label>
                <div className={webClasses("flow-list")}>
                  {referenceKeys.map((referenceKey) => {
                    const reference = references.get(referenceKey)!;
                    const interactionCount = document.source.interactions.filter(
                      (interaction) => interaction.referenceKey === referenceKey,
                    ).length;
                    return (
                      <button
                        key={referenceKey}
                        className={webClasses(currentReferenceKey === referenceKey ? "is-active" : "")}
                        type="button"
                        onClick={() => setCurrentReferenceKey(referenceKey)}
                      >
                        <Square size={13} />
                        <span>
                          <strong>{referenceKey}</strong>
                          <small>{reference.subjectArtifactKey}</small>
                        </span>
                        <em>{interactionCount}</em>
                      </button>
                    );
                  })}
                </div>
              </div>
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
                </div>
                <ResolvedPreviewHierarchy
                  resolved={resolvedPreview}
                  artifacts={artifacts}
                  selection={selection}
                  hoveredAddress={hoveredSelection}
                  query={hierarchyQuery}
                  frameShortcutEnabled={focused}
                  onClearQuery={() => setHierarchyQuery("")}
                  onSelect={selectPrototypeAddress}
                  onHover={setHoveredSelection}
                  onOpenArtifact={onOpenArtifact}
                />
              </>
            ) : (
              <PreviewRelations
                root={{ kind: "prototype", key: document.source.prototypeKey }}
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

      <section className={webClasses("workspace-panel prototype-workspace")}>
        <div className={webClasses("canvas-meta")}>
          <span>{currentReference.referenceKey}</span>
          <CanvasZoomControls zoom={zoom} zoomPolicy={PREVIEW_CANVAS_ZOOM_POLICY} onZoom={onZoom} onFit={viewportController.fit} />
          <span>{currentViewport.join(" x ")}</span>
        </div>
        <CanvasViewport controller={viewportController}>
          <ReferencePreview
            reference={draftReference ?? currentReference}
            referencePath={currentReferenceDocument.path}
            references={references}
            artifacts={artifacts}
            embeddedScale={zoom}
            selectedTargetKey={selectedKey}
            onTap={selectTapTarget}
            selectedAddress={selection}
            hoveredAddress={hoveredSelection}
            onSelectAddress={selectPrototypeAddress}
            onHoverAddress={setHoveredSelection}
            onResolved={setResolvedPreview}
          />
        </CanvasViewport>
      </section>

      <PanelResizeHandle panel="inspector" resize={panelResize} />
      <aside className={webClasses("inspector-panel prototype-inspector")} data-ui="inspector-panel">
        <EditorSidebarTabs
          label="Prototype Inspector"
          value={inspectorView}
          onChange={setInspectorView}
          tabs={[
            { value: "node", label: "节点", icon: <Box size={13} /> },
            { value: "reference", label: "Reference", icon: <Square size={13} /> },
            { value: "changes", label: "改动", icon: <FileDiff size={13} /> },
            { value: "interaction", label: "交互", icon: <ToggleRight size={13} /> },
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
              resolved={resolvedPreview}
              artifacts={artifacts}
              editable
              onEditValue={() => setInspectorView("reference")}
              onEditReference={() => setInspectorView("reference")}
              onOpenArtifact={onOpenArtifact}
            />
          </>
        ) : inspectorView === "reference" ? (
          <ReferenceEditor
            key={currentReferenceDocument.path}
            document={currentReferenceDocument}
            savedReference={savedReferences.get(currentReferenceDocument.referenceKey)?.reference ?? currentReferenceDocument.reference}
            artifacts={artifacts}
            references={references}
            onDraftChange={(reference) => {
              setDraftReference(reference);
              onReferenceDraftChange(currentReferenceDocument.referenceKey, reference);
            }}
          />
        ) : inspectorView === "changes" ? (
          <ReferenceChangesInspector
            reference={draftReference ?? currentReference}
            resolved={resolvedPreview}
            onEditReference={() => setInspectorView("reference")}
          />
        ) : (
          <section className={webClasses("prototype-inspector-section")}>
            <h3>点击操作</h3>
            {!selectedTarget ? (
              <p className={webClasses("empty-value")}>请选择 ButtonEx 目标</p>
            ) : (
              <>
                <code className={webClasses("target-address")} title={selectedKey}>
                  {selectionPath?.namePath ?? selection.nodeId} · ButtonEx
                </code>
                <div className={webClasses("action-list")}>
                  {(selectedInteraction?.actions ?? []).map((action, index) => (
                    <div className={webClasses("action-row")} key={`${action.kind}:${index}`}>
                      <span className={webClasses("action-kind")}>{actionKindLabel(action.kind)}</span>
                      {action.kind === "Navigate" ? (
                        <SelectControl
                          value={action.referenceKey}
                          options={referenceKeys.map((key) => ({ value: key, label: key }))}
                          onValueChange={(referenceKey) => updateAction(index, { kind: "Navigate", referenceKey })}
                        />
                      ) : null}
                      {action.kind === "SetValue" ? (
                        <>
                          <SelectControl
                            value={JSON.stringify({ owner: action.owner, fieldName: action.fieldName, capability: action.capability })}
                            options={valueTargets.map((target) => ({
                              value: target.key,
                              label: `${target.ownerLabel} · ${target.fieldName}.${target.capability}`,
                            }))}
                            onValueChange={(value) => {
                              const target = valueTargets.find((item) => item.key === value);
                              if (!target) return;
                              updateAction(index, {
                                kind: "SetValue",
                                owner: target.owner,
                                fieldName: target.fieldName,
                                capability: target.capability,
                                value: structuredClone(target.defaultValue),
                              });
                            }}
                          />
                          {(() => {
                            const target = valueTargets.find(
                              (entry) =>
                                entry.key ===
                                JSON.stringify({ owner: action.owner, fieldName: action.fieldName, capability: action.capability }),
                            );
                            if (target?.options)
                              return (
                                <SelectControl
                                  value={String(action.value)}
                                  options={target.options.map((option) => ({ value: option, label: option }))}
                                  onValueChange={(value) => updateAction(index, { ...action, value })}
                                />
                              );
                            if (action.capability === "active")
                              return (
                                <input
                                  type="checkbox"
                                  checked={Boolean(action.value)}
                                  onChange={(event) => updateAction(index, { ...action, value: event.target.checked })}
                                />
                              );
                            return (
                              <input
                                value={String(action.value ?? "")}
                                onChange={(event) => updateAction(index, { ...action, value: event.target.value })}
                              />
                            );
                          })()}
                        </>
                      ) : null}
                      <div className={webClasses("action-tools")}>
                        <button type="button" onClick={() => moveAction(index, -1)} disabled={index === 0} title="上移">
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveAction(index, 1)}
                          disabled={index === (selectedInteraction?.actions.length ?? 0) - 1}
                          title="下移"
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button type="button" onClick={() => removeAction(index)} title="删除">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className={webClasses("add-action-row")}>
                  <button type="button" onClick={() => addAction("Navigate")}>
                    <CornerDownRight size={13} />
                    跳转
                  </button>
                  <button type="button" onClick={() => addAction("Back")}>
                    <Undo2 size={13} />
                    返回
                  </button>
                  <button type="button" onClick={() => addAction("SetValue")} disabled={valueTargets.length === 0}>
                    <ToggleRight size={13} />
                    设置值
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </aside>

      <footer className={webClasses("statusbar")}>
        <span className={webClasses(`dirty-dot is-${savePresentation.state}`)} />
        <span title={savePresentation.title}>{savePresentation.label}</span>
        <span className={webClasses("status-path")}>{prototypeDocument.path}</span>
      </footer>
    </main>
  );
}
