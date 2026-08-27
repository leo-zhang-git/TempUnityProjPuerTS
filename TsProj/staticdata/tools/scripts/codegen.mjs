import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const staticDataRoot = resolve(import.meta.dirname, "..", "..");
const tableRoot = join(staticDataRoot, "data");
const generatedRoot = join(staticDataRoot, "generated");
const generatedTableRoot = join(generatedRoot, "tables");
const coreFileSuffix = ".json";
const sidecarFileSuffix = ".sidecar.json";

const checkMode = process.argv.includes("--check");

const tables = readdirSync(tableRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(tableRoot, entry.name, "schema.ts")))
	.map((entry) => entry.name)
	.sort((left, right) => left.localeCompare(right));

const drifts = [];
const tableEntries = [];

// 收集每张表的 logical table 名，用于生成 `generated/ref-id-map.ts`。
const refIdEntries = [];

for (const tableName of tables) {
	const tableDir = join(tableRoot, tableName);
	const schemaPath = join(tableDir, "schema.ts");
	if (!existsSync(schemaPath)) {
		throw new Error(`Missing schema.ts for table ${tableName}`);
	}
	const schemaSource = readFileSync(schemaPath, "utf8");
	const customPath = join(tableDir, "info.custom.ts");
	const hasCustom = existsSync(customPath);
	const schemaInfo = extractSchemaInfo(tableName, schemaSource);
	const literalIds = schemaInfo.idKind === "literal" ? readLiteralIds(tableName) : [];
	tableEntries.push({ tableName, customPath, hasCustom, schemaInfo });
	refIdEntries.push({
		tableName,
		logicalTable: schemaInfo.logicalTable,
		idKind: schemaInfo.idKind,
		literalIds,
	});
}

mkdirSync(generatedRoot, { recursive: true });
const manifestPath = join(generatedRoot, "table-manifest.ts");
reconcileFile(manifestPath, createManifestSource(tables), { allowMissing: false });

const refIdMapPath = join(generatedRoot, "ref-id-map.ts");
reconcileFile(refIdMapPath, createRefIdMapSource(refIdEntries), { allowMissing: false });

const codegenHelpers = await loadCodegenHelpers();

for (const entry of tableEntries) {
	const schema = codegenHelpers.registry.tables[entry.schemaInfo.logicalTable];
	if (!schema) {
		throw new Error(`Missing schema registry entry for table ${entry.schemaInfo.logicalTable}`);
	}
	const expectedInfo = createInfoSource(entry.tableName, entry.schemaInfo, schema, entry.hasCustom);
	const generatedTableDir = join(generatedTableRoot, entry.tableName);
	mkdirSync(generatedTableDir, { recursive: true });
	const infoPath = join(generatedTableDir, "info.ts");
	reconcileFile(infoPath, expectedInfo, { allowMissing: false });
	if (entry.hasCustom) {
		reconcileFile(join(generatedTableDir, "info.custom.ts"), createGeneratedCustomSource(readFileSync(entry.customPath, "utf8")), {
			allowMissing: false,
		});
	} else {
		removeStaleGeneratedCustom(join(generatedTableDir, "info.custom.ts"));
	}
}
removeStaleGeneratedTableDirs(tables);

const descriptionAudit = codegenHelpers.auditSchemaDescriptions(codegenHelpers.registry);
for (const line of codegenHelpers.formatSchemaDescriptionAuditWarnings(descriptionAudit)) {
	console.warn(line);
}

if (checkMode) {
	if (drifts.length > 0) {
		console.error("codegen drift detected:");
		for (const path of drifts) {
			console.error(`  - ${relative(staticDataRoot, path)}`);
		}
		console.error("Run `npm run codegen` to regenerate.");
		process.exit(1);
	}
	console.log(JSON.stringify({ ok: true, check: true, tables }, null, 2));
} else {
	console.log(JSON.stringify({ ok: true, tables }, null, 2));
}

function reconcileFile(path, expected, { allowMissing }) {
	const exists = existsSync(path);
	if (!exists && allowMissing) {
		if (checkMode) {
			return;
		}
		writeFileAtomic(path, expected);
		return;
	}
	if (!exists) {
		if (checkMode) {
			drifts.push(path);
			return;
		}
		writeFileAtomic(path, expected);
		return;
	}
	if (allowMissing) {
		return;
	}
	const actual = readFileSync(path, "utf8");
	if (actual === expected) {
		return;
	}
	if (checkMode) {
		drifts.push(path);
		return;
	}
	writeFileAtomic(path, expected);
}

