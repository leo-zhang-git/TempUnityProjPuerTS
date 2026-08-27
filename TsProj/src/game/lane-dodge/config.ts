import {
  requireLaneDodgeRules,
  type LaneDodgeRulesDataType
} from "../../staticdata/generated/data/tables/lane-dodge-rules/info";

export type LaneDodgeConfig = LaneDodgeRulesDataType;

export function loadLaneDodgeConfig(): LaneDodgeConfig {
  return requireLaneDodgeRules("default");
}
