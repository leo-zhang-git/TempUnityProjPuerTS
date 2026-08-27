import {
  type ComponentDefinition,
  componentArtifactReferenceFields,
  componentRegistry,
  isUseSiteAddable,
} from "../registry/component-registry.js";
import type {
  UiBindingComponentType,
  UiComponentType,
  UiConcreteSource,
  UiNestedTarget,
  UiNode,
  UiPropertyOverride,
  UiSource,
  UiUseSiteComponentAddition,
  UiVariantSource,
} from "../schema/ui-source-schema.js";
import { bindingTarget, type DerivedBinding, derivedBinding } from "./binding.js";
import { auditBindingName, missingPrimaryBindingViolation } from "./binding-naming.js";
import { isBindingTargetAssignable, isSupportedBindingComponentType } from "./binding-contract.js";
import { unityNodeName } from "./naming.js";
import { remapLocalNodeReferenceTargets } from "./node-references.js";
import { applyPropertyOverride, applyPropertyOverrides, validateOverrideTarget } from "./override.js";
import { findNode, walkNodes } from "./tree.js";
import { assertValidSource } from "./validation.js";
import { applyVariantStructure } from "./variant-structure.js";

export interface SourceCatalogInput {
  readonly path: string;
  readonly source: UiSource;
}

export interface SourceCatalogEntry extends SourceCatalogInput {
  readonly resolvedSource: UiConcreteSource;
  readonly bindings?: readonly DerivedBinding[];
  readonly analyzedBindings: readonly DerivedBinding[];
  readonly localBindingDeclarations: readonly AnalyzedSourceBindingDeclaration[];
  readonly bindingIssues: readonly SourceBindingIssue[];
  readonly widgetTypeError?: string;
  readonly dependencies: readonly string[];
  readonly baseArtifactKey?: string;
  readonly localWidgetType: string;
  readonly effectiveWidgetType: string;
}

interface AnalyzedSourceBindingDeclaration {
  readonly artifactKey: string;
  readonly declarationIndex: number;
  readonly name: string;
  readonly target: UiNestedTarget;
  readonly isOverride: boolean;
  readonly declaredComponentType: UiBindingComponentType;
  readonly error?: string;
}

interface SourceBindingIssue {
  readonly artifactKey: string;
  readonly declarationIndex: number;
  readonly name: string;
  readonly message: string;
}

export interface SourceCatalog {
  readonly entries: ReadonlyMap<string, SourceCatalogEntry>;
}

interface PendingEntry extends SourceCatalogInput {
  resolved?: SourceCatalogEntry;
}

