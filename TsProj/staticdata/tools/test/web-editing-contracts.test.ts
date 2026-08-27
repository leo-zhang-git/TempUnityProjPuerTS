import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeObject } from "../../data/framework/schema-materializer.js";
import { s } from "../../data/framework/tool-schema.js";
import { materializeRecordWithSchema } from "../src/index.js";
import { isGridSaveShortcut, syncAppliedGridRows } from "../src/web/grid-save.js";
import { hasPayloadChangedAfterCommit, isCurrentSaveView, SaveIntentQueue } from "../src/web/save-transaction.js";

test("string maxDisplayWidth truncates mixed text without splitting characters", () => {
	const schema = s.object({ name: s.string({ maxDisplayWidth: 14 }) });
	assert.deepEqual(materializeRecordWithSchema({ name: "3级护甲维修箱" }, schema), { name: "3级护甲维修箱" });
	assert.deepEqual(materializeRecordWithSchema({ name: "12级护甲维修箱" }, schema), { name: "12级护甲维修箱" });
	assert.deepEqual(materializeRecordWithSchema({ name: "123级护甲维修箱" }, schema), { name: "123级护甲维修" });
	assert.deepEqual(materializeRecordWithSchema({ name: "abcdefghijklmnop" }, schema), { name: "abcdefghijklmn" });
	assert.deepEqual(canonicalizeObject({ name: "123级护甲维修箱" }, schema), { name: "123级护甲维修" });
});

test("grid save shortcut accepts Ctrl/Cmd+S without Alt", () => {
	assert.equal(isGridSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: false }), true);
	assert.equal(isGridSaveShortcut({ key: "S", ctrlKey: false, metaKey: true, altKey: false }), true);
	assert.equal(isGridSaveShortcut({ key: "s", ctrlKey: true, metaKey: false, altKey: true }), false);
	assert.equal(isGridSaveShortcut({ key: "f", ctrlKey: true, metaKey: false, altKey: false }), false);
});

test("save transaction queues the latest intent and isolates navigation responses", () => {
	const queue = new SaveIntentQueue();
	assert.equal(queue.begin(), "started");
	assert.equal(queue.begin(), "queued");
	assert.equal(queue.begin(), "queued");
	assert.equal(queue.finish(), true);
	assert.equal(queue.begin(), "started");
	assert.equal(queue.finish(), false);
	assert.equal(
		isCurrentSaveView({ navigationRequestId: 3, identity: "grid:source-table" }, { navigationRequestId: 3, identity: "grid:source-table" }),
		true,
	);
	assert.equal(
		isCurrentSaveView({ navigationRequestId: 3, identity: "grid:source-table" }, { navigationRequestId: 4, identity: "grid:target-table" }),
		false,
	);
});

test("committed baseline keeps edits made while save is in flight", () => {
	const currentInput = { updates: [{ table: "source-table", id: "record-a", authoredCore: { capacity: 6 } }] };
	const oldBaseline = { updates: [{ table: "source-table", id: "record-a", authoredCore: { capacity: 6 } }] };
	const committedBaseline = { updates: [{ table: "source-table", id: "record-a", authoredCore: { capacity: 7 } }] };
	assert.equal(hasPayloadChangedAfterCommit(currentInput, oldBaseline), false);
	assert.equal(hasPayloadChangedAfterCommit(currentInput, committedBaseline), true);
});

test("syncAppliedGridRows updates the grid baseline without replacing the view", () => {
	const gridResult = {
		mode: "records",
		columns: [
			{ key: "label", target: "core", fieldKey: "label" },
			{ key: "stats.hp", target: "sidecar", sidecarName: "stats", fieldKey: "hp" },
		],
		rows: [
			{
				table: "source-table",
				category: "core",
				id: "record-a",
				label: "旧记录",
				hasSidecar: true,
				sidecarNames: ["stats"],
				cells: {
					label: { authored: "旧记录", resolved: "旧记录", source: "authored", display: "旧记录", issues: [] },
					"stats.hp": { authored: 10, resolved: 10, source: "authored", display: "10", issues: [] },
				},
			},
		],
	};
	const next = syncAppliedGridRows(
		gridResult,
		{ updates: [{ table: "source-table", id: "record-a", authoredCore: { label: "示例记录" }, authoredSidecars: { stats: { hp: 20 } } }] },
		{ resolvedHead: { tables: { "source-table": { "record-a": { core: { label: "示例记录" }, sidecars: { stats: { hp: 20 } } } } } } },
	);
	assert.notStrictEqual(next, gridResult);
	assert.equal(next.rows[0]?.cells.label?.authored, "示例记录");
	assert.equal(next.rows[0]?.cells.label?.resolved, "示例记录");
	assert.equal(next.rows[0]?.cells["stats.hp"]?.authored, 20);
	assert.equal(next.rows[0]?.cells["stats.hp"]?.resolved, 20);
});
