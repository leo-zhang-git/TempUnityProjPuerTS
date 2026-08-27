import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { type DerivationResult, type DerivationRuleRegistry, deriveWorkspace, getDerivationDownstreamTables } from "../core/derivation.js";
import { applyPlan, type DeleteRecordOp, describePlan, type InsertRecordOp, type Plan, type UpdateFieldsOp } from "../core/plan.js";
import { canonicalizeResolvedWorkspace, createReviewArtifacts } from "../core/review.js";
import type { SchemaRegistry } from "../core/schema.js";
import { assertValid } from "../core/validate.js";
import { resolveWorkspace, type Workspace } from "../core/workspace.js";
import { createRecordUpdateOperations, toRecordCreateDraft, toRecordUpdateDraft, toRecordUpdateKey } from "./record-editor.js";
import type {
	ExecutePlanOptions,
	ExecutePlanResult,
	RecordBatchUpdateRequest,
	RecordCreateRequest,
	RecordUpdatePreviewResult,
	RecordUpdateRequest,
} from "./service.js";
import { assertWorkspaceRevision, createEmptyWorkspaceFileDiff, type StaticDataWorkspaceBackend } from "./workspace-backend.js";
import type { WorkspaceContextStore } from "./workspace-context-store.js";

interface PreparedPreview {
	token: string;
	workspaceRoot: string;
	workspaceRevision: string;
	createdAt: number;
	plan: Plan;
	payloadHash: string;
}

const PREVIEW_TOKEN_TTL_MS = 2 * 60 * 1000;
const MAX_PREPARED_PREVIEWS = 8;

/** Executes canonical plans and manages revision-bound record edit previews. */
export class StaticDataPlanExecutor {
	private readonly preparedPreviews = new Map<string, PreparedPreview>();

	constructor(
		private readonly schemaRegistry: SchemaRegistry,
		private readonly workspaceBackend: StaticDataWorkspaceBackend,
		private readonly derivationRegistry: DerivationRuleRegistry,
		private readonly contextStore: WorkspaceContextStore,
		private readonly invalidateWorkspaceContext: (workspaceRoot: string) => void,
	) {}

	describePlan(planInput: unknown) {
		return {
			ok: true as const,
			...describePlan(planInput, this.schemaRegistry),
		};
	}

	executePlan(options: ExecutePlanOptions): ExecutePlanResult {
		const workspaceRoot = resolve(options.workspaceRoot);
		const workspaceRevision = this.contextStore.getRevision(workspaceRoot);
		const description = describePlan(options.planInput, this.schemaRegistry);
		if (!description.executable) throw new Error(description.boundaries[0] ?? "Plan is not executable");
		const changedTables = getPlanTableNames(description.normalized);
		const affectedTables = getDerivationDownstreamTables(changedTables, this.derivationRegistry);
		const context = this.contextStore.load(workspaceRoot, affectedTables);
		assertValid(context.validation);
		const workspace = context.authoredWorkspace;
		const scopedPatch = this.workspaceBackend.patchScope === "changed-tables" && description.normalized.kind === "patch";
		const result = applyPlan(workspace, this.schemaRegistry, description.normalized, scopedPatch ? { cloneTables: changedTables } : {});
		const headDerivation = deriveWorkspace(result.workspace, this.schemaRegistry, this.derivationRegistry);
		const reviewBase = scopedPatch ? selectWorkspaceTables(context.workspace, affectedTables) : context.workspace;
		const reviewHead = scopedPatch ? selectWorkspaceTables(headDerivation.workspace, affectedTables) : headDerivation.workspace;
		const validation = this.contextStore.validateDerived(headDerivation, affectedTables);
		assertValid(validation);
		const reviewArtifacts = createReviewArtifacts(
			resolveWorkspace(reviewBase, this.schemaRegistry),
			resolveWorkspace(reviewHead, this.schemaRegistry),
			this.schemaRegistry,
		);

		let writtenTo: string | undefined;
		if (options.write) {
			this.workspaceBackend.write({
				baseWorkspace: workspace,
				workspace: result.workspace,
				computedWorkspace: headDerivation.workspace,
				validation,
				registry: this.schemaRegistry,
				targetRoot: workspaceRoot,
				expectedRevision: workspaceRevision,
				apply: result.summary,
				changedTables: affectedTables,
			});
			this.invalidateWorkspaceContext(workspaceRoot);
			writtenTo = workspaceRoot;
		} else if (options.outDir) {
			writtenTo = resolve(options.outDir);
			this.workspaceBackend.write({
				baseWorkspace: workspace,
				workspace: result.workspace,
				computedWorkspace: headDerivation.workspace,
				registry: this.schemaRegistry,
				targetRoot: writtenTo,
				apply: result.summary,
				changedTables: affectedTables,
			});
		}

		return {
			ok: true,
			...(writtenTo ? { writtenTo } : {}),
			plan: description.normalized,
			apply: result.summary,
			diff: reviewArtifacts.diff,
			review: reviewArtifacts.summary,
			validation,
			resolvedHead: canonicalizeResolvedWorkspace(resolveWorkspace(reviewHead, this.schemaRegistry)),
		};
	}

