import { isJsonObject, type SchemaRegistry } from "./schema.js";
import type { ValidationIssue } from "./validate.js";
import type { Workspace } from "./workspace.js";

export function validateWorkspaceCustomRules(
	workspace: Workspace,
	registry: SchemaRegistry,
	tableScope: ReadonlySet<string> | undefined,
): ValidationIssue[] {
	if (!registry.tables["lane-dodge-rules"] || (tableScope && !tableScope.has("lane-dodge-rules"))) {
		return [];
	}

	const records = workspace.tables["lane-dodge-rules"]?.categories.core?.core;
	if (!records) {
		return [];
	}

	const issues: ValidationIssue[] = [];
	if (Object.keys(records).length !== 1 || !isJsonObject(records.default)) {
		issues.push({ path: "lane-dodge-rules/core", message: "必须且只能声明 default 规则。" });
		return issues;
	}

	const rules = records.default;
	if (typeof rules.laneCount === "number" && typeof rules.initialLane === "number" && rules.initialLane >= rules.laneCount) {
		issues.push({ path: "lane-dodge-rules/core#default.initialLane", message: "初始轨道必须小于轨道数量。" });
	}
	if (typeof rules.baseSpeed === "number" && typeof rules.maxSpeed === "number" && rules.baseSpeed > rules.maxSpeed) {
		issues.push({ path: "lane-dodge-rules/core#default.maxSpeed", message: "最大速度不能小于初始速度。" });
	}
	if (
		typeof rules.baseSpawnIntervalSeconds === "number" &&
		typeof rules.minSpawnIntervalSeconds === "number" &&
		rules.minSpawnIntervalSeconds > rules.baseSpawnIntervalSeconds
	) {
		issues.push({ path: "lane-dodge-rules/core#default.minSpawnIntervalSeconds", message: "最小生成间隔不能大于初始生成间隔。" });
	}
	if (
		typeof rules.spawnDistance === "number" &&
		typeof rules.playerDistance === "number" &&
		rules.spawnDistance <= rules.playerDistance
	) {
		issues.push({ path: "lane-dodge-rules/core#default.spawnDistance", message: "生成位置必须位于玩家前方。" });
	}
	if (
		typeof rules.despawnDistance === "number" &&
		typeof rules.playerDistance === "number" &&
		rules.despawnDistance >= rules.playerDistance
	) {
		issues.push({ path: "lane-dodge-rules/core#default.despawnDistance", message: "销毁位置必须位于玩家后方。" });
	}

	return issues;
}
