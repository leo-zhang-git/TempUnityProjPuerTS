import { defineComponent } from "../ecs/component";

export type SceneName = "Boot" | "Main";

export interface SceneState {
  current: SceneName;
}

export interface EnvironmentState {
  resourcesCleaned: boolean;
  initialized: boolean;
}

export interface RuntimeState {
  elapsedSeconds: number;
}

export const SceneStateComponent = defineComponent<SceneState>("game.sceneState");
export const EnvironmentStateComponent = defineComponent<EnvironmentState>("game.environmentState");
export const RuntimeStateComponent = defineComponent<RuntimeState>("game.runtimeState");
