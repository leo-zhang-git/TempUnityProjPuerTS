import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { resolveStaticDataDir } from "../../data/framework/paths.js";
import type {
	GridViewOptions,
	RecordBatchUpdateRequest,
	RecordCreateRequest,
	RecordStatusFilter,
	RecordUpdateRequest,
	StaticDataService,
} from "./app/service.js";
import {
	isWorkspaceRevisionConflictError,
	SCHEMA_FIELD_MUTATION_UNSUPPORTED_CODE,
	type SchemaFieldMutationRequest,
} from "./app/workspace-backend.js";
import type { JsonObject, JsonValue } from "./core/schema.js";
import { resolveWorkspaceRoot } from "./core/workspace-root.js";

const WEB_ASSETS = loadWebAssets();
const WEB_STARTED_AT = new Date().toISOString();

export interface WebServerOptions {
	service: StaticDataService;
	workspaceRoot?: string;
	host?: string;
	port?: number;
	buildOutDir?: string;
	previewOutDir?: string;
	staticDataRoot?: string;
	kernelFingerprint?: string;
}

export interface StartedWebServer {
	server: Server;
	url: string;
}

export interface WebServerIdentity {
	staticDataRoot: string;
	workspaceRoot: string;
	processId: number;
	startedAt: string;
	schemaFingerprint: string;
	schemaTables: string[];
}

interface ApiRouteContext {
	request: IncomingMessage;
	url: URL;
	workspaceRoot: string;
	buildOutDir: string;
	previewOutDir: string;
	service: StaticDataService;
	serverIdentity: WebServerIdentity;
	unityAssetsRoot: string;
}

interface JsonApiRouteResult {
	kind: "json";
	statusCode: number;
	payload: unknown;
}

interface BinaryApiRouteResult {
	kind: "binary";
	statusCode: number;
	body: Buffer;
	contentType: string;
}

type ApiRouteResult = JsonApiRouteResult | BinaryApiRouteResult;

interface ApiRoute {
	method: "GET" | "POST";
	path: string;
	handler: (context: ApiRouteContext) => ApiRouteResult | Promise<ApiRouteResult>;
}

const API_ROUTES: readonly ApiRoute[] = [
	{ method: "GET", path: "/api/manifest", handler: handleManifest },
	{ method: "GET", path: "/api/revision", handler: handleRevision },
	{ method: "GET", path: "/api/lookups", handler: handleLookups },
	{ method: "GET", path: "/api/records", handler: handleRecords },
	{ method: "GET", path: "/api/record", handler: handleRecord },
	{ method: "GET", path: "/api/record/referrers", handler: handleRecordReferrers },
	{ method: "GET", path: "/api/search", handler: handleSearch },
	{ method: "GET", path: "/api/grid", handler: handleGrid },
	{ method: "GET", path: "/api/image", handler: handleImage },
	{ method: "POST", path: "/api/record/create/preview", handler: handleRecordCreatePreview },
	{ method: "POST", path: "/api/record/create/apply", handler: handleRecordCreateApply },
	{ method: "POST", path: "/api/record/preview", handler: handleRecordPreview },
	{ method: "POST", path: "/api/record/apply", handler: handleRecordApply },
	{ method: "POST", path: "/api/records/preview", handler: handleRecordsPreview },
	{ method: "POST", path: "/api/records/apply", handler: handleRecordsApply },
	{ method: "POST", path: "/api/schema/field/preview", handler: handleSchemaFieldPreview },
	{ method: "POST", path: "/api/schema/field/apply", handler: handleSchemaFieldApply },
	{ method: "POST", path: "/api/preview/apply", handler: handlePreviewApply },
	{ method: "POST", path: "/api/validate", handler: handleValidate },
	{ method: "POST", path: "/api/build", handler: handleBuild },
	{ method: "POST", path: "/api/verify", handler: handleVerify },
	{ method: "POST", path: "/api/benchmark", handler: handleBenchmark },
];

