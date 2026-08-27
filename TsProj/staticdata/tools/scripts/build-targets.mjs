import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const staticDataRoot = resolve(import.meta.dirname, "..", "..");
const tableRoot = join(staticDataRoot, "data");
const sourceGeneratedRoot = join(staticDataRoot, "generated");
const targetsRoot = join(staticDataRoot, "targets");
const sides = ["client", "server"];

const sideArg = readArg("--side");
const selectedSides = sideArg === undefined ? sides : [assertSide(sideArg)];
const outputStats = { written: 0, unchanged: 0, removed: 0 };

const tables = readdirSync(tableRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && existsSync(join(tableRoot, entry.name, "schema.ts")))
	.map((entry) => entry.name)
	.sort((left, right) => left.localeCompare(right));

const targetHelpers = await loadTargetHelpers();

for (const side of selectedSides) {
	const sideRoot = join(targetsRoot, side);
	const writtenFiles = new Set();
	mkdirSync(sideRoot, { recursive: true });
	writeTargetCore(sideRoot, writtenFiles);
	writeGeneratedTypes(sideRoot, writtenFiles);
	const targetRowsByTable = new Map();
	const tableTargets = [];

	for (const tableName of tables) {
		const tableDir = join(tableRoot, tableName);
		const schemaPath = join(tableDir, "schema.ts");
		if (!existsSync(schemaPath)) {
			throw new Error(`Missing schema.ts for table ${tableName}`);
		}

		const schemaSource = readFileSync(schemaPath, "utf8");
		const schemaInfo = extractSchemaInfo(tableName, schemaSource);
		const schema = targetHelpers.registry.tables[schemaInfo.logicalTable];
		if (!schema) {
			throw new Error(`Missing schema registry entry for table ${schemaInfo.logicalTable}`);
		}
		if (!targetHelpers.isTableExportedToTarget(schema, side)) {
			continue;
		}
		const customFiles = resolveCustomFiles(tableDir, side);
		const rows = await loadSourceRows(tableName, schemaInfo);
		const prunedRows = rows.map((row) => targetHelpers.pruneRowForTarget(row, schema, inferRowCategory(row, schemaInfo), side));
		if (prunedRows.some((row) => row === undefined)) {
			throw new Error(`Table ${schemaInfo.logicalTable} was unexpectedly pruned while building ${side} target`);
		}
		targetRowsByTable.set(schemaInfo.logicalTable, prunedRows);
		tableTargets.push({ tableName, schemaInfo, schema, rows: prunedRows, customFiles });
	}

	const refIssues = targetHelpers.validateTargetRefs(targetRowsByTable, targetHelpers.registry, side);
	if (refIssues.length > 0) {
		throw new Error(`Target ${side} ref validation failed:\n${refIssues.map((issue) => `- ${issue.message}`).join("\n")}`);
	}

	for (const tableTarget of tableTargets) {
		writeTableTarget(sideRoot, tableTarget, side, targetHelpers, writtenFiles);
	}
	removeStaleTargets(sideRoot, writtenFiles);
}

console.log(JSON.stringify({ ok: true, sides: selectedSides, tables, files: outputStats }, null, 2));

async function loadTargetHelpers() {
	const [schemasModule, pruneModule] = await Promise.all([
		import(new URL("../src/schemas.js", import.meta.url).href),
		import(new URL("../src/core/target-prune.js", import.meta.url).href),
	]);
	return {
		registry: schemasModule.registry,
		isTableExportedToTarget: pruneModule.isTableExportedToTarget,
		pruneRowForTarget: pruneModule.pruneRowForTarget,
		pruneTableSchemaForTarget: pruneModule.pruneTableSchemaForTarget,
		validateTargetRefs: pruneModule.validateTargetRefs,
	};
}

