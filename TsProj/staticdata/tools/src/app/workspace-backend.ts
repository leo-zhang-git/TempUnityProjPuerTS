import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ApplySummary } from "../core/plan.js";
import type { SchemaRegistry } from "../core/schema.js";
import { type ValidationReport, validateWorkspace } from "../core/validate.js";
import type { VerifyOptions, VerifyReport } from "../core/verify.js";
import { loadWorkspace, type Workspace, writeWorkspace } from "../core/workspace.js";
import type { GridViewOptions, GridViewResult } from "./service.js";

export interface WorkspaceFileDiff {
	command: string;
	baseRoot: string;
	headRoot: string;
	text: string;
}

export interface WorkspaceWriteRequest {
	baseWorkspace?: Workspace;
	workspace: Workspace;
	computedWorkspace?: Workspace;
	validation?: ValidationReport;
	registry: SchemaRegistry;
	targetRoot: string;
	expectedRevision?: string;
	apply?: ApplySummary;
	changedTables?: string[];
}

export const WORKSPACE_REVISION_CONFLICT_CODE = "workspace_revision_conflict";

export const SCHEMA_FIELD_MUTATION_UNSUPPORTED_CODE = "schema_field_mutation_unsupported";

export class SchemaFieldMutationUnsupportedError extends Error {
	readonly code = SCHEMA_FIELD_MUTATION_UNSUPPORTED_CODE;

	constructor() {
		super("This workspace does not support schema field mutations");
		this.name = "SchemaFieldMutationUnsupportedError";
	}
}

export class WorkspaceRevisionConflictError extends Error {
	readonly code = WORKSPACE_REVISION_CONFLICT_CODE;

	constructor(
		readonly expectedRevision: string,
		readonly actualRevision: string,
	) {
		super("Workspace changed after it was read; reload the latest revision before writing");
		this.name = "WorkspaceRevisionConflictError";
	}
}

export function assertWorkspaceRevision(expectedRevision: string, actualRevision: string): void {
	if (expectedRevision !== actualRevision) {
		throw new WorkspaceRevisionConflictError(expectedRevision, actualRevision);
	}
}

export function isWorkspaceRevisionConflictError(error: unknown): error is WorkspaceRevisionConflictError {
	return (
		error instanceof WorkspaceRevisionConflictError ||
		(typeof error === "object" && error !== null && "code" in error && error.code === WORKSPACE_REVISION_CONFLICT_CODE)
	);
}

export interface WorkspaceFileDiffRequest {
	baseRoot: string;
	baseWorkspace?: Workspace;
	headWorkspace: Workspace;
	registry: SchemaRegistry;
	outDir?: string;
	changedTables?: string[];
	changedRecords?: Record<string, string[]>;
}

export interface WorkspaceValidationScope {
	tables?: readonly string[];
	records?: Readonly<Record<string, readonly string[]>>;
}

export type SchemaFieldMutationAction = "rename" | "delete";

export interface SchemaFieldMutationRequest {
	workspaceRoot: string;
	table: string;
	category: string;
	field: string;
	action: SchemaFieldMutationAction;
	newName?: string;
	expectedRevision?: string;
	write?: boolean;
}

export interface SchemaFieldMutationResult {
	ok: true;
	action: SchemaFieldMutationAction;
	table: string;
	category: string;
	field: string;
	newName?: string;
	scope: "category" | "table";
	affectedCategories: string[];
	affectedRecords: number;
	authoredValues: number;
	runtimeExport?: string;
	workspaceRevision: string;
	written: boolean;
	reloadRequired: boolean;
}

export interface StaticDataWorkspaceBackend {
	readonly kind: string;
	readonly patchScope?: "full" | "changed-tables";
	readonly lookupIndexMode?: "full" | "empty";
	getGridDirectory?(options: GridViewOptions): GridViewResult | undefined;
	getRevision(workspaceRoot: string): string;
	load(workspaceRoot: string, tables?: readonly string[]): Workspace;
	validate(workspace: Workspace, registry: SchemaRegistry, scope?: WorkspaceValidationScope): ValidationReport;
	write(request: WorkspaceWriteRequest): void;
	createFileDiff(request: WorkspaceFileDiffRequest): WorkspaceFileDiff;
	build?(request: { workspaceRoot: string; outDir?: string; workspace: Workspace; registry: SchemaRegistry }): {
		ok: true;
		outDir?: string;
		tables: string[];
	};
	verify?(request: { workspaceRoot: string; workspace: Workspace; registry: SchemaRegistry; options: VerifyOptions }): VerifyReport;
	mutateSchemaField?(request: SchemaFieldMutationRequest): SchemaFieldMutationResult;
}

