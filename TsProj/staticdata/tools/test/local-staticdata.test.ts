import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	assertValid,
	buildArtifacts,
	loadWorkspace,
	registry,
	resolveWorkspace,
	RuntimeCatalog,
	validateWorkspace,
} from "../src/index.js";

const staticDataRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = join(staticDataRoot, "data");

test("本地 authoring 可校验、解析并由 runtime catalog 读取", () => {
	const workspace = loadWorkspace(workspaceRoot);
	assertValid(validateWorkspace(workspace, registry));

	const resolved = resolveWorkspace(workspace, registry);
	const rules = resolved.tables["lane-dodge-rules"]?.default;
	assert.equal(rules?.id, "default");
	assert.equal(rules?.core.laneCount, 3);

	const runtime = RuntimeCatalog.fromArtifacts(buildArtifacts(workspace, registry), registry);
	assert.deepEqual(runtime.get("lane-dodge-rules", "default"), rules);
	assert.deepEqual(runtime.prewarm(), { tables: ["lane-dodge-rules"], recordCount: 1 });
});

test("三轨闪避规则执行本地交叉校验", () => {
	const workspace = structuredClone(loadWorkspace(workspaceRoot));
	const rules = workspace.tables["lane-dodge-rules"]?.categories.core?.core.default;
	assert.ok(rules);
	rules.maxSpeed = 4;

	const report = validateWorkspace(workspace, registry);
	assert.equal(report.ok, false);
	assert.ok(
		report.issues.some(
			(issue) => issue.path === "lane-dodge-rules/core#default.maxSpeed" && issue.message.includes("最大速度"),
		),
		JSON.stringify(report.issues, null, 2),
	);
});

test("client target 生成纯内存 accessor 并保留本地规则", async () => {
	const buildResult = spawnSync(
		process.execPath,
		["--import", "tsx", "tools/scripts/build-targets-pipeline.mjs", "--side", "client"],
		{ cwd: staticDataRoot, encoding: "utf8" },
	);
	assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

	const targetPath = new URL("../../targets/client/data/tables/lane-dodge-rules/info.js", import.meta.url).href;
	const target = (await import(targetPath)) as {
		readonly listLaneDodgeRules: () => ReadonlyArray<{ readonly rulesId: string; readonly coinScore: number }>;
		readonly requireLaneDodgeRules: (id: string) => { readonly rulesId: string; readonly coinScore: number };
	};
	assert.deepEqual(
		target.listLaneDodgeRules().map((row) => row.rulesId),
		["default"],
	);
	assert.equal(target.requireLaneDodgeRules("default").coinScore, 50);
	assert.throws(() => target.requireLaneDodgeRules("missing"), /missing lane-dodge-rules: missing/);
});
