import { EntityId } from "../ecs/entity";
import { World } from "../ecs/world";
import {
  EnvironmentStateComponent,
  SceneStateComponent
} from "./components";

export function markBootResourcesCleaned(world: World, stateEntity: EntityId): void {
  const scene = world.get(stateEntity, SceneStateComponent);
  const environment = world.get(stateEntity, EnvironmentStateComponent);

  scene.current = "Boot";
  environment.resourcesCleaned = true;
  console.log("Boot resource cleanup completed.");
}

export function initializeEnvironment(world: World, stateEntity: EntityId): void {
  const environment = world.get(stateEntity, EnvironmentStateComponent);

  if (!environment.resourcesCleaned) {
    throw new Error("Environment initialization requires resource cleanup first.");
  }

  environment.initialized = true;
  console.log("Boot environment initialization completed.");
}

export function activateMainScene(world: World, stateEntity: EntityId): void {
  const scene = world.get(stateEntity, SceneStateComponent);
  const environment = world.get(stateEntity, EnvironmentStateComponent);

  if (!environment.initialized) {
    throw new Error("Main scene cannot start before Boot initialization.");
  }

  scene.current = "Main";
  console.log("Main scene state activated.");
}