function writeFileAtomic(path, contents) {
	mkdirSync(resolve(path, ".."), { recursive: true });
	const tempPath = join(resolve(path, ".."), `.tmp-${basename(path)}-${process.pid}-${Date.now()}`);
	try {
		writeFileSync(tempPath, contents, "utf8");
		renameSync(tempPath, path);
	} finally {
		if (existsSync(tempPath)) {
			rmSync(tempPath, { force: true });
		}
	}
}

function removeStaleGeneratedTableDirs(tableNames) {
	if (!existsSync(generatedTableRoot)) {
		return;
	}
	const liveTables = new Set(tableNames);
	for (const entry of readdirSync(generatedTableRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || liveTables.has(entry.name)) {
			continue;
		}
		const path = join(generatedTableRoot, entry.name);
		if (checkMode) {
			drifts.push(path);
			continue;
		}
		rmSync(path, { recursive: true, force: true });
	}
}

function removeStaleGeneratedCustom(path) {
	if (!existsSync(path)) {
		return;
	}
	if (checkMode) {
		drifts.push(path);
		return;
	}
	rmSync(path, { force: true });
}

async function loadCodegenHelpers() {
	const [schemasModule, auditModule] = await Promise.all([
		import(new URL("../src/schemas.js", import.meta.url).href),
		import(new URL("../src/core/schema-description-audit.js", import.meta.url).href),
	]);
	return {
		registry: schemasModule.registry,
		auditSchemaDescriptions: auditModule.auditSchemaDescriptions,
		formatSchemaDescriptionAuditWarnings: auditModule.formatSchemaDescriptionAuditWarnings,
	};
}

function createManifestSource(tableNames) {
	return (
		`// This file is generated by tools/scripts/codegen.mjs.\n` +
		`// Do not edit by hand.\n\n` +
		`export const staticDataTables = ${JSON.stringify(tableNames, null, 2)} as const;\n\n` +
		`export type StaticDataTableName = typeof staticDataTables[number];\n`
	);
}

function createInfoSource(tableName, schemaInfo, schema, hasCustom) {
	const { schemaExportName, logicalTable } = schemaInfo;
	const baseName = displayNameForTable(logicalTable);
	const dataTypeName = `${baseName}DataType`;
	const valueName = toCamelCase(baseName);
	const pluralName = pluralize(baseName);
	const aliasName = aliasNameForTable(logicalTable);
	const idType = aliasName;
	const enumAliases = collectTopLevelEnumAliases(baseName, schema);
	const dataType = dataTypeSource(dataTypeName, schemaExportName, schema, enumAliases);
	const categoryTypes = categoryTypesSource(baseName, dataTypeName, schema);

	const customTail = hasCustom ? `export * from "./info.custom.js";\n` : "";
	const customComment = hasCustom
		? `// 业务特异 helper 写在同目录 info.custom.ts，由文末 \`export *\` 拼接。\n`
		: `// 如需业务特异 helper，新建同目录 info.custom.ts 并重跑 \`npm run codegen\`。\n`;
	const accessorDefinition = formatAccessorDefinition(baseName);
	const accessorCall = formatAccessorCall(valueName, baseName, schemaExportName, tableName);
	const dataUncheckSignature = formatDataUncheckSignature(baseName, idType);
	const legacyDataAccessorFunction = schemaInfo.legacyDataAccessor
		? `${dataUncheckSignature}\n\treturn require${baseName}(id, options);\n}\n`
		: "";

	return finalizeGeneratedSource(
		`// This file is generated by tools/scripts/codegen.mjs. Do not edit by hand.\n` +
			customComment +
			`\n` +
			`import { createSchemaAccessor, type TableAccessorOptions } from "../../../data/framework/table-accessor.js";\n` +
			`import type { InferRow } from "../../../data/framework/tool-schema.js";\n` +
			`import type { RefIdMap } from "../../ref-id-map.js";\n` +
			`import { ${schemaExportName} } from "../../../data/${tableName}/schema.js";\n\n` +
			`export type ${aliasName} = RefIdMap["${logicalTable}"];\n\n` +
			enumAliases.map((entry) => `export type ${entry.typeName} = ${literalUnionSource(entry.values)};\n`).join("") +
			(enumAliases.length > 0 ? "\n" : "") +
			dataType +
			categoryTypes +
			`type ${baseName}Accessor = {\n` +
			`\treadonly loadRows: (options?: TableAccessorOptions) => readonly ${dataTypeName}[];\n` +
			`\treadonly list: (options?: TableAccessorOptions) => readonly ${dataTypeName}[];\n` +
			`\treadonly get: (id: ${idType} | string, options?: TableAccessorOptions) => ${dataTypeName} | undefined;\n` +
			`\treadonly require: (id: ${idType} | string, options?: TableAccessorOptions) => ${dataTypeName};\n` +
			`};\n\n` +
			accessorDefinition +
			`\n` +
			accessorCall +
			`\n` +
			`export function load${baseName}Rows(options?: TableAccessorOptions): readonly ${dataTypeName}[] {\n` +
			`\treturn ${valueName}Accessor.loadRows(options);\n` +
			`}\n\n` +
			`export function list${pluralName}(options?: TableAccessorOptions): readonly ${dataTypeName}[] {\n` +
			`\treturn ${valueName}Accessor.list(options);\n` +
			`}\n\n` +
			`export function get${baseName}(id: ${idType} | string, options?: TableAccessorOptions): ${dataTypeName} | undefined {\n` +
			`\treturn ${valueName}Accessor.get(id, options);\n` +
			`}\n\n` +
			`export function require${baseName}(id: ${idType} | string, options?: TableAccessorOptions): ${dataTypeName} {\n` +
			`\treturn ${valueName}Accessor.require(id, options);\n` +
			`}\n\n` +
			legacyDataAccessorFunction +
			(customTail ? `\n${customTail}` : ""),
	);
}

