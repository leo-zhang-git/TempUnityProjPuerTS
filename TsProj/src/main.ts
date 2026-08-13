import { GameRuntime } from "./game/game-runtime";
import { UnityLaneDodgePresentation } from "./game/lane-dodge/unity-presentation";
import { UnityPlayerPrefsStorage } from "./save/unity-player-prefs-storage";

let runtime: GameRuntime | undefined;
let presentation: UnityLaneDodgePresentation | undefined;

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
  if (presentation) {
    throw new Error("Main presentation has already been created.");
  }

  const gameRuntime = ensureRuntime();
  const result = gameRuntime.enterMain();
  try {
    presentation = new UnityLaneDodgePresentation(gameRuntime);
    return result;
  } catch (error) {
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
  presentation?.update();
}

export function lateUpdate(deltaTime: number): void {
  runtime?.lateUpdate(deltaTime);
  presentation?.lateUpdate();
}

export function dispose(): void {
  let firstError: unknown;

  try {
    presentation?.dispose();
  } catch (error) {
    firstError = error;
  }
  presentation = undefined;

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
