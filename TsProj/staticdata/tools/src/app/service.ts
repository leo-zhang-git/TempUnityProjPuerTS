import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type DerivationRuleRegistry, deriveWorkspace, emptyDerivationRegistry, getDerivationRelatedTables } from "../core/derivation.js";
import type { ApplySummary, Plan } from "../core/plan.js";
import { filterRecordIssues, filterSidecarIrByCategory } from "../core/query-utils.js";
import {
	createRefIndex,
	getRecordReferences,
	getRecordReferrers,
	type RefIndex,
	type RefIndexForwardEntry,
	type RefIndexReverseEntry,
} from "../core/ref-index.js";
import {
	canonicalizeResolvedWorkspace,
	createReviewArtifacts,
	type ReviewArtifacts,
	type ReviewSummary,
	type SemanticDiff,
} from "../core/review.js";
import {
	type FieldDefinition,
	getAvailableSidecarSchemas,
	getCoreSchema,
	getTableSchema,
	type JsonObject,
	type JsonValue,
	type SchemaRegistry,
} from "../core/schema.js";
import {
	createSchemaCatalog,
	createSchemaIR,
	type FieldIR,
	type ObjectFieldIR,
	type SchemaCatalog,
	type SchemaIR,
	type SidecarIR,
} from "../core/schema-ir.js";
import { assertValid, type ValidationIssue, type ValidationReport } from "../core/validate.js";
import { type VerifyIssue, type VerifyOptions, type VerifyReport, verifyWorkspace } from "../core/verify.js";
import {
	buildArtifacts,
	getCategoryRecordOrder,
	materializeRecordWithSchema,
	type ResolvedRecord,
	type ResolvedWorkspace,
	resolveWorkspace,
	writeBuildArtifacts,
} from "../core/workspace.js";
import { type BenchmarkOptions, type BenchmarkReport, benchmarkWorkspace } from "./benchmark.js";
import { buildRecordSummaryValues, getLookupLabel, getRecordSummaryColumns, type SummaryBuilderRegistry } from "./display.js";
import {
	buildGridCategoryEntry,
	buildGridColumns,
	buildGridRows,
	buildGridTableEntry,
	compareGridCategoryNames,
	compareGridRows,
	compareGridTableNames,
	countAvailableSidecars,
	filterGridFiltersForColumns,
	matchesGridFilters,
	normalizeGridFilters,
	normalizeGridSidecars,
	normalizeGridSort,
	toSidecarSummaries,
} from "./grid-builder.js";
import { type AppManifest, createAppManifest } from "./manifest.js";
import { materializeSidecars } from "./materialization.js";
import { StaticDataPlanExecutor } from "./plan-executor.js";
import { getRecordDetail } from "./record-detail-builder.js";
import {
	assertWorkspaceRevision,
	defaultWorkspaceBackend,
	type SchemaFieldMutationRequest,
	type SchemaFieldMutationResult,
	SchemaFieldMutationUnsupportedError,
	type StaticDataWorkspaceBackend,
	type WorkspaceFileDiff,
} from "./workspace-backend.js";
import { type WorkspaceContext, WorkspaceContextStore } from "./workspace-context-store.js";
import {
	buildWorkspaceSearchDocuments,
	matchWorkspaceSearchDocuments,
	type WorkspaceSearchDocument,
	type WorkspaceSearchEntry,
	type WorkspaceSearchMatch,
} from "./workspace-search.js";

export interface WorkspaceSelection {
	table?: string;
	id?: string;
}

export interface BuildWorkspaceOptions {
	workspaceRoot: string;
	outDir?: string;
}

export interface BuildWorkspaceResult {
	ok: true;
	outDir?: string;
	tables: string[];
}

export interface ReviewWorkspaceOptions {
	baseRoot: string;
	headRoot: string;
	outDir?: string;
	sampleLimit?: number;
}

export interface ReviewWorkspaceResult {
	ok: true;
	outDir?: string;
	artifacts: ReviewArtifacts;
}

export interface FormatWorkspaceOptions {
	workspaceRoot: string;
	check?: boolean;
}

export interface FormatWorkspaceResult {
	ok: boolean;
	changed: boolean;
	checked: boolean;
	fileDiff: WorkspaceFileDiff;
}

export interface ExecutePlanOptions {
	workspaceRoot: string;
	planInput: unknown;
	write?: boolean;
	outDir?: string;
}

export interface ExecutePlanResult {
	ok: true;
	writtenTo?: string;
	plan: Plan;
	apply: ApplySummary;
	diff: SemanticDiff;
	review: ReviewSummary;
	validation: ValidationReport;
	resolvedHead: ResolvedWorkspace;
}

export type { WorkspaceFileDiff } from "./workspace-backend.js";

export interface RecordUpdatePreviewResult extends ExecutePlanResult {
	canApply: boolean;
	fileDiff: WorkspaceFileDiff;
	workspaceRevision: string;
	payloadHash: string;
	previewToken?: string;
}

export type RecordStatus = "ok" | "issue";
export type RecordStatusFilter = "all" | RecordStatus;

export interface ListRecordsOptions {
	workspaceRoot: string;
	table?: string;
	category?: string;
	query?: string;
	status?: RecordStatusFilter;
	limit?: number;
}

export interface RecordListEntry {
	table: string;
	id: string;
	category: string;
	label?: string;
	hasSidecar: boolean;
	sidecarNames: string[];
	issueCount: number;
	status: RecordStatus;
	summaryValues: RecordSummaryValue[];
}

export interface RecordListResult {
	total: number;
	limit: number;
	truncated: number;
	statusCounts: {
		ok: number;
		issue: number;
	};
	summaryColumns: RecordSummaryColumn[];
	entries: RecordListEntry[];
}

export interface RecordSummaryColumn {
	key: string;
	label: string;
}

export interface RecordSummaryValue {
	key: string;
	label: string;
	value: string;
}

export interface LookupOption {
	table: string;
	id: string;
	category: string;
	label?: string;
	issueCount: number;
}

export interface LookupTableIndex {
	table: string;
	categories: string[];
	options: LookupOption[];
}