	previewRecordUpdate(request: RecordUpdateRequest): RecordUpdatePreviewResult {
		return this.previewRecordUpdates({
			workspaceRoot: request.workspaceRoot,
			updates: [toRecordUpdateDraft(request)],
			...(request.write !== undefined ? { write: request.write } : {}),
			...(request.outDir !== undefined ? { outDir: request.outDir } : {}),
		});
	}

	previewRecordCreate(request: RecordCreateRequest): RecordUpdatePreviewResult {
		return this.previewRecordUpdates({
			workspaceRoot: request.workspaceRoot,
			updates: [toRecordCreateDraft(request)],
			...(request.write !== undefined ? { write: request.write } : {}),
			...(request.outDir !== undefined ? { outDir: request.outDir } : {}),
		});
	}

	previewRecordUpdates(request: RecordBatchUpdateRequest): RecordUpdatePreviewResult {
		if (request.updates.length === 0) throw new Error("Batch update requires at least one record");
		const requestTables = [...new Set(request.updates.map((update) => update.table))];
		const requestRecords = Object.fromEntries(
			requestTables.map((table) => [
				table,
				[...new Set(request.updates.filter((update) => update.table === table).map((update) => update.id))],
			]),
		);
		const context =
			this.contextStore.findCachedRecords(request.workspaceRoot, requestTables, requestRecords) ??
			this.contextStore.load(request.workspaceRoot, requestTables, requestRecords);
		const seenRecords = new Set<string>();
		const ops: Array<InsertRecordOp | UpdateFieldsOp | DeleteRecordOp> = [];
		for (const update of request.updates) {
			const key = toRecordUpdateKey(update.table, update.id);
			if (seenRecords.has(key)) throw new Error(`Duplicate batch record: ${key}`);
			seenRecords.add(key);
			ops.push(...createRecordUpdateOperations(this.schemaRegistry, context.authoredWorkspace, update));
		}
		return this.previewPlan({
			workspaceRoot: request.workspaceRoot,
			planInput: { kind: "patch", ops },
			...(request.write !== undefined ? { write: request.write } : {}),
			...(request.outDir !== undefined ? { outDir: request.outDir } : {}),
		});
	}

	applyPreviewToken(token: string): RecordUpdatePreviewResult {
		this.cleanupPreparedPreviews();
		const prepared = this.preparedPreviews.get(token);
		if (!prepared) throw new Error("Preview token is missing, expired, or has already been applied");
		this.preparedPreviews.delete(token);
		return this.previewPlan(
			{ workspaceRoot: prepared.workspaceRoot, planInput: prepared.plan, write: true },
			{ workspaceRevision: prepared.workspaceRevision, payloadHash: prepared.payloadHash },
		);
	}

