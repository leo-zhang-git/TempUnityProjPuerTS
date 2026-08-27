import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createStaticDataService } from "./app/service.js";
import { resolveWorkspaceRoot } from "./core/workspace-root.js";
import { createMcpToolCatalog, formatToolError, formatToolResult } from "./mcp/tools.js";
import { registry } from "./schemas.js";
import { summaryBuilders } from "./summary-builders.js";

async function main(): Promise<void> {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: {
			workspace: { type: "string" },
		},
		allowPositionals: false,
	});
	const workspaceRoot = resolveWorkspaceRoot(parsed.values.workspace);
	const service = createStaticDataService(registry, undefined, undefined, summaryBuilders);
	service.validateWorkspaceRoot(workspaceRoot);

	const server = new McpServer(
		{
			name: "unity-puerts-template-staticdata",
			version: "0.1.0",
		},
		{
			capabilities: {
				tools: {},
			},
			instructions:
				"This server exposes the same TypeScript semantic core used by the CLI and local Web UI. Use plan/apply tools for canonical patches, and preview_record_edit/apply_record_edit for finer-grained AI edits that still converge to canonical patch semantics before write-back.",
		},
	);

	for (const tool of createMcpToolCatalog(service, { defaultWorkspaceRoot: workspaceRoot })) {
		server.registerTool(
			tool.name,
			{
				title: tool.name,
				description: tool.description,
				...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
			},
			async (args) => {
				try {
					const result = await tool.execute(isRecord(args) ? args : {});
					return formatToolResult(result);
				} catch (error) {
					return formatToolError(error);
				}
			},
		);
	}

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	await main();
}
