import assert from "node:assert/strict";
import test from "node:test";
import { formatLineBreaksForGrid, shouldUseMultilineStringEditor } from "../src/web/dom-utils.js";
import { createImeCompositionState, GRID_SEARCH_DELAY_MS, isImeCompositionEvent } from "../src/web/grid-search-input.js";

test("grid search waits 700ms after committed input", () => {
	assert.equal(GRID_SEARCH_DELAY_MS, 700);
});

test("grid search recognizes active IME composition and legacy key code", () => {
	assert.equal(isImeCompositionEvent({ isComposing: true }), true);
	assert.equal(isImeCompositionEvent({ keyCode: 229 }), true);
	assert.equal(isImeCompositionEvent({ isComposing: false, keyCode: 13 }), false);
});

test("grid search keeps one input composing until compositionend", () => {
	const state = createImeCompositionState();
	const input = {};
	state.start(input);
	assert.equal(state.isComposing(input, { isComposing: false }), true);
	state.end(input);
	assert.equal(state.isComposing(input, { isComposing: false }), false);
});

test("multiline string editor uses explicit metadata or existing real line breaks", () => {
	assert.equal(shouldUseMultilineStringEditor({ kind: "string", metadata: { multiline: true } }, "single line"), true);
	assert.equal(shouldUseMultilineStringEditor({ kind: "string" }, "first\nsecond"), true);
	assert.equal(shouldUseMultilineStringEditor({ kind: "string" }, "first\r\nsecond"), true);
	assert.equal(shouldUseMultilineStringEditor({ kind: "string" }, "first\\nsecond"), false);
	assert.equal(shouldUseMultilineStringEditor({ kind: "path", metadata: { multiline: true } }, "first\nsecond"), false);
});

test("grid formatting preserves real line breaks for display", () => {
	assert.equal(formatLineBreaksForGrid("first\r\nsecond\rthird\nfourth"), "first\\nsecond\\nthird\\nfourth");
	assert.equal(formatLineBreaksForGrid("first\\nsecond"), "first\\nsecond");
});