export interface LookupIndex {
	tables: Record<string, LookupTableIndex>;
}

export interface GridViewOptions {
	workspaceRoot: string;
	table?: string;
	category?: string;
	query?: string;
	sidecars?: readonly string[];
	sort?: string;
	sortDir?: "asc" | "desc";
	filters?: Record<string, string>;
	search?: string;
	searchFieldNames?: boolean;
	focusId?: string;
	limit?: number;
	cursor?: string;
	page?: number;
}

export interface GridTableEntry {
	table: string;
	categoryCount: number;
	recordCount: number;
	issueCount: number;
	fieldCount: number;
	sidecars: GridSidecarSummary[];
	sidecarRecordCount: number;
	singleCategory?: string;
}

export interface GridCategoryEntry {
	table: string;
	category: string;
	recordCount: number;
	issueCount: number;
	fieldCount: number;
	sidecars: GridSidecarSummary[];
	sidecarRecordCount: number;
}

export interface GridSidecarSummary {
	name: string;
	recordCount: number;
}

export interface GridColumn {
	key: string;
	label: string;
	fieldKey: string;
	fieldPath?: readonly string[];
	target: "core" | "sidecar";
	sidecarName?: string;
	wholeSidecar?: boolean;
	kind: FieldDefinition["kind"];
	profile?: string;
	required: boolean;
	editable: boolean;
	derived?: {
		ruleId: string;
		allowOverride: boolean;
	};
	description?: string;
	default?: JsonValue;
	metadata?: JsonObject;
	values?: readonly string[];
	enumLabels?: Record<string, string>;
	labels?: Record<string, string>;
	refTable?: string;
	refCategories?: readonly string[];
	table?: string;
	categories?: readonly string[];
	fields?: ObjectFieldIR["fields"];
	element?: FieldIR;
	value?: FieldIR;
	variants?: readonly FieldIR[];
	conditionalRules?: Pick<ObjectFieldIR, "requiresWhen" | "forbidsWhen" | "oneOfFields">;
}

export interface GridCellIssue {
	path: string;
	relativePath: string;
	message: string;
}

export interface GridCell {
	authored?: JsonValue;
	resolved?: JsonValue;
	source: "authored" | "default" | "derived" | "override" | "missing";
	display: string;
	issues: GridCellIssue[];
}

export interface GridRow {
	table: string;
	category: string;
	id: string;
	uniqueKeyValue?: JsonValue;
	label?: string;
	status: RecordStatus;
	issueCount: number;
	issues: ValidationIssue[];
	hasSidecar: boolean;
	sidecarNames: string[];
	cells: Record<string, GridCell>;
	search?: {
		totalMatches: number;
		matches: WorkspaceSearchMatch[];
	};
}

export interface GridViewResult {
	mode: "tables" | "categories" | "records";
	table?: string;
	category?: string;
	uniqueKey?: string;
	uniqueKeyColumn?: GridColumn;
	sidecars?: string[];
	availableSidecars?: GridSidecarSummary[];
	total: number;
	limit: number;
	truncated: number;
	offset?: number;
	page?: number;
	pageCount?: number;
	cursor?: string;
	nextCursor?: string;
	previousCursor?: string;
	sort?: {
		key: string;
		dir: "asc" | "desc";
	};
	filters: Record<string, string>;
	search?: {
		query: string;
		fieldNames: boolean;
	};
	tables?: GridTableEntry[];
	categories?: GridCategoryEntry[];
	columns?: GridColumn[];
	rows?: GridRow[];
}

export interface WorkspaceSearchOptions {
	workspaceRoot: string;
	query: string;
	table?: string;
	category?: string;
	fieldNames?: boolean;
	limit?: number;
	cursor?: string;
}

export interface WorkspaceSearchResult {
	revision: string;
	query: string;
	table?: string;
	category?: string;
	fieldNames: boolean;
	total: number;
	limit: number;
	offset: number;
	entries: WorkspaceSearchEntry[];
	cursor?: string;
	nextCursor?: string;
	previousCursor?: string;
}

export interface RecordReferrersResult {
	revision: string;
	entries: RefIndexReferrer[];
}

export interface FieldProvenance {
	path: string;
	source: "authored" | "default" | "derived" | "override";
	value: JsonValue | undefined;
	ruleId?: string;
	allowOverride?: boolean;
}

export interface RecordReference {
	path: string;
	targetTable: string;
	targetCategories?: string[];
	targetId: string;
}

export type RefIndexReference = RefIndexForwardEntry;
export type RefIndexReferrer = RefIndexReverseEntry;

export interface RecordDetail {
	table: string;
	id: string;
	category: string;
	uniqueKey?: string;
	authored: {
		core: JsonObject;
		sidecars?: Record<string, JsonObject>;
	};
	resolved: ResolvedRecord;
	schema: {
		core: ObjectFieldIR;
		sidecars?: Record<string, SidecarIR>;
	};
	provenance: {
		core: FieldProvenance[];
		sidecars?: Record<string, FieldProvenance[]>;
	};
	references: RecordReference[];
	issues: ValidationIssue[];
}

export interface RecordCreateRequest {
	workspaceRoot: string;
	table: string;
	category: string;
	id: string;
	authoredCore: JsonObject;
	authoredSidecars?: Record<string, JsonObject> | undefined;
	write?: boolean;
	outDir?: string;
}

export interface RecordUpdateRequest {
	workspaceRoot: string;
	table: string;
	id: string;
	authoredCore: JsonObject;
	authoredSidecars?: Record<string, JsonObject> | undefined;
	deleteSidecars?: string[] | undefined;
	deleteRecord?: boolean | undefined;
	write?: boolean;
	outDir?: string;
}

export interface RecordBatchUpdateRequest {
	workspaceRoot: string;
	updates: RecordUpdateDraft[];
	write?: boolean;
	outDir?: string;
}

export interface RecordUpdateDraft {
	table: string;
	category?: string;
	id: string;
	authoredCore: JsonObject;
	authoredSidecars?: Record<string, JsonObject> | undefined;
	deleteSidecars?: string[] | undefined;
	deleteRecord?: boolean | undefined;
	create?: boolean;
}

