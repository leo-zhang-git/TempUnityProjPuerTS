import { Ajv } from "ajv";
import {
  type GraphTarget,
  type PreviewReferenceOwnerScope,
  type PrototypeInteraction,
  type UiPrototype,
  UiPrototypeSchema,
  type UiReference,
  UiReferenceSchema,
} from "../schema/ui-prototype-schema.js";
import type { UiComponentType } from "../schema/ui-source-schema.js";
import { graphTargetKey, resolveArtifactUseSite } from "./artifact-use-site.js";
import {
  createPreviewReferenceCatalog,
  type PreviewReferenceCatalog,
  type PreviewReferenceCatalogEntry,
  previewReferenceOwnerRootArtifactKey,
} from "./preview-reference.js";
import { resolvedPreviewInstance, resolvePreviewReference } from "./preview-reference-resolver.js";
import { previewInstanceKey } from "./preview-reference-resolver-contract.js";
import { type PreviewValues, resolvePreviewValues } from "./preview-values.js";
import { schemaValidationIssue } from "./schema-validation.js";
import type { SourceCatalog } from "./source-catalog.js";
import { findNode } from "./tree.js";
import type { ValidationIssue, ValidationResult } from "./validation-contract.js";

export interface ReferenceCatalogInput {
  readonly path: string;
  readonly reference: UiReference;
}

type ReferenceCatalogEntry = PreviewReferenceCatalogEntry;
export type ReferenceCatalog = PreviewReferenceCatalog;

export interface PrototypeCatalogInput {
  readonly path: string;
  readonly prototype: UiPrototype;
}

interface PrototypeCatalogEntry extends PrototypeCatalogInput {}

export interface PrototypeCatalog {
  readonly entries: ReadonlyMap<string, PrototypeCatalogEntry>;
}

export interface PrototypeSession {
  readonly currentReferenceKey: string;
  readonly backStack: readonly string[];
  readonly valuesByOwner: Readonly<Record<string, PreviewValues>>;
  readonly viewport: readonly [number, number];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateReferenceShape = ajv.compile(UiReferenceSchema);
const validatePrototypeShape = ajv.compile(UiPrototypeSchema);

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

export function validateReferenceShapeOnly(value: unknown): ValidationResult {
  const valid = validateReferenceShape(value);
  return valid ? { valid: true, issues: [] } : { valid: false, issues: (validateReferenceShape.errors ?? []).map(schemaValidationIssue) };
}

export function validatePrototypeShapeOnly(value: unknown): ValidationResult {
  const valid = validatePrototypeShape(value);
  return valid ? { valid: true, issues: [] } : { valid: false, issues: (validatePrototypeShape.errors ?? []).map(schemaValidationIssue) };
}

export function assertValidReferenceShape(value: unknown): asserts value is UiReference {
  const result = validateReferenceShapeOnly(value);
  if (result.valid) return;
  throw new Error(result.issues.map((item) => `${item.path} [${item.code}] ${item.message}`).join("\n"));
}

export function assertValidPrototypeShape(value: unknown): asserts value is UiPrototype {
  const result = validatePrototypeShapeOnly(value);
  if (result.valid) return;
  throw new Error(result.issues.map((item) => `${item.path} [${item.code}] ${item.message}`).join("\n"));
}

export function createReferenceCatalog(inputs: readonly ReferenceCatalogInput[], sourceCatalog?: SourceCatalog): ReferenceCatalog {
  if (sourceCatalog) return createPreviewReferenceCatalog(inputs, sourceCatalog);
  const entries = new Map<string, PreviewReferenceCatalogEntry>();
  for (const input of inputs) {
    assertValidReferenceShape(input.reference);
    const existing = entries.get(input.reference.referenceKey);
    if (existing) throw new Error(`Duplicate referenceKey '${input.reference.referenceKey}' in '${existing.path}' and '${input.path}'`);
    entries.set(input.reference.referenceKey, input);
  }
  return { entries, defaults: new Map() };
}

export function createPrototypeCatalog(inputs: readonly PrototypeCatalogInput[]): PrototypeCatalog {
  const entries = new Map<string, PrototypeCatalogEntry>();
  for (const input of inputs) {
    assertValidPrototypeShape(input.prototype);
    const existing = entries.get(input.prototype.prototypeKey);
    if (existing) throw new Error(`Duplicate prototypeKey '${input.prototype.prototypeKey}' in '${existing.path}' and '${input.path}'`);
    entries.set(input.prototype.prototypeKey, input);
  }
  return { entries };
}

function duplicateBackdropIssues(reference: UiReference): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const viewports = new Set<string>();
  for (const [index, image] of (reference.backdrop?.images ?? []).entries()) {
    const key = image.viewport.join("x");
    if (viewports.has(key))
      issues.push(
        issue(`/backdrop/images/${index}/viewport`, "reference.backdropViewport", `Duplicate Reference backdrop viewport '${key}'`),
      );
    viewports.add(key);
  }
  return issues;
}

