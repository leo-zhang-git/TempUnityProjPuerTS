import { type DerivedFieldMetadata, deepClone, getCoreSchema, type JsonObject, type JsonValue, type SchemaRegistry } from "./schema.js";
import { cloneWorkspace, type Workspace } from "./workspace.js";

export type DerivationRuleKind = "record" | "table";

export interface DerivationDependency {
	table: string;
	field?: string;
}

export interface DerivationOutput {
	table: string;
	field: string;
	category?: string;
}

export interface DerivationPatch {
	table: string;
	category: string;
	id: string;
	values: JsonObject;
}

export interface DerivationRuleContext {
	readonly workspace: Workspace;
	readonly registry: SchemaRegistry;
	getRecord(table: string, id: string): { category: string; core: JsonObject } | undefined;
	listRecords(table: string): Array<{ id: string; category: string; core: JsonObject }>;
}

export interface DerivationRule {
	id: string;
	kind: DerivationRuleKind;
	dependencies: readonly DerivationDependency[];
	outputs: readonly DerivationOutput[];
	after?: readonly string[];
	derive(context: DerivationRuleContext): readonly DerivationPatch[];
}

export interface DerivationRuleRegistry {
	version: string;
	rules: readonly DerivationRule[];
}

export interface DerivedFieldProvenance {
	path: string;
	table: string;
	category: string;
	id: string;
	field: string;
	ruleId: string;
	source: "derived" | "override";
	allowOverride: boolean;
	dependencies: readonly DerivationDependency[];
	value: JsonValue;
	expectedValue?: JsonValue;
}

export interface DerivationIssue {
	path: string;
	message: string;
	ruleId?: string;
}

export interface DerivationResult {
	workspace: Workspace;
	issues: DerivationIssue[];
	provenance: Record<string, DerivedFieldProvenance>;
	orderedRuleIds: string[];
	affectedTables: string[];
}

export interface DerivationOptions {
	initialWorkspace?: Workspace;
	recordIdsByTable?: Readonly<Record<string, readonly string[]>>;
}

export const emptyDerivationRegistry: DerivationRuleRegistry = Object.freeze({
	version: "none",
	rules: Object.freeze([]),
});

export function createDerivationRuleRegistry(version: string, rules: readonly DerivationRule[]): DerivationRuleRegistry {
	if (!version.trim()) throw new Error("Derivation registry version must not be empty");
	return { version, rules: [...rules] };
}

export function deriveWorkspace(
	authoredWorkspace: Workspace,
	registry: SchemaRegistry,
	ruleRegistry: DerivationRuleRegistry = emptyDerivationRegistry,
	options: DerivationOptions = {},
): DerivationResult {
	const workspace = cloneWorkspace(options.initialWorkspace ?? authoredWorkspace);
	const recordIdsByTable = Object.fromEntries(Object.entries(options.recordIdsByTable ?? {}).map(([table, ids]) => [table, new Set(ids)]));
	const issues: DerivationIssue[] = [];
	const provenance: Record<string, DerivedFieldProvenance> = {};
	const orderedRules = orderRules(ruleRegistry.rules, issues);
	const outputOwners = collectOutputOwners(orderedRules, registry, issues);
	const affectedTables = new Set<string>();

	for (const rule of orderedRules) {
		if (!rule.outputs.some((output) => workspace.tables[output.table] !== undefined)) continue;
		let patches: readonly DerivationPatch[];
		try {
			patches = rule.derive(createRuleContext(workspace, registry, rule.kind === "record" ? recordIdsByTable : undefined));
		} catch (error) {
			issues.push({
				path: `derivation/${rule.id}`,
				message: `派生规则执行失败：${error instanceof Error ? error.message : String(error)}`,
				ruleId: rule.id,
			});
			continue;
		}

		for (const patch of patches) {
			applyDerivationPatch({
				authoredWorkspace,
				workspace,
				registry,
				rule,
				patch,
				outputOwners,
				issues,
				provenance,
				affectedTables,
			});
		}
	}

	collectMissingDerivedFields(authoredWorkspace, workspace, registry, ruleRegistry, issues, provenance, recordIdsByTable);
	return {
		workspace,
		issues: sortIssues(issues),
		provenance,
		orderedRuleIds: orderedRules.map((rule) => rule.id),
		affectedTables: [...affectedTables].sort((left, right) => left.localeCompare(right)),
	};
}