export interface AppBootstrap {
	manifest: AppManifest;
	catalog: SchemaCatalog;
	capabilities: {
		schemaFieldMutation: boolean;
	};
}

interface CachedLookupIndex {
	revision: string;
	index: LookupIndex;
}

interface CachedWorkspaceSearchIndex {
	revision: string;
	documents: WorkspaceSearchDocument[];
}

const GRID_CELL_BUDGET = 2400;

export class StaticDataService {
	private readonly schemaIr: SchemaIR;
	private readonly schemaCatalog: SchemaCatalog;
	private readonly contextStore: WorkspaceContextStore;
	private readonly planExecutor: StaticDataPlanExecutor;
	private readonly lookupIndexCache = new Map<string, CachedLookupIndex>();
	private readonly workspaceSearchIndexCache = new Map<string, CachedWorkspaceSearchIndex>();

	constructor(
		private readonly schemaRegistry: SchemaRegistry,
		private readonly workspaceBackend: StaticDataWorkspaceBackend = defaultWorkspaceBackend,
		private readonly derivationRegistry: DerivationRuleRegistry = emptyDerivationRegistry,
		private readonly summaryBuilders: SummaryBuilderRegistry = {},
	) {
		this.schemaIr = createSchemaIR(schemaRegistry);
		this.schemaCatalog = createSchemaCatalog(this.schemaIr);
		this.contextStore = new WorkspaceContextStore(schemaRegistry, workspaceBackend, derivationRegistry);
		this.planExecutor = new StaticDataPlanExecutor(
			schemaRegistry,
			workspaceBackend,
			derivationRegistry,
			this.contextStore,
			(workspaceRoot) => this.invalidateWorkspaceContext(workspaceRoot),
		);
	}

	getBootstrap(): AppBootstrap {
		return {
			manifest: createAppManifest(),
			catalog: this.schemaCatalog,
			capabilities: {
				schemaFieldMutation: this.workspaceBackend.mutateSchemaField !== undefined,
			},
		};
	}

	mutateSchemaField(request: SchemaFieldMutationRequest): SchemaFieldMutationResult {
		if (!this.workspaceBackend.mutateSchemaField) {
			throw new SchemaFieldMutationUnsupportedError();
		}
		return this.workspaceBackend.mutateSchemaField(request);
	}

	getManifest(): AppManifest {
		return createAppManifest();
	}

	getSchema(): SchemaIR {
		return this.schemaIr;
	}

	getLookupIndex(workspaceRoot: string, requestedTables?: readonly string[]): LookupIndex {
		if (this.workspaceBackend.lookupIndexMode === "empty") return { tables: {} };
		const tableNames = requestedTables?.length
			? [...new Set(requestedTables)].sort((left, right) => left.localeCompare(right))
			: Object.keys(this.schemaRegistry.tables).sort((left, right) => left.localeCompare(right));
		for (const table of tableNames) {
			if (!this.schemaRegistry.tables[table]) throw new Error(`Unknown lookup table: ${table}`);
		}
		const resolvedRoot = resolve(workspaceRoot);
		const revision = this.getWorkspaceRevision(resolvedRoot);
		const cacheKey = `${resolvedRoot}\u0000${tableNames.join("\u0000")}`;
		const cached = this.lookupIndexCache.get(cacheKey);
		if (cached && cached.revision === revision) return cached.index;
		const { workspace, validation } = this.contextStore.load(resolvedRoot, requestedTables?.length ? tableNames : undefined);
		const tables: LookupIndex["tables"] = {};
		for (const tableName of tableNames) {
			const tableSchema = this.schemaRegistry.tables[tableName];
			if (!tableSchema) {
				continue;
			}
			const categories = Object.keys(tableSchema.categories).sort((left, right) => left.localeCompare(right));
			const options: LookupOption[] = [];
			for (const category of categories) {
				const categoryStore = workspace.tables[tableName]?.categories[category];
				if (!categoryStore) {
					continue;
				}
				const coreSchema = getCoreSchema(this.schemaRegistry, tableName, category);
				for (const id of getCategoryRecordOrder(categoryStore)) {
					const authoredCore = categoryStore.core[id];
					if (!authoredCore) {
						continue;
					}
					const resolvedCore = materializeRecordWithSchema(authoredCore, coreSchema);
					const issueCount = filterRecordIssues(validation, tableName, category, id).length;
					const label = getLookupLabel(resolvedCore);
					options.push({
						table: tableName,
						id,
						category,
						...(label ? { label } : {}),
						issueCount,
					});
				}
			}
			tables[tableName] = {
				table: tableName,
				categories,
				options,
			};
		}
		const index = { tables };
		this.lookupIndexCache.set(cacheKey, { revision, index });
		return index;
	}

	getRefIndex(workspaceRoot: string, expectedRevision?: string): RefIndex {
		if (expectedRevision) assertWorkspaceRevision(expectedRevision, this.getWorkspaceRevision(workspaceRoot));
		const workspace = this.contextStore.loadChecked(workspaceRoot);
		return createRefIndex(workspace, this.schemaRegistry);
	}

	getRecordReferences(workspaceRoot: string, table: string, id: string, expectedRevision?: string): RefIndexReference[] {
		return getRecordReferences(this.getRefIndex(workspaceRoot, expectedRevision), table, id);
	}

	getRecordReferrers(workspaceRoot: string, table: string, id: string, expectedRevision?: string): RefIndexReferrer[] {
		return getRecordReferrers(this.getRefIndex(workspaceRoot, expectedRevision), table, id);
	}

	getRecordReferrersResult(workspaceRoot: string, table: string, id: string, expectedRevision?: string): RecordReferrersResult {
		const revision = this.getWorkspaceRevision(workspaceRoot);
		if (expectedRevision) assertWorkspaceRevision(expectedRevision, revision);
		return {
			revision,
			entries: getRecordReferrers(this.getRefIndex(workspaceRoot, revision), table, id),
		};
	}