	private previewPlan(
		options: ExecutePlanOptions,
		expected?: { workspaceRevision: string; payloadHash: string },
	): RecordUpdatePreviewResult {
		const workspaceRoot = resolve(options.workspaceRoot);
		const workspaceRevision = this.contextStore.getRevision(workspaceRoot);
		if (expected) assertWorkspaceRevision(expected.workspaceRevision, workspaceRevision);
		const description = describePlan(options.planInput, this.schemaRegistry);
		if (!description.executable) throw new Error(description.boundaries[0] ?? "Plan is not executable");
		const changedTables = getPlanTableNames(description.normalized);
		const affectedTables = getDerivationDownstreamTables(changedTables, this.derivationRegistry);
		const planRecords = getPlanRecordIds(description.normalized);
		const context =
			this.contextStore.findCachedRecords(workspaceRoot, affectedTables, planRecords) ??
			this.contextStore.load(workspaceRoot, affectedTables, planRecords);
		const workspace = context.authoredWorkspace;
		const scopedPatch = this.workspaceBackend.patchScope === "changed-tables" && description.normalized.kind === "patch";
		const result = applyPlan(workspace, this.schemaRegistry, description.normalized, scopedPatch ? { cloneTables: changedTables } : {});
		const computedResult = applyPlan(
			context.workspace,
			this.schemaRegistry,
			description.normalized,
			scopedPatch ? { cloneTables: changedTables } : {},
		);
		const headDerivation = deriveWorkspace(result.workspace, this.schemaRegistry, this.derivationRegistry, {
			initialWorkspace: computedResult.workspace,
			recordIdsByTable: planRecords,
		});
		const affectedRecords = mergeDerivedRecordIds(planRecords, headDerivation);
		const reviewBaseWorkspace = scopedPatch ? selectWorkspaceTables(context.workspace, affectedTables) : context.workspace;
		const reviewHeadWorkspace = scopedPatch ? selectWorkspaceTables(headDerivation.workspace, affectedTables) : headDerivation.workspace;
		const validation = this.contextStore.validateDerived(headDerivation, affectedTables, affectedRecords);
		const resolvedRecordTables = Object.keys(affectedRecords);
		const baseResolved = resolveWorkspace(selectWorkspaceTables(reviewBaseWorkspace, resolvedRecordTables), this.schemaRegistry, {
			records: affectedRecords,
			templateWorkspace: context.workspace,
		});
		const headResolved = resolveWorkspace(selectWorkspaceTables(reviewHeadWorkspace, resolvedRecordTables), this.schemaRegistry, {
			records: affectedRecords,
			templateWorkspace: headDerivation.workspace,
		});
		const reviewArtifacts = createReviewArtifacts(baseResolved, headResolved, this.schemaRegistry);
		const payloadHash = createHash("sha256").update(JSON.stringify(description.normalized)).digest("hex");
		if (expected && expected.payloadHash !== payloadHash) throw new Error("Preview payload no longer matches its canonical plan");
		const fileDiff =
			result.summary.operations > 0
				? this.workspaceBackend.createFileDiff({
						baseRoot: workspaceRoot,
						baseWorkspace: workspace,
						headWorkspace: result.workspace,
						registry: this.schemaRegistry,
						changedTables: affectedTables,
						changedRecords: affectedRecords,
						...(options.outDir ? { outDir: options.outDir } : {}),
					})
				: createEmptyWorkspaceFileDiff(workspaceRoot, options.outDir);

		let writtenTo: string | undefined;
		if (options.write && validation.ok) {
			this.workspaceBackend.write({
				baseWorkspace: workspace,
				workspace: result.workspace,
				computedWorkspace: headDerivation.workspace,
				validation,
				registry: this.schemaRegistry,
				targetRoot: workspaceRoot,
				expectedRevision: workspaceRevision,
				apply: result.summary,
				changedTables: affectedTables,
			});
			this.invalidateWorkspaceContext(workspaceRoot);
			writtenTo = workspaceRoot;
		}

		const preview: RecordUpdatePreviewResult = {
			ok: true,
			canApply: validation.ok,
			...(writtenTo ? { writtenTo } : {}),
			plan: description.normalized,
			apply: result.summary,
			diff: reviewArtifacts.diff,
			review: reviewArtifacts.summary,
			validation,
			resolvedHead: canonicalizeResolvedWorkspace(headResolved),
			fileDiff,
			workspaceRevision: writtenTo ? this.contextStore.getRevision(workspaceRoot) : workspaceRevision,
			payloadHash,
		};
		if (!writtenTo && validation.ok && result.summary.operations > 0) {
			assertWorkspaceRevision(workspaceRevision, this.contextStore.getRevision(workspaceRoot));
			const token = randomUUID();
			preview.previewToken = token;
			this.rememberPreparedPreview({
				token,
				workspaceRoot,
				workspaceRevision,
				createdAt: Date.now(),
				plan: description.normalized,
				payloadHash,
			});
		}
		return preview;
	}