export function getDerivationDownstreamTables(changedTables: readonly string[], ruleRegistry: DerivationRuleRegistry): string[] {
	const affected = new Set(changedTables);
	let changed = true;
	while (changed) {
		changed = false;
		for (const rule of ruleRegistry.rules) {
			if (!rule.dependencies.some((dependency) => affected.has(dependency.table))) continue;
			for (const output of rule.outputs) {
				if (affected.has(output.table)) continue;
				affected.add(output.table);
				changed = true;
			}
		}
	}
	return [...affected].sort((left, right) => left.localeCompare(right));
}

export function getDerivationRelatedTables(seedTables: readonly string[], ruleRegistry: DerivationRuleRegistry): string[] {
	const related = new Set(seedTables);
	let changed = true;
	while (changed) {
		changed = false;
		for (const rule of ruleRegistry.rules) {
			const ruleTables = new Set([
				...rule.dependencies.map((dependency) => dependency.table),
				...rule.outputs.map((output) => output.table),
			]);
			if (![...ruleTables].some((table) => related.has(table))) continue;
			for (const table of ruleTables) {
				if (related.has(table)) continue;
				related.add(table);
				changed = true;
			}
		}
	}
	return [...related].sort((left, right) => left.localeCompare(right));
}

function orderRules(rules: readonly DerivationRule[], issues: DerivationIssue[]): DerivationRule[] {
	const byId = new Map<string, DerivationRule>();
	for (const rule of rules) {
		if (byId.has(rule.id)) {
			issues.push({ path: `derivation/${rule.id}`, message: "派生 rule id 重复", ruleId: rule.id });
			continue;
		}
		byId.set(rule.id, rule);
	}

	const dependencies = new Map<string, Set<string>>();
	for (const rule of byId.values()) {
		const ruleDependencies = new Set<string>();
		for (const dependencyId of rule.after ?? []) {
			if (!byId.has(dependencyId)) {
				issues.push({
					path: `derivation/${rule.id}`,
					message: `依赖的派生规则不存在：${dependencyId}`,
					ruleId: rule.id,
				});
				continue;
			}
			ruleDependencies.add(dependencyId);
		}
		for (const producer of byId.values()) {
			if (producer.id === rule.id) continue;
			if (rule.dependencies.some((input) => producer.outputs.some((output) => dependencyMatchesOutput(input, output)))) {
				ruleDependencies.add(producer.id);
			}
		}
		dependencies.set(rule.id, ruleDependencies);
	}

	const ordered: DerivationRule[] = [];
	const ready = [...byId.keys()].filter((id) => dependencies.get(id)?.size === 0).sort((left, right) => left.localeCompare(right));
	while (ready.length > 0) {
		const id = ready.shift();
		if (!id) continue;
		const rule = byId.get(id);
		if (rule) ordered.push(rule);
		for (const [candidateId, candidateDependencies] of dependencies) {
			if (!candidateDependencies.delete(id) || candidateDependencies.size !== 0) continue;
			if (!ordered.some((entry) => entry.id === candidateId) && !ready.includes(candidateId)) {
				ready.push(candidateId);
				ready.sort((left, right) => left.localeCompare(right));
			}
		}
	}

	const unresolved = [...byId.keys()]
		.filter((id) => !ordered.some((rule) => rule.id === id))
		.sort((left, right) => left.localeCompare(right));
	if (unresolved.length > 0) {
		issues.push({ path: "derivation", message: `派生规则依赖成环：${unresolved.join(", ")}` });
	}
	return ordered;
}