export const defaultWorkspaceBackend: StaticDataWorkspaceBackend = {
	kind: "schema-first",
	getRevision: createWorkspaceRevision,
	load: loadWorkspace,
	validate(workspace, registry, scope) {
		return validateWorkspace(workspace, registry, scope?.tables ? { tables: scope.tables } : {});
	},
	write(request) {
		if (request.expectedRevision !== undefined) {
			assertWorkspaceRevision(request.expectedRevision, createWorkspaceRevision(request.targetRoot));
		}
		writeWorkspace(request.workspace, request.registry, request.targetRoot);
	},
	createFileDiff: createDefaultWorkspaceFileDiff,
};

function createWorkspaceRevision(workspaceRoot: string): string {
	const resolvedRoot = resolve(workspaceRoot);
	const hash = createHash("sha256");
	for (const path of listWorkspaceJsonFiles(resolvedRoot)) {
		hash.update(relative(resolvedRoot, path).replace(/\\/gu, "/"), "utf8");
		hash.update("\0", "utf8");
		hash.update(readFileSync(path));
		hash.update("\0", "utf8");
	}
	return `sha256:${hash.digest("hex")}`;
}

export function createDefaultWorkspaceFileDiff(request: WorkspaceFileDiffRequest): WorkspaceFileDiff {
	const resolvedBaseRoot = resolve(request.baseRoot);
	const baseJsonRoot = mkdtempSync(join(tmpdir(), "template-staticdata-base-"));
	const headRoot = request.outDir ? resolve(request.outDir) : mkdtempSync(join(tmpdir(), "template-staticdata-preview-"));
	const shouldCleanup = !request.outDir;
	try {
		if (request.outDir) rmSync(headRoot, { recursive: true, force: true });
		copyWorkspaceJsonFiles(resolvedBaseRoot, baseJsonRoot);
		writeWorkspace(request.headWorkspace, request.registry, headRoot);
		return {
			command: "git diff --no-index --no-color",
			baseRoot: resolvedBaseRoot,
			headRoot,
			text: runNoIndexDiff(baseJsonRoot, headRoot),
		};
	} finally {
		rmSync(baseJsonRoot, { recursive: true, force: true });
		if (shouldCleanup) rmSync(headRoot, { recursive: true, force: true });
	}
}

export function createEmptyWorkspaceFileDiff(baseRoot: string, outDir: string | undefined): WorkspaceFileDiff {
	const resolvedBaseRoot = resolve(baseRoot);
	return {
		command: "git diff --no-index --no-color",
		baseRoot: resolvedBaseRoot,
		headRoot: outDir ? resolve(outDir) : resolvedBaseRoot,
		text: "",
	};
}

function copyWorkspaceJsonFiles(fromRoot: string, toRoot: string): void {
	mkdirSync(toRoot, { recursive: true });
	for (const tableEntry of readdirSafe(fromRoot)) {
		if (!tableEntry.isDirectory() || tableEntry.name.startsWith(".")) continue;
		const sourceTableRoot = join(fromRoot, tableEntry.name);
		const files = readdirSafe(sourceTableRoot).filter(
			(fileEntry) => fileEntry.isFile() && !fileEntry.name.startsWith(".") && fileEntry.name.endsWith(".json"),
		);
		if (files.length === 0) continue;
		const targetTableRoot = join(toRoot, tableEntry.name);
		mkdirSync(targetTableRoot, { recursive: true });
		for (const fileEntry of files) copyFileSync(join(sourceTableRoot, fileEntry.name), join(targetTableRoot, fileEntry.name));
	}
}

function listWorkspaceJsonFiles(root: string): string[] {
	const files: string[] = [];
	for (const tableEntry of readdirSafe(root)) {
		if (!tableEntry.isDirectory() || tableEntry.name.startsWith(".")) continue;
		const tableRoot = join(root, tableEntry.name);
		for (const fileEntry of readdirSafe(tableRoot)) {
			if (fileEntry.isFile() && !fileEntry.name.startsWith(".") && fileEntry.name.endsWith(".json")) {
				files.push(join(tableRoot, fileEntry.name));
			}
		}
	}
	return files.sort((left, right) => left.localeCompare(right));
}

function readdirSafe(path: string) {
	try {
		return readdirSync(path, { withFileTypes: true });
	} catch {
		return [];
	}
}

function runNoIndexDiff(baseRoot: string, headRoot: string): string {
	const result = spawnSync("git", ["diff", "--no-index", "--no-color", "--", baseRoot, headRoot], {
		encoding: "utf8",
	});
	if (result.status === 0 || result.status === 1) return result.stdout;
	const message = result.stderr.trim() || result.error?.message || "unknown git diff error";
	throw new Error(`Failed to generate file diff: ${message}`);
}
