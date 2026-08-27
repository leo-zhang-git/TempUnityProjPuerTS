import { parseArgs } from "node:util";
import { createStaticDataService } from "./app/service.js";
import { resolveWorkspaceRoot } from "./core/workspace-root.js";
import { loadStaticdataFrameConfig } from "./frame-config.js";
import { registry } from "./schemas.js";
import { summaryBuilders } from "./summary-builders.js";
import { createWebServerIdentity, startWebServer } from "./web.js";

const parsed = parseArgs({
	args: process.argv.slice(2),
	options: {
		workspace: { type: "string" },
		host: { type: "string" },
		port: { type: "string" },
		"print-identity": { type: "boolean", default: false },
	},
	allowPositionals: false,
});
const workspaceRoot = resolveWorkspaceRoot(parsed.values.workspace);
const frameConfig = loadStaticdataFrameConfig();
const service = createStaticDataService(registry, undefined, undefined, summaryBuilders);
if (parsed.values["print-identity"]) {
	console.log(JSON.stringify({ ok: true, identity: createWebServerIdentity(workspaceRoot, service) }, null, 2));
} else {
	const { url } = await startWebServer({
		service,
		workspaceRoot,
		host: parsed.values.host ?? frameConfig.host,
		port: parsePositiveInteger(
			parsed.values.port ?? String(frameConfig.staticdataWebBase + frameConfig.portSlot),
			"port",
		),
	});
	console.log(JSON.stringify({ ok: true, url }, null, 2));
}

function parsePositiveInteger(rawValue: string | undefined, field: string): number {
	const parsedValue = Number(rawValue);
	if (!Number.isInteger(parsedValue) || parsedValue <= 0) throw new Error(`Invalid ${field}: ${rawValue}`);
	return parsedValue;
}
