import { createRegistry } from "./framework/tool-schema.js";
import { laneDodgeRulesSchema } from "./lane-dodge-rules/schema.js";

export const registry = createRegistry([laneDodgeRulesSchema]);
