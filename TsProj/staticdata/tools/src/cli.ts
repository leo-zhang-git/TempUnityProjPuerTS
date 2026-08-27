import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createStaticDataService } from "./app/service.js";
import { isWorkspaceRevisionConflictError } from "./app/workspace-backend.js";
import { getRecordReferences, getRecordReferrers, listRefCandidates } from "./core/ref-index.js";
import { DEFAULT_REVIEW_SAMPLE_LIMIT } from "./core/review.js";
import type { VerifyTarget } from "./core/verify.js";
import { requireWorkspaceRoot, resolveWorkspaceRoot } from "./core/workspace-root.js";
import { registry } from "./schemas.js";
import { summaryBuilders } from "./summary-builders.js";

const service = createStaticDataService(registry, undefined, undefined, summaryBuilders);

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	switch (command) {
		case "validate":
			runValidate(rest);
			return;
		case "schema":
			runSchema(rest);
			return;
		case "resolve":
			runResolve(rest);
			return;
		case "build":
			runBuild(rest);
			return;
		case "verify":
			runVerify(rest);
			return;
		case "apply":
			runApply(rest);
			return;
		case "review":
			runReview(rest);
			return;
		case "format":
			runFormat(rest);
			return;
		case "plan":
			runPlan(rest);
			return;
		case "benchmark":
			runBenchmark(rest);
			return;
		case "list-refs":
			runListRefs(rest);
			return;
		case "references":
			runReferences(rest);
			return;
		case "referrers":
			runReferrers(rest);
			return;
		default:
			printUsage();
			process.exitCode = 1;
	}
}

function runValidate(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const report = service.validateWorkspaceRoot(workspaceRoot);
	if (!report.ok) {
		process.exitCode = 1;
	}
	if (parsed.values.json) {
		printJson(report);
		return;
	}
	printHumanReport("validate", report);
}

function runSchema(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});
	const schemaIr = service.getSchema();
	if (parsed.values.json) {
		printJson(schemaIr);
		return;
	}
	printJson(schemaIr);
}

function runResolve(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			table: { type: "string" },
			id: { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const selection = service.resolveWorkspaceSelection(workspaceRoot, {
		...(parsed.values.table !== undefined ? { table: parsed.values.table } : {}),
		...(parsed.values.id !== undefined ? { id: parsed.values.id } : {}),
	});
	if (parsed.values.json) {
		printJson(selection);
		return;
	}
	printJson(selection);
}

function runBuild(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			"out-dir": { type: "string", default: ".artifacts/build" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const outDir = resolve(parsed.values["out-dir"]);
	const summary = service.buildWorkspace({
		workspaceRoot,
		outDir,
	});
	if (parsed.values.json) {
		printJson(summary);
		return;
	}
	printJson(summary);
}

function runVerify(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			target: { type: "string", multiple: true },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const targets = parseVerifyTargets(parsed.values.target);
	const report = service.verifyWorkspaceRoot(workspaceRoot, {
		...(targets ? { targets } : {}),
	});
	if (!report.ok) {
		process.exitCode = 1;
	}
	if (parsed.values.json) {
		printJson(report);
		return;
	}
	printHumanReport("verify", report);
}

function runApply(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			plan: { type: "string" },
			write: { type: "boolean", default: false },
			"out-dir": { type: "string", default: ".artifacts/apply-preview" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const planPath = parsed.values.plan;
	if (!planPath) {
		throw new Error("Missing --plan");
	}
	const rawPlan = JSON.parse(readFileSync(resolve(planPath), "utf8"));
	const summary = service.executePlan({
		workspaceRoot,
		planInput: rawPlan,
		...(parsed.values.write
			? { write: true }
			: {
					outDir: resolve(parsed.values["out-dir"]),
				}),
	});
	if (parsed.values.json) {
		printJson(summary);
		return;
	}
	printJson(summary);
}

function runReview(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			base: { type: "string" },
			head: { type: "string" },
			"out-dir": { type: "string", default: ".artifacts/review" },
			"sample-limit": { type: "string", default: String(DEFAULT_REVIEW_SAMPLE_LIMIT) },
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});
	const baseRoot = requireWorkspaceRoot(parsed.values.base, "--base");
	const headRoot = requireWorkspaceRoot(parsed.values.head, "--head");
	const outDir = resolve(parsed.values["out-dir"]);
	const sampleLimit = parsePositiveInteger(parsed.values["sample-limit"], "--sample-limit");
	const result = service.reviewWorkspaces({
		baseRoot,
		headRoot,
		outDir,
		sampleLimit,
	});
	const { artifacts } = result;
	const summary = {
		ok: true,
		outDir,
		inserted: artifacts.diff.inserted.length,
		deleted: artifacts.diff.deleted.length,
		updated: artifacts.diff.updated.length,
		refImpacts: artifacts.summary.totals.refImpacts,
		resourceImpacts: artifacts.summary.totals.resourceImpacts,
		sampleLimit,
	};
	if (parsed.values.json) {
		printJson(summary);
		return;
	}
	printJson(summary);
}

function runFormat(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			check: { type: "boolean", default: false },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const result = service.formatWorkspace({
		workspaceRoot,
		check: parsed.values.check,
	});
	if (parsed.values.check && result.changed) {
		process.exitCode = 1;
	}
	const summary = {
		ok: result.ok,
		workspaceRoot,
		changed: result.changed,
		checked: result.checked,
	};
	if (parsed.values.json) {
		printJson(summary);
		return;
	}
	printJson(summary);
}

function runPlan(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			plan: { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});
	const planPath = parsed.values.plan;
	if (!planPath) {
		throw new Error("Missing --plan");
	}
	const description = service.describePlan(JSON.parse(readFileSync(resolve(planPath), "utf8")));
	const summary = {
		planPath: resolve(planPath),
		...description,
	};
	if (parsed.values.json) {
		printJson(summary);
		return;
	}
	printJson(summary);
}