export function validateReference(value: unknown, sourceCatalog?: SourceCatalog, referenceCatalog?: ReferenceCatalog): ValidationResult {
  const shape = validateReferenceShapeOnly(value);
  if (!shape.valid || !sourceCatalog) return shape;
  const reference = value as UiReference;
  const issues = duplicateBackdropIssues(reference);
  let catalog = referenceCatalog;
  if (!catalog) {
    try {
      catalog = createPreviewReferenceCatalog([{ path: `${reference.referenceKey}.ui-reference.json`, reference }], sourceCatalog);
    } catch (error) {
      issues.push(issue("/", "reference.catalog", error instanceof Error ? error.message : String(error)));
      return { valid: false, issues };
    }
  }
  const resolved = resolvePreviewReference({
    sourceCatalog,
    referenceCatalog: catalog,
    referenceKey: reference.referenceKey,
  });
  issues.push(...resolved.diagnostics.map((diagnostic) => issue(diagnostic.path, diagnostic.code, diagnostic.message)));
  return { valid: issues.length === 0, issues };
}

function requireReference(catalog: ReferenceCatalog, referenceKey: string): ReferenceCatalogEntry {
  const entry = catalog.entries.get(referenceKey);
  if (!entry) throw new Error(`Reference '${referenceKey}' is missing from Reference Catalog`);
  return entry;
}

function appendResolutionIssue(issues: ValidationIssue[], path: string, code: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    issues.push(issue(path, code, error instanceof Error ? error.message : String(error)));
  }
}

function ownerArtifactKey(reference: UiReference, owner: PreviewReferenceOwnerScope, sourceCatalog: SourceCatalog): string | undefined {
  const root = previewReferenceOwnerRootArtifactKey(reference, owner);
  if (!root) return undefined;
  return resolveArtifactUseSite(sourceCatalog, {
    rootArtifactKey: root.artifactKey,
    ...(root.instancePath.length > 0 ? { instancePath: [...root.instancePath] } : {}),
  }).source.artifactKey;
}

function validateSetValue(
  issues: ValidationIssue[],
  path: string,
  reference: UiReference,
  action: Extract<UiPrototype["interactions"][number]["actions"][number], { kind: "SetValue" }>,
  sourceCatalog: SourceCatalog,
): void {
  appendResolutionIssue(issues, path, "prototype.value", () => {
    const artifactKey = ownerArtifactKey(reference, action.owner, sourceCatalog);
    if (!artifactKey) throw new Error("SetValue owner cannot be resolved");
    const resolved = resolvePreviewValues({
      catalog: sourceCatalog,
      owner: { kind: "prototypeSession", artifactKey, path },
      values: { [action.fieldName]: { [action.capability]: action.value } },
    });
    if (!resolved.valid) throw new Error(resolved.diagnostics.map((entry) => entry.message).join("; "));
  });
}

