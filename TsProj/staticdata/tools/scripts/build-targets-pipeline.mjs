import { resolve } from "node:path";

const staticDataRoot = resolve(import.meta.dirname, "..", "..");
const timingsMs = {};
const pipelineStartedAt = performance.now();

await measureStage("codegen", () => import("./codegen.mjs"));
const validation = await measureStage("validate", async () => {
	const [{ createStaticDataService }, { assertValid }, { registry }] = await Promise.all([
		import("../src/app/service.js"),
		import("../src/core/validate.js"),
		import("../src/schemas.js"),
	]);
	const report = createStaticDataService(registry).validateWorkspaceRoot(resolve(staticDataRoot, "data"));
	assertValid(report);
	return report;
});
await measureStage("buildTargets", () => import("./build-targets.mjs"));

timingsMs.total = roundMilliseconds(performance.now() - pipelineStartedAt);
console.log(
	JSON.stringify(
		{
			ok: true,
			records: validation.recordCount,
			pipelineTimingsMs: timingsMs,
		},
		null,
		2,
	),
);

async function measureStage(name, action) {
	const startedAt = performance.now();
	const result = await action();
	timingsMs[name] = roundMilliseconds(performance.now() - startedAt);
	return result;
}

function roundMilliseconds(value) {
	return Math.round(value * 100) / 100;
}

