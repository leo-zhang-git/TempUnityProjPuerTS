import type { LaneDodgeResultItemWidgetUI } from "../generated/widget/lane-dodge-result-item-widget-ui";
import { WidgetBase } from "./widget-base";

export class LaneDodgeResultItemWidget extends WidgetBase {
  private get ui(): LaneDodgeResultItemWidgetUI {
    return this.getBinderUI<LaneDodgeResultItemWidgetUI>();
  }

  constructor() {
    super("LaneDodgeResultItemWidget");
  }

  render(label: string): void {
    this.ui.txt_label.text = label;
  }
}
