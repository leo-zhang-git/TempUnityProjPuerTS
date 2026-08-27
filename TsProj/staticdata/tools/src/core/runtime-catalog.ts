import { readFileSync } from "node:fs";
import { join } from "node:path";
import { materializeSidecarRecordWithSchema } from "../../../data/framework/schema-materializer.js";
import { getAvailableSidecarSchemas, getCoreSchema, getTableSchema, isJsonObject, type SchemaRegistry } from "./schema.js";
import { type BuildArtifacts, type BuiltTablePack, materializeRecordWithSchema, type ResolvedRecord } from "./workspace.js";

declare const runtimeIdBrand: unique symbol;

export type RuntimeId<TTable extends string, TId extends string = string> = TId & {
	readonly [runtimeIdBrand]: TTable;
};

export interface RuntimePrewarmSummary {
	tables: string[];
	recordCount: number;
}

export class RuntimeCatalog<TRegistry extends SchemaRegistry = SchemaRegistry> {
	private readonly prewarmedRecords = new Map<string, ResolvedRecord>();

	private constructor(
		private readonly registry: TRegistry,
		private readonly packs: Record<string, BuiltTablePack>,
	) {}

	static fromArtifacts<TRegistry extends SchemaRegistry>(artifacts: BuildArtifacts, registry: TRegistry): RuntimeCatalog<TRegistry> {
		const packs = structuredClone(artifacts.tables);
		for (const [tableName, pack] of Object.entries(packs)) {
			if (!pack.sidecars) {
				pack.sidecars = Object.keys(registry.tables[tableName]?.sidecars ?? {}).sort((left, right) => left.localeCompare(right));
			}
		}
		return new RuntimeCatalog(registry, packs);
	}

	static fromBuildDir<TRegistry extends SchemaRegistry>(buildDir: string, registry: TRegistry): RuntimeCatalog<TRegistry> {
		const packs: Record<string, BuiltTablePack> = {};
		for (const tableName of Object.keys(registry.tables)) {
			const filePath = join(buildDir, `${tableName}.json`);
			try {
				packs[tableName] = JSON.parse(readFileSync(filePath, "utf8")) as BuiltTablePack;
			} catch (error) {
				if (isMissingFileError(error)) {
					continue;
				}
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to load build artifact ${filePath}: ${message}`);
			}
		}
		return new RuntimeCatalog(registry, packs);
	}

	get(table: string, id: string): ResolvedRecord | undefined {
		const cacheKey = toRuntimeCacheKey(table, id);
		const cached = this.prewarmedRecords.get(cacheKey);
		if (cached) {
			return structuredClone(cached);
		}
		return this.materializeRecord(table, id);
	}

	prewarm(tables?: string[]): RuntimePrewarmSummary {
		const tableNames = normalizePrewarmTables(this.packs, tables);
		let recordCount = 0;
		for (const tableName of tableNames) {
			const pack = this.packs[tableName];
			if (!pack) {
				continue;
			}
			for (const [category, categoryPack] of Object.entries(pack.categories)) {
				for (const id of Object.keys(categoryPack.core).sort((left, right) => left.localeCompare(right))) {
					const record = this.materializeRecord(tableName, id);
					if (!record || record.category !== category) {
						continue;
					}
					this.prewarmedRecords.set(toRuntimeCacheKey(tableName, id), record);
					recordCount += 1;
				}
			}
		}
		return {
			tables: tableNames,
			recordCount,
		};
	}

	private materializeRecord(table: string, id: string): ResolvedRecord | undefined {
		const pack = this.packs[table];
		if (!pack) {
			return undefined;
		}
		for (const [category, categoryPack] of Object.entries(pack.categories)) {
			const core = categoryPack.core[id];
			if (!core) {
				continue;
			}
			const result: ResolvedRecord = {
				id,
				category,
				core: materializeRecordWithSchema(core, getCoreSchema(this.registry, table, category)),
			};
			const tableSidecars = getAvailableSidecarSchemas(getTableSchema(this.registry, table).sidecars, category);
			const authoredSidecars = categoryPack.sidecars?.[id];
			if (authoredSidecars) {
				for (const sidecarName of Object.keys(tableSidecars).sort((left, right) => left.localeCompare(right))) {
					const sidecarRecord = authoredSidecars[sidecarName];
					const sidecarSchema = tableSidecars[sidecarName];
					if (!sidecarSchema || !isJsonObject(sidecarRecord)) {
						continue;
					}
					result.sidecars ??= {};
					result.sidecars[sidecarName] = materializeSidecarRecordWithSchema(sidecarRecord, sidecarSchema.schema);
				}
			}
			return result;
		}
		return undefined;
	}
}

function normalizePrewarmTables(packs: Record<string, BuiltTablePack>, tables: string[] | undefined): string[] {
	const selected = tables ?? Object.keys(packs);
	return [...new Set(selected)].sort((left, right) => left.localeCompare(right));
}

function toRuntimeCacheKey(table: string, id: string): string {
	return `${table}#${id}`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