export function createSourceCatalog(inputs: readonly SourceCatalogInput[]): SourceCatalog {
  const pending = new Map<string, PendingEntry>();
  const artifactByCaseInsensitiveKey = new Map<string, string>();
  for (const input of inputs) {
    assertValidSource(input.source);
    const existing = pending.get(input.source.artifactKey);
    if (existing) throw new Error(`Duplicate artifactKey '${input.source.artifactKey}' in '${existing.path}' and '${input.path}'`);
    const normalizedKey = input.source.artifactKey.toLocaleLowerCase("en-US");
    const caseInsensitiveOwner = artifactByCaseInsensitiveKey.get(normalizedKey);
    if (caseInsensitiveOwner)
      throw new Error(`Duplicate case-insensitive artifactKey '${caseInsensitiveOwner}' and '${input.source.artifactKey}'`);
    pending.set(input.source.artifactKey, { ...input });
    artifactByCaseInsensitiveKey.set(normalizedKey, input.source.artifactKey);
  }

  const resolving: string[] = [];
  const resolve = (artifactKey: string): SourceCatalogEntry => {
    const item = pending.get(artifactKey);
    if (!item) throw new Error(`Artifact '${artifactKey}' is missing from Source Catalog`);
    if (item.resolved) return item.resolved;
    const cycleStart = resolving.indexOf(artifactKey);
    if (cycleStart >= 0) throw new Error(`Circular Variant base: ${[...resolving.slice(cycleStart), artifactKey].join(" -> ")}`);
    resolving.push(artifactKey);
    try {
      item.resolved =
        item.source.sourceKind === "variant"
          ? resolveVariant(item.path, item.source, resolve(item.source.variantOf))
          : resolveConcrete(item.path, item.source);
      return item.resolved;
    } finally {
      resolving.pop();
    }
  };

  for (const artifactKey of pending.keys()) resolve(artifactKey);
  const entries = new Map([...pending].map(([artifactKey, item]) => [artifactKey, item.resolved!]));
  const catalog = { entries } satisfies SourceCatalog;
  const finalized = new Set<string>();
  const finalizeBindings = (entry: SourceCatalogEntry): void => {
    if (finalized.has(entry.source.artifactKey)) return;
    const mutable = entry as MutableSourceCatalogEntry;
    const base = entry.baseArtifactKey ? entries.get(entry.baseArtifactKey) : undefined;
    if (base) finalizeBindings(base);
    const resolution = analyzeLocalBindingDeclarations(catalog, entry, base?.analyzedBindings ?? []);
    const upstreamIssue =
      base && !base.bindings
        ? [
            {
              artifactKey: entry.source.artifactKey,
              declarationIndex: -1,
              name: "",
              message: `Upstream Binder '${base.source.artifactKey}' is invalid`,
            } satisfies SourceBindingIssue,
          ]
        : [];
    const hasLocalNew = resolution.declarations.some((declaration) => !declaration.error && !declaration.isOverride);
    const widgetTypeError =
      entry.source.sourceKind === "variant" && entry.source.artifactType === "Widget" && !entry.localWidgetType && hasLocalNew
        ? `Widget Variant '${entry.source.artifactKey}' must declare a new widgetType before adding local Bindings`
        : undefined;
    mutable.analyzedBindings = resolution.bindings;
    mutable.localBindingDeclarations = resolution.declarations;
    mutable.bindingIssues = [...upstreamIssue, ...resolution.issues];
    mutable.widgetTypeError = widgetTypeError;
    if (mutable.bindingIssues.length === 0 && !widgetTypeError) {
      mutable.bindings = resolution.bindings;
      if (resolution.bindings.length > 0) {
        mutable.resolvedSource.bindings = resolution.bindings.map((binding) => ({
          name: binding.fieldName,
          target: bindingTarget(binding),
        }));
      } else {
        delete mutable.resolvedSource.bindings;
      }
    } else {
      mutable.bindings = undefined;
      delete mutable.resolvedSource.bindings;
    }
    finalized.add(entry.source.artifactKey);
  };
  for (const entry of entries.values()) finalizeBindings(entry);
  for (const entry of entries.values()) validateCatalogEntry(catalog, entry);
  return catalog;
}

type MutableSourceCatalogEntry = Omit<
  SourceCatalogEntry,
  "bindings" | "analyzedBindings" | "localBindingDeclarations" | "bindingIssues" | "widgetTypeError"
> & {
  bindings: readonly DerivedBinding[] | undefined;
  analyzedBindings: readonly DerivedBinding[];
  localBindingDeclarations: readonly AnalyzedSourceBindingDeclaration[];
  bindingIssues: readonly SourceBindingIssue[];
  widgetTypeError: string | undefined;
};

function resolveConcrete(path: string, source: UiConcreteSource): SourceCatalogEntry {
  const resolvedSource = structuredClone(source);
  const widgetType = source.artifactType === "Widget" ? (source.widgetType ?? "") : "";
  delete resolvedSource.bindings;
  return {
    path,
    source,
    resolvedSource,
    analyzedBindings: [],
    localBindingDeclarations: [],
    bindingIssues: [],
    dependencies: artifactDependencies(resolvedSource),
    localWidgetType: widgetType,
    effectiveWidgetType: widgetType,
  };
}

