import { materializeSidecarRecordWithSchema } from "../../../data/framework/schema-materializer.js";
import { isJsonObject, type JsonObject, type SidecarSchema } from "../core/schema.js";

export function materializeSidecars(
	authoredSidecars: JsonObject | undefined,
	sidecarSchemas: Record<string, SidecarSchema> | undefined,
): Record<string, JsonObject> {
	const resolved: Record<string, JsonObject> = {};
	if (!authoredSidecars || !sidecarSchemas) {
		return resolved;
	}
	for (const sidecarName of Object.keys(sidecarSchemas).sort((left, right) => left.localeCompare(right))) {
		const authoredSidecar = getAuthoredSidecar(authoredSidecars, sidecarName);
		const sidecarSchema = sidecarSchemas[sidecarName];
		if (!authoredSidecar || !sidecarSchema) {
			continue;
		}
		resolved[sidecarName] = materializeSidecarRecordWithSchema(authoredSidecar, sidecarSchema.schema);
	}
	return resolved;
}

export function getAuthoredSidecar(sidecars: JsonObject | undefined, sidecarName: string | undefined): JsonObject | undefined {
	if (!sidecars || !sidecarName) {
		return undefined;
	}
	const sidecar = sidecars[sidecarName];
	return isJsonObject(sidecar) ? sidecar : undefined;
}

export function normalizeSidecarSet(sidecars: JsonObject | undefined): Record<string, JsonObject> {
	const normalized: Record<string, JsonObject> = {};
	for (const [sidecarName, sidecar] of Object.entries(sidecars ?? {})) {
		if (isJsonObject(sidecar)) {
			normalized[sidecarName] = sidecar;
		}
	}
	return normalized;
}

