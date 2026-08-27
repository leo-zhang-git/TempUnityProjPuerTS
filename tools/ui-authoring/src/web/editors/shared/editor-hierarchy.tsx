import {
  Box,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers3,
  Link2,
  Type as TypeIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { ResolvedPreviewInstance } from "../../../kernel/preview-reference-resolver.js";
import { applyCurrentStateRootStates } from "../../../kernel/preview-values.js";
import { stateRootActiveControllers } from "../../../kernel/state-root-control.js";
import { findNode } from "../../../kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../../schema/ui-source-schema.js";
import {
  parseSelectionAddress,
  type SelectionAddress,
  type SelectionUpdateMode,
  sameSelectionAddress,
  selectionAddressKey,
  selectionIncludes,
} from "../../rendering/selection.js";
import { gameObjectDiagnosticLabel, gameObjectName } from "../../shared/game-object-label.js";
import {
  PROJECT_ASSET_DRAG_TYPE,
  PROJECT_PREFAB_REF_DRAG_TYPE,
  type ProjectDragItem,
  readProjectDragData,
} from "../../shared/project-drag.js";
import { SelectedItemEdgeButton, useFrameSelectedShortcut, useSelectedItemReveal } from "../../shared/selected-item-reveal.js";
import type { ArtifactDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { createHierarchyNodeStatusIndex, type HierarchyNodeStatusIndex, hierarchyNodeStatus } from "./editor-hierarchy-status.js";
import sharedStyles from "./editor-shell.module.css";
import { writeHierarchyBindingDragData } from "./hierarchy-node-drag.js";
import { hierarchySelectionRange } from "./hierarchy-selection.js";

const webClasses = createWebClasses(sharedStyles);

export type HierarchyDropPosition = "before" | "inside" | "after";

interface HierarchyInlineRenamePreview {
  readonly nodeId: string;
  readonly issue: string | undefined;
}

export interface EditorHierarchyTreeProps {
  readonly source: UiConcreteSource;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly selectedAddresses: readonly SelectionAddress[];
  readonly primaryAddress: SelectionAddress;
  readonly hoveredAddress?: SelectionAddress | undefined;
  readonly bindingTargets?: ReadonlyMap<string, readonly string[]> | undefined;
  readonly externalBindingTargets?: ReadonlyMap<string, readonly string[]> | undefined;
  readonly changes?: ReadonlyMap<string, "added" | "modified"> | undefined;
  readonly errors?: ReadonlyMap<string, readonly string[]> | undefined;
  readonly previewGeneratedNodeIds?: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  readonly previewInstanceLabels?: ReadonlyMap<string, ReadonlyMap<string, string>> | undefined;
  readonly previewRootArtifactKey?: string | undefined;
  readonly resolvedSourceInstance?: ResolvedPreviewInstance | undefined;
  readonly evaluatedSource?: UiConcreteSource | undefined;
  readonly query?: string | undefined;
  readonly authoringEnabled?: boolean | undefined;
  readonly structureEditable?: boolean | undefined;
  readonly frameShortcutEnabled?: boolean | undefined;
  readonly revealRequest?: number | undefined;
  readonly onClearQuery?: (() => void) | undefined;
  readonly onDenied?: ((reason: string) => void) | undefined;
  readonly onSelect: (address: SelectionAddress, mode?: SelectionUpdateMode) => void;
  readonly onSelectMany?: ((addresses: readonly SelectionAddress[], mode?: SelectionUpdateMode) => void) | undefined;
  readonly onHover: (address: SelectionAddress | undefined) => void;
  readonly onMove?: ((nodeId: string, targetId: string, position: HierarchyDropPosition) => void) | undefined;
  readonly onProjectDrop?: ((address: SelectionAddress, item: ProjectDragItem) => void) | undefined;
  readonly hiddenAddresses?: ReadonlySet<string> | undefined;
  readonly onToggleHidden?: ((address: SelectionAddress) => void) | undefined;
  readonly onContextMenu?: ((address: SelectionAddress, x: number, y: number) => void) | undefined;
  readonly onRenamePreview?: ((address: SelectionAddress, displayName: string) => HierarchyInlineRenamePreview) | undefined;
  readonly onRename?: ((address: SelectionAddress, displayName: string) => string | undefined) | undefined;
  readonly onOpenArtifact: (artifactKey: string) => void;
}

interface TreeNodeProps extends EditorHierarchyTreeProps {
  readonly node: UiNode;
  readonly depth: number;
  readonly rootArtifactKey: string;
  readonly instancePath: readonly string[];
  readonly ownerArtifactKey: string;
  readonly previewInstance?: ResolvedPreviewInstance | undefined;
  readonly activeSource: UiConcreteSource;
  readonly previewRowLabel?: string | undefined;
  readonly previewGeneratedAncestor?: boolean | undefined;
  readonly statusIndex: HierarchyNodeStatusIndex;
  readonly onSelectRange: (address: SelectionAddress) => void;
}

const HIERARCHY_NODE_DRAG_TYPE = "application/x-ui-authoring-node";
const EMPTY_NAMES = new Map<string, readonly string[]>();
const EMPTY_CHANGES = new Map<string, "added" | "modified">();
const EMPTY_ERRORS = new Map<string, readonly string[]>();

function treeNodeBindingNames(
  address: SelectionAddress,
  bindingTargets: ReadonlyMap<string, readonly string[]>,
  externalBindingTargets: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  return [
    ...(bindingTargets.get(selectionAddressKey(address)) ?? []),
    ...(address.instancePath.length === 0 ? (externalBindingTargets.get(`${address.ownerArtifactKey}:${address.nodeId}`) ?? []) : []),
  ];
}

function generatedPreviewChildren(instance: ResolvedPreviewInstance | undefined, nodeId: string): readonly ResolvedPreviewInstance[] {
  return (
    instance?.children.filter(
      (child) => (child.placement.kind === "collection" || child.placement.kind === "mount") && child.placement.nodeId === nodeId,
    ) ?? []
  );
}

function referencedPreviewChild(instance: ResolvedPreviewInstance | undefined, nodeId: string): ResolvedPreviewInstance | undefined {
  return instance?.children.find(
    (child) => (child.placement.kind === "prefabRef" || child.placement.kind === "contextBinding") && child.placement.nodeId === nodeId,
  );
}

function previewInstanceLabel(instance: ResolvedPreviewInstance): string {
  if (instance.placement.kind === "collection") return `${instance.placement.itemKey} · ${instance.artifactKey}`;
  if (instance.placement.kind === "mount") return `${instance.placement.mountKey} · ${instance.artifactKey}`;
  return instance.artifactKey;
}

function treeBranchMatches(
  node: UiNode,
  rootArtifactKey: string,
  instancePath: readonly string[],
  ownerArtifactKey: string,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  bindingTargets: ReadonlyMap<string, readonly string[]>,
  externalBindingTargets: ReadonlyMap<string, readonly string[]>,
  query: string,
  previewInstance?: ResolvedPreviewInstance,
  previewRootArtifactKey?: string,
  active: ReadonlySet<string> = new Set(),
): boolean {
  const address: SelectionAddress = { rootArtifactKey, instancePath, ownerArtifactKey, nodeId: node.id };
  const searchText = [
    node.id,
    node.name ?? "",
    ownerArtifactKey,
    ...Object.keys(node.components ?? {}),
    ...treeNodeBindingNames(address, bindingTargets, externalBindingTargets),
  ]
    .join(" ")
    .toLowerCase();
  if (!query || searchText.includes(query)) return true;
  if (
    node.children?.some((child) =>
      treeBranchMatches(
        child,
        rootArtifactKey,
        instancePath,
        ownerArtifactKey,
        artifacts,
        bindingTargets,
        externalBindingTargets,
        query,
        previewInstance,
        previewRootArtifactKey,
        active,
      ),
    )
  )
    return true;
  for (const child of generatedPreviewChildren(previewInstance, node.id)) {
    if (previewInstanceLabel(child).toLowerCase().includes(query)) return true;
    if (
      treeBranchMatches(
        child.source.root,
        previewRootArtifactKey ?? rootArtifactKey,
        child.instancePath,
        child.artifactKey,
        artifacts,
        bindingTargets,
        externalBindingTargets,
        query,
        child,
        previewRootArtifactKey,
        active,
      )
    )
      return true;
  }
  const resolvedChild = referencedPreviewChild(previewInstance, node.id);
  const referencedKey = resolvedChild?.artifactKey ?? node.components?.PrefabRef?.artifactKey;
  if (!referencedKey || active.has(referencedKey)) return false;
  const referenced = resolvedChild?.source ?? artifacts.get(referencedKey)?.resolvedSource;
  return referenced
    ? treeBranchMatches(
        referenced.root,
        rootArtifactKey,
        resolvedChild?.instancePath ?? [...instancePath, node.id],
        referencedKey,
        artifacts,
        bindingTargets,
        externalBindingTargets,
        query,
        resolvedChild,
        previewRootArtifactKey,
        new Set([...active, ownerArtifactKey]),
      )
    : false;
}

function NodeIcon({ node, referencesArtifact = false }: { readonly node: UiNode; readonly referencesArtifact?: boolean | undefined }) {
  if (referencesArtifact || node.components?.PrefabRef) return <Box className={webClasses("tree-prefab-icon")} size={14} />;
  if (node.components?.Text) return <TypeIcon size={14} />;
  if (node.components?.Image) return <ImageIcon size={14} />;
  return <Layers3 size={14} />;
}

function treeContainsSelection(
  node: UiNode,
  rootArtifactKey: string,
  ownerArtifactKey: string,
  instancePath: readonly string[],
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  selectedAddresses: readonly SelectionAddress[],
  previewInstance?: ResolvedPreviewInstance,
  previewRootArtifactKey?: string,
  active: ReadonlySet<string> = new Set(),
): boolean {
  if (
    selectedAddresses.some(
      (selectedAddress) =>
        rootArtifactKey === selectedAddress.rootArtifactKey &&
        ownerArtifactKey === selectedAddress.ownerArtifactKey &&
        instancePath.join("\0") === selectedAddress.instancePath.join("\0") &&
        node.id === selectedAddress.nodeId,
    )
  )
    return true;
  if (
    node.children?.some((child) =>
      treeContainsSelection(
        child,
        rootArtifactKey,
        ownerArtifactKey,
        instancePath,
        artifacts,
        selectedAddresses,
        previewInstance,
        previewRootArtifactKey,
        active,
      ),
    )
  )
    return true;
  for (const child of generatedPreviewChildren(previewInstance, node.id)) {
    if (
      treeContainsSelection(
        child.source.root,
        previewRootArtifactKey ?? rootArtifactKey,
        child.artifactKey,
        child.instancePath,
        artifacts,
        selectedAddresses,
        child,
        previewRootArtifactKey,
        active,
      )
    )
      return true;
  }
  const resolvedChild = referencedPreviewChild(previewInstance, node.id);
  const referencedKey = resolvedChild?.artifactKey ?? node.components?.PrefabRef?.artifactKey;
  if (!referencedKey || active.has(referencedKey)) return false;
  const referenced = resolvedChild?.source ?? artifacts.get(referencedKey)?.resolvedSource;
  return referenced
    ? treeContainsSelection(
        referenced.root,
        rootArtifactKey,
        referencedKey,
        resolvedChild?.instancePath ?? [...instancePath, node.id],
        artifacts,
        selectedAddresses,
        resolvedChild,
        previewRootArtifactKey,
        new Set([...active, ownerArtifactKey]),
      )
    : false;
}

const TreeNode = memo(function TreeNode(props: TreeNodeProps) {
  const {
    node,
    source,
    selectedAddresses,
    primaryAddress,
    hoveredAddress,
    depth,
    rootArtifactKey,
    instancePath,
    ownerArtifactKey,
    artifacts,
    previewInstance,
    previewRowLabel,
    bindingTargets = EMPTY_NAMES,
    externalBindingTargets = EMPTY_NAMES,
    changes = EMPTY_CHANGES,
    errors = EMPTY_ERRORS,
    query = "",
    authoringEnabled = true,
    structureEditable = true,
    onDenied,
    onSelect,
    onSelectRange,
    onHover,
    onMove,
    onProjectDrop,
    hiddenAddresses,
    onToggleHidden,
    onContextMenu,
    onRenamePreview,
    onRename,
    onOpenArtifact,
    previewGeneratedAncestor = false,
  } = props;
  const previewGenerated = previewGeneratedAncestor || (props.previewGeneratedNodeIds?.get(ownerArtifactKey)?.has(node.id) ?? false);
  const [expanded, setExpanded] = useState(!previewGenerated);
  const [dropPosition, setDropPosition] = useState<HierarchyDropPosition | null>(null);
  const [inlineRenameDraft, setInlineRenameDraft] = useState<string | null>(null);
  const [inlineRenameSubmitIssue, setInlineRenameSubmitIssue] = useState<string | undefined>();
  const inlineRenameInput = useRef<HTMLInputElement>(null);
  const inlineRenaming = inlineRenameDraft !== null;
  useEffect(() => {
    if (!inlineRenaming) return;
    inlineRenameInput.current?.focus();
    inlineRenameInput.current?.select();
  }, [inlineRenaming]);
  const prefabRef = node.components?.PrefabRef;
  const referenced = prefabRef ? artifacts.get(prefabRef.artifactKey) : undefined;
  const resolvedReferencedInstance = referencedPreviewChild(previewInstance, node.id);
  const referencedArtifactKey = resolvedReferencedInstance?.artifactKey ?? referenced?.artifactKey;
  const referencedRoot = resolvedReferencedInstance?.source.root ?? referenced?.resolvedSource.root;
  const referencedActiveSource = useMemo(
    () =>
      resolvedReferencedInstance?.effectiveLayoutSource ??
      (referenced ? applyCurrentStateRootStates(referenced.resolvedSource) : undefined),
    [referenced, resolvedReferencedInstance],
  );
  const generatedChildren = generatedPreviewChildren(previewInstance, node.id);
  const referencedRootGeneratedChildren = referencedRoot ? generatedPreviewChildren(resolvedReferencedInstance, referencedRoot.id) : [];
  const hasChildren =
    (node.children?.length ?? 0) > 0 ||
    (referencedRoot?.children?.length ?? 0) > 0 ||
    generatedChildren.length > 0 ||
    referencedRootGeneratedChildren.length > 0;
  const isLocal = ownerArtifactKey === source.artifactKey;
  const isArtifactRoot = artifacts.get(ownerArtifactKey)?.resolvedSource.root.id === node.id;
  const useSiteAddress: SelectionAddress = { rootArtifactKey, instancePath, ownerArtifactKey, nodeId: node.id };
  const referencedRootAddress: SelectionAddress | undefined =
    referencedRoot && referencedArtifactKey
      ? {
          rootArtifactKey,
          instancePath: resolvedReferencedInstance?.instancePath ?? [...instancePath, node.id],
          ownerArtifactKey: referencedArtifactKey,
          nodeId: referencedRoot.id,
        }
      : undefined;
  const address = referencedRootAddress ?? useSiteAddress;
  const modifierAddress = referencedRootAddress && isLocal ? useSiteAddress : address;
  const representedAddresses = referencedRootAddress ? [useSiteAddress, referencedRootAddress] : [useSiteAddress];
  const hidden = hiddenAddresses?.has(selectionAddressKey(useSiteAddress)) ?? false;
  const useSiteSelected = selectionIncludes(selectedAddresses, useSiteAddress);
  const isSelected = representedAddresses.some((candidate) => selectionIncludes(selectedAddresses, candidate));
  const isPrimary = representedAddresses.some((candidate) => sameSelectionAddress(primaryAddress, candidate));
  const isHovered = representedAddresses.some((candidate) => sameSelectionAddress(hoveredAddress, candidate));
  const change = isLocal ? changes.get(node.id) : undefined;
  const errorMessages = [
    ...new Set([
      ...(errors.get(`${ownerArtifactKey}:${node.id}`) ?? []),
      ...(referencedRoot && referencedArtifactKey ? (errors.get(`${referencedArtifactKey}:${referencedRoot.id}`) ?? []) : []),
    ]),
  ];
  const containsSelection = treeContainsSelection(
    node,
    rootArtifactKey,
    ownerArtifactKey,
    instancePath,
    artifacts,
    selectedAddresses,
    previewInstance,
    props.previewRootArtifactKey,
  );
  const branchMatches =
    Boolean(query && previewRowLabel?.toLowerCase().includes(query)) ||
    treeBranchMatches(
      node,
      rootArtifactKey,
      instancePath,
      ownerArtifactKey,
      artifacts,
      bindingTargets,
      externalBindingTargets,
      query,
      previewInstance,
      props.previewRootArtifactKey,
    );
  useEffect(() => {
    if (containsSelection || (query && branchMatches)) setExpanded(true);
  }, [branchMatches, containsSelection, query]);
  if (!branchMatches) return null;
  const components = [...new Set([...Object.keys(node.components ?? {}), ...Object.keys(referencedRoot?.components ?? {})])];
  const bindingNames = [...new Set(representedAddresses.flatMap((candidate) => bindingTargets.get(selectionAddressKey(candidate)) ?? []))];
  const status = previewGenerated
    ? []
    : [
        ...new Set([
          ...hierarchyNodeStatus({
            node,
            ownerArtifactKey,
            instancePath,
            localArtifactKey: source.artifactKey,
            artifacts,
            index: props.statusIndex,
          }),
          ...(referencedRootAddress && referencedRoot
            ? hierarchyNodeStatus({
                node: referencedRoot,
                ownerArtifactKey: referencedRootAddress.ownerArtifactKey,
                instancePath: referencedRootAddress.instancePath,
                localArtifactKey: source.artifactKey,
                artifacts,
                index: props.statusIndex,
              })
            : []),
        ]),
      ];
  const stateRootControllerIds = previewGenerated
    ? []
    : [
        ...stateRootActiveControllers(artifacts.get(ownerArtifactKey)?.resolvedSource ?? source, node.id).map(
          (control) => control.stateRootNodeId,
        ),
        ...(referencedRootAddress && referencedRoot
          ? stateRootActiveControllers(
              artifacts.get(referencedRootAddress.ownerArtifactKey)?.resolvedSource ?? source,
              referencedRoot.id,
            ).map((control) => control.stateRootNodeId)
          : []),
      ].filter((nodeId, index, values) => values.indexOf(nodeId) === index);
  const statusTitle = [
    ...status.filter((entry) => entry !== "SR:A"),
    ...(stateRootControllerIds.length > 0 ? [`Active 由 StateRoot ${stateRootControllerIds.join(", ")} 控制`] : []),
  ].join(" · ");
  const referencedBinder = status.includes("BR");
  const externalBindingNames = [
    ...new Set(
      representedAddresses.flatMap((candidate) =>
        candidate.instancePath.length === 0 ? (externalBindingTargets.get(`${candidate.ownerArtifactKey}:${candidate.nodeId}`) ?? []) : [],
      ),
    ),
  ];
  const useSiteOverridden = status.includes("OVR");
  const useSiteAdded = status.includes("ADD");
  const openArtifactKey =
    prefabRef?.artifactKey ?? resolvedReferencedInstance?.artifactKey ?? (!isLocal && isArtifactRoot ? ownerArtifactKey : undefined);
  const nodeLabel = gameObjectName(node);
  const nodeIdentityLabel = gameObjectDiagnosticLabel(node);
  const rowLabel =
    previewRowLabel ??
    props.previewInstanceLabels?.get(ownerArtifactKey)?.get(node.id) ??
    (referencedArtifactKey ? `${nodeLabel} · ${referencedArtifactKey}` : nodeLabel);
  const inlineRenameAllowed =
    Boolean(onRenamePreview && onRename) && authoringEnabled && structureEditable && isLocal && !isArtifactRoot && !previewGenerated;
  const inlineRenamePreview = inlineRenameDraft === null ? undefined : onRenamePreview?.(useSiteAddress, inlineRenameDraft);
  const inlineRenameIssue = inlineRenameSubmitIssue ?? inlineRenamePreview?.issue;
  const cancelInlineRename = (): void => {
    setInlineRenameDraft(null);
    setInlineRenameSubmitIssue(undefined);
  };
  const commitInlineRename = (): void => {
    if (inlineRenameDraft === null || inlineRenameIssue) return;
    const displayName = inlineRenameDraft.trim();
    if (displayName === nodeLabel) {
      cancelInlineRename();
      return;
    }
    const issue = onRename?.(useSiteAddress, displayName);
    if (issue) {
      setInlineRenameSubmitIssue(issue);
      return;
    }
    cancelInlineRename();
  };
  const moveDeniedReason = !authoringEnabled
    ? undefined
    : previewGenerated
      ? "预览集合实例不能修改结构"
      : !isLocal
        ? "继承节点不能移动；请打开所属 Artifact"
        : !structureEditable
          ? "Variant 不支持结构修改"
          : undefined;
  const resolveDropPosition = (event: React.DragEvent<HTMLDivElement>): HierarchyDropPosition => {
    if (depth === 0) return "inside";
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    if (ratio < 0.3) return "before";
    if (ratio > 0.7) return "after";
    return "inside";
  };
  const draggable = authoringEnabled && !previewGenerated && inlineRenameDraft === null;
  const effectiveNode = findNode(props.activeSource, node.id);
  const effectiveActive = (effectiveNode ? effectiveNode.active : node.active) !== false;
  return (
    <>
      <div
        className={webClasses(
          `tree-row ${previewGenerated ? "is-preview-instance" : ""} ${isSelected ? "is-selected" : ""} ${isPrimary ? "is-primary" : ""} ${isHovered ? "is-hovered" : ""} ${isLocal ? "" : "is-reference"} ${isArtifactRoot ? "is-artifact-root" : ""} ${referencedArtifactKey ? "is-prefab" : ""} ${useSiteOverridden ? "is-use-site-overridden" : ""} ${useSiteAdded ? "is-use-site-added" : ""} ${stateRootControllerIds.length > 0 ? "is-state-root-active-controlled" : ""} ${effectiveActive ? "" : "is-inactive"} ${errorMessages.length > 0 ? "is-invalid" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""}`,
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
        draggable={draggable}
        data-hierarchy-row
        data-ui="hierarchy-node"
        data-selection-address={selectionAddressKey(address)}
        data-use-site-selection-address={referencedRootAddress ? selectionAddressKey(useSiteAddress) : undefined}
        data-selected={isSelected}
        data-reference={!isLocal}
        data-artifact-reference={referencedArtifactKey}
        data-node-id={node.id}
        data-hierarchy-depth={depth}
        data-effective-active={effectiveActive ? "true" : "false"}
        data-preview-generated={previewGenerated || undefined}
        data-state-root-active-controllers={stateRootControllerIds.length > 0 ? stateRootControllerIds.join(",") : undefined}
        onDragStart={
          draggable
            ? (event) => {
                writeHierarchyBindingDragData(event.dataTransfer, useSiteAddress);
                if (depth > 0 && !moveDeniedReason) event.dataTransfer.setData(HIERARCHY_NODE_DRAG_TYPE, node.id);
                event.dataTransfer.effectAllowed = depth > 0 && !moveDeniedReason ? "copyMove" : "copy";
              }
            : undefined
        }
        onDragOver={
          authoringEnabled && !previewGenerated
            ? (event) => {
                const hierarchyDrag = event.dataTransfer.types.includes(HIERARCHY_NODE_DRAG_TYPE);
                const projectDrag =
                  event.dataTransfer.types.includes(PROJECT_ASSET_DRAG_TYPE) ||
                  event.dataTransfer.types.includes(PROJECT_PREFAB_REF_DRAG_TYPE);
                if (!hierarchyDrag && !projectDrag) return;
                event.preventDefault();
                event.stopPropagation();
                if (!isLocal || !structureEditable) {
                  event.dataTransfer.dropEffect = "none";
                  return;
                }
                event.dataTransfer.dropEffect = hierarchyDrag ? "move" : "copy";
                setDropPosition(hierarchyDrag ? resolveDropPosition(event) : "inside");
              }
            : undefined
        }
        onDragLeave={authoringEnabled && !previewGenerated ? () => setDropPosition(null) : undefined}
        onDrop={
          authoringEnabled && !previewGenerated
            ? (event) => {
                const sourceId = event.dataTransfer.getData(HIERARCHY_NODE_DRAG_TYPE);
                const projectItem = readProjectDragData(event.dataTransfer);
                if (!sourceId && !projectItem) return;
                event.preventDefault();
                event.stopPropagation();
                const position = dropPosition ?? resolveDropPosition(event);
                setDropPosition(null);
                if (!isLocal || !structureEditable) {
                  onDenied?.(!isLocal ? "不能把节点移动到继承层级中" : "Variant 不支持结构修改");
                  return;
                }
                if (sourceId) onMove?.(sourceId, node.id, position);
                else if (projectItem) onProjectDrop?.(useSiteAddress, projectItem);
              }
            : undefined
        }
        onContextMenu={
          onContextMenu && !previewGenerated
            ? (event) => {
                event.preventDefault();
                if (!useSiteSelected) onSelect(useSiteAddress, "replace");
                onContextMenu(useSiteAddress, event.clientX, event.clientY);
              }
            : undefined
        }
      >
        <button
          className={webClasses("tree-toggle")}
          type="button"
          onClick={() => setExpanded((value) => !value)}
          disabled={!hasChildren}
          aria-expanded={hasChildren ? expanded : undefined}
          title={expanded ? "折叠" : "展开"}
        >
          {hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span />}
        </button>
        {onToggleHidden ? (
          <button
            className={webClasses(`tree-visibility ${hidden ? "is-hidden" : ""}`)}
            type="button"
            aria-label={`${hidden ? "显示" : "隐藏"} ${nodeLabel}`}
            title={hidden ? "在编辑视图中显示" : "在编辑视图中隐藏"}
            onClick={() => onToggleHidden(useSiteAddress)}
          >
            {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        ) : null}
        {inlineRenameDraft !== null ? (
          <div className={webClasses("tree-inline-rename")} data-hierarchy-inline-rename title={inlineRenameIssue}>
            <NodeIcon node={node} referencesArtifact={Boolean(referencedArtifactKey)} />
            <input
              ref={inlineRenameInput}
              aria-label={`重命名 ${nodeLabel}`}
              aria-invalid={Boolean(inlineRenameIssue)}
              value={inlineRenameDraft}
              onChange={(event) => {
                setInlineRenameDraft(event.target.value);
                setInlineRenameSubmitIssue(undefined);
              }}
              onBlur={() => {
                if (inlineRenameIssue) cancelInlineRename();
                else commitInlineRename();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelInlineRename();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  commitInlineRename();
                }
              }}
            />
            <code data-inline-node-id-preview>{inlineRenamePreview?.nodeId ?? node.id}</code>
          </div>
        ) : (
          <button
            className={webClasses("tree-select")}
            data-hierarchy-select
            type="button"
            onClick={(event) => {
              if (event.shiftKey) onSelectRange(modifierAddress);
              else if (event.ctrlKey || event.metaKey) onSelect(modifierAddress, "toggle");
              else onSelect(address, "replace");
            }}
            onDoubleClick={(event) => {
              if (!inlineRenameAllowed || event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(useSiteAddress, "replace");
              setInlineRenameSubmitIssue(undefined);
              setInlineRenameDraft(nodeLabel);
            }}
            onPointerEnter={() => onHover(address)}
            onPointerLeave={() => onHover(undefined)}
            title={`${nodeIdentityLabel}${isLocal ? "" : ` · ${ownerArtifactKey}/${node.id}${components.length > 0 ? ` · ${components.join(", ")}` : ""}`}${bindingNames.length > 0 ? ` · Binding ${bindingNames.join(", ")}` : ""}${externalBindingNames.length > 0 ? ` · External ${externalBindingNames.join(", ")}` : ""}${moveDeniedReason ? ` · ${moveDeniedReason}` : ""}${errorMessages.length > 0 ? `\n${errorMessages.join("\n")}` : ""}`}
          >
            <NodeIcon node={node} referencesArtifact={Boolean(referencedArtifactKey)} />
            <span>{rowLabel}</span>
            {!effectiveActive ? <EyeOff className={webClasses("tree-inactive-icon")} size={11} /> : null}
            {errorMessages.length > 0 ? (
              <CircleAlert className={webClasses("tree-error-icon")} data-hierarchy-error size={12} aria-label="节点配置不完整" />
            ) : null}
            {bindingNames.length > 0 ? (
              <Link2
                className={webClasses("tree-binding-icon is-current")}
                data-hierarchy-binding="current"
                size={11}
                aria-label="当前 Binder Binding"
              />
            ) : null}
            {referencedBinder || externalBindingNames.length > 0 ? (
              <Link2
                className={webClasses("tree-binding-icon is-external")}
                data-hierarchy-binding="external"
                size={11}
                aria-label="外部 Binder Binding"
              />
            ) : null}
            {change ? (
              <i className={webClasses(`tree-change is-${change}`)} title={change === "added" ? "新增节点" : "已修改节点"} />
            ) : null}
            {previewGenerated ? (
              <small title="预览生成实例">预览</small>
            ) : status.length > 0 ? (
              <small className={webClasses(stateRootControllerIds.length > 0 ? "is-state-controlled-status" : "")} title={statusTitle}>
                {status.join("_")}
              </small>
            ) : null}
          </button>
        )}
        {openArtifactKey ? (
          <button
            className={webClasses("tree-open-artifact")}
            type="button"
            title={`打开 ${openArtifactKey}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenArtifact(openArtifactKey);
            }}
          >
            <ExternalLink size={12} />
          </button>
        ) : null}
      </div>
      {expanded &&
        node.children?.map((child) => (
          <TreeNode
            key={`${ownerArtifactKey}:${child.id}`}
            {...props}
            node={child}
            depth={depth + 1}
            rootArtifactKey={rootArtifactKey}
            previewInstance={previewInstance}
            activeSource={props.activeSource}
            previewRowLabel={undefined}
            previewGeneratedAncestor={previewGenerated}
          />
        ))}
      {expanded &&
        referencedRoot?.children?.map((child) => (
          <TreeNode
            key={`ref:${referencedArtifactKey}:${child.id}`}
            {...props}
            node={child}
            depth={depth + 1}
            rootArtifactKey={rootArtifactKey}
            instancePath={resolvedReferencedInstance?.instancePath ?? [...instancePath, node.id]}
            ownerArtifactKey={referencedArtifactKey!}
            previewInstance={resolvedReferencedInstance}
            activeSource={referencedActiveSource ?? props.activeSource}
            previewRowLabel={undefined}
            previewGeneratedAncestor={previewGenerated}
          />
        ))}
      {expanded &&
        referencedRootGeneratedChildren.map((child) => (
          <TreeNode
            key={`preview:${child.instanceKey}`}
            {...props}
            node={child.source.root}
            depth={depth + 1}
            rootArtifactKey={props.previewRootArtifactKey ?? rootArtifactKey}
            instancePath={child.instancePath}
            ownerArtifactKey={child.artifactKey}
            previewInstance={child}
            activeSource={child.effectiveLayoutSource}
            previewRowLabel={previewInstanceLabel(child)}
            previewGeneratedAncestor
          />
        ))}
      {expanded &&
        generatedChildren.map((child) => (
          <TreeNode
            key={`preview:${child.instanceKey}`}
            {...props}
            node={child.source.root}
            depth={depth + 1}
            rootArtifactKey={props.previewRootArtifactKey ?? rootArtifactKey}
            instancePath={child.instancePath}
            ownerArtifactKey={child.artifactKey}
            previewInstance={child}
            activeSource={child.effectiveLayoutSource}
            previewRowLabel={previewInstanceLabel(child)}
            previewGeneratedAncestor
          />
        ))}
    </>
  );
}, sameTreeNodeProps);

function sameTreeNodeProps(previous: TreeNodeProps, next: TreeNodeProps): boolean {
  if (
    previous.node !== next.node ||
    previous.source.artifactKey !== next.source.artifactKey ||
    previous.depth !== next.depth ||
    previous.rootArtifactKey !== next.rootArtifactKey ||
    !samePath(previous.instancePath, next.instancePath) ||
    previous.ownerArtifactKey !== next.ownerArtifactKey ||
    previous.previewInstance !== next.previewInstance ||
    previous.activeSource !== next.activeSource ||
    previous.previewRowLabel !== next.previewRowLabel ||
    previous.previewRootArtifactKey !== next.previewRootArtifactKey ||
    previous.previewGeneratedAncestor !== next.previewGeneratedAncestor ||
    previous.previewGeneratedNodeIds !== next.previewGeneratedNodeIds ||
    previous.previewInstanceLabels !== next.previewInstanceLabels ||
    previous.bindingTargets !== next.bindingTargets ||
    previous.externalBindingTargets !== next.externalBindingTargets ||
    previous.query !== next.query ||
    previous.authoringEnabled !== next.authoringEnabled ||
    previous.structureEditable !== next.structureEditable ||
    previous.onDenied !== next.onDenied ||
    previous.onSelect !== next.onSelect ||
    previous.onSelectRange !== next.onSelectRange ||
    previous.onHover !== next.onHover ||
    previous.onMove !== next.onMove ||
    previous.onProjectDrop !== next.onProjectDrop ||
    previous.hiddenAddresses !== next.hiddenAddresses ||
    previous.onToggleHidden !== next.onToggleHidden ||
    previous.onContextMenu !== next.onContextMenu ||
    previous.onRenamePreview !== next.onRenamePreview ||
    previous.onRename !== next.onRename ||
    previous.onOpenArtifact !== next.onOpenArtifact
  )
    return false;
  const local = next.ownerArtifactKey === next.source.artifactKey;
  const prefabStatusChanged =
    previous.statusIndex.prefabDescendantNodeIds.has(previous.node.id) !== next.statusIndex.prefabDescendantNodeIds.has(next.node.id);
  const localDocument = next.artifacts.get(next.source.artifactKey);
  if (
    previous.artifacts !== next.artifacts &&
    (!local || Boolean(next.node.components?.PrefabRef) || localDocument?.source.sourceKind === "variant")
  )
    return false;
  if (prefabStatusChanged) return false;
  if ((previous.changes?.get(previous.node.id) ?? undefined) !== (next.changes?.get(next.node.id) ?? undefined)) return false;
  const previousErrors = previous.errors?.get(`${previous.ownerArtifactKey}:${previous.node.id}`) ?? [];
  const nextErrors = next.errors?.get(`${next.ownerArtifactKey}:${next.node.id}`) ?? [];
  if (!samePath(previousErrors, nextErrors)) return false;
  if (
    treeContainsSelection(
      previous.node,
      previous.rootArtifactKey,
      previous.ownerArtifactKey,
      previous.instancePath,
      previous.artifacts,
      previous.selectedAddresses,
      previous.previewInstance,
      previous.previewRootArtifactKey,
    )
  )
    return false;
  if (
    treeContainsSelection(
      next.node,
      next.rootArtifactKey,
      next.ownerArtifactKey,
      next.instancePath,
      next.artifacts,
      next.selectedAddresses,
      next.previewInstance,
      next.previewRootArtifactKey,
    )
  )
    return false;
  if (
    previous.hoveredAddress &&
    treeContainsSelection(
      previous.node,
      previous.rootArtifactKey,
      previous.ownerArtifactKey,
      previous.instancePath,
      previous.artifacts,
      [previous.hoveredAddress],
      previous.previewInstance,
      previous.previewRootArtifactKey,
    )
  )
    return false;
  if (
    next.hoveredAddress &&
    treeContainsSelection(
      next.node,
      next.rootArtifactKey,
      next.ownerArtifactKey,
      next.instancePath,
      next.artifacts,
      [next.hoveredAddress],
      next.previewInstance,
      next.previewRootArtifactKey,
    )
  )
    return false;
  return true;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function EditorHierarchyTree(props: EditorHierarchyTreeProps) {
  const current = useRef(props);
  const tree = useRef<HTMLDivElement>(null);
  const hoveredRow = useRef<HTMLElement | null>(null);
  const previousQuery = useRef(props.query ?? "");
  const localSource = props.artifacts.get(props.source.artifactKey)?.resolvedSource ?? props.source;
  const statusIndex = useMemo(() => createHierarchyNodeStatusIndex(localSource), [localSource]);
  const activeSource = useMemo(
    () => props.evaluatedSource ?? props.resolvedSourceInstance?.effectiveLayoutSource ?? applyCurrentStateRootStates(props.source),
    [props.evaluatedSource, props.resolvedSourceInstance, props.source],
  );
  const primaryKey = selectionAddressKey(props.primaryAddress);
  const primarySelector = `[data-selection-address="${CSS.escape(primaryKey)}"], [data-use-site-selection-address="${CSS.escape(primaryKey)}"]`;
  const { edge, measure, reveal } = useSelectedItemReveal({
    containerRef: tree,
    selectedKey: primaryKey,
    selectedSelector: primarySelector,
    revealRequest: props.revealRequest,
  });
  current.current = props;
  const handlers = useMemo(
    () => ({
      onDenied: props.onDenied ? (reason: string) => current.current.onDenied?.(reason) : undefined,
      onSelect: (address: SelectionAddress, mode?: SelectionUpdateMode) => current.current.onSelect(address, mode),
      onSelectRange: (address: SelectionAddress) => {
        if (!current.current.onSelectMany) {
          current.current.onSelect(address, "replace");
          return;
        }
        const ordered = [...(tree.current?.querySelectorAll<HTMLElement>("[data-hierarchy-row]") ?? [])]
          .flatMap((row) => {
            const candidate = parseSelectionAddress(row.dataset.useSiteSelectionAddress ?? row.dataset.selectionAddress);
            return candidate ? [candidate] : [];
          })
          .filter((candidate) => {
            const ownerRootId =
              current.current.artifacts.get(candidate.ownerArtifactKey)?.resolvedSource.root.id ??
              (candidate.ownerArtifactKey === current.current.source.artifactKey ? current.current.source.root.id : undefined);
            return candidate.nodeId !== ownerRootId;
          });
        current.current.onSelectMany(hierarchySelectionRange(ordered, current.current.primaryAddress, address), "replace");
      },
      onHover: (address: SelectionAddress | undefined) => current.current.onHover(address),
      onMove: props.onMove
        ? (nodeId: string, targetId: string, position: HierarchyDropPosition) => current.current.onMove?.(nodeId, targetId, position)
        : undefined,
      onProjectDrop: props.onProjectDrop
        ? (address: SelectionAddress, item: ProjectDragItem) => current.current.onProjectDrop?.(address, item)
        : undefined,
      onToggleHidden: props.onToggleHidden ? (address: SelectionAddress) => current.current.onToggleHidden?.(address) : undefined,
      onContextMenu: props.onContextMenu
        ? (address: SelectionAddress, x: number, y: number) => current.current.onContextMenu?.(address, x, y)
        : undefined,
      onRenamePreview: props.onRenamePreview
        ? (address: SelectionAddress, displayName: string) => current.current.onRenamePreview!(address, displayName)
        : undefined,
      onRename: props.onRename
        ? (address: SelectionAddress, displayName: string) => current.current.onRename!(address, displayName)
        : undefined,
      onOpenArtifact: (artifactKey: string) => current.current.onOpenArtifact(artifactKey),
    }),
    [
      Boolean(props.onDenied),
      Boolean(props.onMove),
      Boolean(props.onProjectDrop),
      Boolean(props.onToggleHidden),
      Boolean(props.onContextMenu),
      Boolean(props.onRenamePreview),
      Boolean(props.onRename),
      Boolean(props.onSelectMany),
    ],
  );
  useEffect(() => {
    hoveredRow.current?.classList.remove(webClasses("is-hovered"));
    const key = props.hoveredAddress ? selectionAddressKey(props.hoveredAddress) : undefined;
    const row = key
      ? (tree.current?.querySelector<HTMLElement>(
          `[data-selection-address="${CSS.escape(key)}"], [data-use-site-selection-address="${CSS.escape(key)}"]`,
        ) ?? null)
      : null;
    row?.classList.add(webClasses("is-hovered"));
    hoveredRow.current = row;
    return () => row?.classList.remove(webClasses("is-hovered"));
  }, [props.hoveredAddress]);
  useEffect(() => {
    const query = props.query ?? "";
    if (previousQuery.current && !query) reveal();
    else measure();
    previousQuery.current = query;
  }, [measure, props.query, reveal]);
  useFrameSelectedShortcut(props.frameShortcutEnabled !== false, () => {
    if (current.current.query) current.current.onClearQuery?.();
    reveal("center");
    return true;
  });
  return (
    <>
      <div className={webClasses("hierarchy-list-header")} data-ui="hierarchy-list-header">
        <span>名称</span>
        <small>状态</small>
      </div>
      <div className={webClasses("selection-scroll-frame")} data-ui="selection-scroll-frame">
        <div ref={tree} className={webClasses("tree-scroll")} data-editor-hierarchy>
          <TreeNode
            {...props}
            {...handlers}
            hoveredAddress={undefined}
            node={props.source.root}
            depth={0}
            rootArtifactKey={props.source.artifactKey}
            instancePath={[]}
            ownerArtifactKey={props.source.artifactKey}
            previewInstance={props.resolvedSourceInstance}
            activeSource={activeSource}
            statusIndex={statusIndex}
          />
        </div>
        <SelectedItemEdgeButton
          edge={edge}
          className={webClasses("selection-edge-button")}
          onReveal={() => reveal("center")}
          label="当前节点"
        />
      </div>
    </>
  );
}