function collectTopLevelEnumAliases(baseName, schema) {
	const definitionsByName = new Map();
	const addFields = (fields) => {
		for (const [name, definition] of Object.entries(fields ?? {})) {
			const definitions = definitionsByName.get(name) ?? [];
			definitions.push(definition);
			definitionsByName.set(name, definitions);
		}
	};
	addFields(schema.base?.fields);
	for (const category of Object.values(schema.categories ?? {})) addFields(category.fields);

	const aliases = [];
	for (const [name, definitions] of definitionsByName) {
		if (definitions.length === 0 || definitions.some((definition) => definition.kind !== "enum" || !Array.isArray(definition.values))) {
			continue;
		}
		const values = [...new Set(definitions.flatMap((definition) => definition.values))];
		aliases.push({ name, typeName: `${baseName}${toPascalCase(name)}Enum`, values });
	}
	return aliases.sort((left, right) => left.name.localeCompare(right.name));
}

function categoryTypesSource(baseName, dataTypeName, schema) {
	if (typeof schema.categoryKey !== "string") {
		return "";
	}
	const categories = Object.keys(schema.categories ?? {}).sort((left, right) => left.localeCompare(right));
	if (categories.length === 0) {
		return "";
	}
	return `${categories
		.map((category) => {
			const typeName = `${categoryTypePrefix(category)}${baseName}Type`;
			return `export type ${typeName} = Extract<${dataTypeName}, { readonly ${schema.categoryKey}: ${JSON.stringify(category)} }>;\n`;
		})
		.join("")}\n`;
}

function dataTypeSource(dataTypeName, schemaExportName, schema, enumAliases) {
	const documentedFields = collectReferencedFields(schema);
	const enumDataTypeName = enumAliases.length > 0 ? `${dataTypeName}WithEnumAliases` : undefined;
	const enumOverride = enumDataTypeName
		? `type ${enumDataTypeName}<T> = T extends unknown ? {\n` +
			`\t[K in keyof T]: ${enumAliases.map((entry) => `K extends ${JSON.stringify(entry.name)} ? ${entry.typeName}`).join(" : ")} : T[K];\n` +
			`} : never;\n\n`
		: "";
	const inferredType = enumDataTypeName
		? `${enumDataTypeName}<InferRow<typeof ${schemaExportName}>>`
		: `InferRow<typeof ${schemaExportName}>`;
	if (documentedFields.length === 0) return `${enumOverride}export type ${dataTypeName} = ${inferredType};\n`;
	const documentation = documentedFields
		.map(({ name, description, targets }) => renderReferencedFieldDocumentation(name, description, targets))
		.join("");
	return `${enumOverride}export type ${dataTypeName} = ${inferredType} & {\n${documentation}};\n`;
}

