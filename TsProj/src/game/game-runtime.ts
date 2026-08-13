import { EntityId } from "../ecs/entity";
import { SystemGroup } from "../ecs/system";
import { World } from "../ecs/world";
import {
  EnvironmentStateComponent,
  RuntimeStateComponent,
  SceneStateComponent
} from "./components";
import {
  activateMainScene,
  initializeEnvironment,
  markBootResourcesCleaned
} from "./lifecycle";
import { RuntimeUpdateSystem } from "./systems";

type RuntimePhase = "created" | "bootInitialized" | "main" | "disposed";

export class GameRuntime {
  private readonly world = new World();
  private readonly stateEntity: EntityId;
  private readonly fixedUpdateSystems = new SystemGroup("fixedUpdate", []);
  private readonly updateSystems = new SystemGroup("update", [
    new RuntimeUpdateSystem()
  ]);
  private readonly lateUpdateSystems = new SystemGroup("lateUpdate", []);
  private phase: RuntimePhase = "created";

  constructor() {
    this.stateEntity = this.world.createEntity();
    this.world.emplace(this.stateEntity, SceneStateComponent);
    this.world.emplace(this.stateEntity, EnvironmentStateComponent);
    this.world.emplace(this.stateEntity, RuntimeStateComponent);
  }

  initializeBoot(): string {
    this.assertPhase("created", "initialize Boot");

    markBootResourcesCleaned(this.world, this.stateEntity);
    initializeEnvironment(this.world, this.stateEntity);
    this.phase = "bootInitialized";
    return "Boot initialized.";
  }

  enterMain(): string {
    this.assertPhase("bootInitialized", "enter Main");

    activateMainScene(this.world, this.stateEntity);
    try {
      this.initializeSystemGroups();
    } catch (error) {
      this.dispose();
      throw error;
    }

    this.phase = "main";
    return "Main entered.";
  }

  fixedUpdate(deltaTime: number): void {
    this.assertPhase("main", "run FixedUpdate");
    this.fixedUpdateSystems.update(this.world, deltaTime);
  }

  update(deltaTime: number): void {
    this.assertPhase("main", "run Update");
    this.updateSystems.update(this.world, deltaTime);
  }

  lateUpdate(deltaTime: number): void {
    this.assertPhase("main", "run LateUpdate");
    this.lateUpdateSystems.update(this.world, deltaTime);
  }

  dispose(): void {
    if (this.phase === "disposed") {
      return;
    }

    this.phase = "disposed";

    let firstError: unknown;
    for (const group of [
      this.lateUpdateSystems,
      this.updateSystems,
      this.fixedUpdateSystems
    ]) {
      try {
        group.dispose(this.world);
      } catch (error) {
        firstError ??= error;
      }
    }

    this.world.dispose();
    console.log("Game runtime disposed.");

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  private initializeSystemGroups(): void {
    const groups = [
      this.fixedUpdateSystems,
      this.updateSystems,
      this.lateUpdateSystems
    ];
    let initializedCount = 0;

    try {
      for (const group of groups) {
        group.initialize(this.world);
        initializedCount += 1;
      }
    } catch (error) {
      for (let index = initializedCount - 1; index >= 0; index -= 1) {
        groupDisposeIgnoringError(groups[index], this.world);
      }
      throw error;
    }
  }

  private assertPhase(expected: RuntimePhase, operation: string): void {
    if (this.phase !== expected) {
      throw new Error(
        `Cannot ${operation} while runtime phase is ${this.phase}; expected ${expected}.`
      );
    }
  }
}

function groupDisposeIgnoringError(group: SystemGroup, world: World): void {
  try {
    group.dispose(world);
  } catch (error) {
    console.error(`Failed to dispose system group ${group.name}.`, error);
  }
}
