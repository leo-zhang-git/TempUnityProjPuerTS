import type { DerivedFieldProvenance } from "../core/derivation.js";
import { filterRecordIssues, filterSidecarIrByCategory, findCoreRecordLocation } from "../core/query-utils.js";
import { scanRecordReferences } from "../core/ref-index.js";
import {
	type FieldDefinition,
	getAvailableSidecarSchemas,
	getCoreSchema,
	getTableSchema,
	isJsonObject,
	type JsonObject,
	type ObjectField,
	type SchemaRegistry,
	type SidecarSchema,
} from "../core/schema.js";
import { createSchemaIR, type SchemaIR } from "../core/schema-ir.js";
import type { ValidationReport } from "../core/validate.js";
import { materializeRecordWithSchema, type ResolvedRecord, type Workspace } from "../core/workspace.js";
import { getAuthoredSidecar, materializeSidecars, normalizeSidecarSet } from "./materialization.js";
import type { FieldProvenance, RecordDetail, RecordReference } from "./service.js";

export function getRecordDetail(
	workspace: Workspace,
	validation: ValidationReport,
	registry: SchemaRegistry,
	table: string,
	id: string,
	options: {
		schemaIr?: SchemaIR;
		includeReferences?: boolean;
		authoredWorkspace?: Workspace;
		derivedProvenance?: Record<string, DerivedFieldProvenance>;
	} = {},
): RecordDetail {
	const rawLocation = findCoreRecordLocation(workspace, table, id);
	if (!rawLocation) {
		throw new Error(`找不到 authoring 记录：${table}#${id}`);
	}
	const tableSchema = getTableSchema(registry, table);
	const coreSchema = getCoreSchema(registry, table, rawLocation.category);
	const computedCore = rawLocation.categoryStore.core[id];
	if (!computedCore) throw new Error(`找不到计算后记录：${table}#${id}`);
	const authoredLocation = options.authoredWorkspace ? findCoreRecordLocation(options.authoredWorkspace, table, id) : rawLocation;
	const authoredCore = authoredLocation?.categoryStore.core[id] ?? {};
	const authoredSidecars = authoredLocation?.categoryStore.sidecars[id];
	const authoredSidecarSet = normalizeSidecarSet(authoredSidecars);
	const schemaIr = options.schemaIr ?? createSchemaIR(registry);
	const tableIr = schemaIr.tables[table];
	if (!tableIr) {
		throw new Error(`未知 schema 表：${table}`);
	}
	const categoryIr = tableIr.categories[rawLocation.category];
	if (!categoryIr) {
		throw new Error(`未知 schema 子表：${table}.${rawLocation.category}`);
	}
	const availableSidecarSchemas = getAvailableSidecarSchemas(tableSchema.sidecars, rawLocation.category);
	const availableSidecarIr = filterSidecarIrByCategory(tableIr.sidecars, rawLocation.category);
	const resolvedRecord: ResolvedRecord = {
		id,
		category: rawLocation.category,
		core: materializeRecordWithSchema(computedCore, coreSchema),
	};
	const resolvedSidecars = materializeSidecars(authoredSidecars, availableSidecarSchemas);
	if (Object.keys(resolvedSidecars).length > 0) {
		resolvedRecord.sidecars = resolvedSidecars;
	}

	const references = (options.includeReferences === false ? [] : scanRecordReferences(registry, table, id, resolvedRecord)).map(
		(entry): RecordReference => ({
			path: entry.path,
			targetTable: entry.targetTable,
			...(entry.targetCategories ? { targetCategories: entry.targetCategories } : {}),
			targetId: entry.targetId,
		}),
	);

	return {
		table,
		id,
		category: rawLocation.category,
		...(tableSchema.uniqueKey ? { uniqueKey: tableSchema.uniqueKey } : {}),
		authored: {
			core: structuredClone(authoredCore),
			...(Object.keys(authoredSidecarSet).length > 0 ? { sidecars: structuredClone(authoredSidecarSet) } : {}),
		},
		resolved: structuredClone(resolvedRecord),
		schema: {
			core: categoryIr.mergedCoreSchema,
			...(Object.keys(availableSidecarIr).length > 0 ? { sidecars: availableSidecarIr } : {}),
		},
		provenance: {
			core: collectFieldProvenance(authoredCore, resolvedRecord.core, coreSchema, "core").map((entry) => {
				const derived = options.derivedProvenance?.[`${table}/${rawLocation.category}#${id}.${entry.path}`];
				return derived
					? {
							...entry,
							source: derived.source,
							ruleId: derived.ruleId,
							allowOverride: derived.allowOverride,
						}
					: entry;
			}),
			...(Object.keys(availableSidecarSchemas).length > 0
				? { sidecars: collectSidecarProvenance(authoredSidecars, resolvedRecord.sidecars, availableSidecarSchemas) }
				: {}),
		},
		references,
		issues: filterRecordIssues(validation, table, rawLocation.category, id),
	};
}

