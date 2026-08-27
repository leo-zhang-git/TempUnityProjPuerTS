import { performance } from "node:perf_hooks";
import { RuntimeCatalog, type RuntimePrewarmSummary } from "../core/runtime-catalog.js";
import type { SchemaRegistry } from "../core/schema.js";
import { assertValid, validateWorkspace } from "../core/validate.js";
import { buildArtifacts, loadWorkspace, resolveWorkspace, type Workspace } from "../core/workspace.js";

export interface BenchmarkMeasure {
	averageMs: number;
	totalMs: number;
	iterations: number;
}

export interface BenchmarkReport {
	version: 1;
	workspaceRoot: string;
	iterations: number;
	recordCount: number;
	packBytes: {
		total: number;
		tables: Record<string, number>;
	};
	runtimeSurface: {
		packShape: "sparse-per-table";
		defaultRestoration: "access-layer";
		prewarmStrategy: "opt-in-cache";
	};
	timings: {
		loadWorkspace: BenchmarkMeasure;
		validateWorkspace: BenchmarkMeasure;
		resolveWorkspace: BenchmarkMeasure;
		buildArtifacts: BenchmarkMeasure;
		runtimeFromArtifacts: BenchmarkMeasure;
		runtimeColdGetAll: BenchmarkMeasure;
		runtimePrewarm: BenchmarkMeasure;
		runtimeWarmGetAll: BenchmarkMeasure;
	};
	prewarm: RuntimePrewarmSummary;
}

export interface BenchmarkOptions {
	iterations?: number;
}

export function benchmarkWorkspace(
	workspaceRoot: string,
	registry: SchemaRegistry,
	options: BenchmarkOptions = {},
	load: (workspaceRoot: string) => Workspace = loadWorkspace,
): BenchmarkReport {
	const iterations = normalizeIterations(options.iterations);
	const loadResult = measureIterations(iterations, () => load(workspaceRoot));
	const workspace = loadResult.lastValue;
	const validation = validateWorkspace(workspace, registry);
	assertValid(validation);

	const validateResult = measureIterations(iterations, () => validateWorkspace(workspace, registry));
	const resolveResult = measureIterations(iterations, () => resolveWorkspace(workspace, registry));
	const resolved = resolveResult.lastValue;
	const buildResult = measureIterations(iterations, () => buildArtifacts(workspace, registry));
	const artifacts = buildResult.lastValue;
	const runtimeCreateResult = measureIterations(iterations, () => RuntimeCatalog.fromArtifacts(artifacts, registry));
	const recordKeys = collectRecordKeys(resolved);
	const coldAccessResult = measureIterations(iterations, () => {
		const runtime = RuntimeCatalog.fromArtifacts(artifacts, registry);
		for (const entry of recordKeys) {
			runtime.get(entry.table, entry.id);
		}
	});
	const prewarmResult = measureIterations(iterations, () => {
		const runtime = RuntimeCatalog.fromArtifacts(artifacts, registry);
		return runtime.prewarm();
	});
	const warmAccessResult = measureIterations(iterations, () => {
		const runtime = RuntimeCatalog.fromArtifacts(artifacts, registry);
		runtime.prewarm();
		for (const entry of recordKeys) {
			runtime.get(entry.table, entry.id);
		}
	});

	return {
		version: 1,
		workspaceRoot,
		iterations,
		recordCount: recordKeys.length,
		packBytes: measurePackBytes(artifacts.tables),
		runtimeSurface: {
			packShape: "sparse-per-table",
			defaultRestoration: "access-layer",
			prewarmStrategy: "opt-in-cache",
		},
		timings: {
			loadWorkspace: toBenchmarkMeasure(loadResult.totalMs, iterations),
			validateWorkspace: toBenchmarkMeasure(validateResult.totalMs, iterations),
			resolveWorkspace: toBenchmarkMeasure(resolveResult.totalMs, iterations),
			buildArtifacts: toBenchmarkMeasure(buildResult.totalMs, iterations),
			runtimeFromArtifacts: toBenchmarkMeasure(runtimeCreateResult.totalMs, iterations),
			runtimeColdGetAll: toBenchmarkMeasure(coldAccessResult.totalMs, iterations),
			runtimePrewarm: toBenchmarkMeasure(prewarmResult.totalMs, iterations),
			runtimeWarmGetAll: toBenchmarkMeasure(warmAccessResult.totalMs, iterations),
		},
		prewarm: prewarmResult.lastValue,
	};
}

function measureIterations<T>(iterations: number, run: () => T): { totalMs: number; lastValue: T } {
	const startedAt = performance.now();
	let lastValue!: T;
	for (let index = 0; index < iterations; index += 1) {
		lastValue = run();
	}
	return {
		totalMs: performance.now() - startedAt,
		lastValue,
	};
}

function toBenchmarkMeasure(totalMs: number, iterations: number): BenchmarkMeasure {
	return {
		averageMs: totalMs / iterations,
		totalMs,
		iterations,
	};
}

function collectRecordKeys(resolved: ReturnType<typeof resolveWorkspace>): Array<{ table: string; id: string }> {
	const keys: Array<{ table: string; id: string }> = [];
	for (const tableName of Object.keys(resolved.tables).sort((left, right) => left.localeCompare(right))) {
		const resolvedTable = resolved.tables[tableName];
		if (!resolvedTable) {
			continue;
		}
		for (const id of Object.keys(resolvedTable).sort((left, right) => left.localeCompare(right))) {
			keys.push({ table: tableName, id });
		}
	}
	return keys;
}

function measurePackBytes(tables: Record<string, ReturnType<typeof buildArtifacts>["tables"][string]>): BenchmarkReport["packBytes"] {
	const perTable: Record<string, number> = {};
	let total = 0;
	for (const tableName of Object.keys(tables).sort((left, right) => left.localeCompare(right))) {
		const pack = tables[tableName];
		if (!pack) {
			continue;
		}
		const bytes = Buffer.byteLength(JSON.stringify(pack), "utf8");
		perTable[tableName] = bytes;
		total += bytes;
	}
	return {
		total,
		tables: perTable,
	};
}

function normalizeIterations(iterations: number | undefined): number {
	if (iterations === undefined) {
		return 10;
	}
	if (!Number.isInteger(iterations) || iterations <= 0) {
		throw new Error(`Invalid benchmark iterations: ${iterations}`);
	}
	return iterations;
}

