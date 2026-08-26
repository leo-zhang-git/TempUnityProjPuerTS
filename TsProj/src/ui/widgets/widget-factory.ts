import {
  BinderWidgetFactory,
  UINodeBase
} from "../common/ui-node-base";
import { LaneDodgeHudWidget } from "./lane-dodge-hud-widget";
import { LaneDodgeResultItemWidget } from "./lane-dodge-result-item-widget";
import { WidgetBase } from "./widget-base";

type WidgetConstructor = new () => WidgetBase;

const WIDGET_CONSTRUCTORS: Readonly<Record<string, WidgetConstructor>> = {
  LaneDodgeHudWidget,
  LaneDodgeResultItemWidget
};

export class WidgetFactory implements BinderWidgetFactory {
  create(
    parent: UINodeBase,
    binder: CS.PuerTsTemplate.UI.UIBinder
  ): UINodeBase {
    const widgetType = binder.GetEffectiveWidgetType();
    const Widget = WIDGET_CONSTRUCTORS[widgetType];
    if (!Widget) {
      throw new Error(`No Widget constructor is registered for ${widgetType}.`);
    }

    const widget = new Widget();
    widget.initialize(parent, binder.gameObject, false);
    try {
      widget.show();
      return widget;
    } catch (error) {
      widget.destroy();
      throw error;
    }
  }
}
