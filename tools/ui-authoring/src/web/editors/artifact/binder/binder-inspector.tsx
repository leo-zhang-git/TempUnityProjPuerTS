import { Link2, LocateFixed, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type BinderBindingCandidate,
  binderCandidateMatchesContract,
  defaultBinderBindingFieldName,
  preferredBinderBindingCandidate,
  type ResolvedBinderBinding,
} from "../../../../kernel/binder.js";
import type { UiConcreteSource, UiNestedTarget } from "../../../../schema/ui-source-schema.js";
import type { SelectionAddress } from "../../../rendering/selection.js";
import { SelectControl } from "../../../shared/select-control.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import { HIERARCHY_BINDING_DRAG_TYPE, readHierarchyBindingDragData } from "../../shared/hierarchy-node-drag.js";
import artifactStyles from "../artifact-editor-shell.module.css";
import { BinderWidgetIdentity } from "./binder-widget-identity.js";

const webClasses = createWebClasses(artifactStyles);

interface BinderTargetLocation {
  readonly target: UiNestedTarget;
  readonly targetOwnerArtifactKey: string;
}
function BinderBindingName({
  binding,
  onRename,
}: {
  readonly binding: ResolvedBinderBinding;
  readonly onRename: (localIndex: number, nextFieldName: string) => boolean;
}) {
  const [value, setValue] = useState(binding.fieldName);
  useEffect(() => setValue(binding.fieldName), [binding.fieldName]);
  const commit = (): void => {
    if (value === binding.fieldName || binding.localIndex === undefined) return;
    if (!onRename(binding.localIndex, value)) setValue(binding.fieldName);
  };
  return (
    <input
      value={value}
      readOnly={!binding.editable}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setValue(binding.fieldName);
          event.currentTarget.blur();
        }
      }}
      aria-label={`Binding ${binding.fieldName}`}
    />
  );
}

function binderTargetKey(target: UiNestedTarget): string {
  return JSON.stringify([target.instancePath ?? [], target.nodeId, target.componentType]);
}

function uniqueCandidateLabel(
  candidate: BinderBindingCandidate,
  candidates: readonly BinderBindingCandidate[],
  objectOnly = false,
): string {
  const label = objectOnly ? candidate.objectLabel : candidate.label;
  const duplicate = candidates.some(
    (entry) =>
      entry.key !== candidate.key &&
      (objectOnly ? entry.objectKey !== candidate.objectKey : true) &&
      (objectOnly ? entry.objectLabel : entry.label) === label,
  );
  return duplicate ? `${label} (${objectOnly ? candidate.objectIdPath : candidate.idLabel})` : label;
}

function binderCandidatesAtAddress(
  candidates: readonly BinderBindingCandidate[],
  address: SelectionAddress,
): readonly BinderBindingCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.targetOwnerArtifactKey === address.ownerArtifactKey &&
      candidate.target.nodeId === address.nodeId &&
      (candidate.target.instancePath ?? []).join("\0") === address.instancePath.join("\0"),
  );
}

export function addPreferredBinderBinding(
  candidates: readonly BinderBindingCandidate[],
  bindings: readonly ResolvedBinderBinding[],
  address: SelectionAddress,
  onAdd: (fieldName: string, target: UiNestedTarget) => boolean,
): boolean {
  const candidate = preferredBinderBindingCandidate(binderCandidatesAtAddress(candidates, address));
  if (!candidate) return false;
  const baseName = defaultBinderBindingFieldName(candidate.objectName, candidate.target.componentType);
  const usedNames = new Set(bindings.map((binding) => binding.fieldName));
  let fieldName = baseName;
  let suffix = 2;
  while (usedNames.has(fieldName)) fieldName = `${baseName}${suffix++}`;
  return onAdd(fieldName, candidate.target);
}

const BINDER_ROW_DRAG_TYPE = "application/x-ui-authoring-binder-row";