	validateWorkspaceRoot(workspaceRoot: string): ValidationReport {
		return this.contextStore.load(workspaceRoot).validation;
	}

	resolveWorkspaceSelection(workspaceRoot: string, selection: WorkspaceSelection = {}): unknown {
		const { resolved } = this.contextStore.loadValidated(workspaceRoot);
		return selectResolvedValue(canonicalizeResolvedWorkspace(resolved), selection.table, selection.id);
	}

	buildWorkspace(options: BuildWorkspaceOptions): BuildWorkspaceResult {
		const workspace = this.contextStore.loadChecked(options.workspaceRoot);
		if (this.workspaceBackend.build) {
			return this.workspaceBackend.build({
				workspaceRoot: options.workspaceRoot,
				...(options.outDir ? { outDir: options.outDir } : {}),
				workspace,
				registry: this.schemaRegistry,
			});
		}
		const artifacts = buildArtifacts(workspace, this.schemaRegistry);
		const outDir = options.outDir ? resolve(options.outDir) : undefined;
		if (outDir) {
			writeBuildArtifacts(artifacts, this.schemaRegistry, outDir);
		}
		return {
			ok: true,
			...(outDir ? { outDir } : {}),
			tables: Object.keys(workspace.tables).sort((left, right) => left.localeCompare(right)),
		};
	}

	verifyWorkspaceRoot(workspaceRoot: string, options: VerifyOptions): VerifyReport {
		const workspace = this.contextStore.loadChecked(workspaceRoot);
		if (this.workspaceBackend.verify) {
			return this.workspaceBackend.verify({ workspaceRoot, workspace, registry: this.schemaRegistry, options });
		}
		return verifyWorkspace(workspace, this.schemaRegistry, options);
	}

	reviewWorkspaces(options: ReviewWorkspaceOptions): ReviewWorkspaceResult {
		const baseRoot = resolve(options.baseRoot);
		const headRoot = resolve(options.headRoot);
		const baseAuthoredWorkspace = this.workspaceBackend.load(baseRoot);
		const headAuthoredWorkspace = this.workspaceBackend.load(headRoot);
		const baseDerivation = deriveWorkspace(baseAuthoredWorkspace, this.schemaRegistry, this.derivationRegistry);
		const headDerivation = deriveWorkspace(headAuthoredWorkspace, this.schemaRegistry, this.derivationRegistry);
		assertValid(this.contextStore.validateDerived(baseDerivation));
		assertValid(this.contextStore.validateDerived(headDerivation));
		const artifacts = createReviewArtifacts(
			resolveWorkspace(baseDerivation.workspace, this.schemaRegistry),
			resolveWorkspace(headDerivation.workspace, this.schemaRegistry),
			this.schemaRegistry,
			{
				...(options.sampleLimit !== undefined ? { sampleLimit: options.sampleLimit } : {}),
			},
		);
		const outDir = options.outDir ? resolve(options.outDir) : undefined;
		if (outDir) {
			mkdirSync(outDir, { recursive: true });
			writeFileSync(join(outDir, "semantic-diff.json"), `${JSON.stringify(artifacts.diff, null, 2)}\n`, "utf8");
			writeFileSync(join(outDir, "resolved-head.json"), `${JSON.stringify(artifacts.resolvedHead, null, 2)}\n`, "utf8");
			writeFileSync(join(outDir, "review-summary.json"), `${JSON.stringify(artifacts.summary, null, 2)}\n`, "utf8");
		}
		return {
			ok: true,
			...(outDir ? { outDir } : {}),
			artifacts,
		};
	}

	formatWorkspace(options: FormatWorkspaceOptions): FormatWorkspaceResult {
		const workspaceRoot = resolve(options.workspaceRoot);
		const workspaceRevision = this.getWorkspaceRevision(workspaceRoot);
		const context = this.contextStore.load(workspaceRoot);
		assertValid(context.validation);
		const workspace = context.authoredWorkspace;
		const fileDiff = this.workspaceBackend.createFileDiff({
			baseRoot: workspaceRoot,
			headWorkspace: workspace,
			registry: this.schemaRegistry,
		});
		const changed = fileDiff.text.trim().length > 0;
		if (!options.check && changed) {
			this.workspaceBackend.write({
				workspace,
				validation: context.validation,
				registry: this.schemaRegistry,
				targetRoot: workspaceRoot,
				expectedRevision: workspaceRevision,
			});
			this.invalidateWorkspaceContext(workspaceRoot);
		}
		return {
			ok: !options.check || !changed,
			changed,
			checked: Boolean(options.check),
			fileDiff,
		};
	}

	describePlan(planInput: unknown) {
		return this.planExecutor.describePlan(planInput);
	}

	executePlan(options: ExecutePlanOptions): ExecutePlanResult {
		return this.planExecutor.executePlan(options);
	}

	benchmarkWorkspace(options: { workspaceRoot: string } & BenchmarkOptions): BenchmarkReport {
		const workspaceRoot = resolve(options.workspaceRoot);
		return benchmarkWorkspace(workspaceRoot, this.schemaRegistry, options, (root) => this.workspaceBackend.load(root));
	}

