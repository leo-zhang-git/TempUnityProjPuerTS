import {
  BinderWidgetFactory,
  UINodeBase
} from "../common/ui-node-base";
import { canvasPrefabPath } from "../common/ui-paths";
import { instantiateLocalUiPrefab } from "../common/ui-prefab-loader";
import { destroy } from "../common/unity-ui";

export interface CanvasInitializationContext {
  readonly parent: CS.UnityEngine.Transform;
  readonly sortingOrder: number;
  readonly binderWidgetFactory: BinderWidgetFactory;
  readonly onDestroyed: (canvas: CanvasBase) => void;
}

export abstract class CanvasBase extends UINodeBase {
  private canvasComponent: CS.UnityEngine.Canvas | undefined;

  protected constructor(readonly canvasName: string) {
    super();
  }

  get canvas(): CS.UnityEngine.Canvas {
    if (!this.canvasComponent) {
      throw new Error(
        `Canvas component is unavailable for ${this.canvasName} while state=${this.loadState}.`
      );
    }
    return this.canvasComponent;
  }

  initialize(context: CanvasInitializationContext): void {
    const gameObject = instantiateLocalUiPrefab(
      canvasPrefabPath(this.canvasName),
      context.parent
    );
    const canvas = gameObject.GetComponent(
      puer.$typeof(CS.UnityEngine.Canvas)
    ) as CS.UnityEngine.Canvas | null;
    if (!canvas) {
      destroy(gameObject);
      throw new Error(`Canvas prefab ${this.canvasName} has no Canvas component.`);
    }
    canvas.sortingOrder = context.sortingOrder;
    this.canvasComponent = canvas;

    try {
      this.initializeNode(
        gameObject,
        true,
        undefined,
        context.binderWidgetFactory
      );
      this.registerDisposer(() => context.onDestroyed(this));
    } catch (error) {
      this.canvasComponent = undefined;
      throw error;
    }
  }

  setSortingOrder(sortingOrder: number): void {
    this.canvas.sortingOrder = sortingOrder;
  }

  override destroy(): void {
    try {
      super.destroy();
    } finally {
      this.canvasComponent = undefined;
    }
  }
}
