import { ArrowDown, ArrowUp, Box, ExternalLink, LocateFixed, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { findNode, walkNodes } from "../../../../kernel/tree.js";
import type { NodeReferenceFilter } from "../../../../registry/component-registry.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import type { DocumentCatalog } from "../../../shared/api/client.js";
import { gameObjectDiagnosticLabel } from "../../../shared/game-object-label.js";
import { SelectControl } from "../../../shared/select-control.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-inspector.module.css";
import { matchesNodeReferenceFilter } from "./node-reference-filter.js";

const webClasses = createWebClasses(sharedStyles, artifactStyles);

export function nodeReferenceLabel(node: Pick<UiNode, "id" | "name">): string {
  return gameObjectDiagnosticLabel(node);
}

function CommitInput({
  value,
  ariaLabel,
  list,
  placeholder,
  disabled = false,
  onCommit,
}: {
  readonly value: string;
  readonly ariaLabel: string;
  readonly list?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly onCommit: (value: string) => boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    if (!onCommit(draft)) setDraft(value);
  };
  return (
    <input
      value={draft}
      aria-label={ariaLabel}
      list={list}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.preventDefault();
        }
      }}
    />
  );
}

export function NodeReferenceField({
  source,
  value,
  filter = "any",
  disabled = false,
  onChange,
  onSelect,
  onHover,
}: {
  readonly source: UiConcreteSource;
  readonly value: string;
  readonly filter?: NodeReferenceFilter | undefined;
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: string) => boolean | void;
  readonly onSelect?: ((nodeId: string) => void) | undefined;
  readonly onHover?: ((nodeId: string | undefined) => void) | undefined;
}) {
  const candidates = useMemo(
    () =>
      walkNodes(source)
        .map((entry) => entry.node)
        .filter((node) => matchesNodeReferenceFilter(node, filter)),
    [source, filter],
  );
  const missingValue = Boolean(value) && !candidates.some((node) => node.id === value);
  const options = [
    { value: "", label: "未选择" },
    ...(missingValue ? [{ value, label: `${value}（不可用）`, title: value }] : []),
    ...candidates.map((node) => ({ value: node.id, label: nodeReferenceLabel(node), title: nodeReferenceLabel(node) })),
  ];
  return (
    <div
      className={webClasses("reference-field node-reference-field")}
      onPointerEnter={() => value && onHover?.(value)}
      onPointerLeave={() => onHover?.(undefined)}
    >
      <Search size={12} />
      <SelectControl
        ariaLabel="节点引用"
        disabled={disabled}
        value={value}
        options={options}
        searchable
        searchPlaceholder="搜索 GameObject 名称或 ID"
        onValueChange={onChange}
      />
      <button
        type="button"
        onClick={() => value && onSelect?.(value)}
        disabled={disabled || !value || !findNode(source, value)}
        title="选择引用节点"
      >
        <LocateFixed size={12} />
      </button>
    </div>
  );
}

export function NodeReferenceSelectField({
  source,
  value,
  filter = "any",
  disabled = false,
  onChange,
  onSelect,
  onHover,
}: {
  readonly source: UiConcreteSource;
  readonly value: string;
  readonly filter?: NodeReferenceFilter | undefined;
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: string) => boolean | void;
  readonly onSelect?: ((nodeId: string) => void) | undefined;
  readonly onHover?: ((nodeId: string | undefined) => void) | undefined;
}) {
  const candidates = useMemo(
    () =>
      walkNodes(source)
        .map((entry) => entry.node)
        .filter((node) => matchesNodeReferenceFilter(node, filter)),
    [source, filter],
  );
  const missingValue = Boolean(value) && !candidates.some((node) => node.id === value);
  const options = [
    { value: "", label: "未选择" },
    ...(missingValue ? [{ value, label: `${value}（不可用）`, title: value }] : []),
    ...candidates.map((node) => ({ value: node.id, label: nodeReferenceLabel(node), title: nodeReferenceLabel(node) })),
  ];
  return (
    <div
      className={webClasses("reference-field node-reference-select-field")}
      onPointerEnter={() => value && onHover?.(value)}
      onPointerLeave={() => onHover?.(undefined)}
    >
      <SelectControl
        ariaLabel="节点引用"
        disabled={disabled}
        value={value}
        options={options}
        searchable
        searchPlaceholder="搜索 GameObject 名称或 ID"
        onValueChange={onChange}
      />
      <button
        type="button"
        onClick={() => value && onSelect?.(value)}
        disabled={disabled || !value || !findNode(source, value)}
        title="选择引用节点"
      >
        <LocateFixed size={12} />
      </button>
    </div>
  );
}