	searchWorkspace(options: WorkspaceSearchOptions): WorkspaceSearchResult {
		const query = options.query.trim();
		if (!query) throw new Error("Workspace search query must not be empty");
		if (options.table) {
			const table = getTableSchema(this.schemaRegistry, options.table);
			if (options.category && !table.categories[options.category]) {
				throw new Error(`Unknown schema category: ${options.table}.${options.category}`);
			}
		} else if (options.category) {
			throw new Error("Workspace search category requires a table");
		}
		const revision = this.getWorkspaceRevision(options.workspaceRoot);
		const fieldNames = options.fieldNames === true;
		const limit = normalizeWorkspaceSearchLimit(options.limit);
		const entries = matchWorkspaceSearchDocuments(this.getWorkspaceSearchDocuments(options.workspaceRoot, revision), {
			query,
			...(options.table ? { table: options.table } : {}),
			...(options.category ? { category: options.category } : {}),
			fieldNames,
		});
		const cursorSignature = createWorkspaceSearchCursorSignature({
			revision,
			query: query.toLocaleLowerCase(),
			table: options.table,
			category: options.category,
			fieldNames,
		});
		const cursorState = decodeWorkspaceSearchCursor(options.cursor, cursorSignature);
		const offset = cursorState.offset;
		const pageEntries = entries.slice(offset, offset + limit);
		const nextOffset = offset + pageEntries.length;
		return {
			revision,
			query,
			...(options.table ? { table: options.table } : {}),
			...(options.category ? { category: options.category } : {}),
			fieldNames,
			total: entries.length,
			limit,
			offset,
			entries: pageEntries,
			...(offset > 0 && options.cursor ? { cursor: options.cursor } : {}),
			...(nextOffset < entries.length
				? { nextCursor: encodeWorkspaceSearchCursor(nextOffset, cursorSignature, [...cursorState.history, offset]) }
				: {}),
			...(cursorState.history.length > 0
				? {
						previousCursor: encodeWorkspaceSearchCursor(cursorState.history.at(-1) ?? 0, cursorSignature, cursorState.history.slice(0, -1)),
					}
				: {}),
		};
	}