function resolveVariant(path: string, source: UiVariantSource, base: SourceCatalogEntry): SourceCatalogEntry {
  if (base.source.artifactType !== source.artifactType) {
    throw new Error(
      `Variant '${source.artifactKey}' type '${source.artifactType}' does not match base '${source.variantOf}' type '${base.source.artifactType}'`,
    );
  }
  const declaredWidgetType = source.artifactType === "Widget" ? (source.widgetType ?? "") : "";
  const localWidgetType = declaredWidgetType === base.effectiveWidgetType ? "" : declaredWidgetType;
  for (const override of source.overrides) {
    if ((override.target.instancePath?.length ?? 0) > 0) {
      throw new Error(`Artifact Variant '${source.artifactKey}' property override cannot traverse PrefabRef instances`);
    }
    validateOverrideTarget(base.resolvedSource, override);
  }

  const structured = applyVariantStructure(base.resolvedSource, source.nodeAdditions ?? [], source.componentAdditions ?? []);
  const inherited = applyPropertyOverrides(structured, source.overrides);
  const resolvedSource = variantIdentity(inherited, source);
  const effectiveWidgetType = localWidgetType || base.effectiveWidgetType;
  assertValidSource(resolvedSource);
  return {
    path,
    source,
    resolvedSource,
    analyzedBindings: [],
    localBindingDeclarations: [],
    bindingIssues: [],
    dependencies: unique([source.variantOf, ...artifactDependencies(resolvedSource)]),
    baseArtifactKey: source.variantOf,
    localWidgetType,
    effectiveWidgetType,
  };
}

function variantIdentity(inherited: UiConcreteSource, variant: UiVariantSource): UiConcreteSource {
  const oldRootId = inherited.root.id;
  const root = remapLocalNodeReferenceTargets(
    {
      ...inherited.root,
      id: variant.artifactKey,
      name: variant.artifactKey,
    },
    (nodeId) => (nodeId === oldRootId ? variant.artifactKey : nodeId),
  );
  const common = {
    sourceKind: "artifact" as const,
    artifactKey: variant.artifactKey,
    ...(variant.displayName ? { displayName: variant.displayName } : {}),
    ...(variant.description ? { description: variant.description } : {}),
    ...(inherited.artifactType === "Widget" ? { widgetType: variant.widgetType || inherited.widgetType } : {}),
    root,
  };
  return inherited.artifactType === "Canvas"
    ? { ...common, artifactType: "Canvas" }
    : {
        ...common,
        artifactType: inherited.artifactType,
        initialSize: structuredClone(variant.initialSize ?? inherited.initialSize),
      };
}

function remapRootBinding(binding: DerivedBinding, oldId: string, newId: string): DerivedBinding {
  return binding.nodeId === oldId && !binding.prefabRefNodeId ? { ...binding, nodeId: newId } : binding;
}

function analyzeLocalBindingDeclarations(
  catalog: SourceCatalog,
  entry: SourceCatalogEntry,
  inheritedBindings: readonly DerivedBinding[],
): {
  readonly bindings: readonly DerivedBinding[];
  readonly declarations: readonly AnalyzedSourceBindingDeclaration[];
  readonly issues: readonly SourceBindingIssue[];
} {
  const result = inheritedBindings.map((binding) =>
    remapRootBinding(
      binding,
      entry.baseArtifactKey ? requireArtifact(catalog, entry.baseArtifactKey).resolvedSource.root.id : entry.resolvedSource.root.id,
      entry.resolvedSource.root.id,
    ),
  );
  const localNames = new Set<string>();
  const issues: SourceBindingIssue[] = [];
  const declarations: AnalyzedSourceBindingDeclaration[] = [];
  for (const [declarationIndex, declaration] of (entry.source.bindings ?? []).entries()) {
    let error: string | undefined;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(declaration.name))
      error = declaration.name.length === 0 ? "Binding name is empty" : `Binding name '${declaration.name}' is not a TypeScript identifier`;
    else if (localNames.has(declaration.name)) error = `Binding '${declaration.name}' is duplicated in the same prefab layer`;
    localNames.add(declaration.name);
    if (!error && !isSupportedBindingComponentType(declaration.target.componentType))
      error = `Binding '${declaration.name}' uses unsupported component type '${declaration.target.componentType}'`;
    if (!error) {
      try {
        resolveOwnerBindingTarget(catalog, entry, declaration.target, declaration.name);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
      }
    }
    const index = result.findIndex((binding) => binding.fieldName === declaration.name);
    const isOverride = index >= 0;
    const declaredComponentType = isOverride ? result[index]!.declaredComponentType : declaration.target.componentType;
    if (!error && isOverride) {
      const inherited = result[index]!;
      if (!isBindingTargetAssignable(inherited.declaredComponentType, declaration.target.componentType)) {
        error = `Binding override '${declaration.name}' target '${declaration.target.componentType}' is not assignable to declared contract '${inherited.declaredComponentType}'`;
      }
    }
    declarations.push({
      artifactKey: entry.source.artifactKey,
      declarationIndex,
      name: declaration.name,
      target: structuredClone(declaration.target),
      isOverride,
      declaredComponentType,
      ...(error ? { error } : {}),
    });
    if (error) {
      issues.push({ artifactKey: entry.source.artifactKey, declarationIndex, name: declaration.name, message: error });
    } else if (isOverride) {
      result[index] = { ...derivedBinding(declaration.name, declaration.target), declaredComponentType };
    } else {
      result.push(derivedBinding(declaration.name, declaration.target));
    }
  }
  const namingIssues = analyzeEffectiveBindingNaming(catalog, entry, result, declarations);
  return { bindings: result, declarations, issues: [...issues, ...namingIssues] };
}

