import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { StaticDataService } from "../app/service.js";
import { isWorkspaceRevisionConflictError } from "../app/workspace-backend.js";
import type { JsonObject, JsonValue } from "../core/schema.js";
import { resolveDefaultWorkspaceRoot } from "../core/workspace-root.js";

export interface StaticDataMcpTool {
	name: string;
	description: string;
	inputSchema?: Record<string, z.ZodTypeAny>;
	execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface McpToolCatalogOptions {
	defaultWorkspaceRoot?: string;
}

const verifyTargetSchema = z.enum(["runtime_catalog"]);

export function createMcpToolCatalog(service: StaticDataService, options: McpToolCatalogOptions = {}): StaticDataMcpTool[] {
	const defaultWorkspaceRoot = options.defaultWorkspaceRoot ?? resolveDefaultWorkspaceRoot();
	const workspaceField = z.string().optional().describe(`Workspace root. Defaults to ${defaultWorkspaceRoot}.`);
	const outDirField = z.string().optional().describe("Output directory for derived artifacts or preview writes.");
	const planField = z.unknown().describe("Canonical plan JSON object.");

	const tools: StaticDataMcpTool[] = [
		{
			name: "manifest",
			description: "Return the shared v0 manifest, boundaries, review artifact names, and runtime freeze decisions.",
			execute: async () => service.getManifest(),
		},
		{
			name: "schema",
			description: "Return the shared schema IR, writer contract, v0 non-goals, and high fan-out profile boundaries.",
			execute: async () => service.getSchema(),
		},
		{
			name: "list_records",
			description: "List resolved records with optional table/category/query filters.",
			inputSchema: {
				workspaceRoot: workspaceField,
				table: z.string().optional(),
				category: z.string().optional(),
				query: z.string().optional(),
				limit: z.number().int().positive().optional(),
			},
			execute: async (args) => {
				const table = asOptionalString(args.table);
				const category = asOptionalString(args.category);
				const query = asOptionalString(args.query);
				return service.listRecords({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					...(table ? { table } : {}),
					...(category ? { category } : {}),
					...(query ? { query } : {}),
					...(typeof args.limit === "number" ? { limit: args.limit } : {}),
				});
			},
		},
		{
			name: "get_record",
			description: "Return authored data, resolved data, default provenance, refs, and validation issues for one record.",
			inputSchema: {
				workspaceRoot: workspaceField,
				table: z.string(),
				id: z.string(),
			},
			execute: async (args) =>
				service.getRecordDetail(
					getWorkspaceRoot(args, defaultWorkspaceRoot),
					expectString(args.table, "table"),
					expectString(args.id, "id"),
				),
		},
		{
			name: "resolve_workspace",
			description: "Resolve the workspace and optionally narrow to one table or record.",
			inputSchema: {
				workspaceRoot: workspaceField,
				table: z.string().optional(),
				id: z.string().optional(),
			},
			execute: async (args) => {
				const table = asOptionalString(args.table);
				const id = asOptionalString(args.id);
				return service.resolveWorkspaceSelection(getWorkspaceRoot(args, defaultWorkspaceRoot), {
					...(table ? { table } : {}),
					...(id ? { id } : {}),
				});
			},
		},
		{
			name: "validate_workspace",
			description: "Run schema/default/ref/keyspace/path validation on a workspace.",
			inputSchema: {
				workspaceRoot: workspaceField,
			},
			execute: async (args) => service.validateWorkspaceRoot(getWorkspaceRoot(args, defaultWorkspaceRoot)),
		},
		{
			name: "build_workspace",
			description: "Build sparse runtime packs from authoring data and optionally write them to a directory.",
			inputSchema: {
				workspaceRoot: workspaceField,
				outDir: outDirField,
			},
			execute: async (args) => {
				const outDir = asOptionalString(args.outDir);
				return service.buildWorkspace({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					...(outDir ? { outDir } : {}),
				});
			},
		},
		{
			name: "verify_workspace",
			description: "Run built-in verify checks; the current platform baseline verifies runtime catalog parity.",
			inputSchema: {
				workspaceRoot: workspaceField,
				targets: z.array(verifyTargetSchema).optional(),
			},
			execute: async (args) =>
				service.verifyWorkspaceRoot(getWorkspaceRoot(args, defaultWorkspaceRoot), {
					...(Array.isArray(args.targets) ? { targets: args.targets as "runtime_catalog"[] } : {}),
				}),
		},
		{
			name: "review_workspaces",
			description: "Create semantic diff, resolved head, and review summary artifacts for two workspaces.",
			inputSchema: {
				baseRoot: z.string().optional(),
				headRoot: z.string().optional(),
				outDir: outDirField,
				sampleLimit: z.number().int().positive().optional(),
			},
			execute: async (args) => {
				const outDir = asOptionalString(args.outDir);
				return service.reviewWorkspaces({
					baseRoot: asOptionalString(args.baseRoot) ?? defaultWorkspaceRoot,
					headRoot: asOptionalString(args.headRoot) ?? defaultWorkspaceRoot,
					...(outDir ? { outDir } : {}),
					...(typeof args.sampleLimit === "number" ? { sampleLimit: args.sampleLimit } : {}),
				});
			},
		},
		{
			name: "describe_plan",
			description: "Normalize and describe a patch/refactor/migration plan without executing it.",
			inputSchema: {
				plan: planField,
			},
			execute: async (args) => service.describePlan(args.plan),
		},
		{
			name: "apply_plan_preview",
			description: "Preview a plan against a workspace using the shared semantic chain without writing to authoring by default.",
			inputSchema: {
				workspaceRoot: workspaceField,
				plan: planField,
				outDir: outDirField,
			},
			execute: async (args) => {
				const outDir = asOptionalString(args.outDir);
				return service.executePlan({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					planInput: args.plan,
					...(outDir ? { outDir } : {}),
				});
			},
		},
		{
			name: "apply_plan_write",
			description: "Execute a plan and write the result back to the workspace root.",
			inputSchema: {
				workspaceRoot: workspaceField,
				plan: planField,
			},
			execute: async (args) =>
				service.executePlan({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					planInput: args.plan,
					write: true,
				}),
		},
		{
			name: "preview_record_edit",
			description: "Accept a finer-grained record edit payload, convert it into canonical patch ops, and preview the result.",
			inputSchema: {
				workspaceRoot: workspaceField,
				table: z.string(),
				id: z.string(),
				authoredCore: z.record(z.string(), z.unknown()),
				authoredSidecars: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
				deleteSidecars: z.array(z.string()).optional(),
				outDir: outDirField,
			},
			execute: async (args) => {
				const outDir = asOptionalString(args.outDir);
				const authoredSidecars =
					args.authoredSidecars !== undefined ? expectJsonObjectMap(args.authoredSidecars, "authoredSidecars") : undefined;
				return service.previewRecordUpdate({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					table: expectString(args.table, "table"),
					id: expectString(args.id, "id"),
					authoredCore: expectJsonObject(args.authoredCore, "authoredCore"),
					...(authoredSidecars !== undefined ? { authoredSidecars } : {}),
					...("deleteSidecars" in args ? { deleteSidecars: expectStringArray(args.deleteSidecars, "deleteSidecars") } : {}),
					...(outDir ? { outDir } : {}),
				});
			},
		},
		{
			name: "apply_record_edit",
			description: "Accept a finer-grained record edit payload, convert it into canonical patch ops, and write the result back.",
			inputSchema: {
				workspaceRoot: workspaceField,
				table: z.string(),
				id: z.string(),
				authoredCore: z.record(z.string(), z.unknown()),
				authoredSidecars: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
				deleteSidecars: z.array(z.string()).optional(),
			},
			execute: async (args) => {
				const authoredSidecars =
					args.authoredSidecars !== undefined ? expectJsonObjectMap(args.authoredSidecars, "authoredSidecars") : undefined;
				return service.previewRecordUpdate({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					table: expectString(args.table, "table"),
					id: expectString(args.id, "id"),
					authoredCore: expectJsonObject(args.authoredCore, "authoredCore"),
					...(authoredSidecars !== undefined ? { authoredSidecars } : {}),
					...("deleteSidecars" in args ? { deleteSidecars: expectStringArray(args.deleteSidecars, "deleteSidecars") } : {}),
					write: true,
				});
			},
		},
		{
			name: "preview_schema_field_mutation",
			description: "Preview a top-level exported field rename or deletion when the workspace backend supports schema mutations.",
			inputSchema: {
				workspaceRoot: workspaceField,
				table: z.string(),
				category: z.string(),
				field: z.string(),
				action: z.enum(["rename", "delete"]),
				newName: z.string().optional(),
			},
			execute: async (args) =>
				service.mutateSchemaField({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					table: expectString(args.table, "table"),
					category: expectString(args.category, "category"),
					field: expectString(args.field, "field"),
					action: expectSchemaFieldAction(args.action),
					...(args.newName !== undefined ? { newName: expectString(args.newName, "newName") } : {}),
				}),
		},
		{
			name: "apply_schema_field_mutation",
			description: "Rename or delete a top-level exported field and run the backend's authoring and export transaction.",
			inputSchema: {
				workspaceRoot: workspaceField,
				table: z.string(),
				category: z.string(),
				field: z.string(),
				action: z.enum(["rename", "delete"]),
				newName: z.string().optional(),
				expectedRevision: z.string(),
			},
			execute: async (args) =>
				service.mutateSchemaField({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					table: expectString(args.table, "table"),
					category: expectString(args.category, "category"),
					field: expectString(args.field, "field"),
					action: expectSchemaFieldAction(args.action),
					...(args.newName !== undefined ? { newName: expectString(args.newName, "newName") } : {}),
					expectedRevision: expectString(args.expectedRevision, "expectedRevision"),
					write: true,
				}),
		},
		{
			name: "benchmark_workspace",
			description: "Benchmark load/validate/resolve/build/runtime cold access/prewarm/warm access for a workspace.",
			inputSchema: {
				workspaceRoot: workspaceField,
				iterations: z.number().int().positive().optional(),
			},
			execute: async (args) =>
				service.benchmarkWorkspace({
					workspaceRoot: getWorkspaceRoot(args, defaultWorkspaceRoot),
					...(typeof args.iterations === "number" ? { iterations: args.iterations } : {}),
				}),
		},
	];
	if (service.getBootstrap().capabilities.schemaFieldMutation) return tools;
	return tools.filter((tool) => tool.name !== "preview_schema_field_mutation" && tool.name !== "apply_schema_field_mutation");
}

export function formatToolResult(result: unknown): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(result, null, 2),
			},
		],
	};
}