	getGridView(options: GridViewOptions): GridViewResult {
		const schemaIr = this.schemaIr;
		const limit = normalizeListLimit(options.limit);
		const requestedPage = normalizeGridPage(options.page);
		if (requestedPage !== undefined && options.cursor) {
			throw new Error("Grid page and cursor cannot be used together");
		}
		const filters = normalizeGridFilters(options.filters);
		const sort = normalizeGridSort(options.sort, options.sortDir);
		const directoryQuery = normalizeDirectoryQuery(options.query);
		const searchQuery = normalizeWorkspaceSearchQuery(options.search);
		const searchFieldNames = options.searchFieldNames === true;

		if (!options.table) {
			if (this.workspaceBackend.getGridDirectory) {
				const directory = this.workspaceBackend.getGridDirectory({ ...options, limit });
				if (directory) return directory;
			}
			const { workspace, validation } = this.contextStore.load(options.workspaceRoot);
			const tables = Object.keys(this.schemaRegistry.tables)
				.sort((left, right) => compareGridTableNames(schemaIr, left, right))
				.map((tableName) => buildGridTableEntry(workspace, this.schemaRegistry, schemaIr, validation, tableName))
				.filter((entry): entry is GridTableEntry => Boolean(entry))
				.filter((entry) => matchesGridTableDirectoryQuery(schemaIr, entry, directoryQuery));
			return {
				mode: "tables",
				total: tables.length,
				limit,
				truncated: Math.max(0, tables.length - limit),
				filters,
				tables: tables.slice(0, limit),
			};
		}
		if (!options.category && this.workspaceBackend.getGridDirectory) {
			const directory = this.workspaceBackend.getGridDirectory({ ...options, limit });
			if (directory) return directory;
		}

		const tableSchema = getTableSchema(this.schemaRegistry, options.table);
		const uniqueKey = tableSchema.uniqueKey;
		if (!uniqueKey) {
			throw new Error(`Staticdata table ${options.table} must declare uniqueKey`);
		}
		const tableIr = schemaIr.tables[options.table];
		if (!tableIr) {
			throw new Error(`Unknown schema table: ${options.table}`);
		}
		const categories = Object.keys(tableSchema.categories).sort((left, right) => compareGridCategoryNames(tableIr, left, right));
		if (!options.category && categories.length === 1) {
			const singleCategory = categories[0];
			if (!singleCategory) throw new Error(`Table ${options.table} has no categories`);
			return this.getGridView({ ...options, category: singleCategory });
		}
		if (options.category && (!tableIr.categories[options.category] || !tableSchema.categories[options.category])) {
			throw new Error(`Unknown schema category: ${options.table}.${options.category}`);
		}

		let context: WorkspaceContext;
		if (options.category) {
			const relatedTables = getDerivationRelatedTables([options.table], this.derivationRegistry);
			const authoredWorkspace = this.workspaceBackend.load(resolve(options.workspaceRoot), relatedTables);
			const categoryStore = authoredWorkspace.tables[options.table]?.categories[options.category];
			const recordIds = categoryStore ? getCategoryRecordOrder(categoryStore) : [];
			context = this.contextStore.load(options.workspaceRoot, [options.table], { [options.table]: recordIds }, authoredWorkspace);
		} else {
			context = this.contextStore.load(options.workspaceRoot, [options.table]);
		}
		const { workspace, authoredWorkspace, validation, derivation } = context;

		if (!options.category) {
			if (categories.length === 1) {
				const singleCategory = categories[0];
				if (!singleCategory) {
					throw new Error(`Table ${options.table} has no categories`);
				}
				return this.getGridView({
					...options,
					category: singleCategory,
				});
			}
			const categoryEntries = categories
				.map((category) => buildGridCategoryEntry(workspace, this.schemaRegistry, tableIr, validation, options.table!, category))
				.filter((entry) => matchesGridCategoryDirectoryQuery(tableIr, entry, directoryQuery));
			return {
				mode: "categories",
				table: options.table,
				total: categoryEntries.length,
				limit,
				truncated: Math.max(0, categoryEntries.length - limit),
				filters,
				categories: categoryEntries.slice(0, limit),
			};
		}

		const categoryIr = tableIr.categories[options.category];
		if (!categoryIr) throw new Error(`Unknown schema category: ${options.table}.${options.category}`);

		const activeSidecars = normalizeGridSidecars(options.sidecars);
		const availableSidecarSchemas = getAvailableSidecarSchemas(tableSchema.sidecars, options.category);
		const availableSidecarIr = filterSidecarIrByCategory(tableIr.sidecars, options.category);
		for (const sidecarName of activeSidecars) {
			if (!availableSidecarIr[sidecarName]) {
				throw new Error(`Sidecar ${sidecarName} is not available for ${options.table}.${options.category}`);
			}
		}
		const sidecarSummaries = toSidecarSummaries(
			countAvailableSidecars(availableSidecarSchemas, workspace.tables[options.table]?.categories[options.category]?.sidecars),
		);
		const allColumns = buildGridColumns(
			categoryIr.mergedCoreSchema,
			activeSidecars.map((sidecarName) => availableSidecarIr[sidecarName]).filter((sidecar): sidecar is SidecarIR => Boolean(sidecar)),
		);
		const uniqueKeyColumn = allColumns.find((column) => column.target === "core" && column.fieldKey === uniqueKey);
		const columns = allColumns.filter((column) => column.target !== "core" || column.fieldKey !== uniqueKey);
		const columnKeys = new Set(columns.map((column) => column.key));
		const activeFilters = filterGridFiltersForColumns(filters, columnKeys);
		const activeSort =
			sort && (sort.key === "id" || sort.key === "status" || sort.key === "issueCount" || columnKeys.has(sort.key)) ? sort : undefined;
		const pageLimit = Math.min(limit, Math.max(1, Math.floor(GRID_CELL_BUDGET / Math.max(1, columns.length + 1))));
		const revision = this.getWorkspaceRevision(options.workspaceRoot);
		const searchEntries = searchQuery
			? matchWorkspaceSearchDocuments(this.getWorkspaceSearchDocuments(options.workspaceRoot, revision), {
					query: searchQuery,
					table: options.table,
					category: options.category,
					fieldNames: searchFieldNames,
				})
			: undefined;
		const searchEntriesById = searchEntries ? new Map(searchEntries.map((entry) => [entry.id, entry])) : undefined;
		const cursorSignature = createGridCursorSignature({
			revision,
			table: options.table,
			category: options.category,
			sidecars: activeSidecars,
			sort: activeSort,
			filters: activeFilters,
			search: searchQuery,
			searchFieldNames,
			pageLimit,
		});
		const cursorState = decodeGridCursor(options.cursor, cursorSignature);
		let offset = cursorState.offset;
		let cursorHistory = cursorState.history;
		const categoryStore = workspace.tables[options.table]?.categories[options.category];
		const allIds = categoryStore ? getCategoryRecordOrder(categoryStore) : [];
		const canLimitBeforeMaterialization = !activeSort && Object.keys(activeFilters).every((key) => key === "id");
		let rows: GridRow[];
		let total: number;
		if (canLimitBeforeMaterialization) {
			const idNeedle = activeFilters.id?.toLowerCase();
			const matchingIds = allIds.filter(
				(id) => (!idNeedle || id.toLowerCase().includes(idNeedle)) && (!searchEntriesById || searchEntriesById.has(id)),
			);
			total = matchingIds.length;
			if (requestedPage !== undefined) {
				offset = getGridPageOffset(requestedPage, total, pageLimit);
				cursorHistory = createGridCursorHistory(offset, pageLimit);
			} else if (options.focusId && !options.cursor) {
				const focusIndex = matchingIds.indexOf(options.focusId);
				if (focusIndex >= 0) {
					offset = Math.floor(focusIndex / pageLimit) * pageLimit;
					cursorHistory = createGridCursorHistory(offset, pageLimit);
				}
			}
			rows = buildGridRows(
				workspace,
				this.schemaRegistry,
				validation,
				options.table,
				options.category,
				columns,
				matchingIds.slice(offset, offset + pageLimit),
				{ authoredWorkspace, provenance: derivation.provenance },
			);
		} else {
			const matchingRows = buildGridRows(workspace, this.schemaRegistry, validation, options.table, options.category, columns, undefined, {
				authoredWorkspace,
				provenance: derivation.provenance,
			}).filter((row) => (!searchEntriesById || searchEntriesById.has(row.id)) && matchesGridFilters(row, activeFilters));
			if (activeSort) matchingRows.sort((left, right) => compareGridRows(left, right, activeSort));
			total = matchingRows.length;
			if (requestedPage !== undefined) {
				offset = getGridPageOffset(requestedPage, total, pageLimit);
				cursorHistory = createGridCursorHistory(offset, pageLimit);
			} else if (options.focusId && !options.cursor) {
				const focusIndex = matchingRows.findIndex((row) => row.id === options.focusId);
				if (focusIndex >= 0) {
					offset = Math.floor(focusIndex / pageLimit) * pageLimit;
					cursorHistory = createGridCursorHistory(offset, pageLimit);
				}
			}
			rows = matchingRows.slice(offset, offset + pageLimit);
		}
		if (searchEntriesById) {
			rows = rows.map((row) => {
				const entry = searchEntriesById.get(row.id);
				return entry ? { ...row, search: { totalMatches: entry.totalMatches, matches: entry.matches } } : row;
			});
		}
		const nextOffset = offset + rows.length;
		const pageCount = total > 0 ? Math.ceil(total / pageLimit) : 0;
		const page = pageCount > 0 ? Math.floor(offset / pageLimit) + 1 : 0;

		return {
			mode: "records",
			table: options.table,
			category: options.category,
			uniqueKey,
			...(uniqueKeyColumn ? { uniqueKeyColumn } : {}),
			sidecars: activeSidecars,
			availableSidecars: sidecarSummaries,
			total,
			limit: pageLimit,
			truncated: Math.max(0, total - nextOffset),
			offset,
			page,
			pageCount,
			...(offset > 0 ? { cursor: encodeGridCursor(offset, cursorSignature, cursorHistory) } : {}),
			...(nextOffset < total ? { nextCursor: encodeGridCursor(nextOffset, cursorSignature, [...cursorHistory, offset]) } : {}),
			...(cursorHistory.length > 0
				? {
						previousCursor: encodeGridCursor(cursorHistory.at(-1) ?? 0, cursorSignature, cursorHistory.slice(0, -1)),
					}
				: {}),
			...(activeSort ? { sort: activeSort } : {}),
			filters: activeFilters,
			...(searchQuery ? { search: { query: searchQuery, fieldNames: searchFieldNames } } : {}),
			columns,
			rows,
		};
	}

