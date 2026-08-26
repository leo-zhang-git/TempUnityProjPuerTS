import { GameRuntime } from "./game/game-runtime";
import { UnityPlayerPrefsStorage } from "./save/unity-player-prefs-storage";
import { LaneDodgeCanvas } from "./ui/canvas/lane-dodge-canvas";
import { CanvasSortingLayer } from "./ui/common/ui-config";
import { UIManager } from "./ui/common/ui-manager";
import { WidgetFactory } from "./ui/widgets/widget-factory";

let runtime: GameRuntime | undefined;
let uiManager: UIManager | undefined;

function ensureRuntime(): GameRuntime {
  if (!runtime) {
    runtime = new GameRuntime({ saveStorage: new UnityPlayerPrefsStorage() });
  }

  return runtime;
}

export function initializeBoot(): string {
  return ensureRuntime().initializeBoot();
}

export function enterMain(): string {
  if (uiManager) {
    throw new Error("Main UI has already been created.");
  }

  const gameRuntime = ensureRuntime();
  const result = gameRuntime.enterMain();
  const manager = new UIManager(new WidgetFactory());
  try {
    manager.openCanvas(
      new LaneDodgeCanvas(gameRuntime),
      CanvasSortingLayer.Scene
    );
    uiManager = manager;
    return result;
  } catch (error) {
    try {
      manager.destroy();
    } catch (cleanupError) {
      void cleanupError;
    }
    gameRuntime.dispose();
    runtime = undefined;
    throw error;
  }
}

export function fixedUpdate(deltaTime: number): void {
  runtime?.fixedUpdate(deltaTime);
}

export function update(deltaTime: number): void {
  runtime?.update(deltaTime);
  uiManager?.update(deltaTime);
}

export function lateUpdate(deltaTime: number): void {
  runtime?.lateUpdate(deltaTime);
  uiManager?.lateUpdate(deltaTime);
}

export function dispose(): void {
  let firstError: unknown;

  try {
    uiManager?.destroy();
  } catch (error) {
    firstError = error;
  }
  uiManager = undefined;

  try {
    runtime?.dispose();
  } catch (error) {
    if (firstError === undefined) {
      firstError = error;
    }
  }
  runtime = undefined;

  if (firstError !== undefined) {
    throw firstError;
  }
}