function collectOutputOwners(
	rules: readonly DerivationRule[],
	registry: SchemaRegistry,
	issues: DerivationIssue[],
): Map<string, DerivationRule> {
	const owners = new Map<string, DerivationRule>();
	for (const rule of rules) {
		for (const output of rule.outputs) {
			const categories = output.category ? [output.category] : Object.keys(registry.tables[output.table]?.categories ?? {});
			if (categories.length === 0) {
				issues.push({ path: `derivation/${rule.id}`, message: `输出表不存在：${output.table}`, ruleId: rule.id });
				continue;
			}
			for (const category of categories) {
				const key = outputKey(output.table, category, output.field);
				const existing = owners.get(key);
				if (existing && existing.id !== rule.id) {
					issues.push({
						path: `${output.table}/${category}.${output.field}`,
						message: `派生字段存在多个 owner：${existing.id}, ${rule.id}`,
					});
					continue;
				}
				let fieldMetadata: DerivedFieldMetadata | undefined;
				try {
					fieldMetadata = getCoreSchema(registry, output.table, category).fields[output.field]?.metadata?.derived;
				} catch {
					fieldMetadata = undefined;
				}
				if (!fieldMetadata || fieldMetadata.ruleId !== rule.id) {
					issues.push({
						path: `${output.table}/${category}.${output.field}`,
						message: `schema 派生声明与规则 owner 不一致，应为 ${rule.id}`,
						ruleId: rule.id,
					});
				}
				owners.set(key, rule);
			}
		}
	}
	return owners;
}

function applyDerivationPatch(options: {
	authoredWorkspace: Workspace;
	workspace: Workspace;
	registry: SchemaRegistry;
	rule: DerivationRule;
	patch: DerivationPatch;
	outputOwners: Map<string, DerivationRule>;
	issues: DerivationIssue[];
	provenance: Record<string, DerivedFieldProvenance>;
	affectedTables: Set<string>;
}): void {
	const { authoredWorkspace, workspace, registry, rule, patch, outputOwners, issues, provenance, affectedTables } = options;
	let coreSchema: ReturnType<typeof getCoreSchema>;
	try {
		coreSchema = getCoreSchema(registry, patch.table, patch.category);
	} catch (error) {
		issues.push({
			path: `${patch.table}/${patch.category}#${patch.id}`,
			message: `派生目标不存在：${error instanceof Error ? error.message : String(error)}`,
			ruleId: rule.id,
		});
		return;
	}

	let tableStore = workspace.tables[patch.table];
	if (!tableStore) {
		tableStore = { categories: {} };
		workspace.tables[patch.table] = tableStore;
	}
	let categoryStore = tableStore.categories[patch.category];
	if (!categoryStore) {
		categoryStore = { core: {}, sidecars: {}, recordOrder: [] };
		tableStore.categories[patch.category] = categoryStore;
	}
	let target = categoryStore.core[patch.id];
	if (!target) {
		target = {};
		categoryStore.core[patch.id] = target;
		categoryStore.recordOrder.push(patch.id);
	}
	const authored = authoredWorkspace.tables[patch.table]?.categories[patch.category]?.core[patch.id];

	for (const [field, value] of Object.entries(patch.values)) {
		const path = `${patch.table}/${patch.category}#${patch.id}.core.${field}`;
		const owner = outputOwners.get(outputKey(patch.table, patch.category, field));
		if (!owner || owner.id !== rule.id) {
			issues.push({ path, message: "规则写入了未声明的派生字段", ruleId: rule.id });
			continue;
		}
		const fieldSchema = coreSchema.fields[field];
		if (!fieldSchema) {
			issues.push({ path, message: "规则写入了 schema 中不存在的字段", ruleId: rule.id });
			continue;
		}
		if (value === undefined) {
			issues.push({ path, message: "规则不能写入 undefined", ruleId: rule.id });
			continue;
		}
		const derivedMetadata = fieldSchema.metadata?.derived;
		const allowOverride = derivedMetadata?.allowOverride === true;
		if (authored && Object.hasOwn(authored, field)) {
			if (!allowOverride) {
				issues.push({ path, message: "该派生字段不允许人工覆盖", ruleId: rule.id });
			}
			const authoredValue = authored[field];
			if (authoredValue !== undefined) {
				provenance[path] = {
					...createProvenance(path, patch, field, rule, "override", allowOverride, authoredValue),
					expectedValue: deepClone(value),
				};
			}
			continue;
		}
		target[field] = deepClone(value);
		provenance[path] = createProvenance(path, patch, field, rule, "derived", allowOverride, value);
		affectedTables.add(patch.table);
	}
}