function analyzeEffectiveBindingNaming(
  catalog: SourceCatalog,
  entry: SourceCatalogEntry,
  bindings: readonly DerivedBinding[],
  declarations: readonly AnalyzedSourceBindingDeclaration[],
): SourceBindingIssue[] {
  const issues: SourceBindingIssue[] = [];
  const targets = new Map<string, { readonly nodeName: string; readonly bindingNames: string[] }>();
  for (const binding of bindings) {
    const target = bindingTarget(binding);
    const node = resolveOwnerBindingNode(catalog, entry, target, binding.fieldName);
    const nodeName = unityNodeName(node);
    const declarationIndex = declarations.find((candidate) => candidate.name === binding.fieldName)?.declarationIndex ?? -1;
    for (const violation of auditBindingName(binding.fieldName, binding.componentType, nodeName)) {
      issues.push({
        artifactKey: entry.source.artifactKey,
        declarationIndex,
        name: binding.fieldName,
        message: violation.message,
      });
    }
    const key = `${(target.instancePath ?? []).join("/")}\0${target.nodeId}`;
    const current = targets.get(key) ?? { nodeName, bindingNames: [] };
    current.bindingNames.push(binding.fieldName);
    targets.set(key, current);
  }
  for (const target of targets.values()) {
    if (target.bindingNames.includes(target.nodeName)) continue;
    const violation = missingPrimaryBindingViolation(target.nodeName);
    issues.push({
      artifactKey: entry.source.artifactKey,
      declarationIndex: -1,
      name: target.bindingNames[0] ?? "",
      message: violation.message,
    });
  }
  return issues;
}

function artifactDependencies(source: UiConcreteSource): string[] {
  return unique(
    walkNodes(source).flatMap(({ node }) => {
      const prefabArtifactKey = node.components?.PrefabRef?.artifactKey;
      const componentArtifactKeys = Object.entries(node.components ?? {}).flatMap(([componentType, value]) => {
        if (!value || !(componentType in componentRegistry)) return [];
        return componentArtifactReferenceFields(componentType as UiComponentType).flatMap((field) => {
          const artifactKey = (value as Readonly<Record<string, unknown>>)[field];
          return typeof artifactKey === "string" && artifactKey ? [artifactKey] : [];
        });
      });
      return [...(prefabArtifactKey ? [prefabArtifactKey] : []), ...componentArtifactKeys];
    }),
  ).sort((left, right) => left.localeCompare(right));
}

function validateCatalogEntry(catalog: SourceCatalog, entry: SourceCatalogEntry): void {
  for (const dependency of entry.dependencies) {
    if (!catalog.entries.has(dependency))
      throw new Error(`Artifact '${entry.source.artifactKey}' references missing artifact '${dependency}'`);
  }

  for (const { node } of walkNodes(entry.resolvedSource)) {
    for (const [componentType, value] of Object.entries(node.components ?? {})) {
      if (!value || !(componentType in componentRegistry)) continue;
      for (const field of componentArtifactReferenceFields(componentType as UiComponentType)) {
        const artifactKey = (value as Readonly<Record<string, unknown>>)[field];
        if (typeof artifactKey !== "string" || !artifactKey) continue;
        const target = requireArtifact(catalog, artifactKey, entry.source.artifactKey);
        if (target.source.artifactType !== "Widget") {
          throw new Error(
            `Artifact reference '${entry.source.artifactKey}/${node.id}.${componentType}.${field}' must target a Widget, received '${target.source.artifactType}'`,
          );
        }
      }
    }
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef?.artifactKey) continue;
    const target = requireArtifact(catalog, prefabRef.artifactKey, entry.source.artifactKey);
    validateDependencyType(entry, target);
    for (const override of prefabRef.overrides ?? []) {
      validateUseSiteOverride(catalog, target.source.artifactKey, override, `${entry.source.artifactKey}/${node.id}`);
    }
    validateUseSiteRootComponents(entry, node, target);
    const additionKeys = new Set<string>();
    for (const addition of prefabRef.componentAdditions ?? []) {
      validateUseSiteComponentAddition(catalog, target, addition, `${entry.source.artifactKey}/${node.id}`, additionKeys);
    }
  }
}

