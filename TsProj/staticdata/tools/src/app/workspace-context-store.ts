import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { type DerivationResult, type DerivationRuleRegistry, deriveWorkspace, getDerivationRelatedTables } from "../core/derivation.js";
import type { SchemaRegistry } from "../core/schema.js";
import { assertValid, type ValidationReport } from "../core/validate.js";
import { type ResolvedWorkspace, resolveWorkspace, type Workspace } from "../core/workspace.js";
import type { StaticDataWorkspaceBackend } from "./workspace-backend.js";

export interface WorkspaceContext {
	authoredWorkspace: Workspace;
	workspace: Workspace;
	validation: ValidationReport;
	derivation: DerivationResult;
}

interface CachedWorkspaceContext {
	revision: string;
	context: WorkspaceContext;
	records?: Readonly<Record<string, readonly string[]>>;
}

/** Owns revision-bound workspace contexts and their invalidation lifecycle. */
export class WorkspaceContextStore {
	private readonly cache = new Map<string, CachedWorkspaceContext>();

	constructor(
		private readonly schemaRegistry: SchemaRegistry,
		private readonly workspaceBackend: StaticDataWorkspaceBackend,
		private readonly derivationRegistry: DerivationRuleRegistry,
	) {}

	load(
		workspaceRoot: string,
		tables?: readonly string[],
		records?: Readonly<Record<string, readonly string[]>>,
		preloadedAuthoredWorkspace?: Workspace,
	): WorkspaceContext {
		const resolvedRoot = resolve(workspaceRoot);
		const relatedTables = tables ? getDerivationRelatedTables(tables, this.derivationRegistry) : undefined;
		const cacheKey = createWorkspaceContextCacheKey(resolvedRoot, relatedTables, records);
		const revision = this.workspaceBackend.getRevision(resolvedRoot);
		const cached = this.cache.get(cacheKey);
		if (cached && cached.revision === revision) return cached.context;
		const authoredWorkspace = preloadedAuthoredWorkspace ?? this.workspaceBackend.load(resolvedRoot, relatedTables);
		const derivation = deriveWorkspace(authoredWorkspace, this.schemaRegistry, this.derivationRegistry);
		const context = {
			authoredWorkspace,
			workspace: derivation.workspace,
			validation: this.validateDerived(derivation, relatedTables, records),
			derivation,
		};
		this.cache.set(cacheKey, { revision, context, ...(records ? { records } : {}) });
		return context;
	}

	findCachedRecords(
		workspaceRoot: string,
		tables: readonly string[],
		records: Readonly<Record<string, readonly string[]>>,
	): WorkspaceContext | undefined {
		const resolvedRoot = resolve(workspaceRoot);
		const revision = this.workspaceBackend.getRevision(resolvedRoot);
		const rootPrefix = `${resolvedRoot}\u0000`;
		const requiredTables = getDerivationRelatedTables(tables, this.derivationRegistry);
		for (const [key, cached] of this.cache) {
			if (cached.revision !== revision || !key.startsWith(rootPrefix)) continue;
			if (requiredTables.some((table) => cached.context.workspace.tables[table] === undefined)) continue;
			let coversRecords = true;
			for (const [table, ids] of Object.entries(records)) {
				if (cached.records && ids.some((id) => !cached.records?.[table]?.includes(id))) {
					coversRecords = false;
					break;
				}
				const tableStore = cached.context.workspace.tables[table];
				if (!tableStore || ids.some((id) => !Object.values(tableStore.categories).some((category) => category.core[id] !== undefined))) {
					coversRecords = false;
					break;
				}
			}
			if (coversRecords) return cached.context;
		}
		return undefined;
	}

	validateDerived(
		derivation: DerivationResult,
		tables?: readonly string[],
		records?: Readonly<Record<string, readonly string[]>>,
	): ValidationReport {
		const validation = this.workspaceBackend.validate(
			derivation.workspace,
			this.schemaRegistry,
			tables || records ? { ...(tables ? { tables } : {}), ...(records ? { records } : {}) } : undefined,
		);
		const derivationIssues = derivation.issues.map(({ path, message }) => ({ path, message }));
		const issues = [...validation.issues, ...derivationIssues].sort(
			(left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message),
		);
		return {
			ok: validation.ok && derivationIssues.length === 0,
			issues,
			recordCount: validation.recordCount,
		};
	}

	loadValidated(workspaceRoot: string): WorkspaceContext & { resolved: ResolvedWorkspace } {
		const context = this.load(workspaceRoot);
		assertValid(context.validation);
		return {
			...context,
			resolved: resolveWorkspace(context.workspace, this.schemaRegistry),
		};
	}

	loadChecked(workspaceRoot: string): Workspace {
		const context = this.load(workspaceRoot);
		assertValid(context.validation);
		return context.workspace;
	}

	invalidate(workspaceRoot: string): void {
		const rootPrefix = `${resolve(workspaceRoot)}\u0000`;
		for (const key of this.cache.keys()) {
			if (key.startsWith(rootPrefix)) this.cache.delete(key);
		}
	}

	getRevision(workspaceRoot: string): string {
		return this.workspaceBackend.getRevision(resolve(workspaceRoot));
	}
}

function createWorkspaceContextCacheKey(
	workspaceRoot: string,
	tables: readonly string[] | undefined,
	records?: Readonly<Record<string, readonly string[]>>,
): string {
	const recordScope = records
		? createHash("sha256")
				.update(
					JSON.stringify(
						Object.fromEntries(
							Object.entries(records)
								.sort(([left], [right]) => left.localeCompare(right))
								.map(([table, ids]) => [table, [...ids]]),
						),
					),
				)
				.digest("base64url")
				.slice(0, 16)
		: "*";
	return `${workspaceRoot}\u0000${tables?.join("\u0000") ?? "*"}\u0000${recordScope}`;
}

