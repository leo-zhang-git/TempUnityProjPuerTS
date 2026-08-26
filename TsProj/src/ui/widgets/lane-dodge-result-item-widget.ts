import type { LaneDodgeResultItemWidgetUI } from "../generated/widget/lane-dodge-result-item-widget-ui";
import { WidgetBase } from "./widget-base";

export interface LaneDodgeResultItemWidget extends LaneDodgeResultItemWidgetUI {}

export class LaneDodgeResultItemWidget extends WidgetBase {
  constructor() {
    super("LaneDodgeResultItemWidget");
  }
}