function validateUseSiteRootComponents(owner: SourceCatalogEntry, useSite: UiNode, target: SourceCatalogEntry): void {
  const inherited = target.resolvedSource.root.components ?? {};
  const additions = Object.entries(useSite.components ?? {}).filter(([type]) => type !== "PrefabRef");
  const addedGraphics = additions.filter(([componentType]) => isAddedGraphic(componentType));
  const exclusiveGroups = new Map<string, string>();
  for (const componentType of Object.keys(inherited)) {
    const group = componentExclusiveGroup(componentType);
    if (group) exclusiveGroups.set(group, componentType);
  }
  if (addedGraphics.length > 1) {
    throw new Error(`PrefabRef '${owner.source.artifactKey}/${useSite.id}' root cannot add multiple Graphic components`);
  }
  for (const [componentType] of additions) {
    if (!isUseSiteAddable(componentType)) {
      throw new Error(`PrefabRef '${owner.source.artifactKey}/${useSite.id}' cannot add ${componentType}`);
    }
    if (inherited[componentType]) {
      throw new Error(`PrefabRef '${owner.source.artifactKey}/${useSite.id}' root already inherits ${componentType}`);
    }
    const group = componentExclusiveGroup(componentType);
    const conflict = group ? exclusiveGroups.get(group) : undefined;
    if (group && conflict) {
      throw new Error(
        `PrefabRef '${owner.source.artifactKey}/${useSite.id}' cannot add ${componentType} because it conflicts with ${conflict}`,
      );
    }
    if (group) exclusiveGroups.set(group, componentType);
    if (isAddedGraphic(componentType) && hasGraphic(inherited)) {
      throw new Error(
        `PrefabRef '${owner.source.artifactKey}/${useSite.id}' cannot add ${componentType} to a root with an inherited Graphic`,
      );
    }
  }
}

function validateUseSiteComponentAddition(
  catalog: SourceCatalog,
  start: SourceCatalogEntry,
  addition: UiUseSiteComponentAddition,
  owner: string,
  additionKeys: Set<string>,
): void {
  if (!isUseSiteAddable(addition.componentType)) {
    throw new Error(`PrefabRef '${owner}' cannot add ${addition.componentType}`);
  }
  const resolved = resolveUseSiteNode(catalog, start, addition.target.instancePath ?? [], addition.target.nodeId, owner);
  if ((addition.target.instancePath?.length ?? 0) === 0 && resolved.node.id === start.resolvedSource.root.id) {
    throw new Error(`PrefabRef '${owner}' root component additions must be declared on the PrefabRef use-site node`);
  }
  const key = `${(addition.target.instancePath ?? []).join("/")}\0${addition.target.nodeId}\0${addition.componentType}`;
  if (additionKeys.has(key))
    throw new Error(`PrefabRef '${owner}' has duplicate ${addition.componentType} addition on '${addition.target.nodeId}'`);
  additionKeys.add(key);
  if (resolved.node.components?.[addition.componentType]) {
    throw new Error(`PrefabRef '${owner}' target '${addition.target.nodeId}' already has ${addition.componentType}`);
  }
  const group = componentExclusiveGroup(addition.componentType);
  if (group) {
    const inheritedConflict = Object.keys(resolved.node.components ?? {}).find(
      (componentType) => componentExclusiveGroup(componentType) === group,
    );
    const additionConflict = [...additionKeys]
      .map((candidate) => candidate.split("\0"))
      .find(
        ([instancePath, nodeId, componentType]) =>
          instancePath === (addition.target.instancePath ?? []).join("/") &&
          nodeId === addition.target.nodeId &&
          componentType !== addition.componentType &&
          componentExclusiveGroup(componentType ?? "") === group,
      )?.[2];
    const conflict = inheritedConflict ?? additionConflict;
    if (conflict)
      throw new Error(
        `PrefabRef '${owner}' cannot add ${addition.componentType} to '${addition.target.nodeId}' because it conflicts with ${conflict}`,
      );
  }
  if (isAddedGraphic(addition.componentType)) {
    const inheritedComponents = resolved.node.components ?? {};
    const graphicAlreadyAdded = [...additionKeys].some((candidate) => {
      const [instancePath, nodeId, componentType] = candidate.split("\0");
      return (
        instancePath === (addition.target.instancePath ?? []).join("/") &&
        nodeId === addition.target.nodeId &&
        componentType !== addition.componentType &&
        isAddedGraphic(componentType ?? "")
      );
    });
    if (hasGraphic(inheritedComponents) || graphicAlreadyAdded) {
      throw new Error(
        `PrefabRef '${owner}' cannot add ${addition.componentType} to '${addition.target.nodeId}' because it already has a Graphic`,
      );
    }
  }
}

