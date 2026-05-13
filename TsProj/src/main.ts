import { GameRuntime } from "./game/game-runtime";

let runtime: GameRuntime | undefined;

function ensureRuntime(): GameRuntime {
  if (!runtime) {
    runtime = new GameRuntime();
  }

  return runtime;
}

export function initializeBoot(): string {
  return ensureRuntime().initializeBoot();
}

export function enterMain(): string {
  return ensureRuntime().enterMain();
}

export function fixedUpdate(deltaTime: number): void {
  runtime?.fixedUpdate(deltaTime);
}

export function update(deltaTime: number): void {
  runtime?.update(deltaTime);
}

export function lateUpdate(deltaTime: number): void {
  runtime?.lateUpdate(deltaTime);
}

export function dispose(): void {
  runtime?.dispose();
  runtime = undefined;
}
