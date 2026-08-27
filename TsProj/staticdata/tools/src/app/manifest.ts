import { DEFAULT_VERIFY_TARGETS, type VerifyTarget } from "../core/verify.js";
import { createV0Boundaries, type V0Boundaries } from "./v0-boundaries.js";

export interface AppManifest {
	version: 1;
	boundaries: V0Boundaries;
	reviewArtifacts: string[];
	verifyTargets: VerifyTarget[];
	runtime: {
		packShape: "sparse-per-table";
		defaultRestoration: "access-layer";
		prewarmStrategy: "opt-in-cache";
	};
}

export function createAppManifest(): AppManifest {
	return {
		version: 1,
		boundaries: createV0Boundaries(),
		reviewArtifacts: ["semantic-diff.json", "resolved-head.json", "review-summary.json"],
		verifyTargets: [...DEFAULT_VERIFY_TARGETS],
		runtime: {
			packShape: "sparse-per-table",
			defaultRestoration: "access-layer",
			prewarmStrategy: "opt-in-cache",
		},
	};
}

