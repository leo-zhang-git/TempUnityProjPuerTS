import { ArrowUpToLine, Box, ChevronDown, ChevronRight, Component, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { overrideTargetKey } from "../../../../kernel/override.js";
import { componentAdditionTargetKey } from "../../../../kernel/use-site-components.js";
import type { UiPropertyOverride, UiUseSiteComponentAddition } from "../../../../schema/ui-source-schema.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import artifactStyles from "../artifact-editor-shell.module.css";
import type {
  UseSiteModificationSelection,
  UseSiteOverrideCandidate,
  UseSiteOverrideHierarchySegment,
} from "../inspector/use-site-overrides.js";

const webClasses = createWebClasses(artifactStyles);
const PANEL_GAP = 4;
const VIEWPORT_PADDING = 8;
const PANEL_WIDTH = 380;
const PANEL_MAX_HEIGHT = 500;
const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

type OverrideTarget = UiPropertyOverride["target"] | UiUseSiteComponentAddition["target"];

interface OverrideModificationItem {
  readonly key: string;
  readonly kind: "property" | "component";
  readonly nodeKey: string;
  readonly nodeLabel: string;
  readonly idPath: string;
  readonly label: string;
  readonly valueLabel?: string | undefined;
  readonly colorValue?: string | undefined;
  readonly nodePath: readonly UseSiteOverrideHierarchySegment[];
  readonly target: OverrideTarget;
  readonly selection: UseSiteModificationSelection;
}

interface OverrideHierarchyNode {
  readonly key: string;
  readonly label: string;
  readonly idPath: string;
  readonly target: UiUseSiteComponentAddition["target"];
  readonly items: readonly OverrideModificationItem[];
  readonly children: readonly OverrideHierarchyNode[];
  readonly subtreeItems: readonly OverrideModificationItem[];
}

interface MutableOverrideHierarchyNode {
  readonly key: string;
  readonly label: string;
  readonly idPath: string;
  readonly target: UiUseSiteComponentAddition["target"];
  readonly items: OverrideModificationItem[];
  readonly children: Map<string, MutableOverrideHierarchyNode>;
}

interface PanelPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

interface UseSiteOverridesDropdownProps {
  readonly artifactKey: string;
  readonly candidates: readonly UseSiteOverrideCandidate[];
  readonly overrides: readonly UiPropertyOverride[];
  readonly componentAdditions: readonly UiUseSiteComponentAddition[];
  readonly onApply: (selection: UseSiteModificationSelection) => void;
  readonly onRevert: (selection: UseSiteModificationSelection) => void;
  readonly onSelectTarget?: ((target: OverrideTarget) => void) | undefined;
  readonly onHoverTarget?: ((target: OverrideTarget | undefined) => void) | undefined;
}

function targetNodeKey(target: OverrideTarget): string {
  return [...(target.instancePath ?? []), target.nodeId].join("\0");
}

function targetIdPath(target: OverrideTarget): string {
  return [...(target.instancePath ?? []), target.nodeId].join("/");
}

function fallbackNodePath(target: OverrideTarget, nodeLabel: string, idPath: string): readonly UseSiteOverrideHierarchySegment[] {
  return [
    {
      key: targetNodeKey(target),
      label: nodeLabel,
      idPath,
      target: {
        ...(target.instancePath ? { instancePath: target.instancePath } : {}),
        nodeId: target.nodeId,
      },
    },
  ];
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function overrideColor(fieldPath: string, value: unknown): string | undefined {
  if (!fieldPath.toLowerCase().endsWith("color") || typeof value !== "string") return undefined;
  return HEX_COLOR.test(value) ? value : undefined;
}

function modificationSelection(items: readonly OverrideModificationItem[]): UseSiteModificationSelection {
  const propertyKeys = items.filter((item) => item.kind === "property").map((item) => item.key);
  const componentKeys = items.filter((item) => item.kind === "component").map((item) => item.key);
  return {
    ...(propertyKeys.length > 0 ? { propertyKeys } : {}),
    ...(componentKeys.length > 0 ? { componentKeys } : {}),
  };
}

function SelectionCheckbox({
  checked,
  mixed = false,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly mixed?: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input ref={input} type="checkbox" checked={checked} aria-label={label} onChange={(event) => onChange(event.currentTarget.checked)} />
  );
}

function collectModifications(
  candidates: readonly UseSiteOverrideCandidate[],
  overrides: readonly UiPropertyOverride[],
  componentAdditions: readonly UiUseSiteComponentAddition[],
): readonly OverrideModificationItem[] {
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const candidateByNode = new Map<string, UseSiteOverrideCandidate>();
  for (const candidate of candidates) {
    const key = targetNodeKey(candidate.target);
    if (!candidateByNode.has(key)) candidateByNode.set(key, candidate);
  }
  const items: OverrideModificationItem[] = [];
  for (const override of overrides) {
    const key = overrideTargetKey(override);
    const nodeKey = targetNodeKey(override.target);
    const candidate = candidateByKey.get(key) ?? candidateByNode.get(nodeKey);
    const nodeLabel = candidate?.nodeLabel ?? targetIdPath(override.target);
    const idPath = candidate?.idPath ?? targetIdPath(override.target);
    items.push({
      key,
      kind: "property",
      nodeKey,
      nodeLabel,
      idPath,
      label: `${override.target.componentType}.${override.target.fieldPath}`,
      valueLabel: formatValue(override.value),
      colorValue: overrideColor(override.target.fieldPath, override.value),
      nodePath: candidate?.nodePath ?? fallbackNodePath(override.target, nodeLabel, idPath),
      target: override.target,
      selection: { propertyKeys: [key] },
    });
  }
  for (const addition of componentAdditions) {
    const key = componentAdditionTargetKey(addition);
    const nodeKey = targetNodeKey(addition.target);
    const candidate = candidateByNode.get(nodeKey);
    const nodeLabel = candidate?.nodeLabel ?? targetIdPath(addition.target);
    const idPath = candidate?.idPath ?? targetIdPath(addition.target);
    items.push({
      key,
      kind: "component",
      nodeKey,
      nodeLabel,
      idPath,
      label: `新增 ${addition.componentType}`,
      nodePath: candidate?.nodePath ?? fallbackNodePath(addition.target, nodeLabel, idPath),
      target: addition.target,
      selection: { componentKeys: [key] },
    });
  }
  return items.toSorted(
    (left, right) =>
      left.nodeLabel.localeCompare(right.nodeLabel) || left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label),
  );
}

function buildOverrideHierarchy(items: readonly OverrideModificationItem[]): readonly OverrideHierarchyNode[] {
  const roots = new Map<string, MutableOverrideHierarchyNode>();
  for (const item of items) {
    let siblings = roots;
    let current: MutableOverrideHierarchyNode | undefined;
    for (const segment of item.nodePath) {
      current = siblings.get(segment.key);
      if (!current) {
        current = { ...segment, items: [], children: new Map() };
        siblings.set(segment.key, current);
      }
      siblings = current.children;
    }
    current?.items.push(item);
  }

  const finalize = (node: MutableOverrideHierarchyNode): OverrideHierarchyNode => {
    const children = [...node.children.values()]
      .map(finalize)
      .toSorted((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
    const directItems = node.items.toSorted((left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));
    return {
      key: node.key,
      label: node.label,
      idPath: node.idPath,
      target: node.target,
      items: directItems,
      children,
      subtreeItems: [...directItems, ...children.flatMap((child) => child.subtreeItems)],
    };
  };

  return [...roots.values()]
    .map(finalize)
    .toSorted((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
}

function OverrideHierarchyBranch({
  node,
  depth,
  selectedKeys,
  collapsedNodes,
  onUpdateSelection,
  onToggleCollapsed,
  onApply,
  onRevert,
  onSelectTarget,
  onHoverTarget,
}: {
  readonly node: OverrideHierarchyNode;
  readonly depth: number;
  readonly selectedKeys: ReadonlySet<string>;
  readonly collapsedNodes: ReadonlySet<string>;
  readonly onUpdateSelection: (keys: readonly string[], selected: boolean) => void;
  readonly onToggleCollapsed: (key: string) => void;
  readonly onApply: (selection: UseSiteModificationSelection) => void;
  readonly onRevert: (selection: UseSiteModificationSelection) => void;
  readonly onSelectTarget?: ((target: OverrideTarget) => void) | undefined;
  readonly onHoverTarget?: ((target: OverrideTarget | undefined) => void) | undefined;
}) {
  const collapsed = collapsedNodes.has(node.key);
  const selectedCount = node.subtreeItems.filter((item) => selectedKeys.has(item.key)).length;
  const branchKeys = node.subtreeItems.map((item) => item.key);
  return (
    <section
      className={webClasses("use-site-override-node")}
      data-ui="use-site-override-node"
      data-depth={depth}
      data-has-direct-overrides={node.items.length > 0}
    >
      <header style={{ paddingLeft: 3 + depth * 14 }}>
        <SelectionCheckbox
          checked={selectedCount === node.subtreeItems.length}
          mixed={selectedCount > 0 && selectedCount < node.subtreeItems.length}
          label={`选择 ${node.label} 分支的全部覆写`}
          onChange={(checked) => onUpdateSelection(branchKeys, checked)}
        />
        <button
          className={webClasses("override-object-toggle")}
          type="button"
          onClick={() => onToggleCollapsed(node.key)}
          title={collapsed ? "展开对象修改" : "折叠对象修改"}
          aria-label={collapsed ? `展开 ${node.label}` : `折叠 ${node.label}`}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <Box size={12} />
        <button
          className={webClasses("override-object-link")}
          type="button"
          title={`${node.label} (${node.idPath})`}
          onClick={() => onSelectTarget?.(node.target)}
          onPointerEnter={() => onHoverTarget?.(node.target)}
          onPointerLeave={() => onHoverTarget?.(undefined)}
        >
          {node.label}
        </button>
        <small>{node.subtreeItems.length}</small>
      </header>
      {!collapsed ? (
        <>
          {node.items.length > 0 ? (
            <div className={webClasses("use-site-override-items")}>
              {node.items.map((item) => (
                <div
                  className={webClasses("use-site-override-row")}
                  data-ui="use-site-override-row"
                  style={{ paddingLeft: 19 + depth * 14 }}
                  key={item.key}
                >
                  <SelectionCheckbox
                    checked={selectedKeys.has(item.key)}
                    label={`选择 ${item.nodeLabel} ${item.label}`}
                    onChange={(checked) => onUpdateSelection([item.key], checked)}
                  />
                  {item.kind === "property" ? <SlidersHorizontal size={11} /> : <Component size={11} />}
                  <button
                    className={webClasses("override-target-link")}
                    type="button"
                    title={`${item.nodeLabel} (${item.idPath}) · ${item.label}${item.valueLabel ? ` · ${item.valueLabel}` : ""}`}
                    onClick={() => onSelectTarget?.(item.target)}
                    onPointerEnter={() => onHoverTarget?.(item.target)}
                    onPointerLeave={() => onHoverTarget?.(undefined)}
                  >
                    <span>{item.label}</span>
                    {item.valueLabel ? (
                      <small>
                        {item.colorValue ? (
                          <span
                            className={webClasses("override-color-swatch")}
                            data-ui="use-site-override-color"
                            style={{ backgroundColor: item.colorValue }}
                            title={`变更颜色 ${item.valueLabel}`}
                          />
                        ) : null}
                        <span>{item.valueLabel}</span>
                      </small>
                    ) : null}
                  </button>
                  <div className={webClasses("use-site-override-actions")}>
                    <button
                      type="button"
                      onClick={() => onRevert(item.selection)}
                      title={item.kind === "property" ? "还原此属性" : "移除此新增组件"}
                      aria-label={item.kind === "property" ? "还原此属性" : "还原新增组件"}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onApply(item.selection)}
                      title={item.kind === "property" ? "应用到被引用 Artifact" : "应用组件到被引用 Artifact"}
                      aria-label={item.kind === "property" ? "应用此属性" : "应用新增组件"}
                    >
                      <ArrowUpToLine size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {node.children.map((child) => (
            <OverrideHierarchyBranch
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedKeys={selectedKeys}
              collapsedNodes={collapsedNodes}
              onUpdateSelection={onUpdateSelection}
              onToggleCollapsed={onToggleCollapsed}
              onApply={onApply}
              onRevert={onRevert}
              onSelectTarget={onSelectTarget}
              onHoverTarget={onHoverTarget}
            />
          ))}
        </>
      ) : null}
    </section>
  );
}

export function UseSiteOverridesDropdown({
  artifactKey,
  candidates,
  overrides,
  componentAdditions,
  onApply,
  onRevert,
  onSelectTarget,
  onHoverTarget,
}: UseSiteOverridesDropdownProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>();
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedNodes, setCollapsedNodes] = useState<ReadonlySet<string>>(() => new Set());
  const modifications = useMemo(
    () => collectModifications(candidates, overrides, componentAdditions),
    [candidates, componentAdditions, overrides],
  );
  const hierarchy = useMemo(() => buildOverrideHierarchy(modifications), [modifications]);
  const keySignature = modifications.map((item) => item.key).join("\0");
  const selectedItems = modifications.filter((item) => selectedKeys.has(item.key));
  const allSelection = modificationSelection(modifications);
  const selectedSelection = modificationSelection(selectedItems);

  useEffect(() => {
    const available = new Set(modifications.map((item) => item.key));
    setSelectedKeys((current) => new Set([...current].filter((key) => available.has(key))));
  }, [keySignature, modifications]);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
    const roomBelow = window.innerHeight - rect.bottom - PANEL_GAP - VIEWPORT_PADDING;
    const roomAbove = rect.top - PANEL_GAP - VIEWPORT_PADDING;
    const openAbove = roomBelow < 280 && roomAbove > roomBelow;
    const maxHeight = Math.max(180, Math.min(PANEL_MAX_HEIGHT, openAbove ? roomAbove : roomBelow));
    setPosition({
      left: Math.max(VIEWPORT_PADDING, Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_PADDING)),
      top: openAbove ? Math.max(VIEWPORT_PADDING, rect.top - PANEL_GAP - maxHeight) : rect.bottom + PANEL_GAP,
      width,
      maxHeight,
    });
  }, [hierarchy.length, modifications.length, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const closeOnViewportChange = (event: Event): void => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  const updateSelection = (keys: readonly string[], selected: boolean): void => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (selected) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const toggleCollapsed = (key: string): void => {
    setCollapsedNodes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className={webClasses("use-site-overrides-dropdown")}>
      <button
        ref={trigger}
        className={webClasses(`use-site-overrides-trigger ${open ? "is-open" : ""}`)}
        type="button"
        aria-label={`覆写（${modifications.length}）`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="查看 Prefab 覆写"
        onClick={() => setOpen((current) => !current)}
      >
        <span>覆写</span>
        <strong>{modifications.length}</strong>
        <ChevronDown size={11} />
      </button>
      {open && position
        ? createPortal(
            <section
              ref={panel}
              className={webClasses("use-site-overrides-panel")}
              style={position}
              role="dialog"
              aria-label="Prefab 覆写"
              data-ui="use-site-overrides-panel"
            >
              <header>
                <span>
                  <h3>覆写（{modifications.length}）</h3>
                  <small title={artifactKey}>位于 {artifactKey}</small>
                </span>
              </header>
              <div className={webClasses("use-site-override-objects")} data-ui="use-site-override-objects">
                {hierarchy.map((node) => (
                  <OverrideHierarchyBranch
                    key={node.key}
                    node={node}
                    depth={0}
                    selectedKeys={selectedKeys}
                    collapsedNodes={collapsedNodes}
                    onUpdateSelection={updateSelection}
                    onToggleCollapsed={toggleCollapsed}
                    onApply={onApply}
                    onRevert={onRevert}
                    onSelectTarget={onSelectTarget}
                    onHoverTarget={onHoverTarget}
                  />
                ))}
                {hierarchy.length === 0 ? <div className={webClasses("use-site-overrides-empty")}>没有实例覆写</div> : null}
              </div>
              {modifications.length > 0 ? (
                <footer className={webClasses("use-site-override-footer")}>
                  <label className={webClasses("use-site-overrides-select-all")} title="选择全部覆写">
                    <SelectionCheckbox
                      checked={selectedItems.length === modifications.length}
                      mixed={selectedItems.length > 0 && selectedItems.length < modifications.length}
                      label="选择全部覆写"
                      onChange={(checked) =>
                        updateSelection(
                          modifications.map((item) => item.key),
                          checked,
                        )
                      }
                    />
                  </label>
                  <span>已选 {selectedItems.length}</span>
                  <button
                    type="button"
                    disabled={selectedItems.length === 0}
                    onClick={() => onRevert(selectedSelection)}
                    title={selectedItems.length === 0 ? "请先选择覆写" : "还原所选覆写"}
                  >
                    <RotateCcw size={12} />
                    还原所选
                  </button>
                  <button
                    type="button"
                    disabled={selectedItems.length === 0}
                    onClick={() => onApply(selectedSelection)}
                    title={selectedItems.length === 0 ? "请先选择覆写" : "应用所选覆写"}
                  >
                    <ArrowUpToLine size={12} />
                    应用所选
                  </button>
                  <button type="button" onClick={() => onRevert(allSelection)}>
                    <RotateCcw size={12} />
                    全部还原
                  </button>
                  <button type="button" onClick={() => onApply(allSelection)} title="应用全部覆写">
                    <ArrowUpToLine size={12} />
                    全部应用
                  </button>
                </footer>
              ) : null}
            </section>,
            document.body,
          )
        : null}
    </div>
  );
}
