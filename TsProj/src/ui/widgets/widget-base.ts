import { UINodeBase } from "../common/ui-node-base";

export abstract class WidgetBase extends UINodeBase {
  protected constructor(readonly widgetName: string) {
    super();
  }

  initialize(
    parent: UINodeBase,
    root: CS.UnityEngine.GameObject,
    ownsRoot = false
  ): void {
    this.initializeNode(root, ownsRoot, parent);
  }
}
