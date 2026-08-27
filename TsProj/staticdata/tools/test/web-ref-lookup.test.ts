import assert from "node:assert/strict";
import test from "node:test";
import { getLookupLabel } from "../src/app/display.js";
import { type RefLookupOption, selectRefLookupOptions } from "../src/web/ref-lookup.js";

test("ref lookup stops scanning after the visible option limit", () => {
	const options: RefLookupOption[] = Array.from({ length: 20 }, (_, index) => ({
		id: String(index),
		category: "records",
		label: `任务 ${index}`,
		issueCount: 0,
	}));
	Object.defineProperty(options[12], "category", {
		get() {
			throw new Error("lookup scanned past its visible option limit");
		},
	});

	const selected = selectRefLookupOptions({ task: { options } }, [{ table: "task", categories: ["records"] }], "");

	assert.equal(selected.length, 12);
	assert.equal(selected[0]?.label, "任务 0");
	assert.equal(selected[11]?.label, "任务 11");
});

test("lookup labels recognize the legacy taskName field", () => {
	assert.equal(getLookupLabel({ taskName: "跨第二天" }), "跨第二天");
});