function resolveUseSiteNode(
  catalog: SourceCatalog,
  start: SourceCatalogEntry,
  instancePath: readonly string[],
  nodeId: string,
  owner: string,
): { readonly entry: SourceCatalogEntry; readonly node: UiNode } {
  let current = start;
  for (const instanceId of instancePath) {
    const instance = findNode(current.resolvedSource, instanceId);
    const nextKey = instance?.components?.PrefabRef?.artifactKey;
    if (!nextKey) throw new Error(`PrefabRef '${owner}' component target instance '${instanceId}' is not a PrefabRef`);
    current = requireArtifact(catalog, nextKey, owner);
  }
  const node = findNode(current.resolvedSource, nodeId);
  if (!node) throw new Error(`PrefabRef '${owner}' component target '${nodeId}' does not exist in '${current.source.artifactKey}'`);
  return { entry: current, node };
}

function isAddedGraphic(componentType: string): boolean {
  return componentType === "Image" || componentType === "Text" || componentType === "RoundedRect";
}

function hasGraphic(components: NonNullable<UiNode["components"]>): boolean {
  return Boolean(components.Image || components.RoundedRect || components.Text);
}

function componentExclusiveGroup(componentType: string): string | undefined {
  return componentType in componentRegistry
    ? (componentRegistry[componentType as UiComponentType] as ComponentDefinition).exclusiveGroup
    : undefined;
}

function resolveOwnerBindingTarget(catalog: SourceCatalog, owner: SourceCatalogEntry, target: UiNestedTarget, fieldName: string): void {
  const resolvedOwner = resolveOwnerBindingEntry(catalog, owner, target, fieldName);
  const node = resolveOwnerBindingNode(catalog, owner, target, fieldName);
  validateBindingComponent(catalog, resolvedOwner, node, target.componentType, fieldName);
}

function resolveOwnerBindingEntry(
  catalog: SourceCatalog,
  owner: SourceCatalogEntry,
  target: UiNestedTarget,
  fieldName: string,
): SourceCatalogEntry {
  const instancePath = target.instancePath ?? [];
  if (instancePath.length === 0) return owner;
  const first = findNode(owner.resolvedSource, instancePath[0]!);
  const firstKey = first?.components?.PrefabRef?.artifactKey;
  if (!firstKey) throw new Error(`Binding '${fieldName}' instance path '${instancePath[0]}' is not a PrefabRef`);
  let current = requireArtifact(catalog, firstKey, fieldName);
  if (current.source.artifactType !== "Fragment") throw new Error(`Binding '${fieldName}' crosses Binder '${current.source.artifactKey}'`);
  for (const instanceId of instancePath.slice(1)) {
    const instance = findNode(current.resolvedSource, instanceId);
    const nextKey = instance?.components?.PrefabRef?.artifactKey;
    if (!nextKey) throw new Error(`Binding '${fieldName}' instance path '${instanceId}' is not a PrefabRef`);
    current = requireArtifact(catalog, nextKey, fieldName);
    if (current.source.artifactType !== "Fragment") throw new Error(`Binding '${fieldName}' crosses Binder '${current.source.artifactKey}'`);
  }
  return current;
}

