import { Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { resolveArtifactUseSite } from "../../../kernel/artifact-use-site.js";
import { resolveBinderBindings } from "../../../kernel/binder.js";
import { resolvePreviewCollectionTemplate } from "../../../kernel/preview-collection.js";
import { type PreviewReferenceOwnerScope, previewReferenceOwnerRootArtifactKey } from "../../../kernel/preview-reference.js";
import { formatReference } from "../../../kernel/prototype-canonical.js";
import { createSourceCatalog, type SourceCatalog } from "../../../kernel/source-catalog.js";
import { findNode, walkNodes } from "../../../kernel/tree.js";
import { componentPreview, isPreviewCollectionOwner } from "../../../registry/component-registry.js";
import type {
  ReferenceCollection,
  ReferenceCollectionGroup,
  ReferenceInstanceValues,
  ReferenceMount,
  UiReference,
} from "../../../schema/ui-prototype-schema.js";
import type { UiBindingComponentType } from "../../../schema/ui-source-schema.js";
import { gameObjectName } from "../../shared/game-object-label.js";
import { NumberInput } from "../../shared/number-input.js";
import { SelectControl } from "../../shared/select-control.js";
import type { ArtifactDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { useSerializedDocumentState } from "./document-state.js";
import sharedStyles from "./editor-shell.module.css";
import inspectorStyles from "./reference-document-inspector.module.css";

const webClasses = createWebClasses(sharedStyles, inspectorStyles);
type Values = NonNullable<UiReference["values"]>;
type Binder = ReturnType<typeof resolveBinderBindings>[number];

export interface ReferenceDirectEditRequest {
  readonly id: number;
  readonly update: (reference: UiReference) => UiReference;
}

function uniqueKey(base: string, used: ReadonlySet<string>): string {
  let index = 1;
  let value = base;
  while (used.has(value)) value = `${base}${++index}`;
  return value;
}

function ownerArtifactKey(
  reference: UiReference,
  owner: PreviewReferenceOwnerScope | undefined,
  catalog: SourceCatalog,
): string | undefined {
  const root = previewReferenceOwnerRootArtifactKey(reference, owner);
  if (!root) return undefined;
  try {
    return resolveArtifactUseSite(catalog, {
      rootArtifactKey: root.artifactKey,
      ...(root.instancePath.length > 0 ? { instancePath: [...root.instancePath] } : {}),
    }).source.artifactKey;
  } catch {
    return undefined;
  }
}

function instanceEvidence(
  entry: ReferenceInstanceValues,
  referenceKey: string | undefined,
  values: Values | undefined,
): ReferenceInstanceValues | undefined {
  if (!referenceKey && !values) return undefined;
  return {
    owner: entry.owner,
    ...(referenceKey ? { referenceKey } : {}),
    ...(values ? { values } : {}),
  } as ReferenceInstanceValues;
}

interface InstancePathOption {
  readonly value: string;
  readonly path: readonly string[];
  readonly idPath: string;
  readonly namePath: string;
}

function instancePathOptions(catalog: SourceCatalog, parentArtifactKey: string, subjectArtifactKey: string): readonly InstancePathOption[] {
  const result: InstancePathOption[] = [];
  const visit = (
    artifactKey: string,
    idPath: readonly string[],
    namePath: readonly string[],
    activeArtifacts: ReadonlySet<string>,
  ): void => {
    const source = catalog.entries.get(artifactKey)?.resolvedSource;
    if (!source) return;
    for (const { node } of walkNodes(source)) {
      const targetKey = node.components?.PrefabRef?.artifactKey;
      if (!targetKey) continue;
      const nextIds = [...idPath, node.id];
      const nextNames = [...namePath, gameObjectName(node)];
      if (targetKey === subjectArtifactKey) {
        result.push({ value: JSON.stringify(nextIds), path: nextIds, idPath: nextIds.join("/"), namePath: nextNames.join(" / ") });
      }
      if (!activeArtifacts.has(targetKey)) visit(targetKey, nextIds, nextNames, new Set([...activeArtifacts, targetKey]));
    }
  };
  visit(parentArtifactKey, [], [], new Set([parentArtifactKey]));
  return result;
}

function baselineValue(catalog: SourceCatalog, binding: Binder, capability: string): unknown {
  const target = catalog.entries.get(binding.targetOwnerArtifactKey)?.resolvedSource;
  const node = target ? findNode(target, binding.target.nodeId) : undefined;
  if (!node) return undefined;
  if (capability === "active") return node.active ?? true;
  const definition = componentPreview(binding.componentType)?.fields[capability];
  if (!definition) return undefined;
  if (definition.handler === "stateRootState") return node.components?.StateRoot?.currentState;
  if (definition.handler === "tmpInputFieldText") {
    const textNode = node.components?.TMPInputField?.textComponent;
    return textNode ? (findNode(target!, textNode)?.components?.Text?.text ?? "") : "";
  }
  if (definition.sourceProperty && binding.componentType !== "GameObject" && binding.componentType !== "RectTransform") {
    const component = node.components?.[binding.componentType as Exclude<UiBindingComponentType, "GameObject" | "RectTransform">] as
      | Record<string, unknown>
      | undefined;
    return component?.[definition.sourceProperty] ?? definition.defaultValue;
  }
  return definition.defaultValue;
}

function capabilityInput(catalog: SourceCatalog, binding: Binder, capability: string, value: unknown, onChange: (value: unknown) => void) {
  const baseline = baselineValue(catalog, binding, capability);
  if (capability === "state") {
    const source = catalog.entries.get(binding.targetOwnerArtifactKey)?.resolvedSource;
    const states = source ? Object.keys(findNode(source, binding.target.nodeId)?.components?.StateRoot?.states ?? {}) : [];
    return (
      <SelectControl
        value={String(value ?? baseline ?? "")}
        options={states.map((state) => ({ value: state, label: state }))}
        onValueChange={onChange}
      />
    );
  }
  if (typeof (value ?? baseline) === "boolean") {
    return <input type="checkbox" checked={Boolean(value ?? baseline)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (typeof (value ?? baseline) === "number") {
    return <NumberInput value={Number(value ?? baseline ?? 0)} onChange={onChange} />;
  }
  if (capability === "text") {
    return <textarea value={String(value ?? baseline ?? "")} onChange={(event) => onChange(event.target.value)} />;
  }
  return <input value={String(value ?? baseline ?? "")} onChange={(event) => onChange(event.target.value)} />;
}

function ValuesEditor({
  title,
  artifactKey,
  values,
  catalog,
  onChange,
}: {
  readonly title: string;
  readonly artifactKey: string | undefined;
  readonly values: Values | undefined;
  readonly catalog: SourceCatalog;
  readonly onChange: (values: Values | undefined) => void;
}) {
  const bindings = artifactKey ? resolveBinderBindings(catalog, artifactKey) : [];
  const setCapability = (binding: Binder, capability: string, value: unknown): void => {
    onChange({
      ...(values ?? {}),
      [binding.fieldName]: {
        ...(values?.[binding.fieldName] ?? {}),
        [capability]: value,
      },
    });
  };
  const resetCapability = (fieldName: string, capability: string): void => {
    const next = structuredClone(values ?? {}) as Record<string, Record<string, unknown>>;
    delete next[fieldName]?.[capability];
    if (next[fieldName] && Object.keys(next[fieldName]).length === 0) delete next[fieldName];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <section className={webClasses("inspector-section preview-section")}>
      <h3>{title}</h3>
      {bindings.length === 0 ? (
        <p className={webClasses("empty-value")}>没有 Binder 字段</p>
      ) : (
        bindings.map((binding) => {
          const capabilities = ["active", ...Object.keys(componentPreview(binding.componentType)?.fields ?? {})];
          return (
            <div
              className={webClasses("reference-subject-block")}
              data-reference-values-scope={title}
              data-reference-values-field={binding.fieldName}
              key={binding.fieldName}
            >
              <strong>{binding.fieldName}</strong>
              <small>{binding.componentType}</small>
              {capabilities.map((capability) => {
                const patched = values?.[binding.fieldName]?.[capability];
                return (
                  <label className={webClasses("component-field")} key={capability}>
                    <span>{capability}</span>
                    {capabilityInput(catalog, binding, capability, patched, (next) => setCapability(binding, capability, next))}
                    {patched !== undefined ? (
                      <button
                        className={webClasses("icon-button")}
                        type="button"
                        onClick={() => resetCapability(binding.fieldName, capability)}
                        title="恢复 Unity 基线"
                      >
                        <Undo2 size={12} />
                      </button>
                    ) : null}
                  </label>
                );
              })}
            </div>
          );
        })
      )}
    </section>
  );
}

function collectionTemplateKeys(collection: ReferenceCollection, reference: UiReference, catalog: SourceCatalog): string[] {
  const artifactKey = ownerArtifactKey(reference, collection.owner, catalog);
  if (!artifactKey) return [];
  const binding = resolveBinderBindings(catalog, artifactKey).find((entry) => entry.fieldName === collection.targetBinding);
  const source = binding ? catalog.entries.get(binding.targetOwnerArtifactKey)?.resolvedSource : undefined;
  const node = source && binding ? findNode(source, binding.target.nodeId) : undefined;
  if (!node) return [];
  if (binding?.componentType === "ScrollRectEx") return Object.keys(node.components?.ScrollRectEx?.templates ?? {});
  if (binding?.componentType === "CustomDropDown") return ["option"];
  return [];
}

function collectionTemplateArtifact(
  collection: ReferenceCollection,
  group: ReferenceCollectionGroup,
  reference: UiReference,
  catalog: SourceCatalog,
): string | undefined {
  const artifactKey = ownerArtifactKey(reference, collection.owner, catalog);
  if (!artifactKey) return undefined;
  const binding = resolveBinderBindings(catalog, artifactKey).find((entry) => entry.fieldName === collection.targetBinding);
  const source = binding ? catalog.entries.get(binding.targetOwnerArtifactKey)?.resolvedSource : undefined;
  const node = source && binding ? findNode(source, binding.target.nodeId) : undefined;
  if (!source || !node || !binding) return undefined;
  const componentTypes =
    binding.componentType === "GameObject" ? Object.keys(node.components ?? {}).filter(isPreviewCollectionOwner) : [binding.componentType];
  if (componentTypes.length !== 1) return undefined;
  const template = resolvePreviewCollectionTemplate(source, node, componentTypes[0]!, group.templateKey);
  return template?.kind === "artifact" ? template.artifactKey : undefined;
}

function valuesOrDelete<T extends object, K extends keyof T>(value: T, key: K, values: T[K] | undefined): T {
  const next = { ...value };
  if (values !== undefined && (!Array.isArray(values) || values.length > 0)) next[key] = values;
  else delete next[key];
  return next;
}

export function ReferenceEditor({
  document: initialDocument,
  savedReference,
  artifacts,
  references,
  onDraftChange,
  directEdit,
}: {
  readonly document: ReferenceDocument;
  readonly savedReference: UiReference;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references?: ReadonlyMap<string, ReferenceDocument> | undefined;
  readonly onDraftChange?: ((reference: UiReference) => void) | undefined;
  readonly directEdit?: ReferenceDirectEditRequest | undefined;
}) {
  const document = useSerializedDocumentState(initialDocument.reference, formatReference, savedReference);
  const handledDirectEdit = useRef(0);
  const catalog = useMemo(
    () => createSourceCatalog([...artifacts.values()].map((entry) => ({ path: entry.path, source: entry.source }))),
    [artifacts],
  );
  const widgetArtifacts = useMemo(
    () =>
      [...artifacts.values()]
        .filter((entry) => entry.resolvedSource.artifactType === "Widget")
        .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
    [artifacts],
  );
  const referenceOptions = useMemo(
    () => [...(references?.values() ?? [])].sort((left, right) => left.referenceKey.localeCompare(right.referenceKey)),
    [references],
  );
  useEffect(() => onDraftChange?.(document.source), [document.source, onDraftChange]);
  useEffect(() => {
    if (!directEdit || handledDirectEdit.current === directEdit.id) return;
    handledDirectEdit.current = directEdit.id;
    document.commit(directEdit.update);
  }, [directEdit, document.commit]);
  const savedText = useMemo(() => formatReference(savedReference), [savedReference]);
  useEffect(() => {
    if (formatReference(document.source) === savedText) document.markSaved(savedReference);
  }, [document.source, document.markSaved, savedReference, savedText]);

  const subjectBindings = resolveBinderBindings(catalog, document.source.subjectArtifactKey);
  const collectionBindings = subjectBindings.filter((binding) => {
    const source = catalog.entries.get(binding.targetOwnerArtifactKey)?.resolvedSource;
    const node = source ? findNode(source, binding.target.nodeId) : undefined;
    return (
      binding.componentType === "ScrollRectEx" ||
      binding.componentType === "CustomDropDown" ||
      (binding.componentType === "GameObject" && Object.keys(node?.components ?? {}).filter(isPreviewCollectionOwner).length === 1)
    );
  });
  const context = document.source.context;
  const contextInstancePath = context && "instancePath" in context.placement ? context.placement.instancePath : undefined;
  const contextInstancePathOptions =
    contextInstancePath && context ? instancePathOptions(catalog, context.parentArtifactKey, document.source.subjectArtifactKey) : [];

  const updateCollection = (index: number, update: (collection: ReferenceCollection) => ReferenceCollection): void =>
    document.commit((reference) => ({
      ...reference,
      collections: (reference.collections ?? []).map((collection, current) => (current === index ? update(collection) : collection)),
    }));
  const updateMount = (index: number, update: (mount: ReferenceMount) => ReferenceMount): void =>
    document.commit((reference) => ({
      ...reference,
      mounts: (reference.mounts ?? []).map((mount, current) => (current === index ? update(mount) : mount)),
    }));

  return (
    <div className={webClasses("reference-document-editor")}>
      <div className={webClasses("reference-editor-toolbar")}>
        <button className={webClasses("icon-button")} type="button" onClick={document.undo} disabled={!document.canUndo} title="撤销">
          <Undo2 size={13} />
        </button>
        <button className={webClasses("icon-button")} type="button" onClick={document.redo} disabled={!document.canRedo} title="重做">
          <Redo2 size={13} />
        </button>
      </div>

      <section className={webClasses("inspector-section")}>
        <h3>Reference</h3>
        <label className={webClasses("component-field")}>
          <span>主体</span>
          <SelectControl
            value={document.source.subjectArtifactKey}
            options={[...artifacts.values()]
              .filter((entry) => entry.resolvedSource.artifactType !== "Fragment")
              .map((entry) => ({ value: entry.artifactKey, label: entry.artifactKey }))}
            onValueChange={(subjectArtifactKey) => document.commit((reference) => ({ ...reference, subjectArtifactKey }))}
          />
        </label>
        <label className={webClasses("component-field")}>
          <span>检查说明</span>
          <input
            value={document.source.description ?? ""}
            onChange={(event) =>
              document.commit((reference) =>
                event.target.value
                  ? { ...reference, description: event.target.value }
                  : valuesOrDelete(reference, "description", undefined),
              )
            }
          />
        </label>
        <label className={webClasses("component-field")}>
          <span>预览尺寸</span>
          <input
            value={document.source.viewport?.join(" x ") ?? ""}
            placeholder="自动"
            onChange={(event) => {
              const match = event.target.value.match(/^\s*(\d+)\s*[x,]\s*(\d+)\s*$/i);
              document.commit((reference) =>
                match ? { ...reference, viewport: [Number(match[1]), Number(match[2])] } : valuesOrDelete(reference, "viewport", undefined),
              );
            }}
          />
        </label>
      </section>

      <ValuesEditor
        title="主体值"
        artifactKey={document.source.subjectArtifactKey}
        values={document.source.values}
        catalog={catalog}
        onChange={(values) => document.commit((reference) => valuesOrDelete(reference, "values", values))}
      />

      <section className={webClasses("inspector-section")}>
        <div className={webClasses("panel-heading compact")}>
          <h3>上下文</h3>
          {document.source.context ? (
            <button
              className={webClasses("icon-button")}
              type="button"
              onClick={() => document.commit((reference) => valuesOrDelete(reference, "context", undefined))}
              title="移除上下文"
            >
              <Trash2 size={12} />
            </button>
          ) : (
            <button
              className={webClasses("icon-button")}
              type="button"
              onClick={() =>
                document.commit((reference) => ({
                  ...reference,
                  context: {
                    parentArtifactKey:
                      [...artifacts.values()].find((entry) => entry.resolvedSource.artifactType === "Canvas")?.artifactKey ??
                      reference.subjectArtifactKey,
                    placement: { targetBinding: "root" },
                  },
                }))
              }
              title="添加上下文"
            >
              <Plus size={12} />
            </button>
          )}
        </div>
        {document.source.context ? (
          <>
            <label className={webClasses("component-field")}>
              <span>父级</span>
              <SelectControl
                value={document.source.context.parentArtifactKey}
                options={[...artifacts.values()]
                  .filter((entry) => entry.resolvedSource.artifactType !== "Fragment")
                  .map((entry) => ({ value: entry.artifactKey, label: entry.artifactKey }))}
                onValueChange={(parentArtifactKey) =>
                  document.commit((reference) => ({ ...reference, context: { ...reference.context!, parentArtifactKey } }))
                }
              />
            </label>
            {"targetBinding" in document.source.context.placement ? (
              <label className={webClasses("component-field")}>
                <span>放置位置</span>
                <SelectControl
                  value={document.source.context.placement.targetBinding}
                  options={resolveBinderBindings(catalog, document.source.context.parentArtifactKey).map((binding) => ({
                    value: binding.fieldName,
                    label: binding.fieldName,
                  }))}
                  onValueChange={(targetBinding) =>
                    document.commit((reference) => ({ ...reference, context: { ...reference.context!, placement: { targetBinding } } }))
                  }
                />
              </label>
            ) : (
              <label className={webClasses("component-field")}>
                <span>实例路径</span>
                <SelectControl
                  value={JSON.stringify(contextInstancePath ?? [])}
                  options={[
                    ...(!contextInstancePathOptions.some((option) => option.value === JSON.stringify(contextInstancePath))
                      ? [
                          {
                            value: JSON.stringify(contextInstancePath),
                            label: `${contextInstancePath?.join("/") ?? ""}（不可用）`,
                            title: contextInstancePath?.join("/") ?? "",
                          },
                        ]
                      : []),
                    ...contextInstancePathOptions.map((option) => ({
                      value: option.value,
                      label: contextInstancePathOptions.some(
                        (candidate) => candidate.value !== option.value && candidate.namePath === option.namePath,
                      )
                        ? `${option.namePath} (${option.idPath})`
                        : option.namePath,
                      title: `${option.namePath} (${option.idPath})`,
                    })),
                  ]}
                  searchable
                  searchPlaceholder="搜索 GameObject 名称或 ID 路径"
                  onValueChange={(value) => {
                    const option = contextInstancePathOptions.find((candidate) => candidate.value === value);
                    if (!option) return;
                    document.commit((reference) => ({
                      ...reference,
                      context: { ...reference.context!, placement: { instancePath: [...option.path] } },
                    }));
                  }}
                />
              </label>
            )}
          </>
        ) : null}
      </section>
      {document.source.context ? (
        <ValuesEditor
          title="上下文值"
          artifactKey={document.source.context.parentArtifactKey}
          values={document.source.context.values}
          catalog={catalog}
          onChange={(values) =>
            document.commit((reference) => ({ ...reference, context: valuesOrDelete(reference.context!, "values", values) }))
          }
        />
      ) : null}

      {(document.source.instanceValues ?? []).map((entry, index) => {
        const artifactKey = ownerArtifactKey(document.source, entry.owner, catalog);
        const supportsPreset = entry.owner.kind === "artifact" || entry.owner.kind === "mount";
        const presetKey = "referenceKey" in entry ? entry.referenceKey : "";
        const presets = referenceOptions.filter(
          (candidate) => candidate.subjectArtifactKey === artifactKey && candidate.referenceKey !== document.source.referenceKey,
        );
        return (
          <div key={JSON.stringify(entry.owner)}>
            {supportsPreset ? (
              <section className={webClasses("inspector-section preview-section")}>
                <h3>{`实例 ${index + 1} 预设`}</h3>
                <label className={webClasses("component-field")}>
                  <span>预设</span>
                  <SelectControl
                    value={presetKey}
                    options={[
                      { value: "", label: "Unity 基线" },
                      ...presets.map((candidate) => ({ value: candidate.referenceKey, label: candidate.referenceKey })),
                    ]}
                    onValueChange={(referenceKey) =>
                      document.commit((reference) => ({
                        ...reference,
                        instanceValues: (reference.instanceValues ?? []).flatMap((current, currentIndex) => {
                          if (currentIndex !== index) return [current];
                          const next = instanceEvidence(current, referenceKey || undefined, current.values);
                          return next ? [next] : [];
                        }),
                      }))
                    }
                  />
                </label>
              </section>
            ) : null}
            <ValuesEditor
              title={`实例 ${index + 1} 值`}
              artifactKey={artifactKey}
              values={entry.values}
              catalog={catalog}
              onChange={(values) =>
                document.commit((reference) => ({
                  ...reference,
                  instanceValues: (reference.instanceValues ?? []).flatMap((current, currentIndex) => {
                    if (currentIndex !== index) return [current];
                    const referenceKey = "referenceKey" in current ? current.referenceKey : undefined;
                    const next = instanceEvidence(current, referenceKey, values);
                    return next ? [next] : [];
                  }),
                }))
              }
            />
          </div>
        );
      })}

      <section className={webClasses("inspector-section")}>
        <div className={webClasses("panel-heading compact")}>
          <h3>集合</h3>
          <button
            className={webClasses("icon-button")}
            type="button"
            disabled={collectionBindings.length === 0}
            onClick={() =>
              document.commit((reference) => {
                const binding = collectionBindings[0]!;
                const key = uniqueKey("collection", new Set((reference.collections ?? []).map((entry) => entry.key)));
                return {
                  ...reference,
                  collections: [
                    ...(reference.collections ?? []),
                    {
                      key,
                      targetBinding: binding.fieldName,
                      groups: [
                        {
                          templateKey:
                            Object.keys(
                              catalog.entries.get(binding.targetOwnerArtifactKey)?.resolvedSource.root.components?.ScrollRectEx
                                ?.templates ?? {},
                            )[0] ?? "item",
                          items: [{}],
                        },
                      ],
                    },
                  ],
                };
              })
            }
            title="添加集合"
          >
            <Plus size={12} />
          </button>
        </div>
        {(document.source.collections ?? []).map((collection, index) => {
          const templates = collectionTemplateKeys(collection, document.source, catalog);
          return (
            <div className={webClasses("reference-subject-block")} key={collection.key}>
              <div className={webClasses("panel-heading compact")}>
                <strong>{collection.key}</strong>
                <button
                  className={webClasses("icon-button")}
                  type="button"
                  onClick={() =>
                    document.commit((reference) =>
                      valuesOrDelete(
                        reference,
                        "collections",
                        reference.collections?.filter((_, current) => current !== index),
                      ),
                    )
                  }
                  title="删除集合"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <label className={webClasses("component-field")}>
                <span>目标</span>
                <SelectControl
                  value={collection.targetBinding}
                  options={collectionBindings.map((binding) => ({ value: binding.fieldName, label: binding.fieldName }))}
                  onValueChange={(targetBinding) => updateCollection(index, (current) => ({ ...current, targetBinding }))}
                />
              </label>
              {collection.groups.map((group, groupIndex) => {
                const templateArtifact = collectionTemplateArtifact(collection, group, document.source, catalog);
                const presets = referenceOptions.filter((entry) => entry.subjectArtifactKey === templateArtifact);
                return (
                  <div key={`${collection.key}:${groupIndex}`}>
                    <label className={webClasses("component-field")}>
                      <span>模板</span>
                      <SelectControl
                        value={group.templateKey}
                        options={templates.map((template) => ({ value: template, label: template }))}
                        onValueChange={(templateKey) =>
                          updateCollection(index, (current) => ({
                            ...current,
                            groups: current.groups.map((value, currentIndex) =>
                              currentIndex === groupIndex ? { ...value, templateKey } : value,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label className={webClasses("component-field")}>
                      <span>预设</span>
                      <SelectControl
                        value={group.referenceKey ?? ""}
                        options={[
                          { value: "", label: "Unity 基线" },
                          ...presets.map((entry) => ({ value: entry.referenceKey, label: entry.referenceKey })),
                        ]}
                        onValueChange={(referenceKey) =>
                          updateCollection(index, (current) => ({
                            ...current,
                            groups: current.groups.map((value, currentIndex) =>
                              currentIndex === groupIndex
                                ? referenceKey
                                  ? { ...value, referenceKey }
                                  : valuesOrDelete(value, "referenceKey", undefined)
                                : value,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label className={webClasses("component-field")}>
                      <span>模式</span>
                      <SelectControl
                        value={"items" in group ? "items" : "count"}
                        options={[
                          { value: "items", label: "逐项" },
                          { value: "count", label: "数量" },
                        ]}
                        onValueChange={(mode) =>
                          updateCollection(index, (current) => ({
                            ...current,
                            groups: current.groups.map((value, currentIndex) =>
                              currentIndex !== groupIndex
                                ? value
                                : mode === "items"
                                  ? {
                                      templateKey: value.templateKey,
                                      ...(value.referenceKey ? { referenceKey: value.referenceKey } : {}),
                                      ...(value.values ? { values: value.values } : {}),
                                      items: [{}],
                                    }
                                  : {
                                      templateKey: value.templateKey,
                                      ...(value.referenceKey ? { referenceKey: value.referenceKey } : {}),
                                      ...(value.values ? { values: value.values } : {}),
                                      count: 1,
                                    },
                            ),
                          }))
                        }
                      />
                    </label>
                    {"count" in group ? (
                      <label className={webClasses("component-field")}>
                        <span>数量</span>
                        <NumberInput
                          minimum={1}
                          step={1}
                          value={group.count}
                          onChange={(count) =>
                            updateCollection(index, (current) => ({
                              ...current,
                              groups: current.groups.map((value, currentIndex) =>
                                currentIndex === groupIndex && "count" in value ? { ...value, count: Math.max(1, count) } : value,
                              ),
                            }))
                          }
                        />
                      </label>
                    ) : (
                      <div className={webClasses("reference-item-list")}>
                        {group.items.map((item, itemIndex) => (
                          <div key={item.key ?? itemIndex}>
                            <span>{item.key ?? `#${itemIndex + 1}`}</span>
                            <SelectControl
                              value={item.referenceKey ?? ""}
                              options={[
                                { value: "", label: "默认" },
                                ...presets.map((entry) => ({ value: entry.referenceKey, label: entry.referenceKey })),
                              ]}
                              onValueChange={(referenceKey) =>
                                updateCollection(index, (current) => ({
                                  ...current,
                                  groups: current.groups.map((value, currentIndex) =>
                                    currentIndex !== groupIndex || !("items" in value)
                                      ? value
                                      : {
                                          ...value,
                                          items: value.items.map((currentItem, currentItemIndex) =>
                                            currentItemIndex !== itemIndex
                                              ? currentItem
                                              : referenceKey
                                                ? { ...currentItem, referenceKey }
                                                : valuesOrDelete(currentItem, "referenceKey", undefined),
                                          ),
                                        },
                                  ),
                                }))
                              }
                            />
                            <button
                              className={webClasses("icon-button")}
                              type="button"
                              onClick={() =>
                                updateCollection(index, (current) => ({
                                  ...current,
                                  groups: current.groups.map((value, currentIndex) =>
                                    currentIndex === groupIndex && "items" in value
                                      ? { ...value, items: value.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex) }
                                      : value,
                                  ),
                                }))
                              }
                              title="删除项"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {"items" in group ? (
                      <button
                        type="button"
                        onClick={() =>
                          updateCollection(index, (current) => ({
                            ...current,
                            groups: current.groups.map((value, currentIndex) =>
                              currentIndex === groupIndex && "items" in value ? { ...value, items: [...value.items, {}] } : value,
                            ),
                          }))
                        }
                      >
                        <Plus size={11} />
                        添加项
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      <section className={webClasses("inspector-section")}>
        <div className={webClasses("panel-heading compact")}>
          <h3>挂载</h3>
          <button
            className={webClasses("icon-button")}
            type="button"
            disabled={widgetArtifacts.length === 0 || subjectBindings.length === 0}
            onClick={() =>
              document.commit((reference) => ({
                ...reference,
                mounts: [
                  ...(reference.mounts ?? []),
                  {
                    key: uniqueKey("mount", new Set((reference.mounts ?? []).map((entry) => entry.key))),
                    targetBinding: subjectBindings[0]!.fieldName,
                    artifactKey: widgetArtifacts[0]!.artifactKey,
                  },
                ],
              }))
            }
            title="添加挂载"
          >
            <Plus size={12} />
          </button>
        </div>
        {(document.source.mounts ?? []).map((mount, index) => (
          <div className={webClasses("reference-subject-block")} data-reference-mount={mount.key} key={mount.key}>
            <div className={webClasses("panel-heading compact")}>
              <strong>{mount.key}</strong>
              <button
                className={webClasses("icon-button")}
                type="button"
                onClick={() =>
                  document.commit((reference) =>
                    valuesOrDelete(
                      reference,
                      "mounts",
                      reference.mounts?.filter((_, current) => current !== index),
                    ),
                  )
                }
                title="删除挂载"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <label className={webClasses("component-field")}>
              <span>目标</span>
              <SelectControl
                value={mount.targetBinding}
                options={subjectBindings.map((binding) => ({ value: binding.fieldName, label: binding.fieldName }))}
                onValueChange={(targetBinding) => updateMount(index, (current) => ({ ...current, targetBinding }))}
              />
            </label>
            <label className={webClasses("component-field")}>
              <span>Widget</span>
              <SelectControl
                value={mount.artifactKey}
                options={widgetArtifacts.map((entry) => ({ value: entry.artifactKey, label: entry.artifactKey }))}
                onValueChange={(artifactKey) => updateMount(index, (current) => ({ ...current, artifactKey }))}
              />
            </label>
            <label className={webClasses("component-field")}>
              <span>预设</span>
              <SelectControl
                value={mount.referenceKey ?? ""}
                options={[
                  { value: "", label: "Unity 基线" },
                  ...referenceOptions
                    .filter((entry) => entry.subjectArtifactKey === mount.artifactKey)
                    .map((entry) => ({ value: entry.referenceKey, label: entry.referenceKey })),
                ]}
                onValueChange={(referenceKey) =>
                  updateMount(index, (current) =>
                    referenceKey ? { ...current, referenceKey } : valuesOrDelete(current, "referenceKey", undefined),
                  )
                }
              />
            </label>
            <ValuesEditor
              title="挂载值"
              artifactKey={mount.artifactKey}
              values={mount.values}
              catalog={catalog}
              onChange={(values) => updateMount(index, (current) => valuesOrDelete(current, "values", values))}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
