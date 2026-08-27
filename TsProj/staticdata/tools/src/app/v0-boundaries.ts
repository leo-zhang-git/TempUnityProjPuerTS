export interface V0NonGoal {
	code:
		| "formula-objects"
		| "conditional-rule-objects"
		| "dynamic-key-maps"
		| "multi-target-refs"
		| "cross-field-conditions"
		| "deep-object-merge"
		| "element-level-array-patch"
		| "heavy-grid-editor"
		| "alias-based-renames"
		| "code-config-export";
	title: string;
	description: string;
}

export interface V0Profile {
	code: "high-fanout-logical-table";
	title: string;
	description: string;
	phase: "analysis-profile";
	metrics: string[];
	decisions: string[];
}

export interface V0Boundaries {
	nonGoals: V0NonGoal[];
	profiles: V0Profile[];
}

export const V0_NON_GOALS: readonly V0NonGoal[] = [
	{
		code: "formula-objects",
		title: "Formula objects",
		description: "v0 rejects computed formula-style authoring objects; author concrete static values instead.",
	},
	{
		code: "conditional-rule-objects",
		title: "Conditional rule objects",
		description: "v0 does not model conditional rule objects or cross-field rule evaluation in authoring data.",
	},
	{
		code: "dynamic-key-maps",
		title: "Dynamic key maps",
		description: "v0 keeps authored object shapes closed; free-form dynamic key maps are outside the contract.",
	},
	{
		code: "multi-target-refs",
		title: "Multi-target refs",
		description: "References stay single-table in v0 and do not fan out across multiple target tables.",
	},
	{
		code: "cross-field-conditions",
		title: "Cross-field conditions",
		description: "Validation stays field- and schema-driven in v0; cross-field conditional constraints remain out of scope.",
	},
	{
		code: "deep-object-merge",
		title: "Deep object merge",
		description: "Object updates replace the whole field; deep merge authoring and patch semantics are not supported.",
	},
	{
		code: "element-level-array-patch",
		title: "Element-level array patch",
		description: "Array updates replace the whole array; element-level patch semantics remain out of scope.",
	},
	{
		code: "heavy-grid-editor",
		title: "Heavy grid editor",
		description: "The local Web UI stays lightweight and does not implement a spreadsheet-style grid editor.",
	},
	{
		code: "alias-based-renames",
		title: "Alias-based renames",
		description: "rename_id rewrites refs in one shot and does not preserve alias or redirect compatibility layers.",
	},
	{
		code: "code-config-export",
		title: "Code config export",
		description: "Config-family data is owned by code config and is not implemented in this static-data export chain.",
	},
];

export const V0_PROFILES: readonly V0Profile[] = [
	{
		code: "high-fanout-logical-table",
		title: "High fan-out logical-table profile",
		description:
			"Tracks large logical tables with many categories as a profile-driven pressure sample for codegen, review, and runtime governance.",
		phase: "analysis-profile",
		metrics: ["active category count", "empty category count", "tail ratio", "field-overlap ratio", "behavior family count"],
		decisions: [
			"Keep high fan-out families inside the logical-table/category model.",
			"Do not create a second authoring truth layer for fan-out pressure.",
			"Attach lifecycle, codegen, and review controls through profile metadata.",
		],
	},
];

export function createV0Boundaries(): V0Boundaries {
	return {
		nonGoals: V0_NON_GOALS.map((entry) => ({ ...entry })),
		profiles: V0_PROFILES.map((entry) => ({
			...entry,
			metrics: [...entry.metrics],
			decisions: [...entry.decisions],
		})),
	};
}