	listRecords(options: ListRecordsOptions): RecordListResult {
		const { workspace, validation } = this.contextStore.load(options.workspaceRoot, options.table ? [options.table] : undefined);
		const limit = normalizeListLimit(options.limit);
		const statusFilter = normalizeListStatus(options.status);
		const query = options.query?.trim().toLowerCase();
		const matchingEntries: RecordListEntry[] = [];
		const statusCounts: RecordListResult["statusCounts"] = {
			ok: 0,
			issue: 0,
		};
		const summaryColumns = options.table ? getRecordSummaryColumns(this.schemaRegistry, options.table) : [];

		for (const tableName of Object.keys(workspace.tables).sort((left, right) => left.localeCompare(right))) {
			if (options.table && tableName !== options.table) {
				continue;
			}
			const tableSchema = this.schemaRegistry.tables[tableName];
			if (!tableSchema) {
				continue;
			}
			const table = workspace.tables[tableName];
			if (!table) {
				continue;
			}
			for (const category of Object.keys(table.categories).sort((left, right) => left.localeCompare(right))) {
				if (!tableSchema.categories[category]) {
					continue;
				}
				const categoryStore = table.categories[category];
				if (!categoryStore) {
					continue;
				}
				if (options.category && category !== options.category) {
					continue;
				}
				for (const id of getCategoryRecordOrder(categoryStore)) {
					const record = categoryStore.core[id];
					if (!record) {
						continue;
					}
					const label = typeof record.label === "string" ? record.label : undefined;
					const coreSchema = getCoreSchema(this.schemaRegistry, tableName, category);
					const resolvedCore = materializeRecordWithSchema(record, coreSchema);
					const resolvedSidecars = materializeSidecars(categoryStore.sidecars[id], tableSchema.sidecars);
					const summaryValues = buildRecordSummaryValues(
						this.schemaRegistry,
						tableName,
						category,
						resolvedCore,
						resolvedSidecars,
						this.summaryBuilders,
					);
					const haystack = [tableName, id, category, label ?? "", ...summaryValues.map((entry) => entry.value)].join(" ").toLowerCase();
					if (query && !haystack.includes(query)) {
						continue;
					}
					const issueCount = filterRecordIssues(validation, tableName, category, id).length;
					const status: RecordStatus = issueCount > 0 ? "issue" : "ok";
					statusCounts[status] += 1;
					if (statusFilter !== "all" && status !== statusFilter) {
						continue;
					}
					matchingEntries.push({
						table: tableName,
						id,
						category,
						...(label ? { label } : {}),
						hasSidecar: Object.keys(categoryStore.sidecars[id] ?? {}).length > 0,
						sidecarNames: Object.keys(categoryStore.sidecars[id] ?? {}).sort((left, right) => left.localeCompare(right)),
						issueCount,
						status,
						summaryValues,
					});
				}
			}
		}

		return {
			total: matchingEntries.length,
			limit,
			truncated: Math.max(0, matchingEntries.length - limit),
			statusCounts,
			summaryColumns,
			entries: matchingEntries.slice(0, limit),
		};
	}

	getRecordDetail(workspaceRoot: string, table: string, id: string, expectedRevision?: string): RecordDetail {
		if (expectedRevision) assertWorkspaceRevision(expectedRevision, this.getWorkspaceRevision(workspaceRoot));
		const context =
			this.contextStore.findCachedRecords(workspaceRoot, [table], { [table]: [id] }) ??
			this.contextStore.load(workspaceRoot, [table], { [table]: [id] });
		return getRecordDetail(context.workspace, context.validation, this.schemaRegistry, table, id, {
			schemaIr: this.schemaIr,
			includeReferences: this.workspaceBackend.lookupIndexMode !== "empty",
			authoredWorkspace: context.authoredWorkspace,
			derivedProvenance: context.derivation.provenance,
		});
	}

	previewRecordUpdate(request: RecordUpdateRequest): RecordUpdatePreviewResult {
		return this.planExecutor.previewRecordUpdate(request);
	}

	previewRecordCreate(request: RecordCreateRequest): RecordUpdatePreviewResult {
		return this.planExecutor.previewRecordCreate(request);
	}

	previewRecordUpdates(request: RecordBatchUpdateRequest): RecordUpdatePreviewResult {
		return this.planExecutor.previewRecordUpdates(request);
	}

	applyPreviewToken(token: string): RecordUpdatePreviewResult {
		return this.planExecutor.applyPreviewToken(token);
	}

	assertWorkspaceReady(workspaceRoot: string): void {
		assertValid(this.validateWorkspaceRoot(workspaceRoot));
	}

	private getWorkspaceSearchDocuments(workspaceRoot: string, expectedRevision?: string): WorkspaceSearchDocument[] {
		const resolvedRoot = resolve(workspaceRoot);
		const revision = this.getWorkspaceRevision(resolvedRoot);
		if (expectedRevision) assertWorkspaceRevision(expectedRevision, revision);
		const cached = this.workspaceSearchIndexCache.get(resolvedRoot);
		if (cached?.revision === revision) return cached.documents;
		const context = this.contextStore.load(resolvedRoot);
		const documents = buildWorkspaceSearchDocuments(context.workspace, context.authoredWorkspace, this.schemaRegistry, context.validation);
		this.workspaceSearchIndexCache.set(resolvedRoot, { revision, documents });
		return documents;
	}

	private invalidateWorkspaceContext(workspaceRoot: string): void {
		const resolvedRoot = resolve(workspaceRoot);
		this.contextStore.invalidate(resolvedRoot);
		const rootPrefix = `${resolvedRoot}\u0000`;
		for (const key of this.lookupIndexCache.keys()) {
			if (key.startsWith(rootPrefix)) this.lookupIndexCache.delete(key);
		}
		this.workspaceSearchIndexCache.delete(resolvedRoot);
	}

	getWorkspaceRevision(workspaceRoot: string): string {
		return this.contextStore.getRevision(workspaceRoot);
	}
}

export function createStaticDataService(
	schemaRegistry: SchemaRegistry,
	workspaceBackend: StaticDataWorkspaceBackend = defaultWorkspaceBackend,
	derivationRegistry: DerivationRuleRegistry = emptyDerivationRegistry,
	summaryBuilders: SummaryBuilderRegistry = {},
): StaticDataService {
	return new StaticDataService(schemaRegistry, workspaceBackend, derivationRegistry, summaryBuilders);
}