export function formatToolError(error: unknown): CallToolResult {
	const revisionConflict = isWorkspaceRevisionConflictError(error);
	return {
		isError: true,
		content: [
			{
				type: "text",
				text: revisionConflict
					? JSON.stringify({ ok: false, code: error.code, message: error.message }, null, 2)
					: error instanceof Error
						? error.message
						: String(error),
			},
		],
	};
}

function getWorkspaceRoot(args: Record<string, unknown>, defaultWorkspaceRoot: string): string {
	return asOptionalString(args.workspaceRoot) ?? defaultWorkspaceRoot;
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function expectString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Expected non-empty string for ${field}`);
	}
	return value;
}

function expectSchemaFieldAction(value: unknown): "rename" | "delete" {
	if (value !== "rename" && value !== "delete") throw new Error(`Expected rename or delete for action`);
	return value;
}

function expectJsonObject(value: unknown, field: string): JsonObject {
	if (!isJsonObjectRecord(value)) {
		throw new Error(`Expected JSON object for ${field}`);
	}
	const normalized: JsonObject = {};
	for (const [key, entry] of Object.entries(value)) {
		normalized[key] = toJsonValue(entry, `${field}.${key}`);
	}
	return normalized;
}

function expectJsonObjectMap(value: unknown, field: string): Record<string, JsonObject> {
	if (!isJsonObjectRecord(value)) {
		throw new Error(`Expected JSON object for ${field}`);
	}
	const normalized: Record<string, JsonObject> = {};
	for (const [key, entry] of Object.entries(value)) {
		normalized[key] = expectJsonObject(entry, `${field}.${key}`);
	}
	return normalized;
}

function expectStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`Expected string array for ${field}`);
	}
	return value.map((entry, index) => expectString(entry, `${field}[${index}]`));
}

function isJsonObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown, path: string): JsonValue {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => toJsonValue(entry, `${path}[${index}]`));
	}
	if (isJsonObjectRecord(value)) {
		const objectValue: JsonObject = {};
		for (const [key, entry] of Object.entries(value)) {
			objectValue[key] = toJsonValue(entry, `${path}.${key}`);
		}
		return objectValue;
	}
	throw new Error(`Expected JSON-compatible value at ${path}`);
}