export function createWebRequestHandler(options: WebServerOptions) {
	const service = options.service;
	const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
	const buildOutDir = options.buildOutDir ?? ".artifacts/build";
	const previewOutDir = options.previewOutDir ?? ".artifacts/apply-preview";
	const serverIdentity = createWebServerIdentity(workspaceRoot, service, options.staticDataRoot, options.kernelFingerprint);
	const unityAssetsRoot = resolve(serverIdentity.staticDataRoot, "..", "..", "My project", "Assets");

	return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			const staticAsset = request.method === "GET" ? WEB_ASSETS.get(url.pathname === "/" ? "/index.html" : url.pathname) : undefined;
			if (staticAsset) {
				sendText(response, 200, staticAsset.content, staticAsset.contentType);
				return;
			}
			const route = findApiRoute(request.method, url.pathname);
			if (route) {
				const result = await route.handler({
					request,
					url,
					workspaceRoot,
					buildOutDir,
					previewOutDir,
					service,
					serverIdentity,
					unityAssetsRoot,
				});
				if (result.kind === "binary") {
					sendBinary(response, result.statusCode, result.body, result.contentType);
				} else {
					sendJson(response, result.statusCode, result.payload);
				}
				return;
			}
			sendJson(response, 404, { ok: false, message: "Not found" });
		} catch (error) {
			const revisionConflict = isWorkspaceRevisionConflictError(error);
			const errorCode = getErrorCode(error);
			const statusCode =
				revisionConflict || errorCode === "WORKBENCH_SCHEMA_RELOADED"
					? 409
					: errorCode === "WORKBENCH_SOURCE_UPDATING"
						? 503
						: errorCode === SCHEMA_FIELD_MUTATION_UNSUPPORTED_CODE
							? 501
							: 500;
			sendJson(response, statusCode, {
				ok: false,
				...(errorCode ? { code: errorCode } : {}),
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};
}

function findApiRoute(method: string | undefined, path: string): ApiRoute | undefined {
	return API_ROUTES.find((route) => route.method === method && route.path === path);
}

function json(payload: unknown, statusCode = 200): JsonApiRouteResult {
	return { kind: "json", statusCode, payload };
}

function badRequest(message: string): ApiRouteResult {
	return json({ ok: false, message }, 400);
}

function handleManifest({ service, serverIdentity }: ApiRouteContext): ApiRouteResult {
	return json({
		...service.getBootstrap(),
		server: serverIdentity,
	});
}

function handleRevision({ service, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	return json({ ok: true, revision: service.getWorkspaceRevision(workspaceRoot) });
}

function getErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function handleLookups({ service, url, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	const tables = [
		...new Set(
			url.searchParams
				.getAll("tables")
				.flatMap((value) => value.split(","))
				.map((value) => value.trim())
				.filter(Boolean),
		),
	];
	return json(service.getLookupIndex(workspaceRoot, tables.length > 0 ? tables : undefined));
}

function handleRecords({ service, url, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	const status = url.searchParams.get("status");
	if (status && !isRecordStatusFilter(status)) {
		return badRequest(`Invalid status: ${status}`);
	}
	const statusFilter = status && isRecordStatusFilter(status) ? status : undefined;
	return json(
		service.listRecords({
			workspaceRoot,
			...(url.searchParams.get("table") ? { table: url.searchParams.get("table")! } : {}),
			...(url.searchParams.get("category") ? { category: url.searchParams.get("category")! } : {}),
			...(url.searchParams.get("query") ? { query: url.searchParams.get("query")! } : {}),
			...(statusFilter ? { status: statusFilter } : {}),
			...(url.searchParams.get("limit") ? { limit: parsePositiveInteger(url.searchParams.get("limit")!, "limit") } : {}),
		}),
	);
}

function handleRecord({ service, url, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	const table = url.searchParams.get("table");
	const id = url.searchParams.get("id");
	if (!table || !id) {
		return badRequest("Missing table or id");
	}
	return json(service.getRecordDetail(workspaceRoot, table, id, url.searchParams.get("revision") ?? undefined));
}

function handleRecordReferrers({ service, url, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	const table = url.searchParams.get("table");
	const id = url.searchParams.get("id");
	if (!table || !id) return badRequest("Missing table or id");
	return json(service.getRecordReferrersResult(workspaceRoot, table, id, url.searchParams.get("revision") ?? undefined));
}

function handleSearch({ service, url, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	const query = url.searchParams.get("query")?.trim();
	if (!query) return badRequest("Missing search query");
	return json(
		service.searchWorkspace({
			workspaceRoot,
			query,
			...(url.searchParams.get("table") ? { table: url.searchParams.get("table")! } : {}),
			...(url.searchParams.get("category") ? { category: url.searchParams.get("category")! } : {}),
			...(parseBooleanSearchParam(url.searchParams, "fieldNames") ? { fieldNames: true } : {}),
			...(url.searchParams.get("limit") ? { limit: parsePositiveInteger(url.searchParams.get("limit")!, "limit") } : {}),
			...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor")! } : {}),
		}),
	);
}

function handleGrid({ service, url, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	return json(service.getGridView(toGridViewOptions(url, workspaceRoot)));
}

const UNITY_IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

async function handleImage({ url, unityAssetsRoot }: ApiRouteContext): Promise<ApiRouteResult> {
	const assetPath = url.searchParams.get("path");
	if (!assetPath) {
		return badRequest("Missing image path");
	}
	if (!assetPath.startsWith("Assets/") || assetPath.includes("\\") || assetPath.includes("\0")) {
		return badRequest("Image path must be a normalized path below Assets/");
	}

	const relativeAssetPath = assetPath.slice("Assets/".length);
	const pathSegments = relativeAssetPath.split("/");
	if (
		!relativeAssetPath ||
		isAbsolute(relativeAssetPath) ||
		pathSegments.some((segment) => !segment || segment === "." || segment === "..")
	) {
		return badRequest("Invalid image path");
	}

	const contentType = UNITY_IMAGE_CONTENT_TYPES[extname(relativeAssetPath).toLowerCase()];
	if (!contentType) {
		return badRequest("Unsupported image extension");
	}

	const candidatePath = resolve(unityAssetsRoot, ...pathSegments);
	if (!isPathInside(unityAssetsRoot, candidatePath)) {
		return json({ ok: false, message: "Image not found" }, 404);
	}

	try {
		const [realAssetsRoot, realCandidatePath] = await Promise.all([realpath(unityAssetsRoot), realpath(candidatePath)]);
		if (!isPathInside(realAssetsRoot, realCandidatePath) || !(await stat(realCandidatePath)).isFile()) {
			return json({ ok: false, message: "Image not found" }, 404);
		}

		return {
			kind: "binary",
			statusCode: 200,
			body: await readFile(realCandidatePath),
			contentType,
		};
	} catch (error) {
		if (isUnavailableFileError(error)) {
			return json({ ok: false, message: "Image not found" }, 404);
		}
		throw error;
	}
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
	const relativePath = relative(rootPath, candidatePath);
	return relativePath.length > 0 && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function isUnavailableFileError(error: unknown): boolean {
	const code = getErrorCode(error);
	return code === "ENOENT" || code === "ENOTDIR";
}

async function handleRecordCreatePreview(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(context.service.previewRecordCreate(toRecordCreateRequest(payload, context.workspaceRoot, context.previewOutDir)));
}

async function handleRecordCreateApply(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(
		applyPreparedPreview(
			context.service,
			context.service.previewRecordCreate(toRecordCreateRequest(payload, context.workspaceRoot, context.previewOutDir)),
		),
	);
}

async function handleRecordPreview(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(context.service.previewRecordUpdate(toRecordUpdateRequest(payload, context.workspaceRoot, context.previewOutDir)));
}

async function handleRecordApply(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(
		applyPreparedPreview(
			context.service,
			context.service.previewRecordUpdate(toRecordUpdateRequest(payload, context.workspaceRoot, context.previewOutDir)),
		),
	);
}

async function handleRecordsPreview(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(context.service.previewRecordUpdates(toRecordBatchUpdateRequest(payload, context.workspaceRoot, context.previewOutDir)));
}

async function handleRecordsApply(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(
		applyPreparedPreview(
			context.service,
			context.service.previewRecordUpdates(toRecordBatchUpdateRequest(payload, context.workspaceRoot, context.previewOutDir)),
		),
	);
}

async function handleSchemaFieldPreview(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(context.service.mutateSchemaField(toSchemaFieldMutationRequest(payload, context.workspaceRoot, false)));
}

async function handleSchemaFieldApply(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(context.service.mutateSchemaField(toSchemaFieldMutationRequest(payload, context.workspaceRoot, true)));
}

function applyPreparedPreview(service: StaticDataService, preview: ReturnType<StaticDataService["previewRecordUpdates"]>) {
	return preview.previewToken ? service.applyPreviewToken(preview.previewToken) : preview;
}

function toSchemaFieldMutationRequest(payload: Record<string, unknown>, workspaceRoot: string, write: boolean): SchemaFieldMutationRequest {
	const action = expectString(payload.action, "action");
	if (action !== "rename" && action !== "delete") throw new Error(`Invalid schema field action: ${action}`);
	return {
		workspaceRoot,
		table: expectString(payload.table, "table"),
		category: expectString(payload.category, "category"),
		field: expectString(payload.field, "field"),
		action,
		...(payload.newName !== undefined ? { newName: expectString(payload.newName, "newName") } : {}),
		...(payload.expectedRevision !== undefined ? { expectedRevision: expectString(payload.expectedRevision, "expectedRevision") } : {}),
		write,
	};
}

async function handlePreviewApply(context: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(context.request);
	return json(context.service.applyPreviewToken(expectString(payload.token, "token")));
}

function handleValidate({ service, workspaceRoot }: ApiRouteContext): ApiRouteResult {
	return json(service.validateWorkspaceRoot(workspaceRoot));
}

function handleBuild({ service, workspaceRoot, buildOutDir }: ApiRouteContext): ApiRouteResult {
	return json(
		service.buildWorkspace({
			workspaceRoot,
			outDir: buildOutDir,
		}),
	);
}

async function handleVerify({ service, request, workspaceRoot }: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(request);
	return json(
		service.verifyWorkspaceRoot(workspaceRoot, {
			...(Array.isArray(payload.targets)
				? {
						targets: payload.targets.filter((entry): entry is "runtime_catalog" => entry === "runtime_catalog"),
					}
				: {}),
		}),
	);
}

async function handleBenchmark({ service, request, workspaceRoot }: ApiRouteContext): Promise<ApiRouteResult> {
	const payload = await readJsonBody<Record<string, unknown>>(request);
	return json(
		service.benchmarkWorkspace({
			workspaceRoot,
			...(typeof payload.iterations === "number" ? { iterations: payload.iterations } : {}),
		}),
	);
}

export async function startWebServer(options: WebServerOptions): Promise<StartedWebServer> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 54173;

	const server = createServer(createWebRequestHandler(options));
	await new Promise<void>((resolvePromise, rejectPromise) => {
		server.once("error", rejectPromise);
		server.listen(port, host, () => resolvePromise());
	});
	const address = server.address();
	const actualPort = typeof address === "object" && address ? address.port : port;
	return {
		server,
		url: `http://${host}:${actualPort}`,
	};
}

export function createWebServerIdentity(
	workspaceRoot: string,
	service: StaticDataService,
	staticDataRoot = getStaticDataRoot(),
	kernelFingerprint?: string,
): WebServerIdentity {
	const schema = service.getSchema();
	return {
		staticDataRoot,
		workspaceRoot: resolveWorkspaceRoot(workspaceRoot),
		processId: process.pid,
		startedAt: WEB_STARTED_AT,
		schemaFingerprint: kernelFingerprint ?? createSchemaSourceFingerprint(staticDataRoot),
		schemaTables: Object.keys(schema.tables).sort((left, right) => left.localeCompare(right)),
	};
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	if (!raw) {
		return {} as T;
	}
	return JSON.parse(raw) as T;
}

function loadWebAssets(): Map<string, { content: string; contentType: string }> {
	const emittedWebDir = fileURLToPath(new URL("./web/", import.meta.url));
	const configuredWebDir = process.env.STATICDATA_WEB_ASSET_DIR;
	const sourceBuildWebDir = resolve(emittedWebDir, "..", "..", "..", "dist", "tools", "src", "web");
	const webDir = configuredWebDir
		? resolve(configuredWebDir)
		: existsSync(join(sourceBuildWebDir, "app.js"))
			? sourceBuildWebDir
			: emittedWebDir;
	if (!existsSync(join(webDir, "app.js"))) {
		throw new Error("Missing emitted staticdata web assets; run npm run build:emit first");
	}
	const assets = new Map<string, { content: string; contentType: string }>();
	for (const entry of readdirSync(webDir, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}
		const contentType = getStaticContentType(entry.name);
		if (!contentType) {
			continue;
		}
		assets.set(`/${entry.name}`, {
			content: readFileSync(join(webDir, entry.name), "utf8"),
			contentType,
		});
	}
	return assets;
}

function getStaticContentType(fileName: string): string | undefined {
	if (fileName.endsWith(".html")) {
		return "text/html; charset=utf-8";
	}
	if (fileName.endsWith(".js")) {
		return "text/javascript; charset=utf-8";
	}
	if (fileName.endsWith(".css")) {
		return "text/css; charset=utf-8";
	}
	return undefined;
}

function getStaticDataRoot(): string {
	return resolveStaticDataDir();
}

function createSchemaSourceFingerprint(staticDataRoot: string): string {
	const dataRoot = join(staticDataRoot, "data");
	const entries = listSchemaIdentityFiles(dataRoot).map((path) => {
		const relativePath = relative(dataRoot, path).replace(/\\/g, "/");
		const fileHash = createHash("sha256").update(readFileSync(path)).digest("hex");
		return `${relativePath}\n${fileHash}`;
	});
	return createHash("sha256").update(entries.join("\n"), "utf8").digest("hex");
}

function listSchemaIdentityFiles(dataRoot: string): string[] {
	const files: string[] = [];
	const visit = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				visit(path);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			const relativePath = relative(dataRoot, path).replace(/\\/g, "/");
			if (relativePath === "schema-registry.ts" || relativePath === "framework/tool-schema.ts" || entry.name === "schema.ts") {
				files.push(path);
			}
		}
	};
	visit(dataRoot);
	return files.sort((left, right) => relative(dataRoot, left).localeCompare(relative(dataRoot, right)));
}

function toRecordUpdateRequest(payload: Record<string, unknown>, workspaceRoot: string, previewOutDir: string): RecordUpdateRequest {
	const table = expectString(payload.table, "table");
	const id = expectString(payload.id, "id");
	const authoredCore = expectJsonObject(payload.authoredCore, "authoredCore");
	const request: RecordUpdateRequest = {
		workspaceRoot,
		table,
		id,
		authoredCore,
		outDir: previewOutDir,
	};
	if (payload.authoredSidecars !== undefined) {
		request.authoredSidecars = expectJsonObjectMap(payload.authoredSidecars, "authoredSidecars");
	}
	if (payload.deleteSidecars !== undefined) {
		request.deleteSidecars = expectStringArray(payload.deleteSidecars, "deleteSidecars");
	}
	if (payload.deleteRecord !== undefined) {
		request.deleteRecord = expectBoolean(payload.deleteRecord, "deleteRecord");
	}
	return request;
}

function toRecordCreateRequest(payload: Record<string, unknown>, workspaceRoot: string, previewOutDir: string): RecordCreateRequest {
	const table = expectString(payload.table, "table");
	const category = expectString(payload.category, "category");
	const id = expectString(payload.id, "id");
	const authoredCore = expectJsonObject(payload.authoredCore, "authoredCore");
	const request: RecordCreateRequest = {
		workspaceRoot,
		table,
		category,
		id,
		authoredCore,
		outDir: previewOutDir,
	};
	if (payload.authoredSidecars !== undefined) {
		request.authoredSidecars = expectJsonObjectMap(payload.authoredSidecars, "authoredSidecars");
	}
	return request;
}

function toRecordBatchUpdateRequest(
	payload: Record<string, unknown>,
	workspaceRoot: string,
	previewOutDir: string,
): RecordBatchUpdateRequest {
	if (!Array.isArray(payload.updates)) {
		throw new Error("Expected updates array");
	}
	return {
		workspaceRoot,
		outDir: previewOutDir,
		updates: payload.updates.map((entry, index) => {
			if (!isJsonRecord(entry)) {
				throw new Error(`Expected update object at updates[${index}]`);
			}
			const request = toRecordUpdateRequest(entry, workspaceRoot, previewOutDir);
			const draft: RecordBatchUpdateRequest["updates"][number] = {
				table: request.table,
				id: request.id,
				authoredCore: request.authoredCore,
			};
			if (Object.hasOwn(request, "authoredSidecars")) {
				draft.authoredSidecars = request.authoredSidecars;
			}
			if (request.deleteSidecars !== undefined) {
				draft.deleteSidecars = request.deleteSidecars;
			}
			if (request.deleteRecord !== undefined) {
				draft.deleteRecord = request.deleteRecord;
			}
			return draft;
		}),
	};
}

function toGridViewOptions(url: URL, workspaceRoot: string): GridViewOptions {
	const sortDir = url.searchParams.get("sortDir");
	const sidecars = parseSidecarsParam(url.searchParams);
	const options: GridViewOptions = {
		workspaceRoot,
		...(url.searchParams.get("table") ? { table: url.searchParams.get("table")! } : {}),
		...(url.searchParams.get("category") ? { category: url.searchParams.get("category")! } : {}),
		...(url.searchParams.get("query") ? { query: url.searchParams.get("query")! } : {}),
		...(url.searchParams.get("search") ? { search: url.searchParams.get("search")! } : {}),
		...(parseBooleanSearchParam(url.searchParams, "searchFieldNames") ? { searchFieldNames: true } : {}),
		...(url.searchParams.get("focusId") ? { focusId: url.searchParams.get("focusId")! } : {}),
		...(sidecars.length > 0 ? { sidecars } : {}),
		...(url.searchParams.get("sort") ? { sort: url.searchParams.get("sort")! } : {}),
		...(sortDir === "asc" || sortDir === "desc" ? { sortDir } : {}),
		...(url.searchParams.get("limit") ? { limit: parsePositiveInteger(url.searchParams.get("limit")!, "limit") } : {}),
		...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor")! } : {}),
		...(url.searchParams.get("page") ? { page: parsePositiveInteger(url.searchParams.get("page")!, "page") } : {}),
	};
	const filters: Record<string, string> = {};
	for (const [key, value] of url.searchParams.entries()) {
		if (!key.startsWith("filter.") || !value.trim()) {
			continue;
		}
		filters[key.slice("filter.".length)] = value;
	}
	if (Object.keys(filters).length > 0) {
		options.filters = filters;
	}
	return options;
}

function parseBooleanSearchParam(params: URLSearchParams, key: string): boolean {
	const value = params.get(key);
	return value === "1" || value === "true";
}

function parseSidecarsParam(params: URLSearchParams): string[] {
	const seen = new Set<string>();
	const sidecars: string[] = [];
	const append = (rawValue: string): void => {
		for (const entry of rawValue.split(",")) {
			const sidecar = entry.trim();
			if (!sidecar || seen.has(sidecar)) {
				continue;
			}
			sidecars.push(sidecar);
			seen.add(sidecar);
		}
	};
	for (const rawValue of params.getAll("sidecars")) {
		append(rawValue);
	}
	return sidecars;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
	sendText(response, statusCode, `${JSON.stringify(payload)}\n`, "application/json; charset=utf-8");
}

function sendText(response: ServerResponse, statusCode: number, payload: string, contentType: string): void {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", contentType);
	response.end(payload);
}

function sendBinary(response: ServerResponse, statusCode: number, body: Buffer, contentType: string): void {
	response.statusCode = statusCode;
	response.setHeader("Content-Type", contentType);
	response.setHeader("Content-Length", body.byteLength);
	response.setHeader("Cache-Control", "no-store");
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.end(body);
}

function parsePositiveInteger(rawValue: string, field: string): number {
	const parsed = Number(rawValue);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${field}: ${rawValue}`);
	}
	return parsed;
}

function isRecordStatusFilter(value: string): value is RecordStatusFilter {
	return value === "all" || value === "issue" || value === "ok";
}

function expectString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Expected non-empty string for ${field}`);
	}
	return value;
}

function expectJsonObject(value: unknown, field: string): JsonObject {
	if (!isJsonRecord(value)) {
		throw new Error(`Expected JSON object for ${field}`);
	}
	const normalized: JsonObject = {};
	for (const [key, entry] of Object.entries(value)) {
		normalized[key] = toJsonValue(entry, `${field}.${key}`);
	}
	return normalized;
}

function expectJsonObjectMap(value: unknown, field: string): Record<string, JsonObject> {
	if (!isJsonRecord(value)) {
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

function expectBoolean(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`Expected boolean for ${field}`);
	}
	return value;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown, path: string): JsonValue {
	if (value === null) {
		return null;
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => toJsonValue(entry, `${path}[${index}]`));
	}
	if (isJsonRecord(value)) {
		const normalized: JsonObject = {};
		for (const [key, entry] of Object.entries(value)) {
			normalized[key] = toJsonValue(entry, `${path}.${key}`);
		}
		return normalized;
	}
	throw new Error(`Expected JSON-compatible value at ${path}`);
}