function runBenchmark(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			iterations: { type: "string" },
			"out-file": { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const report = service.benchmarkWorkspace({
		workspaceRoot,
		...(parsed.values.iterations ? { iterations: parsePositiveInteger(parsed.values.iterations, "--iterations") } : {}),
	});
	const outFile = parsed.values["out-file"] ? resolve(parsed.values["out-file"]) : undefined;
	if (outFile) {
		mkdirSync(dirname(outFile), { recursive: true });
		writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	}
	if (parsed.values.json) {
		printJson(report);
		return;
	}
	printJson(report);
}

function runListRefs(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			table: { type: "string" },
			category: { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const table = requireOption(parsed.values.table, "--table");
	const ids = listRefCandidates(service.getRefIndex(workspaceRoot), table, parsed.values.category);
	const result = {
		table,
		...(parsed.values.category ? { category: parsed.values.category } : {}),
		ids,
	};
	if (parsed.values.json) {
		printJson(result);
		return;
	}
	for (const id of ids) {
		console.log(id);
	}
}

function runReferences(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			table: { type: "string" },
			id: { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const table = requireOption(parsed.values.table, "--table");
	const id = requireOption(parsed.values.id, "--id");
	const references = getRecordReferences(service.getRefIndex(workspaceRoot), table, id);
	const result = {
		table,
		id,
		references,
	};
	if (parsed.values.json) {
		printJson(result);
		return;
	}
	for (const entry of references) {
		console.log(`${entry.path} -> ${entry.targetTable}#${entry.targetId}`);
	}
}

function runReferrers(args: string[]): void {
	const parsed = parseArgs({
		args,
		options: {
			table: { type: "string" },
			id: { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.positionals[0]);
	const table = requireOption(parsed.values.table, "--table");
	const id = requireOption(parsed.values.id, "--id");
	const referrers = getRecordReferrers(service.getRefIndex(workspaceRoot), table, id);
	const result = {
		table,
		id,
		referrers,
	};
	if (parsed.values.json) {
		printJson(result);
		return;
	}
	for (const entry of referrers) {
		console.log(`${entry.sourceTable}#${entry.sourceId}.${entry.path}`);
	}
}

function printUsage(): void {
	console.log(`Usage:
  tsx tools/src/cli.ts validate [workspace] [--json]
  tsx tools/src/cli.ts schema [--json]
  tsx tools/src/cli.ts resolve [workspace] [--table <table>] [--id <id>] [--json]
  tsx tools/src/cli.ts build [workspace] [--out-dir <dir>] [--json]
  tsx tools/src/cli.ts verify [workspace] [--target <runtime_catalog>]... [--json]
  tsx tools/src/cli.ts apply [workspace] --plan <plan.json> [--write] [--out-dir <dir>] [--json]
  tsx tools/src/cli.ts review --base <workspace> --head <workspace> [--out-dir <dir>] [--sample-limit <n>] [--json]
  tsx tools/src/cli.ts format [workspace] [--check] [--json]
  tsx tools/src/cli.ts plan --plan <plan.json> [--json]
  tsx tools/src/cli.ts benchmark [workspace] [--iterations <n>] [--out-file <path>] [--json]
  tsx tools/src/cli.ts list-refs [workspace] --table <table> [--category <category>] [--json]
  tsx tools/src/cli.ts references [workspace] --table <table> --id <id> [--json]
  tsx tools/src/cli.ts referrers [workspace] --table <table> --id <id> [--json]`);
}

function printHumanReport(command: string, report: unknown): void {
	console.log(`[${command}]`);
	printJson(report);
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function parsePositiveInteger(rawValue: string | undefined, flagName: string): number {
	const parsed = Number(rawValue);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${flagName}: ${rawValue}`);
	}
	return parsed;
}

function requireOption(value: string | undefined, flagName: string): string {
	if (!value) {
		throw new Error(`Missing ${flagName}`);
	}
	return value;
}

function parseVerifyTargets(rawTargets: string[] | undefined): VerifyTarget[] | undefined {
	if (!rawTargets) {
		return undefined;
	}
	return rawTargets.map((target) => {
		if (target === "runtime_catalog") {
			return target;
		}
		throw new Error(`Invalid --target: ${target}`);
	});
}

try {
	await main();
} catch (error) {
	if (!isWorkspaceRevisionConflictError(error)) throw error;
	console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }, null, 2));
	process.exitCode = 1;
}

