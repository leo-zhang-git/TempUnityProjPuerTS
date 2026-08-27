import { ChevronDown, ChevronRight, GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  defaultStateRootElementValue,
  readCurrentStateRootElementValue,
  stateRootElementDescriptor,
  stateRootElementReferenceFilter,
  stateRootElementTypes,
} from "../../../../components/state-root-elements.js";
import { type EvaluatedNode, evaluateLayout } from "../../../../kernel/layout.js";
import { findNode, walkNodes } from "../../../../kernel/tree.js";
import type { NodeReferenceFilter } from "../../../../registry/component-registry.js";
import type { UiConcreteSource, UiStateRootElement } from "../../../../schema/ui-source-schema.js";
import { gameObjectDiagnosticLabelById, gameObjectName, gameObjectNameById } from "../../../shared/game-object-label.js";
import { SelectControl } from "../../../shared/select-control.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import sharedStyles from "../../shared/editor-shell.module.css";
import artifactStyles from "./artifact-inspector.module.css";
import { ColorField } from "./color-field.js";
import { AssetField } from "./inspector-asset-fields.js";
import { NumberInput, TupleField } from "./inspector-field-primitives.js";
import { CommitInput, NodeReferenceSelectField, nodeReferenceLabel } from "./inspector-reference-fields.js";
import type { AssetPickerRequest, ComponentValue, InspectorUpdateMode } from "./inspector-types.js";
import { matchesNodeReferenceFilter } from "./node-reference-filter.js";

const webClasses = createWebClasses(sharedStyles, artifactStyles);
const stateElementTypes = stateRootElementTypes;
const statePublicElementTypes = ["Active", ...stateElementTypes] as const;
type StatePublicElementType = (typeof statePublicElementTypes)[number];

function stateRootNotice(message: string): string {
  const exact: Record<string, string> = {
    "Inherited StateRoot structure is read-only; add states in the defining Widget":
      "继承的 StateRoot 结构只读，请在定义它的 Widget 中添加状态",
    "Inherited StateRoot structure is read-only; delete states in the defining Widget":
      "继承的 StateRoot 结构只读，请在定义它的 Widget 中删除状态",
    "Inherited StateRoot structure is read-only; add public elements in the defining Widget":
      "继承的 StateRoot 结构只读，请在定义它的 Widget 中添加公共元素",
    "Inherited StateRoot structure is read-only; delete public elements in the defining Widget":
      "继承的 StateRoot 结构只读，请在定义它的 Widget 中删除公共元素",
    "Inherited StateRoot structure is read-only; reorder states in the defining Widget":
      "继承的 StateRoot 结构只读，请在定义它的 Widget 中调整状态顺序",
    "Inherited StateRoot structure is read-only; add properties in the defining Widget":
      "继承的 StateRoot 结构只读，请在定义它的 Widget 中添加属性",
    "Inherited StateRoot structure is read-only; delete properties in the defining Widget":
      "继承的 StateRoot 结构只读，请在定义它的 Widget 中删除属性",
    "cannot delete the last state": "不能删除最后一个状态",
    "cannot add a property before declaring a state": "请先声明状态，再添加属性",
    "property target cannot be empty": "属性目标不能为空",
  };
  if (exact[message]) return exact[message];
  const rules: readonly { readonly pattern: RegExp; readonly format: (match: RegExpExecArray) => string }[] = [
    { pattern: /^selected state '(.+)'$/, format: (match) => `已选择状态 '${match[1]}'` },
    { pattern: /^created state '(.+)'$/, format: (match) => `已创建状态 '${match[1]}'` },
    { pattern: /^moved state '(.+)' to position (\d+)$/, format: (match) => `已将状态 '${match[1]}' 移到第 ${match[2]} 位` },
    { pattern: /^rejected invalid state name '(.+)'$/, format: (match) => `状态名 '${match[1]}' 无效` },
    { pattern: /^state name '(.+)' already exists$/, format: (match) => `状态名 '${match[1]}' 已存在` },
    { pattern: /^renamed state '(.+)' to '(.+)'$/, format: (match) => `已将状态 '${match[1]}' 重命名为 '${match[2]}'` },
    { pattern: /^deleted state '(.+)'$/, format: (match) => `已删除状态 '${match[1]}'` },
    { pattern: /^no available target nodes for '(.+)'$/, format: (match) => `没有可用于 '${match[1]}' 的目标节点` },
    { pattern: /^added public (.+) element '(.+)'$/, format: (match) => `已添加公共 ${match[1]} 元素 '${match[2]}'` },
    { pattern: /^public Active element '(.+)' already exists$/, format: (match) => `公共 Active 元素 '${match[1]}' 已存在` },
    {
      pattern: /^changed public Active target '(.+)' to '(.+)'$/,
      format: (match) => `已将公共 Active 目标从 '${match[1]}' 改为 '${match[2]}'`,
    },
    { pattern: /^deleted public (.+) element '(.+)'$/, format: (match) => `已删除公共 ${match[1]} 元素 '${match[2]}'` },
    { pattern: /^property '(.+)' already exists$/, format: (match) => `属性 '${match[1]}' 已存在` },
    {
      pattern: /^changed public element type to '(.+)' for '(.+)'$/,
      format: (match) => `已将 '${match[2]}' 的公共元素类型改为 '${match[1]}'`,
    },
    {
      pattern: /^set target '(.+)' active=(true|false) in '(.+)'$/,
      format: (match) => `已在状态 '${match[3]}' 中将目标 '${match[1]}' 的 Active 设为 ${match[2]}`,
    },
    { pattern: /^added property '(.+)'$/, format: (match) => `已添加属性 '${match[1]}'` },
    {
      pattern: /^changed property type to '(.+)' for '(.+)'$/,
      format: (match) => `已将 '${match[2]}' 的属性类型改为 '${match[1]}'`,
    },
    { pattern: /^deleted property '(.+)'$/, format: (match) => `已删除属性 '${match[1]}'` },
  ];
  for (const rule of rules) {
    const match = rule.pattern.exec(message);
    if (match) return rule.format(match);
  }
  return message;
}