export function BinderBindingsInspector({
  bindings,
  candidates,
  artifactType,
  localWidgetType,
  effectiveWidgetType,
  widgetTypeError,
  canAdd,
  onWidgetType,
  onAdd,
  onRename,
  onRemove,
  onRetarget,
  onResetTarget,
  onReorder,
  onSelectTarget,
  onHoverTarget,
  onDropDenied,
}: {
  readonly bindings: readonly ResolvedBinderBinding[];
  readonly candidates: readonly BinderBindingCandidate[];
  readonly artifactType: UiConcreteSource["artifactType"];
  readonly localWidgetType: string;
  readonly effectiveWidgetType: string;
  readonly widgetTypeError: string | undefined;
  readonly canAdd: boolean;
  readonly onWidgetType: (widgetType: string) => boolean;
  readonly onAdd: (fieldName: string, target: UiNestedTarget) => boolean;
  readonly onRename: (localIndex: number, nextFieldName: string) => boolean;
  readonly onRemove: (localIndex: number) => void;
  readonly onRetarget: (localIndex: number, target: UiNestedTarget) => boolean;
  readonly onResetTarget: (localIndex: number) => void;
  readonly onReorder: (fromIndex: number, toIndex: number) => boolean;
  readonly onSelectTarget: (target: BinderTargetLocation) => void;
  readonly onHoverTarget: (target: BinderTargetLocation | undefined) => void;
  readonly onDropDenied: (reason: string) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [nameFilter, setNameFilter] = useState("");
  const [objectFilter, setObjectFilter] = useState("");
  const filterActive = nameFilter.trim().length > 0 || objectFilter.length > 0;
  const objectOptions = [
    ...new Map(
      candidates.map((candidate) => [
        candidate.objectKey,
        {
          key: candidate.objectKey,
          candidate,
        },
      ]),
    ).values(),
  ];
  const candidateFor = (binding: ResolvedBinderBinding): BinderBindingCandidate | undefined =>
    candidates.find((candidate) => candidate.key === binderTargetKey(binding.target));
  const visibleBindings = bindings.filter((binding) => {
    const candidate = candidateFor(binding);
    const matchesName =
      nameFilter.trim().length === 0 ||
      `${binding.fieldName} ${candidate?.objectName ?? binding.target.nodeId}`.toLocaleLowerCase().includes(nameFilter.toLocaleLowerCase());
    const matchesObject =
      objectFilter.length === 0 ||
      (candidate?.objectKey ?? JSON.stringify([binding.target.instancePath ?? [], binding.target.nodeId])) === objectFilter;
    return matchesName && matchesObject;
  });
  const addDroppedAddress = (address: SelectionAddress): void => {
    if (!canAdd || filterActive) {
      onDropDenied(filterActive ? "筛选生效时不能新增 Binding" : "当前 Source 没有 Binder");
      return;
    }
    if (!addPreferredBinderBinding(candidates, bindings, address, onAdd)) onDropDenied("该节点没有可添加到当前 Binder 的目标");
  };
  return (
    <section
      className={webClasses(`inspector-section binder-bindings-section ${dragActive ? "is-drag-over" : ""}`)}
      data-ui="binder-bindings-section"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes(HIERARCHY_BINDING_DRAG_TYPE)) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(HIERARCHY_BINDING_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as HTMLElement)) return;
        setDragActive(false);
      }}
      onDrop={(event) => {
        const address = readHierarchyBindingDragData(event.dataTransfer);
        if (!address) return;
        event.preventDefault();
        setDragActive(false);
        addDroppedAddress(address);
      }}
    >
      <h3>
        Binder Bindings{" "}
        <span>
          {visibleBindings.length}/{bindings.length}
        </span>
      </h3>
      {artifactType === "Widget" ? (
        <BinderWidgetIdentity local={localWidgetType} effective={effectiveWidgetType} error={widgetTypeError} onChange={onWidgetType} />
      ) : null}
      <div className={webClasses("binder-filter-controls")}>
        <label>
          <Search size={11} />
          <input
            value={nameFilter}
            onChange={(event) => setNameFilter(event.target.value)}
            aria-label="Binding 名称筛选"
            placeholder="名称"
          />
        </label>
        <label>
          <LocateFixed size={11} />
          <SelectControl
            value={objectFilter}
            onValueChange={setObjectFilter}
            ariaLabel="Binding 对象筛选"
            options={[
              { value: "", label: "对象" },
              ...objectOptions.map((option) => ({
                value: option.key,
                label: uniqueCandidateLabel(option.candidate, candidates, true),
                title: `${option.candidate.objectLabel} (${option.candidate.objectIdPath})`,
              })),
            ]}
          />
        </label>
        <button
          type="button"
          disabled={!objectFilter}
          onClick={() => {
            const match = bindings.find(
              (binding) =>
                (candidateFor(binding)?.objectKey ?? JSON.stringify([binding.target.instancePath ?? [], binding.target.nodeId])) ===
                objectFilter,
            );
            if (match) {
              setNameFilter(match.fieldName);
              setObjectFilter("");
            }
          }}
          title="使用已选对象筛选声明名称"
          aria-label="按对象筛选名称"
        >
          <Search size={11} />
        </button>
        <button
          type="button"
          disabled={!filterActive}
          onClick={() => {
            setNameFilter("");
            setObjectFilter("");
          }}
          title="清空筛选"
          aria-label="清除 Binding 筛选"
        >
          <X size={11} />
        </button>
      </div>
      <div className={webClasses("binder-binding-list")}>
        {visibleBindings.map((binding) => {
          const currentTargetKey = binderTargetKey(binding.target);
          const targetOptions = candidates.filter(
            (candidate) => binding.origin !== "variantOverride" || binderCandidateMatchesContract(binding, candidate),
          );
          const hasCurrentTarget = targetOptions.some((candidate) => candidate.key === currentTargetKey);
          const currentCandidate = candidateFor(binding);
          const canLocate = Boolean(currentCandidate);
          return (
            <div
              className={webClasses(`binder-binding-row is-${binding.origin} ${binding.error ? "is-invalid" : ""}`)}
              key={binding.rowKey}
              title={binding.error}
              data-binding-row={binding.rowKey}
              data-binding-error={binding.error || undefined}
              draggable={binding.localIndex !== undefined && !filterActive}
              onDragStart={(event) => {
                if (binding.localIndex === undefined || filterActive) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.setData(BINDER_ROW_DRAG_TYPE, String(binding.localIndex));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                if (binding.localIndex === undefined || !event.dataTransfer.types.includes(BINDER_ROW_DRAG_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                if (binding.localIndex === undefined || filterActive) return;
                const fromIndex = Number(event.dataTransfer.getData(BINDER_ROW_DRAG_TYPE));
                if (!Number.isInteger(fromIndex)) return;
                event.preventDefault();
                onReorder(fromIndex, binding.localIndex);
              }}
              onPointerEnter={() => canLocate && onHoverTarget(binding)}
              onPointerLeave={() => onHoverTarget(undefined)}
            >
              <BinderBindingName binding={binding} onRename={onRename} />
              {binding.targetEditable ? (
                <label className={webClasses("binder-binding-target-editor")} title="重定向 Binding">
                  <SelectControl
                    value={currentTargetKey}
                    ariaLabel={`Binding 目标：${binding.fieldName}`}
                    options={[
                      ...(!hasCurrentTarget
                        ? [
                            {
                              value: currentTargetKey,
                              label: `${[...(binding.target.instancePath ?? []), binding.target.nodeId].join("/")} · ${binding.target.componentType}（不可用）`,
                            },
                          ]
                        : []),
                      ...targetOptions.map((candidate) => ({
                        value: candidate.key,
                        label: uniqueCandidateLabel(candidate, targetOptions),
                        title: `${candidate.objectLabel} (${candidate.objectIdPath}) · ${candidate.target.componentType}`,
                      })),
                    ]}
                    onValueChange={(value) => {
                      const candidate = targetOptions.find((entry) => entry.key === value);
                      if (candidate && binding.localIndex !== undefined) onRetarget(binding.localIndex, candidate.target);
                    }}
                  />
                  <small>
                    {binding.origin === "variantOverride" ? "Variant 覆盖" : binding.origin === "variantAddition" ? "Variant" : "本地"}
                  </small>
                </label>
              ) : (
                <div className={webClasses("binder-binding-target-cell")}>
                  <button
                    className={webClasses("binder-binding-target")}
                    type="button"
                    disabled={!canLocate}
                    onClick={() => onSelectTarget(binding)}
                    title={`定位 ${
                      currentCandidate
                        ? `${currentCandidate.objectLabel} (${currentCandidate.objectIdPath})`
                        : [...(binding.target.instancePath ?? []), binding.target.nodeId].join("/")
                    }`}
                  >
                    <span>
                      {currentCandidate
                        ? uniqueCandidateLabel(currentCandidate, candidates, true)
                        : `${[...(binding.target.instancePath ?? []), binding.target.nodeId].join("/")}（不可用）`}
                    </span>
                  </button>
                  <small>继承</small>
                </div>
              )}
              <button type="button" disabled={!canLocate} onClick={() => onSelectTarget(binding)} title="定位 Binding 目标">
                <LocateFixed size={12} />
              </button>
              {binding.origin === "variantOverride" ? (
                <button
                  type="button"
                  onClick={() => binding.localIndex !== undefined && onResetTarget(binding.localIndex)}
                  title={`删除 ${binding.fieldName} override`}
                >
                  <RotateCcw size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={binding.localIndex === undefined}
                  onClick={() => binding.localIndex !== undefined && onRemove(binding.localIndex)}
                  title={binding.editable ? `删除 ${binding.fieldName}` : "继承 Binding 不能删除"}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className={webClasses("binder-binding-drop-zone")} data-binder-drop-zone data-disabled={!canAdd || filterActive || undefined}>
        <Link2 size={12} />
        <span>将 Hierarchy 节点拖到此处</span>
      </div>
    </section>
  );
}