function writeTargetCore(sideRoot, writtenFiles) {
	const frameworkRoot = join(sideRoot, "data", "framework");
	mkdirSync(frameworkRoot, { recursive: true });
	writeGeneratedFile(join(frameworkRoot, "table-accessor.ts"), createTargetAccessorSource(), writtenFiles);
	copySourceFile(join(staticDataRoot, "data", "framework", "common-types.ts"), join(frameworkRoot, "common-types.ts"), writtenFiles);
	copySourceFile(
		join(staticDataRoot, "data", "framework", "runtime-template.ts"),
		join(frameworkRoot, "runtime-template.ts"),
		writtenFiles,
	);
	writeGeneratedFile(join(frameworkRoot, "tool-schema.ts"), createTargetToolSchemaSource(), writtenFiles);
	copySourceFile(
		join(staticDataRoot, "data", "framework", "tool-schema-fragments.ts"),
		join(frameworkRoot, "tool-schema-fragments.ts"),
		writtenFiles,
	);
}

function writeGeneratedTypes(sideRoot, writtenFiles) {
	const generatedRoot = join(sideRoot, "data", "generated");
	mkdirSync(generatedRoot, { recursive: true });
	const source = readFileSync(join(sourceGeneratedRoot, "ref-id-map.ts"), "utf8").replaceAll("../data/framework/", "../framework/");
	writeGeneratedFile(join(generatedRoot, "ref-id-map.ts"), source, writtenFiles);
}

function writeTableTarget(sideRoot, tableTarget, side, helpers, writtenFiles) {
	const { tableName, schemaInfo, schema, rows, customFiles } = tableTarget;
	const targetTableDir = join(sideRoot, "data", "tables", tableName);
	const prunedSchema = helpers.pruneTableSchemaForTarget(schema, side);
	if (prunedSchema === undefined) {
		throw new Error(`Table ${schemaInfo.logicalTable} is not exported to ${side}`);
	}
	mkdirSync(targetTableDir, { recursive: true });
	writeGeneratedFile(join(targetTableDir, "rows.json"), `${JSON.stringify(rows, null, 2)}\n`, writtenFiles);
	writeGeneratedFile(join(targetTableDir, "schema.ts"), createTargetSchemaSource(schemaInfo.schemaExportName, prunedSchema), writtenFiles);
	for (const customFile of customFiles) {
		copyCustomFile(customFile.sourcePath, join(targetTableDir, customFile.fileName), writtenFiles);
	}
	writeGeneratedFile(
		join(targetTableDir, "info.ts"),
		createTargetInfoSource(tableName, schemaInfo, prunedSchema, customFiles, side),
		writtenFiles,
	);
}

async function loadSourceRows(tableName, schemaInfo) {
	const infoModule = await import(new URL(`../../generated/tables/${tableName}/info.js`, import.meta.url).href);
	const loadRows = infoModule[`load${displayNameForTable(schemaInfo.logicalTable)}Rows`];
	if (typeof loadRows !== "function") {
		throw new Error(`Cannot find load rows function for table ${tableName}`);
	}
	return loadRows();
}

function resolveCustomFiles(tableDir, side) {
	const candidates = ["info.custom.ts", `info.custom.${side}.ts`];
	return candidates.map((fileName) => ({ fileName, sourcePath: join(tableDir, fileName) })).filter((entry) => existsSync(entry.sourcePath));
}