function evaluatedRectsById(source: UiConcreteSource): ReadonlyMap<string, EvaluatedNode["rect"]> {
  const result = new Map<string, EvaluatedNode["rect"]>();
  const visit = (entry: EvaluatedNode): void => {
    result.set(entry.node.id, entry.rect);
    entry.children.forEach(visit);
  };
  visit(evaluateLayout(source));
  return result;
}

function currentStateElementValue(
  source: UiConcreteSource,
  type: UiStateRootElement["elementType"],
  targetNodeId: string,
  evaluatedRects: ReadonlyMap<string, EvaluatedNode["rect"]>,
): unknown {
  const target = findNode(source, targetNodeId);
  return target ? readCurrentStateRootElementValue(type, target, evaluatedRects.get(targetNodeId)) : defaultStateRootElementValue(type);
}

export function StateMapField({
  source,
  component,
  structureEditable = true,
  selectionMode = "current",
  selectedState,
  onChange,
  onCurrentStateChange,
  onStateSelect,
  openAssetPicker,
  onNotice,
  onBlocked,
}: {
  readonly source: UiConcreteSource;
  readonly component: ComponentValue;
  readonly structureEditable?: boolean | undefined;
  readonly selectionMode?: "current" | "preview" | undefined;
  readonly selectedState?: string | undefined;
  readonly onChange: (value: ComponentValue, mode?: InspectorUpdateMode) => boolean | void;
  readonly onCurrentStateChange?: ((value: string) => boolean | void) | undefined;
  readonly onStateSelect?: ((value: string) => boolean | void) | undefined;
  readonly openAssetPicker: (request: AssetPickerRequest) => void;
  readonly onNotice?: ((notice: string) => void) | undefined;
  readonly onBlocked?: ((message: string) => void) | undefined;
}) {
  const report = (message: string, level: "info" | "warn" = "info", nodeIds: readonly string[] = []): void => {
    const text = `StateRoot：${stateRootNotice(message)}`;
    const diagnostic =
      nodeIds.length > 0 ? ` [${nodeIds.map((nodeId) => gameObjectDiagnosticLabelById(source, nodeId)).join(" -> ")}]` : "";
    if (level === "warn") {
      if (onBlocked) onBlocked(text);
      else {
        console.warn(`[Legma][StateRoot] ${message}${diagnostic}`);
        onNotice?.(text);
      }
      return;
    }
    console.info(`[Legma][StateRoot] ${message}${diagnostic}`);
    onNotice?.(text);
  };
  const states = (component.states ?? {}) as Record<string, Record<string, boolean>>;
  const elements = (component.elements ?? []) as UiStateRootElement[];
  const names = Object.keys(states);
  const currentState = String(component.currentState ?? "");
  const displayedState =
    selectedState && names.includes(selectedState) ? selectedState : names.includes(currentState) ? currentState : (names[0] ?? "");
  const [elementsExpanded, setElementsExpanded] = useState(true);
  const [statesExpanded, setStatesExpanded] = useState(true);
  const [expandedStates, setExpandedStates] = useState<Set<string>>(() => new Set());
  const draggedStateRef = useRef("");
  const [draggedState, setDraggedState] = useState("");
  const [dragOverState, setDragOverState] = useState("");
  const nodeEntries = useMemo(() => walkNodes(source).map((entry) => entry.node), [source]);
  const evaluatedRects = useMemo(() => evaluatedRectsById(source), [source]);
  const nodeNamesById = useMemo(() => new Map(nodeEntries.map((node) => [node.id, gameObjectName(node)])), [nodeEntries]);
  const activeTargetIds = useMemo(() => [...new Set(names.flatMap((name) => Object.keys(states[name] ?? {})))], [names, states]);
  const activeTargetSet = useMemo(() => new Set(activeTargetIds), [activeTargetIds]);
  const [publicElementTypeDraft, setPublicElementTypeDraft] = useState<StatePublicElementType>("Active");
  const publicElementFilter = publicElementTypeDraft === "Active" ? "any" : stateElementReferenceFilter(publicElementTypeDraft);
  const publicElementCandidates = useMemo(
    () => nodeEntries.filter((node) => matchesNodeReferenceFilter(node, publicElementFilter)),
    [nodeEntries, publicElementFilter],
  );
  const usedPublicTargetIds = useMemo(
    () =>
      publicElementTypeDraft === "Active"
        ? activeTargetSet
        : new Set(elements.filter((element) => element.elementType === publicElementTypeDraft).map((element) => element.targetNodeId)),
    [activeTargetSet, elements, publicElementTypeDraft],
  );
  const availablePublicTargets = useMemo(
    () => publicElementCandidates.filter((node) => !usedPublicTargetIds.has(node.id)),
    [publicElementCandidates, usedPublicTargetIds],
  );
  const [publicTargetDraft, setPublicTargetDraft] = useState("");
  useEffect(() => {
    if (availablePublicTargets.length === 0) {
      if (publicTargetDraft) setPublicTargetDraft("");
      return;
    }
    if (!availablePublicTargets.some((node) => node.id === publicTargetDraft)) setPublicTargetDraft(availablePublicTargets[0]!.id);
  }, [availablePublicTargets, publicTargetDraft]);
  useEffect(() => {
    setExpandedStates((current) => {
      const next = new Set([...current].filter((name) => names.includes(name)));
      return next.size === current.size ? current : next;
    });
  }, [names]);
  const setStates = (
    next: Record<string, Record<string, boolean>>,
    nextCurrentState = currentState,
    nextElements = elements,
    mode?: InspectorUpdateMode,
  ): boolean => onChange({ ...component, states: next, currentState: nextCurrentState, elements: nextElements }, mode) !== false;
  const setCurrentState = (stateName: string): boolean =>
    onCurrentStateChange ? onCurrentStateChange(stateName) !== false : setStates(states, stateName, elements);
  const selectCurrentState = (stateName: string): void => {
    if (stateName === displayedState) return;
    if (selectionMode === "current" && !setCurrentState(stateName)) return;
    if (onStateSelect?.(stateName) === false) return;
    report(`selected state '${stateName}'`);
  };
  const toggleStateExpanded = (stateName: string): void =>
    setExpandedStates((current) => {
      const next = new Set(current);
      if (next.has(stateName)) next.delete(stateName);
      else next.add(stateName);
      return next;
    });
  const mapStates = (
    mapper: (stateName: string, targets: Record<string, boolean>) => Record<string, boolean>,
  ): Record<string, Record<string, boolean>> =>
    Object.fromEntries(Object.entries(states).map(([stateName, stateTargets]) => [stateName, mapper(stateName, stateTargets)]));
  const addState = (): void => {
    if (!structureEditable) {
      report("Inherited StateRoot structure is read-only; add states in the defining Widget", "warn");
      return;
    }
    let index = names.length;
    let name = `name_${index}`;
    while (name in states) name = `name_${++index}`;
    const templateState = names[0] ?? currentState;
    const nextElements = elements.map(
      (element) =>
        ({ ...element, values: { ...element.values, [name]: defaultStateRootElementValue(element.elementType) } }) as UiStateRootElement,
    );
    const templateTargets = states[templateState] ?? {};
    const nextTargets = Object.fromEntries(Object.keys(templateTargets).map((targetId) => [targetId, false]));
    const nextCurrentState = names.includes(currentState) ? currentState : name;
    if (setStates({ ...states, [name]: nextTargets }, nextCurrentState, nextElements)) {
      report(`created state '${name}'`);
    }
  };
  const moveState = (sourceName: string, targetName: string): void => {
    const from = names.indexOf(sourceName);
    const to = names.indexOf(targetName);
    if (!structureEditable || from < 0 || to < 0 || from === to) return;
    const nextNames = [...names];
    const [moved] = nextNames.splice(from, 1);
    nextNames.splice(to, 0, moved!);
    const nextStates = Object.fromEntries(nextNames.map((name) => [name, states[name]!])) as Record<string, Record<string, boolean>>;
    const nextElements = elements.map(
      (element) =>
        ({
          ...element,
          values: Object.fromEntries(nextNames.map((name) => [name, element.values[name]])),
        }) as UiStateRootElement,
    );
    if (setStates(nextStates, currentState, nextElements)) report(`moved state '${sourceName}' to position ${to + 1}`);
  };
  const renameState = (stateName: string, draft: string): boolean => {
    const nextName = draft.trim();
    if (!nextName || /[/\\]/.test(nextName)) {
      report(`rejected invalid state name '${draft}'`, "warn");
      return false;
    }
    if (nextName === stateName) return true;
    if (nextName in states) {
      report(`state name '${nextName}' already exists`, "warn");
      return false;
    }
    const next: Record<string, Record<string, boolean>> = {};
    for (const [name, state] of Object.entries(states)) next[name === stateName ? nextName : name] = state;
    const nextCurrentState = currentState === stateName ? nextName : currentState;
    const nextElements = elements.map((element) => {
      const values: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(element.values)) values[name === stateName ? nextName : name] = value;
      return { ...element, values } as UiStateRootElement;
    });
    if (setStates(next, nextCurrentState, nextElements)) {
      setExpandedStates((current) => {
        if (!current.has(stateName)) return current;
        const renamed = new Set(current);
        renamed.delete(stateName);
        renamed.add(nextName);
        return renamed;
      });
      if (currentState === stateName) onStateSelect?.(nextName);
      report(`renamed state '${stateName}' to '${nextName}'`);
      return true;
    }
    return false;
  };
  const removeState = (stateName: string): void => {
    if (!structureEditable) {
      report("Inherited StateRoot structure is read-only; delete states in the defining Widget", "warn");
      return;
    }
    if (names.length <= 1) {
      report("cannot delete the last state", "warn");
      return;
    }
    const next = { ...states };
    delete next[stateName];
    const remainingNames = Object.keys(next);
    const removedIndex = names.indexOf(stateName);
    const fallback = remainingNames[Math.min(Math.max(removedIndex, 0), remainingNames.length - 1)] ?? remainingNames[0] ?? "default";
    const nextElements = elements.map((element) => {
      const values = { ...element.values } as Record<string, unknown>;
      delete values[stateName];
      return { ...element, values } as UiStateRootElement;
    });
    const nextCurrentState = currentState === stateName ? fallback : currentState;
    if (setStates(next, nextCurrentState, nextElements)) {
      setExpandedStates((current) => {
        const reduced = new Set(current);
        reduced.delete(stateName);
        return reduced;
      });
      if (currentState === stateName) onStateSelect?.(fallback);
      report(`deleted state '${stateName}'`);
    }
  };
  const addPublicElement = (): void => {
    if (!structureEditable) {
      report("Inherited StateRoot structure is read-only; add public elements in the defining Widget", "warn");
      return;
    }
    const targetNodeId = availablePublicTargets.find((node) => node.id === publicTargetDraft)?.id ?? availablePublicTargets[0]?.id;
    if (!targetNodeId) {
      report(`no available target nodes for '${publicElementTypeDraft}'`, "warn");
      return;
    }
    if (publicElementTypeDraft === "Active") {
      const next = mapStates((_stateName, stateTargets) => ({ ...stateTargets, [targetNodeId]: false }));
      if (setStates(next)) report(`added public Active element '${gameObjectNameById(source, targetNodeId)}'`, "info", [targetNodeId]);
    } else {
      const currentValue = currentStateElementValue(source, publicElementTypeDraft, targetNodeId, evaluatedRects);
      const values = Object.fromEntries(names.map((stateName) => [stateName, structuredClone(currentValue)]));
      if (
        setStates(states, currentState, [...elements, { targetNodeId, elementType: publicElementTypeDraft, values } as UiStateRootElement])
      )
        report(`added public ${publicElementTypeDraft} element '${gameObjectNameById(source, targetNodeId)}'`, "info", [targetNodeId]);
    }
    setPublicTargetDraft(availablePublicTargets.find((node) => node.id !== targetNodeId)?.id ?? targetNodeId);
  };
  const renameActiveTarget = (targetId: string, nextId: string): boolean => {
    if (!nextId || nextId === targetId) return Boolean(nextId);
    if (activeTargetSet.has(nextId)) {
      report(`public Active element '${gameObjectNameById(source, nextId)}' already exists`, "warn", [nextId]);
      return false;
    }
    const next = mapStates((_stateName, stateTargets) => {
      const nextTargets: Record<string, boolean> = {};
      for (const [id, active] of Object.entries(stateTargets)) nextTargets[id === targetId ? nextId : id] = active;
      return nextTargets;
    });
    if (!setStates(next)) return false;
    report(`changed public Active target '${gameObjectNameById(source, targetId)}' to '${gameObjectNameById(source, nextId)}'`, "info", [
      targetId,
      nextId,
    ]);
    return true;
  };
  const removeActiveTarget = (targetId: string): void => {
    if (!structureEditable) {
      report("Inherited StateRoot structure is read-only; delete public elements in the defining Widget", "warn");
      return;
    }
    const next = mapStates((_stateName, stateTargets) => {
      const nextTargets = { ...stateTargets };
      delete nextTargets[targetId];
      return nextTargets;
    });
    if (setStates(next)) report(`deleted public Active element '${gameObjectNameById(source, targetId)}'`, "info", [targetId]);
  };
  const replaceElement = (index: number, next: UiStateRootElement, mode?: InspectorUpdateMode): boolean =>
    setStates(
      states,
      currentState,
      elements.map((element, current) => (current === index ? next : element)),
      mode,
    );
  const removeElement = (index: number): void => {
    if (!structureEditable) {
      report("Inherited StateRoot structure is read-only; delete public elements in the defining Widget", "warn");
      return;
    }
    const element = elements[index];
    if (
      setStates(
        states,
        currentState,
        elements.filter((_, current) => current !== index),
      )
    )
      report(
        `deleted public ${element?.elementType ?? "property"} element '${element ? gameObjectNameById(source, element.targetNodeId) : index}'`,
        "info",
        element ? [element.targetNodeId] : [],
      );
  };
  return (
    <div className={webClasses("state-root-editor")}>
      <div className={webClasses("state-root-form-row state-root-current-row")}>
        <span>当前状态</span>
        <SelectControl
          value={displayedState}
          ariaLabel="当前状态"
          disabled={names.length === 0}
          options={
            names.length > 0 ? names.map((name, index) => ({ value: name, label: `${index} (${name})` })) : [{ value: "", label: "无状态" }]
          }
          onValueChange={selectCurrentState}
        />
      </div>

      <section className={webClasses("state-root-group")}>
        <button
          className={webClasses("state-root-group-toggle")}
          type="button"
          aria-expanded={elementsExpanded}
          onClick={() => setElementsExpanded((value) => !value)}
        >
          {elementsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>公共元素</span>
          <small>{activeTargetIds.length + elements.length}</small>
        </button>
        {elementsExpanded ? (
          <div className={webClasses("state-root-group-body")}>
            <div className={webClasses("state-root-public-list")}>
              {activeTargetIds.map((targetId) => (
                <div className={webClasses("state-root-public-row")} key={`active:${targetId}`}>
                  <NodeReferenceSelectField
                    source={source}
                    value={targetId}
                    disabled={!structureEditable}
                    onChange={(nextId) => renameActiveTarget(targetId, nextId)}
                  />
                  <span className={webClasses("state-root-element-kind")}>Active</span>
                  <button
                    type="button"
                    data-disabled={!structureEditable}
                    onClick={() => removeActiveTarget(targetId)}
                    title="删除公共元素"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {elements.map((element, index) => {
                const filter = stateElementReferenceFilter(element.elementType);
                return (
                  <div className={webClasses("state-root-public-row")} key={`${element.targetNodeId}:${element.elementType}:${index}`}>
                    <NodeReferenceSelectField
                      source={source}
                      value={element.targetNodeId}
                      filter={filter}
                      disabled={!structureEditable}
                      onChange={(targetNodeId) => {
                        if (!targetNodeId) {
                          report("property target cannot be empty", "warn");
                          return false;
                        }
                        const duplicate = elements.some(
                          (current, currentIndex) =>
                            currentIndex !== index && current.targetNodeId === targetNodeId && current.elementType === element.elementType,
                        );
                        if (duplicate) {
                          report(`property '${gameObjectNameById(source, targetNodeId)}/${element.elementType}' already exists`, "warn", [
                            targetNodeId,
                          ]);
                          return false;
                        }
                        return replaceElement(index, { ...element, targetNodeId } as UiStateRootElement);
                      }}
                    />
                    <SelectControl
                      value={element.elementType}
                      disabled={!structureEditable}
                      ariaLabel={`${gameObjectNameById(source, element.targetNodeId)} 属性类型`}
                      options={stateElementTypes.map((type) => ({ value: type, label: type }))}
                      onValueChange={(elementType: UiStateRootElement["elementType"]) => {
                        const duplicate = elements.some(
                          (current, currentIndex) =>
                            currentIndex !== index && current.targetNodeId === element.targetNodeId && current.elementType === elementType,
                        );
                        if (duplicate) {
                          report(`property '${gameObjectNameById(source, element.targetNodeId)}/${elementType}' already exists`, "warn", [
                            element.targetNodeId,
                          ]);
                          return;
                        }
                        const values = Object.fromEntries(names.map((stateName) => [stateName, defaultStateRootElementValue(elementType)]));
                        if (replaceElement(index, { targetNodeId: element.targetNodeId, elementType, values } as UiStateRootElement))
                          report(
                            `changed public element type to '${elementType}' for '${gameObjectNameById(source, element.targetNodeId)}'`,
                            "info",
                            [element.targetNodeId],
                          );
                      }}
                    />
                    <button type="button" data-disabled={!structureEditable} onClick={() => removeElement(index)} title="删除公共元素">
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={webClasses("state-root-form-row state-root-public-add-row")}>
              <span>增加</span>
              <div>
                <SelectControl
                  value={publicElementTypeDraft}
                  disabled={!structureEditable}
                  ariaLabel="公共元素类型"
                  options={statePublicElementTypes.map((type) => ({ value: type, label: type }))}
                  onValueChange={setPublicElementTypeDraft}
                />
                <SelectControl
                  value={publicTargetDraft}
                  disabled={!structureEditable || availablePublicTargets.length === 0}
                  ariaLabel="公共元素目标"
                  options={[
                    ...(availablePublicTargets.length === 0 ? [{ value: "", label: "无可选目标" }] : []),
                    ...publicElementCandidates.map((node) => ({
                      value: node.id,
                      label: `${nodeReferenceLabel(node)}${usedPublicTargetIds.has(node.id) ? "（已添加）" : ""}`,
                      disabled: usedPublicTargetIds.has(node.id),
                    })),
                  ]}
                  onValueChange={setPublicTargetDraft}
                />
                <button
                  type="button"
                  data-disabled={!structureEditable || availablePublicTargets.length === 0}
                  onClick={addPublicElement}
                  title="增加公共元素"
                  aria-label="增加公共元素"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className={webClasses("state-root-group")}>
        <button
          className={webClasses("state-root-group-toggle")}
          type="button"
          aria-expanded={statesExpanded}
          onClick={() => setStatesExpanded((value) => !value)}
        >
          {statesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>状态</span>
          <small>{names.length}</small>
        </button>
        {statesExpanded ? (
          <div className={webClasses("state-root-group-body state-root-states")}>
            <div className={webClasses("state-root-state-list")} role="list" aria-label="状态顺序">
              {names.map((name, index) => {
                const isCurrent = name === displayedState;
                const isExpanded = expandedStates.has(name);
                return (
                  <div
                    className={webClasses(
                      `state-root-state ${isCurrent ? "is-current" : ""} ${dragOverState === name && draggedState !== name ? "is-drag-over" : ""}`,
                    )}
                    key={name}
                    role="listitem"
                    data-state-name={name}
                    onDragOver={(event) => {
                      const sourceName = draggedStateRef.current || event.dataTransfer.getData("text/plain");
                      if (!structureEditable || !sourceName || sourceName === name) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverState(name);
                    }}
                    onDragLeave={() => setDragOverState((current) => (current === name ? "" : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      moveState(draggedStateRef.current || event.dataTransfer.getData("text/plain"), name);
                      draggedStateRef.current = "";
                      setDraggedState("");
                      setDragOverState("");
                    }}
                  >
                    <div className={webClasses("state-root-state-header")}>
                      <span
                        className={webClasses("state-drag-handle")}
                        draggable={structureEditable && names.length > 1}
                        title={structureEditable ? "拖动调整顺序" : "继承状态顺序不可修改"}
                        onMouseDown={() => {
                          if (!structureEditable)
                            report("Inherited StateRoot structure is read-only; reorder states in the defining Widget", "warn");
                        }}
                        onDragStart={(event) => {
                          if (!structureEditable) return;
                          draggedStateRef.current = name;
                          setDraggedState(name);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", name);
                        }}
                        onDragEnd={() => {
                          draggedStateRef.current = "";
                          setDraggedState("");
                          setDragOverState("");
                        }}
                      >
                        <GripVertical size={12} />
                      </span>
                      <button
                        className={webClasses("state-root-state-toggle")}
                        type="button"
                        onClick={() => toggleStateExpanded(name)}
                        title={`${isExpanded ? "折叠" : "展开"}状态 ${name}`}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <span>{`状态${index} (${name})`}</span>
                      </button>
                      <button
                        className={webClasses("state-root-delete-button")}
                        type="button"
                        data-disabled={!structureEditable || names.length <= 1}
                        onClick={() => removeState(name)}
                        title="删除状态"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {isExpanded ? (
                      <div className={webClasses("state-root-state-body")}>
                        <div className={webClasses("state-root-form-row")}>
                          <span>状态名</span>
                          <CommitInput
                            value={name}
                            ariaLabel={`状态${index}名称`}
                            disabled={!structureEditable}
                            onCommit={(nextName) => renameState(name, nextName)}
                          />
                        </div>
                        {activeTargetIds.map((targetId) => (
                          <div className={webClasses("state-root-value-row")} data-ui="state-root-value-row" key={`active:${targetId}`}>
                            <span title={`${gameObjectDiagnosticLabelById(source, targetId)} · Active`}>
                              {nodeNamesById.get(targetId) ?? targetId}
                            </span>
                            <label className={webClasses("mini-check")}>
                              <input
                                type="checkbox"
                                checked={states[name]?.[targetId] ?? false}
                                disabled={!structureEditable}
                                onChange={(event) => {
                                  if (setStates({ ...states, [name]: { ...states[name], [targetId]: event.target.checked } }))
                                    report(
                                      `set target '${gameObjectNameById(source, targetId)}' active=${event.target.checked ? "true" : "false"} in '${name}'`,
                                      "info",
                                      [targetId],
                                    );
                                }}
                              />
                              <span>Active</span>
                            </label>
                          </div>
                        ))}
                        {elements.map((element, elementIndex) => (
                          <div
                            className={webClasses("state-root-value-row")}
                            data-ui="state-root-value-row"
                            key={`${element.targetNodeId}:${element.elementType}:${elementIndex}`}
                          >
                            <span title={`${gameObjectDiagnosticLabelById(source, element.targetNodeId)} · ${element.elementType}`}>
                              {element.elementType} · {nodeNamesById.get(element.targetNodeId) ?? element.targetNodeId}
                            </span>
                            <StateElementValueField
                              type={element.elementType}
                              value={element.values[name]}
                              title={`${gameObjectDiagnosticLabelById(source, element.targetNodeId)} · ${name}`}
                              openAssetPicker={openAssetPicker}
                              onChange={(value, mode) => {
                                replaceElement(
                                  elementIndex,
                                  { ...element, values: { ...element.values, [name]: value } } as UiStateRootElement,
                                  mode,
                                );
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button className={webClasses("state-root-add-state")} type="button" onClick={addState} data-disabled={!structureEditable}>
              <Plus size={12} />
              <span>增加状态</span>
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function stateElementReferenceFilter(type: UiStateRootElement["elementType"]): NodeReferenceFilter {
  return stateRootElementReferenceFilter(type);
}

function StateElementValueField({
  type,
  value,
  title,
  openAssetPicker,
  onChange,
}: {
  readonly type: UiStateRootElement["elementType"];
  readonly value: unknown;
  readonly title: string;
  readonly openAssetPicker: (request: AssetPickerRequest) => void;
  readonly onChange: (value: unknown, mode?: InspectorUpdateMode) => void;
}) {
  const control = stateRootElementDescriptor(type).control;
  if (control.kind === "vector2" || control.kind === "vector3")
    return (
      <TupleField
        label=""
        value={Array.isArray(value) ? value.map(Number) : control.kind === "vector2" ? [0, 0] : [0, 0, 0]}
        labels={[...control.labels]}
        onChange={onChange}
      />
    );
  if (control.kind === "text") return <input value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  if (control.kind === "sprite") {
    const spriteValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { readonly sprite?: unknown; readonly setNativeSize?: unknown })
        : {};
    const selectedPath = typeof spriteValue.sprite === "string" ? spriteValue.sprite : undefined;
    return (
      <div className={webClasses("state-root-sprite-value")}>
        <AssetField
          kind="image"
          value={selectedPath}
          onChange={(path) => onChange({ sprite: path ?? null, setNativeSize: Boolean(spriteValue.setNativeSize) })}
          onOpen={() =>
            openAssetPicker({
              kind: "image",
              title,
              selectedPath,
              onChoose: (path) => onChange({ sprite: path, setNativeSize: Boolean(spriteValue.setNativeSize) }),
            })
          }
        />
        <label className={webClasses("mini-check")}>
          <input
            type="checkbox"
            checked={Boolean(spriteValue.setNativeSize)}
            onChange={(event) => onChange({ sprite: selectedPath ?? null, setNativeSize: event.target.checked })}
          />
          <span>SNS</span>
        </label>
      </div>
    );
  }
  if (control.kind === "canvasGroup") {
    const canvasGroupValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { readonly alpha?: unknown; readonly blocksRaycasts?: unknown })
        : {};
    const alpha = Number(canvasGroupValue.alpha ?? 1);
    const blocksRaycasts = Boolean(canvasGroupValue.blocksRaycasts ?? true);
    return (
      <div className={webClasses("state-root-canvas-group-value")}>
        <label>
          <span>Alpha</span>
          <NumberInput
            value={alpha}
            minimum={0}
            maximum={1}
            step={0.05}
            ariaLabel={`${title} Alpha`}
            onChange={(nextAlpha, mode) => onChange({ alpha: nextAlpha, blocksRaycasts }, mode)}
          />
        </label>
        <label className={webClasses("mini-check")} title="Blocks Raycasts">
          <input
            type="checkbox"
            aria-label={`${title} Blocks Raycasts`}
            checked={blocksRaycasts}
            onChange={(event) => onChange({ alpha, blocksRaycasts: event.target.checked })}
          />
          <span>Raycast</span>
        </label>
      </div>
    );
  }
  if (control.kind === "asset") {
    const selectedPath = typeof value === "string" ? value : undefined;
    return (
      <AssetField
        kind={control.assetKind}
        value={selectedPath}
        onChange={(path) => onChange(path ?? null)}
        onOpen={() => openAssetPicker({ kind: control.assetKind, title, selectedPath, onChoose: onChange })}
      />
    );
  }
  if (control.kind === "color") return <ColorField value={typeof value === "string" ? value : "#FFFFFFFF"} onChange={onChange} />;
  if (control.kind === "boolean")
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  return (
    <NumberInput value={Number(value ?? 0)} minimum={control.minimum} maximum={control.maximum} step={control.step} onChange={onChange} />
  );
}

export function StateElementsField({
  source,
  component,
  structureEditable = true,
  openAssetPicker,
  onChange,
  onNotice,
  onBlocked,
}: {
  readonly source: UiConcreteSource;
  readonly component: ComponentValue;
  readonly structureEditable?: boolean | undefined;
  readonly openAssetPicker: (request: AssetPickerRequest) => void;
  readonly onChange: (value: ComponentValue, mode?: InspectorUpdateMode) => boolean | void;
  readonly onNotice?: ((notice: string) => void) | undefined;
  readonly onBlocked?: ((message: string) => void) | undefined;
}) {
  const report = (message: string, level: "info" | "warn" = "info", nodeIds: readonly string[] = []): void => {
    const text = `StateRoot：${stateRootNotice(message)}`;
    const diagnostic =
      nodeIds.length > 0 ? ` [${nodeIds.map((nodeId) => gameObjectDiagnosticLabelById(source, nodeId)).join(" -> ")}]` : "";
    if (level === "warn") {
      if (onBlocked) onBlocked(text);
      else {
        console.warn(`[Legma][StateRoot] ${message}${diagnostic}`);
        onNotice?.(text);
      }
      return;
    }
    console.info(`[Legma][StateRoot] ${message}${diagnostic}`);
    onNotice?.(text);
  };
  const states = (component.states ?? {}) as Record<string, Record<string, boolean>>;
  const stateNames = Object.keys(states);
  const elements = (component.elements ?? []) as UiStateRootElement[];
  const setElements = (next: UiStateRootElement[], mode?: InspectorUpdateMode): boolean =>
    onChange({ ...component, elements: next }, mode) !== false;
  const replace = (index: number, next: UiStateRootElement, mode?: InspectorUpdateMode): boolean =>
    setElements(
      elements.map((element, current) => (current === index ? next : element)),
      mode,
    );
  const nodeEntries = useMemo(() => walkNodes(source).map((entry) => entry.node), [source]);
  const evaluatedRects = useMemo(() => evaluatedRectsById(source), [source]);
  const [elementTypeDraft, setElementTypeDraft] = useState<UiStateRootElement["elementType"]>(stateElementTypes[0]!);
  const [targetDraft, setTargetDraft] = useState("");
  const candidateTargets = useMemo(() => {
    const filter = stateElementReferenceFilter(elementTypeDraft);
    return nodeEntries.filter((node) => matchesNodeReferenceFilter(node, filter));
  }, [elementTypeDraft, nodeEntries]);
  const usedTargetIds = useMemo(
    () => new Set(elements.filter((element) => element.elementType === elementTypeDraft).map((element) => element.targetNodeId)),
    [elements, elementTypeDraft],
  );
  const availableTargets = useMemo(() => candidateTargets.filter((node) => !usedTargetIds.has(node.id)), [candidateTargets, usedTargetIds]);
  useEffect(() => {
    if (availableTargets.length === 0) {
      if (targetDraft) setTargetDraft("");
      return;
    }
    if (!availableTargets.some((node) => node.id === targetDraft)) setTargetDraft(availableTargets[0]!.id);
  }, [availableTargets, targetDraft]);
  const add = (): void => {
    if (!structureEditable) {
      report("Inherited StateRoot structure is read-only; add properties in the defining Widget", "warn");
      return;
    }
    if (stateNames.length === 0) {
      report("cannot add a property before declaring a state", "warn");
      return;
    }
    if (availableTargets.length === 0) {
      report(`no available target nodes for '${elementTypeDraft}'`, "warn");
      return;
    }
    const targetNodeId = availableTargets.find((node) => node.id === targetDraft)?.id ?? availableTargets[0]!.id;
    const currentValue = currentStateElementValue(source, elementTypeDraft, targetNodeId, evaluatedRects);
    const values = Object.fromEntries(stateNames.map((stateName) => [stateName, structuredClone(currentValue)]));
    if (setElements([...elements, { targetNodeId, elementType: elementTypeDraft, values } as UiStateRootElement])) {
      setTargetDraft(availableTargets.find((node) => node.id !== targetNodeId)?.id ?? targetNodeId);
      report(`added property '${gameObjectNameById(source, targetNodeId)}/${elementTypeDraft}'`, "info", [targetNodeId]);
    }
  };
  return (
    <div className={webClasses("map-editor")}>
      <div className={webClasses("map-rows")}>
        {elements.map((element, index) => {
          const filter = stateElementReferenceFilter(element.elementType);
          return (
            <div className={webClasses("state-element-row")} key={`${element.targetNodeId}:${element.elementType}:${index}`}>
              <div className={webClasses("state-element-head")}>
                <NodeReferenceSelectField
                  source={source}
                  value={element.targetNodeId}
                  filter={filter}
                  disabled={!structureEditable}
                  onChange={(targetNodeId) => {
                    if (!targetNodeId) {
                      report("property target cannot be empty", "warn");
                      return false;
                    }
                    const duplicate = elements.some(
                      (current, currentIndex) =>
                        currentIndex !== index && current.targetNodeId === targetNodeId && current.elementType === element.elementType,
                    );
                    if (duplicate) {
                      report(`property '${gameObjectNameById(source, targetNodeId)}/${element.elementType}' already exists`, "warn", [
                        targetNodeId,
                      ]);
                      return false;
                    }
                    return replace(index, { ...element, targetNodeId } as UiStateRootElement);
                  }}
                />
                <SelectControl
                  value={element.elementType}
                  disabled={!structureEditable}
                  options={stateElementTypes.map((type) => ({ value: type, label: type }))}
                  onValueChange={(elementType: UiStateRootElement["elementType"]) => {
                    const duplicate = elements.some(
                      (current, currentIndex) =>
                        currentIndex !== index && current.targetNodeId === element.targetNodeId && current.elementType === elementType,
                    );
                    if (duplicate) {
                      report(`property '${gameObjectNameById(source, element.targetNodeId)}/${elementType}' already exists`, "warn", [
                        element.targetNodeId,
                      ]);
                      return;
                    }
                    const values = Object.fromEntries(
                      stateNames.map((stateName) => [stateName, defaultStateRootElementValue(elementType)]),
                    );
                    if (replace(index, { targetNodeId: element.targetNodeId, elementType, values } as UiStateRootElement))
                      report(
                        `changed property type to '${elementType}' for '${gameObjectNameById(source, element.targetNodeId)}'`,
                        "info",
                        [element.targetNodeId],
                      );
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!structureEditable) {
                      report("Inherited StateRoot structure is read-only; delete properties in the defining Widget", "warn");
                      return;
                    }
                    if (setElements(elements.filter((_, current) => current !== index)))
                      report(`deleted property '${gameObjectNameById(source, element.targetNodeId)}/${element.elementType}'`, "info", [
                        element.targetNodeId,
                      ]);
                  }}
                  data-disabled={!structureEditable}
                  title="删除属性"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <fieldset className={webClasses("state-element-values")} disabled={!structureEditable}>
                {stateNames.map((stateName) => (
                  <label key={stateName}>
                    <span>{stateName}</span>
                    <StateElementValueField
                      type={element.elementType}
                      value={element.values[stateName]}
                      title={`${element.targetNodeId} · ${stateName}`}
                      openAssetPicker={openAssetPicker}
                      onChange={(value, mode) => {
                        replace(index, { ...element, values: { ...element.values, [stateName]: value } } as UiStateRootElement, mode);
                      }}
                    />
                  </label>
                ))}
              </fieldset>
            </div>
          );
        })}
      </div>
      <div className={webClasses("map-row state-element-add-row")}>
        <SelectControl
          value={elementTypeDraft}
          disabled={!structureEditable}
          options={stateElementTypes.map((type) => ({ value: type, label: type }))}
          onValueChange={setElementTypeDraft}
        />
        <SelectControl
          value={targetDraft}
          onValueChange={setTargetDraft}
          disabled={!structureEditable || availableTargets.length === 0}
          options={[
            ...(availableTargets.length === 0 ? [{ value: "", label: "无可选目标" }] : []),
            ...candidateTargets.map((node) => ({
              value: node.id,
              label: `${nodeReferenceLabel(node)}${usedTargetIds.has(node.id) ? "（已添加）" : ""}`,
              disabled: usedTargetIds.has(node.id),
            })),
          ]}
        />
        <button
          className={webClasses("add-map-row")}
          type="button"
          onClick={add}
          data-disabled={!structureEditable || stateNames.length === 0 || availableTargets.length === 0}
        >
          <Plus size={12} />
          添加属性
        </button>
      </div>
    </div>
  );
}
