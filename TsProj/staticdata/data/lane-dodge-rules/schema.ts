import { defineTable, s } from "../framework/tool-schema.js";

export const laneDodgeRulesSchema = defineTable({
	table: "lane-dodge-rules",
	uniqueKey: "rulesId",
	idKind: "literal",
	metadata: {
		displayName: "三轨闪避规则",
		icon: "🎮",
		description: "三轨闪避示例的生成、难度、碰撞范围与计分参数。",
		runtimeExport: "client",
		codegen: { legacyDataAccessor: false },
		idConvention: {
			pattern: "fixed",
			example: "default",
			note: "当前示例只消费 default 规则。",
		},
		summary: [
			{ key: "speed", label: "速度", template: "{baseSpeed}-{maxSpeed}" },
			{ key: "spawn", label: "生成间隔", template: "{baseSpawnIntervalSeconds}s" },
		],
	},
	categoryMetadata: {
		core: { displayName: "基础", icon: "📄", description: "示例玩法的全局规则。" },
	},
	base: s.object({}),
	categories: {
		core: s.object({
			laneCount: s.literal(3, { required: true, description: "三轨闪避固定使用三条轨道。" }),
			initialLane: s.number({ required: true, integer: true, min: 0, description: "新局玩家初始轨道下标。" }),
			playerDistance: s.number({ required: true, description: "玩家在距离轴上的固定位置。" }),
			spawnDistance: s.number({ required: true, description: "障碍物和金币的生成位置。" }),
			despawnDistance: s.number({ required: true, description: "物体越过该位置后进入延迟销毁。" }),
			collisionRadius: s.number({ required: true, exclusiveMin: 0, description: "玩家和落物各自的碰撞半径。" }),
			initialSpawnDelaySeconds: s.number({ required: true, min: 0, description: "新局首次生成前的等待时间。" }),
			baseSpeed: s.number({ required: true, exclusiveMin: 0, description: "新局初始落物速度。" }),
			maxSpeed: s.number({ required: true, exclusiveMin: 0, description: "难度增长后的落物速度上限。" }),
			speedIncreasePerSecond: s.number({ required: true, min: 0, description: "每秒增加的落物速度。" }),
			baseSpawnIntervalSeconds: s.number({ required: true, exclusiveMin: 0, description: "新局生成间隔。" }),
			minSpawnIntervalSeconds: s.number({ required: true, exclusiveMin: 0, description: "难度增长后的最小生成间隔。" }),
			spawnIntervalDecreasePerSecond: s.number({ required: true, min: 0, description: "每秒缩短的生成间隔。" }),
			maxCatchUpSpawnsPerTick: s.number({ required: true, integer: true, min: 1, description: "单次 FixedUpdate 允许补生成的数量上限。" }),
			coinChance: s.number({ required: true, min: 0, max: 1, description: "每次生成金币的概率。" }),
			coinScore: s.number({ required: true, integer: true, min: 0, description: "每枚金币提供的分数。" }),
			survivalScorePerSecond: s.number({ required: true, min: 0, description: "每秒生存时间提供的分数。" }),
		}),
	},
});