function createTargetInfoSource(tableName, schemaInfo, schema, customFiles, side) {
	const { schemaExportName, logicalTable } = schemaInfo;
	const baseName = displayNameForTable(logicalTable);
	const dataTypeName = `${baseName}DataType`;
	const valueName = toCamelCase(baseName);
	const pluralName = pluralize(baseName);
	const aliasName = aliasNameForTable(logicalTable);
	const customTail = customFiles.map((entry) => `export * from "./${entry.fileName.replace(/\.ts$/u, ".js")}";\n`).join("");
	const customComment =
		customFiles.length > 0
			? `// Target re-exports table-specific helpers; pruned row types make helper conflicts fail at typecheck.\n`
			: `// Target info uses generated static JSON rows and never reads from the filesystem.\n`;
	const dataUncheckSignature = formatDataUncheckSignature(baseName, aliasName);
	const categoryTypes = categoryTypesSource(baseName, dataTypeName, schemaInfo, schema);
	const legacyDataAccessorFunction = schemaInfo.legacyDataAccessor
		? `${dataUncheckSignature}\n\treturn require${baseName}(id, options);\n}\n`
		: "";
	return finalizeGeneratedSource(
		`// This file is generated by tools/scripts/build-targets.mjs. Do not edit by hand.\n` +
			customComment +
			`\n` +
			`import { createStaticTableAccessor, type TargetTableAccessorOptions } from "../../framework/table-accessor.js";\n` +
			`import type { InferRow } from "../../framework/tool-schema.js";\n` +
			`import type { RefIdMap } from "../../generated/ref-id-map.js";\n` +
			`import rows from "./rows.json"${side === "server" ? ' with { type: "json" }' : ""};\n` +
			`import { ${schemaExportName} } from "./schema.js";\n\n` +
			`export type ${aliasName} = RefIdMap["${logicalTable}"];\n\n` +
			`export type ${dataTypeName} = InferRow<typeof ${schemaExportName}>;\n` +
			categoryTypes +
			`export type TableAccessorOptions = TargetTableAccessorOptions;\n\n` +
			`const ${valueName}Accessor = createStaticTableAccessor<${dataTypeName}, ${aliasName} | string>(\n` +
			`\trows as unknown as readonly ${dataTypeName}[],\n` +
			`\t(row) => String(row.${schemaInfo.uniqueKey}),\n` +
			`\t(id) => \`missing ${tableName}: \${id}\`,\n` +
			`);\n\n` +
			`export function load${baseName}Rows(_options?: TableAccessorOptions): readonly ${dataTypeName}[] {\n` +
			`\treturn ${valueName}Accessor.loadRows();\n` +
			`}\n\n` +
			`export function list${pluralName}(_options?: TableAccessorOptions): readonly ${dataTypeName}[] {\n` +
			`\treturn ${valueName}Accessor.list();\n` +
			`}\n\n` +
			`export function get${baseName}(id: ${aliasName} | string, _options?: TableAccessorOptions): ${dataTypeName} | undefined {\n` +
			`\treturn ${valueName}Accessor.get(id);\n` +
			`}\n\n` +
			`export function require${baseName}(id: ${aliasName} | string, _options?: TableAccessorOptions): ${dataTypeName} {\n` +
			`\treturn ${valueName}Accessor.require(id);\n` +
			`}\n\n` +
			`export function replace${baseName}RowsForDebug(rows: readonly ${dataTypeName}[]): void {\n` +
			`\t${valueName}Accessor.replaceRows(rows);\n` +
			`}\n\n` +
			legacyDataAccessorFunction +
			(customTail ? `\n${customTail}` : ""),
	);
}

function categoryTypesSource(baseName, dataTypeName, schemaInfo, schema) {
	if (schemaInfo.categoryKey === undefined) {
		return "";
	}
	const categories = Object.keys(schema.categories ?? {}).sort((left, right) => left.localeCompare(right));
	if (categories.length === 0) {
		return "";
	}
	return `${categories
		.map((category) => {
			const typeName = `${categoryTypePrefix(category)}${baseName}Type`;
			return `export type ${typeName} = Extract<${dataTypeName}, { readonly ${schemaInfo.categoryKey}: ${JSON.stringify(category)} }>;\n`;
		})
		.join("")}\n`;
}

function finalizeGeneratedSource(source) {
	return `${source.replace(/\n+$/u, "")}\n`;
}

function createTargetSchemaSource(schemaExportName, schema) {
	return (
		`// This file is generated by tools/scripts/build-targets.mjs. Do not edit by hand.\n` +
		`// Target schema is runtime-pruned for this side; edit the source schema instead.\n\n` +
		`import { defineTable } from "../../framework/tool-schema.js";\n\n` +
		`export const ${schemaExportName} = defineTable(${JSON.stringify(schema, null, "\t")} as const);\n`
	);
}