function collectMissingDerivedFields(
	authoredWorkspace: Workspace,
	workspace: Workspace,
	registry: SchemaRegistry,
	ruleRegistry: DerivationRuleRegistry,
	issues: DerivationIssue[],
	provenance: Record<string, DerivedFieldProvenance>,
	recordIdsByTable: Readonly<Record<string, ReadonlySet<string>>>,
): void {
	const knownRules = new Set(ruleRegistry.rules.map((rule) => rule.id));
	for (const [table, tableStore] of Object.entries(workspace.tables)) {
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			if (!registry.tables[table]?.categories[category]) continue;
			const schema = getCoreSchema(registry, table, category);
			for (const [id, record] of Object.entries(categoryStore.core)) {
				const recordIds = recordIdsByTable[table];
				if (recordIds && !recordIds.has(id)) continue;
				for (const [field, fieldSchema] of Object.entries(schema.fields)) {
					const metadata = fieldSchema.metadata?.derived;
					if (!metadata) continue;
					const path = `${table}/${category}#${id}.core.${field}`;
					if (!knownRules.has(metadata.ruleId)) {
						issues.push({ path, message: `schema 引用的派生规则不存在：${metadata.ruleId}`, ruleId: metadata.ruleId });
						continue;
					}
					const authored = authoredWorkspace.tables[table]?.categories[category]?.core[id];
					if (authored && Object.hasOwn(authored, field) && authored[field] !== undefined && !provenance[path]) {
						provenance[path] = {
							path,
							table,
							category,
							id,
							field,
							ruleId: metadata.ruleId,
							source: "override",
							allowOverride: metadata.allowOverride === true,
							dependencies:
								metadata.dependencies?.map(({ table: dependencyTable, field: dependencyField }) => ({
									table: dependencyTable,
									...(dependencyField ? { field: dependencyField } : {}),
								})) ?? [],
							value: deepClone(authored[field] as JsonValue),
						};
					}
					if (record[field] === undefined && fieldSchema.required === true && fieldSchema.default === undefined) {
						issues.push({ path, message: "派生规则未生成字段值", ruleId: metadata.ruleId });
					}
				}
			}
		}
	}
}

function createRuleContext(
	workspace: Workspace,
	registry: SchemaRegistry,
	recordIdsByTable: Readonly<Record<string, ReadonlySet<string>>> | undefined,
): DerivationRuleContext {
	return {
		workspace,
		registry,
		getRecord(table, id) {
			for (const [category, categoryStore] of Object.entries(workspace.tables[table]?.categories ?? {})) {
				const core = categoryStore.core[id];
				if (core) return { category, core };
			}
			return undefined;
		},
		listRecords(table) {
			const records: Array<{ id: string; category: string; core: JsonObject }> = [];
			const recordIds = recordIdsByTable?.[table];
			for (const [category, categoryStore] of Object.entries(workspace.tables[table]?.categories ?? {})) {
				for (const [id, core] of Object.entries(categoryStore.core)) {
					if (!recordIds || recordIds.has(id)) records.push({ id, category, core });
				}
			}
			return records.sort((left, right) => left.id.localeCompare(right.id) || left.category.localeCompare(right.category));
		},
	};
}

function createProvenance(
	path: string,
	patch: DerivationPatch,
	field: string,
	rule: DerivationRule,
	source: DerivedFieldProvenance["source"],
	allowOverride: boolean,
	value: JsonValue,
): DerivedFieldProvenance {
	return {
		path,
		table: patch.table,
		category: patch.category,
		id: patch.id,
		field,
		ruleId: rule.id,
		source,
		allowOverride,
		dependencies: rule.dependencies.map((dependency) => ({ ...dependency })),
		value: deepClone(value),
	};
}

function dependencyMatchesOutput(dependency: DerivationDependency, output: DerivationOutput): boolean {
	return dependency.table === output.table && (dependency.field === undefined || dependency.field === output.field);
}

function outputKey(table: string, category: string, field: string): string {
	return `${table}\u0000${category}\u0000${field}`;
}

function sortIssues(issues: DerivationIssue[]): DerivationIssue[] {
	return issues.sort((left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message));
}