function selectResolvedValue(resolved: ResolvedWorkspace, table: string | undefined, id: string | undefined): unknown {
	if (!table && id) {
		throw new Error("Missing table for id selection");
	}
	if (!table) {
		return resolved;
	}
	const selectedTable = resolved.tables[table];
	if (!selectedTable) {
		throw new Error(`Unknown resolved table: ${table}`);
	}
	if (!id) {
		return {
			table,
			records: selectedTable,
		};
	}
	const record = selectedTable[id];
	if (!record) {
		throw new Error(`Missing resolved record: ${table}#${id}`);
	}
	return record;
}

function createGridCursorSignature(value: {
	revision: string;
	table: string;
	category: string;
	sidecars: readonly string[];
	sort: { key: string; dir: "asc" | "desc" } | undefined;
	filters: Record<string, string>;
	search: string | undefined;
	searchFieldNames: boolean;
	pageLimit: number;
}): string {
	const payload = {
		...value,
		filters: Object.fromEntries(Object.entries(value.filters).sort(([left], [right]) => left.localeCompare(right))),
	};
	return createHash("sha256").update(JSON.stringify(payload)).digest("base64url").slice(0, 16);
}

function createWorkspaceSearchCursorSignature(value: {
	revision: string;
	query: string;
	table: string | undefined;
	category: string | undefined;
	fieldNames: boolean;
}): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 16);
}

function encodeWorkspaceSearchCursor(offset: number, signature: string, history: readonly number[]): string {
	return Buffer.from(JSON.stringify({ version: 1, offset, signature, history }), "utf8").toString("base64url");
}

function decodeWorkspaceSearchCursor(cursor: string | undefined, signature: string): { offset: number; history: number[] } {
	if (!cursor) return { offset: 0, history: [] };
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
		const history = Array.isArray(parsed.history) ? parsed.history.map(Number) : [];
		if (
			parsed.version !== 1 ||
			parsed.signature !== signature ||
			!Number.isInteger(parsed.offset) ||
			Number(parsed.offset) < 0 ||
			!history.every((offset) => Number.isInteger(offset) && offset >= 0)
		) {
			throw new Error("cursor does not match the current workspace search");
		}
		return { offset: Number(parsed.offset), history };
	} catch (error) {
		throw new Error(`Invalid workspace search cursor: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function encodeGridCursor(offset: number, signature: string, history: readonly number[]): string {
	return Buffer.from(JSON.stringify({ version: 1, offset, signature, history }), "utf8").toString("base64url");
}

function createGridCursorHistory(offset: number, pageLimit: number): number[] {
	return Array.from({ length: Math.floor(offset / pageLimit) }, (_, index) => index * pageLimit);
}

function normalizeGridPage(page: number | undefined): number | undefined {
	if (page === undefined) return undefined;
	if (!Number.isInteger(page) || page <= 0) throw new Error(`Invalid grid page: ${page}`);
	return page;
}

function getGridPageOffset(page: number, total: number, pageLimit: number): number {
	if (total === 0) return 0;
	const pageCount = Math.ceil(total / pageLimit);
	return (Math.min(page, pageCount) - 1) * pageLimit;
}

function decodeGridCursor(cursor: string | undefined, signature: string): { offset: number; history: number[] } {
	if (!cursor) return { offset: 0, history: [] };
	try {
		const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
		const history = Array.isArray(parsed.history) ? parsed.history.map(Number) : [];
		if (
			parsed.version !== 1 ||
			parsed.signature !== signature ||
			!Number.isInteger(parsed.offset) ||
			Number(parsed.offset) < 0 ||
			!history.every((offset) => Number.isInteger(offset) && offset >= 0)
		) {
			throw new Error("cursor does not match the current grid query");
		}
		return { offset: Number(parsed.offset), history };
	} catch (error) {
		throw new Error(`Invalid grid cursor: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function normalizeListLimit(limit: number | undefined): number {
	if (limit === undefined) {
		return 200;
	}
	if (!Number.isInteger(limit) || limit <= 0) {
		throw new Error(`Invalid record list limit: ${limit}`);
	}
	return limit;
}

function normalizeWorkspaceSearchLimit(limit: number | undefined): number {
	if (limit === undefined) return 50;
	if (!Number.isInteger(limit) || limit <= 0) throw new Error(`Invalid workspace search limit: ${limit}`);
	return Math.min(limit, 200);
}

function normalizeWorkspaceSearchQuery(query: string | undefined): string | undefined {
	const normalized = query?.trim();
	return normalized ? normalized : undefined;
}

function normalizeListStatus(status: RecordStatusFilter | undefined): RecordStatusFilter {
	if (status === undefined) {
		return "all";
	}
	if (status === "all" || status === "issue" || status === "ok") {
		return status;
	}
	throw new Error(`Invalid record status filter: ${status}`);
}

function normalizeDirectoryQuery(query: string | undefined): string {
	return query?.trim().toLowerCase() ?? "";
}

function matchesGridTableDirectoryQuery(schemaIr: SchemaIR, entry: GridTableEntry, query: string): boolean {
	if (!query) {
		return true;
	}
	const metadata = schemaIr.tables[entry.table]?.metadata;
	return [entry.table, metadata?.displayName, metadata?.icon]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase()
		.includes(query);
}

function matchesGridCategoryDirectoryQuery(
	tableIr: NonNullable<SchemaIR["tables"][string]>,
	entry: GridCategoryEntry,
	query: string,
): boolean {
	if (!query) {
		return true;
	}
	const metadata = tableIr.categories[entry.category]?.metadata;
	return [entry.category, metadata?.displayName, metadata?.icon]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase()
		.includes(query);
}

export function summarizeVerifyIssues(issues: VerifyIssue[], pathPrefix: string): VerifyIssue[] {
	return issues.filter((entry) => entry.path.startsWith(pathPrefix));
}