function createTargetAccessorSource() {
	return (
		`// This file is generated by tools/scripts/build-targets.mjs. Do not edit by hand.\n` +
		`// Target accessors are Unity/Puerts-safe: pure in-memory rows, no Node APIs.\n\n` +
		`export interface TargetTableAccessorOptions {\n` +
		`\treadonly reload?: boolean;\n` +
		`\treadonly projectRootDir?: string;\n` +
		`\treadonly staticDataDir?: string;\n` +
		`\treadonly compiledDataDir?: string;\n` +
		`}\n\n` +
		`export type TableAccessorOptions = TargetTableAccessorOptions;\n\n` +
		`export interface StaticTableAccessor<TRecord, TId extends string = string> {\n` +
		`\treadonly loadRows: (options?: TargetTableAccessorOptions) => readonly TRecord[];\n` +
		`\treadonly list: (options?: TargetTableAccessorOptions) => readonly TRecord[];\n` +
		`\treadonly get: (id: TId, options?: TargetTableAccessorOptions) => TRecord | undefined;\n` +
		`\treadonly require: (id: TId, options?: TargetTableAccessorOptions) => TRecord;\n` +
		`\treadonly replaceRows: (rows: readonly TRecord[]) => void;\n` +
		`}\n\n` +
		`export function createStaticTableAccessor<TRecord, TId extends string = string>(\n` +
		`\trows: readonly TRecord[],\n` +
		`\tidOf: (row: TRecord) => string,\n` +
		`\tmissingMessage: (id: string) => string,\n` +
		`): StaticTableAccessor<TRecord, TId> {\n` +
		`\tlet activeRows = freezeRows(rows);\n` +
		`\tlet index = buildIndex(activeRows);\n\n` +
		`\tfunction loadRows(_options?: TargetTableAccessorOptions): readonly TRecord[] {\n` +
		`\t\treturn activeRows;\n` +
		`\t}\n\n` +
		`\tfunction get(id: TId, _options?: TargetTableAccessorOptions): TRecord | undefined {\n` +
		`\t\treturn index.get(String(id));\n` +
		`\t}\n\n` +
		`\tfunction requireRecord(id: TId, options?: TargetTableAccessorOptions): TRecord {\n` +
		`\t\tconst record = get(id, options);\n` +
		`\t\tif (record === undefined) {\n` +
		`\t\t\tthrow new Error(missingMessage(String(id)));\n` +
		`\t\t}\n` +
		`\t\treturn record;\n` +
		`\t}\n\n` +
		`\tfunction replaceRows(rows: readonly TRecord[]): void {\n` +
		`\t\tactiveRows = freezeRows(rows);\n` +
		`\t\tindex = buildIndex(activeRows);\n` +
		`\t}\n\n` +
		`\tfunction freezeRows(rows: readonly TRecord[]): readonly TRecord[] {\n` +
		`\t\treturn Object.freeze(rows.map((row) => Object.freeze({ ...(row as Record<string, unknown>) }) as TRecord));\n` +
		`\t}\n\n` +
		`\tfunction buildIndex(rows: readonly TRecord[]): Map<string, TRecord> {\n` +
		`\t\treturn new Map<string, TRecord>(rows.map((row) => [idOf(row), row]));\n` +
		`\t}\n\n` +
		`\treturn { loadRows, list: loadRows, get, require: requireRecord, replaceRows };\n` +
		`}\n`
	);
}

function createTargetToolSchemaSource() {
	return readFileSync(join(staticDataRoot, "data", "framework", "tool-schema.ts"), "utf8")
		.replace('import "../../generated/ref-id-map.js";', 'import "../generated/ref-id-map.js";')
		.replaceAll("`generated/ref-id-map.ts`", "`data/generated/ref-id-map.ts`")
		.replace("return structuredClone(value);", "return JSON.parse(JSON.stringify(value)) as T;");
}

function copySourceFile(from, to, writtenFiles) {
	mkdirSync(resolve(to, ".."), { recursive: true });
	writeGeneratedFile(to, readFileSync(from, "utf8"), writtenFiles);
}

