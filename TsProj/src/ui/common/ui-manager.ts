import { CanvasBase } from "../canvas/canvas-base";
import { BinderWidgetFactory } from "./ui-node-base";
import {
  CanvasSortingLayer,
  CanvasSortingLayerValue
} from "./ui-config";
import { destroy, ensureEventSystem } from "./unity-ui";

const Unity = CS.UnityEngine;

export class UIManager {
  private readonly root: CS.UnityEngine.GameObject;
  private readonly ownedEventSystem: CS.UnityEngine.GameObject | undefined;
  private readonly canvases = new Map<string, CanvasBase>();
  private readonly canvasLayers = new Map<string, CanvasSortingLayerValue>();
  private destroyed = false;

  constructor(private readonly binderWidgetFactory: BinderWidgetFactory) {
    this.root = new Unity.GameObject("TypeScript UI Root");
    try {
      this.ownedEventSystem = ensureEventSystem();
    } catch (error) {
      destroy(this.root);
      throw error;
    }
  }

  openCanvas<TCanvas extends CanvasBase>(
    canvas: TCanvas,
    layer: CanvasSortingLayerValue = CanvasSortingLayer.General
  ): TCanvas {
    this.assertActive("open canvas");
    if (this.canvases.has(canvas.canvasName)) {
      throw new Error(`Canvas ${canvas.canvasName} is already open.`);
    }

    canvas.initialize({
      parent: this.root.transform,
      sortingOrder: 0,
      binderWidgetFactory: this.binderWidgetFactory,
      onDestroyed: (destroyedCanvas) => this.removeDestroyedCanvas(destroyedCanvas)
    });
    this.canvases.set(canvas.canvasName, canvas);
    this.canvasLayers.set(canvas.canvasName, layer);
    this.sortCanvasOrder();

    try {
      canvas.show();
      return canvas;
    } catch (error) {
      this.canvases.delete(canvas.canvasName);
      this.canvasLayers.delete(canvas.canvasName);
      this.sortCanvasOrder();
      try {
        canvas.destroy();
      } catch (cleanupError) {
        void cleanupError;
      }
      throw error;
    }
  }

  getCanvas(canvasName: string): CanvasBase | undefined {
    return this.canvases.get(canvasName);
  }

  showCanvas(canvasName: string): void {
    this.requireCanvas(canvasName).show();
  }

  hideCanvas(canvasName: string): void {
    this.requireCanvas(canvasName).hide();
  }

  closeCanvas(canvasName: string): void {
    const canvas = this.canvases.get(canvasName);
    if (!canvas) {
      return;
    }

    this.canvases.delete(canvasName);
    this.canvasLayers.delete(canvasName);
    this.sortCanvasOrder();
    canvas.destroy();
  }

  update(deltaTime: number): void {
    if (this.destroyed) {
      return;
    }
    assertDeltaTime(deltaTime);
    for (const canvas of [...this.canvases.values()]) {
      canvas.update(deltaTime);
    }
  }

  lateUpdate(deltaTime: number): void {
    if (this.destroyed) {
      return;
    }
    assertDeltaTime(deltaTime);
    for (const canvas of [...this.canvases.values()]) {
      canvas.lateUpdate(deltaTime);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    let firstError: unknown;
    const canvases = [...this.canvases.values()].reverse();
    this.canvases.clear();
    this.canvasLayers.clear();
    for (const canvas of canvases) {
      firstError = captureFirstError(firstError, () => canvas.destroy());
    }

    firstError = captureFirstError(firstError, () => destroy(this.ownedEventSystem));
    firstError = captureFirstError(firstError, () => destroy(this.root));

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  private requireCanvas(canvasName: string): CanvasBase {
    this.assertActive("access canvas");
    const canvas = this.canvases.get(canvasName);
    if (!canvas) {
      throw new Error(`Canvas ${canvasName} is not open.`);
    }
    return canvas;
  }

  private removeDestroyedCanvas(canvas: CanvasBase): void {
    if (this.canvases.get(canvas.canvasName) === canvas) {
      this.canvases.delete(canvas.canvasName);
      this.canvasLayers.delete(canvas.canvasName);
      this.sortCanvasOrder();
    }
  }

  private sortCanvasOrder(): void {
    let orderIndex = 0;
    const layers = Object.values(CanvasSortingLayer).sort(
      (left, right) => left - right
    );
    for (const layer of layers) {
      for (const [canvasName, canvas] of this.canvases) {
        if (this.canvasLayers.get(canvasName) !== layer) {
          continue;
        }
        orderIndex += 1;
        canvas.setSortingOrder(orderIndex * 100 + 20);
      }
    }
  }

  private assertActive(operation: string): void {
    if (this.destroyed) {
      throw new Error(`Cannot ${operation} after UIManager.destroy().`);
    }
  }
}

function assertDeltaTime(deltaTime: number): void {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error(`UI deltaTime must be finite and non-negative; received ${deltaTime}.`);
  }
}

function captureFirstError(firstError: unknown, operation: () => void): unknown {
  try {
    operation();
  } catch (error) {
    return firstError === undefined ? error : firstError;
  }
  return firstError;
}