export function NodeReferenceListField({
  source,
  value,
  filter = "any",
  selectedIndices,
  listDisabled = false,
  selectionDisabled = false,
  onChange,
  onSelectionChange,
  onSelect,
  onHover,
}: {
  readonly source: UiConcreteSource;
  readonly value: readonly string[];
  readonly filter?: NodeReferenceFilter | undefined;
  readonly selectedIndices?: readonly number[] | undefined;
  readonly listDisabled?: boolean | undefined;
  readonly selectionDisabled?: boolean | undefined;
  readonly onChange: (value: readonly string[]) => boolean | void;
  readonly onSelectionChange?: ((value: readonly number[]) => boolean | void) | undefined;
  readonly onSelect?: ((nodeId: string) => void) | undefined;
  readonly onHover?: ((nodeId: string | undefined) => void) | undefined;
}) {
  const candidates = walkNodes(source)
    .map((entry) => entry.node)
    .filter((node) => matchesNodeReferenceFilter(node, filter));
  const available = candidates.find((node) => !value.includes(node.id));
  const selected = new Set(selectedIndices ?? []);
  const toggle = (index: number): void => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelectionChange?.([...next].sort((left, right) => left - right));
  };
  const move = (index: number, offset: -1 | 1): void => {
    const target = index + offset;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  return (
    <div className={webClasses("map-editor")}>
      <div className={webClasses("map-rows")}>
        {value.map((nodeId, index) => (
          <div className={webClasses("map-row")} key={`${nodeId}:${index}`}>
            {onSelectionChange ? (
              <input
                type="checkbox"
                aria-label={`选择第 ${index + 1} 项`}
                checked={selected.has(index)}
                disabled={selectionDisabled}
                onChange={() => toggle(index)}
              />
            ) : null}
            {onSelectionChange ? <span className={webClasses("indexed-list-index")}>{index}</span> : null}
            <NodeReferenceField
              source={source}
              value={nodeId}
              filter={filter}
              disabled={listDisabled}
              onChange={(next) => onChange(value.map((current, currentIndex) => (currentIndex === index ? next : current)))}
              onSelect={onSelect}
              onHover={onHover}
            />
            {onSelectionChange ? (
              <button type="button" disabled={listDisabled || index === 0} onClick={() => move(index, -1)} title="上移">
                <ArrowUp size={12} />
              </button>
            ) : null}
            {onSelectionChange ? (
              <button type="button" disabled={listDisabled || index === value.length - 1} onClick={() => move(index, 1)} title="下移">
                <ArrowDown size={12} />
              </button>
            ) : null}
            <button
              type="button"
              disabled={listDisabled || value.length <= 1}
              onClick={() => onChange(value.filter((_, currentIndex) => currentIndex !== index))}
              title="删除引用"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        className={webClasses("add-map-row")}
        type="button"
        disabled={listDisabled || !available}
        onClick={() => available && onChange([...value, available.id])}
      >
        <Plus size={12} />
        添加引用
      </button>
    </div>
  );
}

export function prefabArtifactCandidates(
  source: UiConcreteSource,
  catalog: DocumentCatalog,
  artifactType?: "Widget",
): DocumentCatalog["artifacts"] {
  return catalog.artifacts.filter(
    (entry) =>
      entry.artifactKey !== source.artifactKey &&
      (entry.artifactType === "Fragment" || (source.artifactType !== "Fragment" && entry.artifactType === "Widget")) &&
      (artifactType === undefined || entry.artifactType === artifactType),
  );
}

export function ArtifactReferenceField({
  source,
  catalog,
  value,
  artifactType,
  staged = true,
  onChange,
  onOpen,
}: {
  readonly source: UiConcreteSource;
  readonly catalog: DocumentCatalog;
  readonly value: string;
  readonly artifactType?: "Widget" | undefined;
  readonly staged?: boolean | undefined;
  readonly onChange: (value: string) => boolean | void;
  readonly onOpen: (artifactKey: string) => void;
}) {
  const listId = useId();
  const candidates = prefabArtifactCandidates(source, catalog, artifactType);
  return (
    <div className={webClasses("reference-field artifact-reference-field")} data-ui="artifact-reference-field">
      <Box size={12} />
      {staged ? (
        <CommitInput value={value} ariaLabel="Artifact 引用" list={listId} onCommit={(next) => onChange(next) !== false} />
      ) : (
        <input value={value} aria-label="Artifact 引用" list={listId} onChange={(event) => onChange(event.target.value)} />
      )}
      <datalist id={listId}>
        {candidates.map((entry) => (
          <option key={entry.artifactKey} value={entry.artifactKey}>
            {entry.artifactType}
          </option>
        ))}
      </datalist>
      <button type="button" onClick={() => value && onOpen(value)} disabled={!value} title="打开 Artifact">
        <ExternalLink size={12} />
      </button>
    </div>
  );
}

export { CommitInput };