function collectSidecarProvenance(
	authoredSidecars: JsonObject | undefined,
	resolvedSidecars: Record<string, JsonObject> | undefined,
	sidecarSchemas: Record<string, SidecarSchema>,
): Record<string, FieldProvenance[]> {
	const provenance: Record<string, FieldProvenance[]> = {};
	for (const sidecarName of Object.keys(sidecarSchemas).sort((left, right) => left.localeCompare(right))) {
		const sidecarSchema = sidecarSchemas[sidecarName];
		if (!sidecarSchema) {
			continue;
		}
		provenance[sidecarName] = collectFieldProvenance(
			getAuthoredSidecar(authoredSidecars, sidecarName),
			resolvedSidecars?.[sidecarName],
			sidecarSchema.schema.kind === "object"
				? sidecarSchema.schema
				: resolveUnionObjectVariant(sidecarSchema.schema, resolvedSidecars?.[sidecarName]),
			`sidecar.${sidecarName}`,
		);
	}
	return provenance;
}

function resolveUnionObjectVariant(field: FieldDefinition, value: JsonObject | undefined): ObjectField {
	if (field.kind === "object") {
		return field;
	}
	if (field.kind !== "union") {
		return { kind: "object", fields: {} };
	}
	if (value) {
		const selected = field.variants.find((variant) => variant.kind === "object" && matchesObjectLiteralFields(value, variant));
		if (selected?.kind === "object") {
			return selected;
		}
	}
	const firstObject = field.variants.find((variant): variant is ObjectField => variant.kind === "object");
	return firstObject ?? { kind: "object", fields: {} };
}

function matchesObjectLiteralFields(value: JsonObject, field: ObjectField): boolean {
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		if (childField.kind === "literal" && value[fieldName] !== childField.value) {
			return false;
		}
	}
	return true;
}

function collectFieldProvenance(
	authored: JsonObject | undefined,
	resolved: JsonObject | undefined,
	schema: ObjectField,
	pathPrefix: string,
): FieldProvenance[] {
	const provenance: FieldProvenance[] = [];
	for (const [fieldName, field] of Object.entries(schema.fields)) {
		const path = `${pathPrefix}.${fieldName}`;
		const authoredValue = authored?.[fieldName];
		const resolvedValue = resolved?.[fieldName];
		if (authoredValue !== undefined) {
			provenance.push({
				path,
				source: "authored",
				value: structuredClone(authoredValue),
			});
		} else if (resolvedValue !== undefined) {
			provenance.push({
				path,
				source: "default",
				value: structuredClone(resolvedValue),
			});
		}

		if (field.kind === "object") {
			provenance.push(
				...collectFieldProvenance(
					isJsonObject(authoredValue) ? authoredValue : undefined,
					isJsonObject(resolvedValue) ? resolvedValue : undefined,
					field,
					path,
				),
			);
			continue;
		}

		if (field.kind === "array" && field.element.kind === "object") {
			const authoredArray = Array.isArray(authoredValue) ? authoredValue : [];
			const resolvedArray = Array.isArray(resolvedValue) ? resolvedValue : [];
			const length = Math.max(authoredArray.length, resolvedArray.length);
			for (let index = 0; index < length; index += 1) {
				provenance.push(
					...collectFieldProvenance(
						isJsonObject(authoredArray[index]) ? (authoredArray[index] as JsonObject) : undefined,
						isJsonObject(resolvedArray[index]) ? (resolvedArray[index] as JsonObject) : undefined,
						field.element,
						`${path}[${index}]`,
					),
				);
			}
		}
	}
	return provenance;
}