export function validatePrototype(value: unknown, referenceCatalog?: ReferenceCatalog, sourceCatalog?: SourceCatalog): ValidationResult {
  const shape = validatePrototypeShapeOnly(value);
  if (!shape.valid || !referenceCatalog || !sourceCatalog) return shape;
  const prototype = value as UiPrototype;
  const issues: ValidationIssue[] = [];
  appendResolutionIssue(issues, "/startReferenceKey", "prototype.startReference", () => {
    requireReference(referenceCatalog, prototype.startReferenceKey);
  });
  const interactionKeys = new Set<string>();
  const resolvedReferences = new Map<string, ReturnType<typeof resolvePreviewReference>>();
  for (const [index, interaction] of prototype.interactions.entries()) {
    const path = `/interactions/${index}`;
    let reference: UiReference | undefined;
    appendResolutionIssue(issues, `${path}/referenceKey`, "prototype.reference", () => {
      reference = requireReference(referenceCatalog, interaction.referenceKey).reference;
    });
    if (!reference) continue;
    const currentReference = reference;
    const expectedRoot = currentReference.context?.parentArtifactKey ?? currentReference.subjectArtifactKey;
    if (interaction.trigger.target.rootArtifactKey !== expectedRoot) {
      issues.push(
        issue(`${path}/trigger/target/rootArtifactKey`, "prototype.triggerRoot", `Tap target rootArtifactKey must be '${expectedRoot}'`),
      );
    } else {
      appendResolutionIssue(issues, `${path}/trigger/target`, "prototype.trigger", () => {
        let resolved = resolvedReferences.get(currentReference.referenceKey);
        if (!resolved) {
          resolved = resolvePreviewReference({
            sourceCatalog,
            referenceCatalog,
            referenceKey: currentReference.referenceKey,
          });
          resolvedReferences.set(currentReference.referenceKey, resolved);
        }
        const tree = resolved.tree;
        if (!tree) throw new Error(`Reference '${currentReference.referenceKey}' has no resolved Preview tree`);
        const target = interaction.trigger.target;
        const instance = resolvedPreviewInstance(tree, previewInstanceKey(target.rootArtifactKey, target.instancePath ?? []));
        if (!instance) {
          throw new Error(
            `Reference '${currentReference.referenceKey}' has no Preview instance '${[target.rootArtifactKey, ...(target.instancePath ?? [])].join("/")}'`,
          );
        }
        const node = findNode(instance.source, target.nodeId);
        if (!node) throw new Error(`Artifact '${instance.artifactKey}' has no node '${target.nodeId}'`);
        if (!node.components?.[target.componentType as UiComponentType]) {
          throw new Error(`Node '${instance.artifactKey}/${target.nodeId}' has no '${target.componentType}' component`);
        }
      });
    }
    const key = `${interaction.referenceKey}:${graphTargetKey(interaction.trigger.target)}`;
    if (interactionKeys.has(key)) issues.push(issue(path, "prototype.interactionDuplicate", `Duplicate interaction '${key}'`));
    interactionKeys.add(key);
    for (const [actionIndex, action] of interaction.actions.entries()) {
      const actionPath = `${path}/actions/${actionIndex}`;
      if (action.kind === "Navigate") {
        appendResolutionIssue(issues, `${actionPath}/referenceKey`, "prototype.navigate", () => {
          requireReference(referenceCatalog, action.referenceKey);
        });
      } else if (action.kind === "SetValue") {
        validateSetValue(issues, actionPath, currentReference, action, sourceCatalog);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

export function assertValidReference(
  value: unknown,
  sourceCatalog: SourceCatalog,
  referenceCatalog?: ReferenceCatalog,
): asserts value is UiReference {
  const result = validateReference(value, sourceCatalog, referenceCatalog);
  if (result.valid) return;
  throw new Error(result.issues.map((item) => `${item.path} [${item.code}] ${item.message}`).join("\n"));
}

export function assertValidPrototype(
  value: unknown,
  referenceCatalog: ReferenceCatalog,
  sourceCatalog: SourceCatalog,
): asserts value is UiPrototype {
  const result = validatePrototype(value, referenceCatalog, sourceCatalog);
  if (result.valid) return;
  throw new Error(result.issues.map((item) => `${item.path} [${item.code}] ${item.message}`).join("\n"));
}

function ownerSessionKey(referenceKey: string, owner: PreviewReferenceOwnerScope): string {
  return `${referenceKey}\0${JSON.stringify(owner)}`;
}

export function prototypeOwnerValues(
  session: PrototypeSession,
  referenceKey: string,
  owner: PreviewReferenceOwnerScope,
): PreviewValues | undefined {
  return session.valuesByOwner[ownerSessionKey(referenceKey, owner)];
}

export function createPrototypeSession(
  prototype: UiPrototype,
  viewport: readonly [number, number],
  _reference?: UiReference,
): PrototypeSession {
  return { currentReferenceKey: prototype.startReferenceKey, backStack: [], valuesByOwner: {}, viewport };
}

export function applyPrototypeInteraction(session: PrototypeSession, interaction: PrototypeInteraction): PrototypeSession {
  let currentReferenceKey = session.currentReferenceKey;
  let backStack = [...session.backStack];
  const valuesByOwner = { ...session.valuesByOwner };
  for (const action of interaction.actions) {
    if (action.kind === "Navigate") {
      backStack.push(currentReferenceKey);
      currentReferenceKey = action.referenceKey;
    } else if (action.kind === "Back") {
      currentReferenceKey = backStack.pop() ?? currentReferenceKey;
    } else {
      const key = ownerSessionKey(interaction.referenceKey, action.owner);
      valuesByOwner[key] = {
        ...(valuesByOwner[key] ?? {}),
        [action.fieldName]: {
          ...(valuesByOwner[key]?.[action.fieldName] ?? {}),
          [action.capability]: structuredClone(action.value),
        },
      };
    }
  }
  return { currentReferenceKey, backStack, valuesByOwner, viewport: session.viewport };
}

export function findPrototypeInteraction(
  prototype: UiPrototype,
  referenceKey: string,
  target: GraphTarget,
): PrototypeInteraction | undefined {
  const key = graphTargetKey(target);
  return prototype.interactions.find(
    (interaction) => interaction.referenceKey === referenceKey && graphTargetKey(interaction.trigger.target) === key,
  );
}