	private rememberPreparedPreview(preview: PreparedPreview): void {
		this.cleanupPreparedPreviews();
		this.preparedPreviews.set(preview.token, preview);
		while (this.preparedPreviews.size > MAX_PREPARED_PREVIEWS) {
			const oldest = [...this.preparedPreviews.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
			if (!oldest) break;
			this.preparedPreviews.delete(oldest.token);
		}
	}

	private cleanupPreparedPreviews(): void {
		const cutoff = Date.now() - PREVIEW_TOKEN_TTL_MS;
		for (const [token, preview] of this.preparedPreviews) {
			if (preview.createdAt < cutoff) this.preparedPreviews.delete(token);
		}
	}
}

function getPlanTableNames(plan: Plan): string[] {
	if (plan.kind === "patch") return [...new Set(plan.ops.map((operation) => operation.record.table))].sort();
	if (plan.kind === "refactor") return [...new Set(plan.ops.map((operation) => operation.table))].sort();
	return [];
}

function getPlanRecordIds(plan: Plan): Record<string, string[]> {
	const records = new Map<string, Set<string>>();
	const add = (table: string, id: string): void => {
		const ids = records.get(table) ?? new Set<string>();
		ids.add(id);
		records.set(table, ids);
	};
	if (plan.kind === "patch") {
		for (const operation of plan.ops) add(operation.record.table, operation.record.id);
	} else if (plan.kind === "refactor") {
		for (const operation of plan.ops) {
			add(operation.table, operation.from);
			add(operation.table, operation.to);
		}
	}
	return Object.fromEntries(
		[...records].sort(([left], [right]) => left.localeCompare(right)).map(([table, ids]) => [table, [...ids].sort()]),
	);
}

function mergeDerivedRecordIds(records: Record<string, string[]>, derivation: DerivationResult): Record<string, string[]> {
	const merged = new Map(Object.entries(records).map(([table, ids]) => [table, new Set(ids)]));
	for (const provenance of Object.values(derivation.provenance)) {
		const ids = merged.get(provenance.table) ?? new Set<string>();
		ids.add(provenance.id);
		merged.set(provenance.table, ids);
	}
	return Object.fromEntries(
		[...merged].sort(([left], [right]) => left.localeCompare(right)).map(([table, ids]) => [table, [...ids].sort()]),
	);
}

function selectWorkspaceTables(workspace: Workspace, tableNames: readonly string[]): Workspace {
	const tables: Workspace["tables"] = {};
	for (const tableName of tableNames) {
		const table = workspace.tables[tableName];
		if (table) tables[tableName] = table;
	}
	return { root: workspace.root, tables };
}

