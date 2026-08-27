import assert from "node:assert/strict";
import test from "node:test";
import { cliCommandNames } from "../../src/cli/command-registry.js";
import { cliCommandHandlers } from "../../src/cli/handler-registry.js";

test("CLI handler registry covers every public command", () => {
  assert.deepEqual(Object.keys(cliCommandHandlers).sort(), [...cliCommandNames].sort());
});
