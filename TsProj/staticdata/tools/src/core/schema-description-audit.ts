import type { FieldDefinition, ObjectField, SchemaRegistry, SidecarRootField } from "./schema.js";

export interface SchemaDescriptionAuditIssue {
	path: string;
	kind: "table" | "category" | "sidecar" | "ref" | "enum" | "enumFromTable";
	message: string;
}

export interface SchemaDescriptionAuditReport {
	ok: boolean;
	issues: SchemaDescriptionAuditIssue[];
	tableCount: number;
}

export function auditSchemaDescriptions(registry: SchemaRegistry): SchemaDescriptionAuditReport {
	const issues: SchemaDescriptionAuditIssue[] = [];
	const tableNames = Object.keys(registry.tables).sort(compareText);

	for (const tableName of tableNames) {
		const table = registry.tables[tableName];
		if (!table) {
			continue;
		}
		if (!table.metadata?.description) {
			issues.push(issue(tableName, "table", "Missing table metadata.description"));
		}
		if (!table.metadata?.displayName) {
			issues.push(issue(tableName, "table", "Missing table metadata.displayName"));
		}
		if (!table.metadata?.icon) {
			issues.push(issue(tableName, "table", "Missing table metadata.icon"));
		}
		if (!table.metadata?.idConvention) {
			issues.push(issue(tableName, "table", "Missing table metadata.idConvention"));
		}
		for (const category of Object.keys(table.categories).sort(compareText)) {
			if (!table.categoryMetadata?.[category]?.description) {
				issues.push(issue(`${tableName}.${category}`, "category", "Missing category metadata.description"));
			}
			if (!table.categoryMetadata?.[category]?.displayName) {
				issues.push(issue(`${tableName}.${category}`, "category", "Missing category metadata.displayName"));
			}
			if (!table.categoryMetadata?.[category]?.icon) {
				issues.push(issue(`${tableName}.${category}`, "category", "Missing category metadata.icon"));
			}
			const categorySchema = table.categories[category];
			if (categorySchema) {
				auditObjectField(categorySchema, `${tableName}.${category}`, issues);
			}
		}
		for (const sidecarName of Object.keys(table.sidecars ?? {}).sort(compareText)) {
			const sidecar = table.sidecars?.[sidecarName];
			if (!sidecar) {
				continue;
			}
			if (!sidecar.metadata?.description) {
				issues.push(issue(`${tableName}.sidecar.${sidecarName}`, "sidecar", "Missing sidecar metadata.description"));
			}
			auditSidecarField(sidecar.schema, `${tableName}.sidecar.${sidecarName}`, issues);
		}
	}

	return {
		ok: issues.length === 0,
		issues,
		tableCount: tableNames.length,
	};
}

export function formatSchemaDescriptionAuditWarnings(report: SchemaDescriptionAuditReport): string[] {
	if (report.issues.length === 0) {
		return [];
	}
	const lines = [`schema description audit found ${report.issues.length} missing display metadata/description/idConvention entries:`];
	for (const entry of report.issues) {
		lines.push(`  - ${entry.path}: ${entry.message}`);
	}
	return lines;
}

function auditSidecarField(field: SidecarRootField, path: string, issues: SchemaDescriptionAuditIssue[]): void {
	auditField(field, path, issues);
}

function auditObjectField(field: ObjectField, path: string, issues: SchemaDescriptionAuditIssue[]): void {
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		auditField(childField, `${path}.${fieldName}`, issues);
	}
}

function auditField(field: FieldDefinition, path: string, issues: SchemaDescriptionAuditIssue[]): void {
	switch (field.kind) {
		case "ref":
			if (!field.description) {
				issues.push(issue(path, "ref", `Missing description for ref(${field.table})`));
			}
			return;
		case "enum":
			if (!field.description) {
				issues.push(
					issue(
						path,
						field.keyspace ? "enumFromTable" : "enum",
						field.keyspace ? `Missing description for enumFromTable(${field.keyspace.table})` : "Missing description for enum",
					),
				);
			}
			return;
		case "object":
			auditObjectField(field, path, issues);
			return;
		case "array":
			auditField(field.element, `${path}[]`, issues);
			return;
		case "map":
			auditField(field.value, `${path}{}`, issues);
			return;
		case "union":
			for (const [index, variant] of field.variants.entries()) {
				auditField(variant, `${path}|${index}`, issues);
			}
			return;
		default:
			return;
	}
}

function issue(path: string, kind: SchemaDescriptionAuditIssue["kind"], message: string): SchemaDescriptionAuditIssue {
	return { path, kind, message };
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right);
}

