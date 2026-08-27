import type { JsonObject } from "../core/schema.js";
import type { SchemaCatalog } from "../core/schema-ir.js";

const TABLE_LABELS: Readonly<Record<string, string>> = {};

let schemaTables: SchemaCatalog["tables"] = {};

export function configureDisplayLabels(schema: SchemaCatalog | undefined): void {
	schemaTables = schema?.tables ?? {};
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = { core: "基础" };

const SIDECAR_LABELS: Readonly<Record<string, string>> = {};

const FIELD_LABELS: Readonly<Record<string, string>> = {
	baseSpawnIntervalSeconds: "初始生成间隔(s)",
	baseSpeed: "初始速度",
	collisionRadius: "碰撞半径",
	coinChance: "金币概率",
	coinScore: "金币得分",
	despawnDistance: "销毁距离",
	initialLane: "初始轨道",
	initialSpawnDelaySeconds: "首次生成延迟(s)",
	laneCount: "轨道数量",
	maxCatchUpSpawnsPerTick: "单帧补生成上限",
	maxSpeed: "最大速度",
	minSpawnIntervalSeconds: "最小生成间隔(s)",
	playerDistance: "玩家距离",
	spawnDistance: "生成距离",
	spawnIntervalDecreasePerSecond: "生成间隔衰减/s",
	speedIncreasePerSecond: "速度增长/s",
	survivalScorePerSecond: "生存得分/s",
};
export function formatTableLabel(table: string): string {
	const metadata = schemaTables[table]?.metadata ?? {};
	return formatLabel(metadata.displayName ?? TABLE_LABELS[table], table);
}

export function formatTableBadge(table: string): string {
	const metadata = schemaTables[table]?.metadata ?? {};
	return formatLabel(metadata.displayName ?? TABLE_LABELS[table], table, metadata.icon);
}

export function formatCategoryLabel(category: string, table = ""): string {
	const metadata = table ? (schemaTables[table]?.categories?.[category]?.metadata ?? {}) : {};
	return formatLabel(metadata.displayName ?? CATEGORY_LABELS[category], category);
}

export function formatCategoryBadge(category: string, table = ""): string {
	const metadata = table ? (schemaTables[table]?.categories?.[category]?.metadata ?? {}) : {};
	return formatLabel(metadata.displayName ?? CATEGORY_LABELS[category], category, metadata.icon);
}

export function formatSidecarLabel(sidecarName: string): string {
	return formatLabel(SIDECAR_LABELS[sidecarName], sidecarName);
}

export function formatFieldLabel(table: string, _category: string, fieldName: string, field?: DisplayField): string {
	const explicitLabel = toOptionalString(field?.metadata?.displayName);
	const legacyLabel = schemaTables[table]?.metadata?.legacy ? firstDescriptionLine(field?.description) : undefined;
	return formatLabel(explicitLabel ?? legacyLabel ?? FIELD_LABELS[fieldName], fieldName);
}

interface DisplayField {
	readonly description?: string;
	readonly metadata?: JsonObject;
}

function firstDescriptionLine(description: unknown): string | undefined {
	if (typeof description !== "string") {
		return undefined;
	}
	return description.split(/\r?\n/u, 1)[0]?.trim() || undefined;
}

function formatLabel(label: unknown, key: string, icon?: unknown): string {
	const displayLabel = toOptionalString(label);
	const displayIcon = toOptionalString(icon);
	const text = displayLabel && displayLabel !== key ? `${displayLabel} (${key})` : key;
	return displayIcon ? `${displayIcon} ${text}` : text;
}

function toOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
