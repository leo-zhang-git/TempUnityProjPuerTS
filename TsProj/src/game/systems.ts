import { EntityId } from "../ecs/entity";
import { System } from "../ecs/system";
import { World } from "../ecs/world";
import {
  EnvironmentStateComponent,
  RuntimeStateComponent,
  SceneStateComponent
} from "./components";

export function createBootCleanupSystem(stateEntity: EntityId): System {
  return {
    name: "boot.cleanupResources",
    update(world: World): void {
      const scene = world.get(stateEntity, SceneStateComponent);
      const environment = world.get(stateEntity, EnvironmentStateComponent);

      scene.current = "Boot";
      environment.resourcesCleaned = true;
      console.log("Boot resource cleanup completed.");
    }
  };
}

export function createEnvironmentInitializeSystem(stateEntity: EntityId): System {
  return {
    name: "boot.initializeEnvironment",
    update(world: World): void {
      const environment = world.get(stateEntity, EnvironmentStateComponent);

      if (!environment.resourcesCleaned) {
        throw new Error("Environment initialization requires resource cleanup first.");
      }

      environment.initialized = true;
      console.log("Boot environment initialization completed.");
    }
  };
}

export function createMainEnterSystem(stateEntity: EntityId): System {
  return {
    name: "main.enter",
    update(world: World): void {
      const scene = world.get(stateEntity, SceneStateComponent);
      const environment = world.get(stateEntity, EnvironmentStateComponent);

      if (!environment.initialized) {
        throw new Error("Main scene cannot start before Boot initialization.");
      }

      scene.current = "Main";
      console.log("Main scene state activated.");
    }
  };
}

export function createRuntimeUpdateSystem(stateEntity: EntityId): System {
  return {
    name: "runtime.update",
    update(world: World, deltaTime: number): void {
      const runtime = world.get(stateEntity, RuntimeStateComponent);
      runtime.elapsedSeconds += deltaTime;
    }
  };
}