function collectReferencedFields(schema) {
	const fields = new Map();
	const addFields = (definitions) => {
		for (const [name, definition] of Object.entries(definitions ?? {})) {
			const targets = collectReferenceTargets(definition);
			if (targets.length === 0) continue;
			const current = fields.get(name);
			if (current) {
				for (const target of targets) {
					if (!current.targets.includes(target)) current.targets.push(target);
				}
				continue;
			}
			fields.set(name, { name, description: definition.description, targets });
		}
	};
	addFields(schema.base?.fields);
	for (const category of Object.values(schema.categories ?? {})) addFields(category.fields);
	return [...fields.values()];
}

function collectReferenceTargets(definition) {
	if (!definition || typeof definition !== "object") return [];
	if (definition.kind === "ref") return [definition.table];
	if (definition.kind === "array" || definition.kind === "map") return collectReferenceTargets(definition.element ?? definition.value);
	if (definition.kind !== "union") return [];
	return [...new Set(definition.variants.flatMap(collectReferenceTargets))];
}

function renderReferencedFieldDocumentation(name, description, targets) {
	const comment = [String(description ?? "").replace(/\*\//gu, "* /"), `@refer ${targets.join(", ")}`].filter(Boolean).join(" ");
	if (!comment.includes("\n")) {
		return `\t/** ${comment} */\n\treadonly ${formatPropertyName(name)}?: unknown;\n`;
	}
	const lines = comment.split(/\r?\n/u).map((line) => `\t * ${line}`);
	return `\t/**\n${lines.join("\n")}\n\t */\n\treadonly ${formatPropertyName(name)}?: unknown;\n`;
}

function createGeneratedCustomSource(source) {
	return finalizeGeneratedSource(
		source
			.replaceAll("../framework/", "../../../data/framework/")
			.replaceAll("../../../generated/", "../../")
			.replaceAll("../../generated/", "../../"),
	);
}

function formatPropertyName(value) {
	return /^[A-Za-z_$][\w$]*$/u.test(value) ? value : JSON.stringify(value);
}

function finalizeGeneratedSource(source) {
	return `${source.replace(/\n+$/u, "")}\n`;
}

function extractSchemaInfo(tableName, schemaSource) {
	const schemaMatch = /export const (?<name>[a-zA-Z0-9_]+Schema)\s*=\s*defineTable\(\s*\{/u.exec(schemaSource);
	if (!schemaMatch?.groups?.name) {
		throw new Error(`Cannot infer schema export for table ${tableName}`);
	}
	const tableMatch = /defineTable\(\s*\{\s*table:\s*"(?<table>[^"]+)"/u.exec(schemaSource);
	const uniqueKeyMatch = /uniqueKey:\s*"(?<key>[a-zA-Z0-9_]+)"/u.exec(schemaSource);
	if (!uniqueKeyMatch?.groups?.key) {
		throw new Error(`Cannot infer uniqueKey for table ${tableName}`);
	}
	const idKindMatch = /idKind:\s*"(?<kind>literal)"/u.exec(schemaSource);
	const legacyDataAccessorMatch = /legacyDataAccessor:\s*false/u.exec(schemaSource);
	return {
		schemaExportName: schemaMatch.groups.name,
		logicalTable: tableMatch?.groups?.table ?? tableName,
		uniqueKey: uniqueKeyMatch.groups.key,
		idKind: idKindMatch?.groups?.kind === "literal" ? "literal" : "brand",
		legacyDataAccessor: legacyDataAccessorMatch === null,
	};
}

function aliasNameForTable(logicalTable) {
	return `${toPascalCase(logicalTable)}Id`;
}

function displayNameForTable(logicalTable) {
	return toPascalCase(logicalTable);
}

function readLiteralIds(tableName) {
	const tableDir = join(tableRoot, tableName);
	const ids = new Set();
	for (const entry of readdirSync(tableDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(coreFileSuffix) || entry.name.endsWith(sidecarFileSuffix) || entry.name.startsWith(".")) {
			continue;
		}
		const filePath = join(tableDir, entry.name);
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(`Cannot parse literal ids from ${relative(staticDataRoot, filePath)}`);
		}
		for (const id of Object.keys(parsed)) {
			ids.add(id);
		}
	}
	return [...ids].sort((left, right) => left.localeCompare(right));
}

function literalUnionSource(values) {
	if (values.length === 0) {
		return "never";
	}
	return values.map((value) => JSON.stringify(value)).join(" | ");
}

function createRefIdMapSource(entries) {
	const sorted = [...entries].sort((left, right) => left.logicalTable.localeCompare(right.logicalTable));
	const mapLines = sorted
		.map((entry) => {
			if (entry.idKind === "literal") {
				return `  "${entry.logicalTable}": ${literalUnionSource(entry.literalIds)};`;
			}
			return `  "${entry.logicalTable}": RefId<"${entry.logicalTable}">;`;
		})
		.join("\n");
	const aliasLines = sorted
		.map((entry) => {
			const alias = aliasNameForTable(entry.logicalTable);
			return `export type ${alias} = RefIdMap["${entry.logicalTable}"];`;
		})
		.join("\n");

	return (
		`// This file is generated by tools/scripts/codegen.mjs. Do not edit by hand.\n` +
		`// 维护各表主键的类型映射：brand 表用 RefId<"table">，literal-union 表由 authoring 顶层 key 生成。\n` +
		`\n` +
		`import type { RefId } from "../data/framework/common-types.js";\n\n` +
		`interface GeneratedRefIdMap {\n` +
		mapLines +
		`\n` +
		`}\n` +
		`\n` +
		`declare module "../data/framework/tool-schema.js" {\n` +
		`  interface RefIdMap extends GeneratedRefIdMap {}\n` +
		`}\n` +
		`\n` +
		`export interface RefIdMap extends GeneratedRefIdMap {}\n` +
		`\n` +
		aliasLines +
		`\n`
	);
}

function formatAccessorCall(valueName, baseName, schemaExportName, tableName) {
	const singleLine = `const ${valueName}Accessor = create${baseName}Accessor(${schemaExportName}, (id) => \`missing ${tableName}: \${id}\`);`;
	if (singleLine.length <= 140) {
		return `${singleLine}\n`;
	}
	return (
		`const ${valueName}Accessor = create${baseName}Accessor(\n` +
		`\t${schemaExportName},\n` +
		`\t(id) => \`missing ${tableName}: \${id}\`,\n` +
		`);\n`
	);
}

function formatAccessorDefinition(baseName) {
	const singleLine = `const create${baseName}Accessor = createSchemaAccessor as unknown as (schema: unknown, missingMessage: (id: string) => string) => ${baseName}Accessor;`;
	if (singleLine.length <= 140) {
		return `${singleLine}`;
	}
	return (
		`const create${baseName}Accessor = createSchemaAccessor as unknown as (\n` +
		`\tschema: unknown,\n` +
		`\tmissingMessage: (id: string) => string,\n` +
		`) => ${baseName}Accessor;`
	);
}

function formatDataUncheckSignature(baseName, idType) {
	const singleLine = `export function get${baseName}DataUncheck(id: ${idType} | string, options?: TableAccessorOptions): ${baseName}DataType {`;
	if (singleLine.length <= 140) {
		return `${singleLine}`;
	}
	return (
		`export function get${baseName}DataUncheck(\n` +
		`\tid: ${idType} | string,\n` +
		`\toptions?: TableAccessorOptions,\n` +
		`): ${baseName}DataType {`
	);
}

function toPascalCase(value) {
	return value
		.split(/[^a-zA-Z0-9]+/u)
		.filter(Boolean)
		.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
		.join("");
}

function toCamelCase(value) {
	const pascal = toPascalCase(value);
	return `${pascal[0]?.toLowerCase() ?? ""}${pascal.slice(1)}`;
}

function pluralize(value) {
	return value.endsWith("s") ? value : `${value}s`;
}

function categoryTypePrefix(category) {
	return toPascalCase(singularCategoryName(category));
}

function singularCategoryName(category) {
	if (category.endsWith("ies") && category.length > 3) {
		return `${category.slice(0, -3)}y`;
	}
	if (category.endsWith("s") && !category.endsWith("ss")) {
		return category.slice(0, -1);
	}
	return category;
}