function copyCustomFile(from, to, writtenFiles) {
	mkdirSync(resolve(to, ".."), { recursive: true });
	writeGeneratedFile(
		to,
		readFileSync(from, "utf8").replaceAll("../framework/", "../../framework/").replaceAll("../../../generated/", "../../generated/"),
		writtenFiles,
	);
}

function writeGeneratedFile(filePath, contents, writtenFiles) {
	mkdirSync(resolve(filePath, ".."), { recursive: true });
	const resolvedPath = resolve(filePath);
	writtenFiles.add(resolvedPath);
	if (existsSync(filePath) && readFileSync(filePath, "utf8") === contents) {
		outputStats.unchanged += 1;
		return;
	}
	writeFileAtomicSyncWithRetry(filePath, contents, "utf8");
	outputStats.written += 1;
}

function writeFileAtomicSyncWithRetry(filePath, contents, encoding) {
	const directory = resolve(filePath, "..");
	for (let attempt = 0; ; attempt += 1) {
		const tempPath = join(directory, `.tmp-${basename(filePath)}-${process.pid}-${Date.now()}-${attempt}`);
		try {
			writeFileSync(tempPath, contents, encoding);
			renameSync(tempPath, filePath);
			return;
		} catch (error) {
			if (existsSync(tempPath)) rmSync(tempPath, { force: true });
			if (!shouldRetryWrite(error) || attempt >= 5) throw error;
			sleepSync(25 * (attempt + 1));
		}
	}
}

function shouldRetryWrite(error) {
	return error?.code === "UNKNOWN" || error?.code === "EBUSY" || error?.code === "EPERM";
}

function sleepSync(ms) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		// Windows can briefly hold generated files after prior tool runs.
	}
}

function removeStaleTargets(root, writtenFiles) {
	if (!existsSync(root)) {
		return;
	}
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const entryPath = join(root, entry.name);
		if (entry.isDirectory()) {
			removeStaleTargets(entryPath, writtenFiles);
			if (readdirSync(entryPath).length === 0) {
				rmSync(entryPath, { recursive: true, force: true });
			}
			continue;
		}
		if (!writtenFiles.has(resolve(entryPath))) {
			rmSync(entryPath, { force: true });
			outputStats.removed += 1;
		}
	}
}

function readArg(name) {
	const index = process.argv.indexOf(name);
	if (index === -1) {
		return undefined;
	}
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${name}`);
	}
	return value;
}

function assertSide(value) {
	if (!sides.includes(value)) {
		throw new Error(`Invalid target side: ${value}`);
	}
	return value;
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
	const categoryKeyMatch = /categoryKey:\s*"(?<key>[a-zA-Z0-9_]+)"/u.exec(schemaSource);
	const legacyDataAccessorMatch = /legacyDataAccessor:\s*false/u.exec(schemaSource);
	return {
		schemaExportName: schemaMatch.groups.name,
		logicalTable: tableMatch?.groups?.table ?? tableName,
		uniqueKey: uniqueKeyMatch.groups.key,
		categoryKey: categoryKeyMatch?.groups?.key,
		legacyDataAccessor: legacyDataAccessorMatch === null,
	};
}

function inferRowCategory(row, schemaInfo) {
	if (schemaInfo.categoryKey !== undefined) {
		const category = row[schemaInfo.categoryKey];
		if (typeof category !== "string") {
			throw new Error(`Cannot infer category for ${schemaInfo.logicalTable} row without ${schemaInfo.categoryKey}`);
		}
		return category;
	}
	return "core";
}

function aliasNameForTable(logicalTable) {
	return `${toPascalCase(logicalTable)}Id`;
}

function displayNameForTable(logicalTable) {
	return toPascalCase(logicalTable);
}

function formatDataUncheckSignature(baseName, idType) {
	const singleLine = `export function get${baseName}DataUncheck(id: ${idType} | string, options?: TableAccessorOptions): ${baseName}DataType {`;
	if (singleLine.length <= 140) {
		return singleLine;
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