function resolveOwnerBindingNode(
  catalog: SourceCatalog,
  owner: SourceCatalogEntry,
  target: UiNestedTarget,
  fieldName: string,
): UiNode {
  const resolvedOwner = resolveOwnerBindingEntry(catalog, owner, target, fieldName);
  const node = findNode(resolvedOwner.resolvedSource, target.nodeId);
  if (!node) {
    throw new Error(`Binding '${fieldName}' target '${target.nodeId}' does not exist in '${resolvedOwner.source.artifactKey}'`);
  }
  return node;
}

function validateDependencyType(owner: SourceCatalogEntry, target: SourceCatalogEntry): void {
  const ownerType = owner.source.artifactType;
  const targetType = target.source.artifactType;
  const valid = ownerType === "Fragment" ? targetType === "Fragment" : targetType === "Widget" || targetType === "Fragment";
  if (!valid)
    throw new Error(
      `Artifact dependency '${owner.source.artifactKey}' (${ownerType}) -> '${target.source.artifactKey}' (${targetType}) is not allowed`,
    );
}

function validateBindingComponent(
  catalog: SourceCatalog,
  owner: SourceCatalogEntry,
  node: UiNode,
  componentType: UiBindingComponentType,
  fieldName: string,
): void {
  if (!isSupportedBindingComponentType(componentType)) {
    throw new Error(`Binding '${fieldName}' uses unsupported UIBinder component '${componentType}'`);
  }
  if (componentType === "GameObject" || componentType === "RectTransform") return;
  if (componentType === "PrefabRef") {
    const targetKey = node.components?.PrefabRef?.artifactKey;
    const target = targetKey ? catalog.entries.get(targetKey) : undefined;
    if (!target || target.source.artifactType !== "Widget") {
      throw new Error(`Binding '${fieldName}' PrefabRef target '${owner.source.artifactKey}/${node.id}' is not a Widget Binder`);
    }
    return;
  }
  if (!node.components?.[componentType]) {
    throw new Error(`Binding '${fieldName}' target '${owner.source.artifactKey}/${node.id}' has no ${componentType} component`);
  }
}

function validateUseSiteOverride(catalog: SourceCatalog, startArtifactKey: string, override: UiPropertyOverride, owner: string): void {
  let current = requireArtifact(catalog, startArtifactKey, owner);
  for (const instanceId of override.target.instancePath ?? []) {
    const instance = findNode(current.resolvedSource, instanceId);
    const nextKey = instance?.components?.PrefabRef?.artifactKey;
    if (!nextKey) throw new Error(`Override '${owner}' instance path '${instanceId}' is not a PrefabRef`);
    current = requireArtifact(catalog, nextKey, owner);
  }
  if (
    (override.target.instancePath?.length ?? 0) === 0 &&
    override.target.nodeId === current.resolvedSource.root.id &&
    (override.target.componentType === "Node" || override.target.componentType === "RectTransform")
  ) {
    throw new Error(
      `Override '${owner}' must store referenced root ${override.target.componentType}.${override.target.fieldPath} on the PrefabRef use-site node`,
    );
  }
  const local: UiPropertyOverride = { ...override, target: { ...override.target, instancePath: [] } };
  validateOverrideTarget(current.resolvedSource, local);
  applyPropertyOverride(current.resolvedSource, local);
}

function requireArtifact(catalog: SourceCatalog, artifactKey: string, owner?: string): SourceCatalogEntry {
  const entry = catalog.entries.get(artifactKey);
  if (!entry)
    throw new Error(
      owner
        ? `Artifact '${owner}' references missing artifact '${artifactKey}'`
        : `Artifact '${artifactKey}' is missing from Source Catalog`,
    );
  return entry;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function projectionOrder(catalog: SourceCatalog, rootArtifactKey: string): SourceCatalogEntry[] {
  const result: SourceCatalogEntry[] = [];
  const active: string[] = [];
  const visited = new Set<string>();

  const visit = (artifactKey: string): void => {
    const cycleStart = active.indexOf(artifactKey);
    if (cycleStart >= 0) throw new Error(`Circular Artifact dependency: ${[...active.slice(cycleStart), artifactKey].join(" -> ")}`);
    if (visited.has(artifactKey)) return;
    const entry = requireArtifact(catalog, artifactKey, active.at(-1));
    active.push(artifactKey);
    for (const dependency of entry.dependencies) visit(dependency);
    active.pop();
    visited.add(artifactKey);
    result.push(entry);
  };

  visit(rootArtifactKey);
  return result;
}
