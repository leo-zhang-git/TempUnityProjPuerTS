import { EntityId } from "../ecs/entity";
import { runSystems, System } from "../ecs/system";
import { World } from "../ecs/world";
import {
  EnvironmentStateComponent,
  RuntimeStateComponent,
  SceneStateComponent
} from "./components";
import {
  createEnvironmentInitializeSystem,
  createBootCleanupSystem,
  createMainEnterSystem,
  createRuntimeUpdateSystem
} from "./systems";

export class GameRuntime {
  private readonly world = new World();
  private readonly stateEntity: EntityId;
  private readonly bootSystems: readonly System[];
  private readonly mainEnterSystems: readonly System[];
  private readonly fixedUpdateSystems: readonly System[];
  private readonly updateSystems: readonly System[];
  private readonly lateUpdateSystems: readonly System[];

  constructor() {
    this.stateEntity = this.world.createEntity();
    this.world.add(this.stateEntity, SceneStateComponent, { current: "Boot" });
    this.world.add(this.stateEntity, EnvironmentStateComponent, {
      resourcesCleaned: false,
      initialized: false
    });
    this.world.add(this.stateEntity, RuntimeStateComponent, { elapsedSeconds: 0 });

    this.bootSystems = [
      createBootCleanupSystem(this.stateEntity),
      createEnvironmentInitializeSystem(this.stateEntity)
    ];
    this.mainEnterSystems = [createMainEnterSystem(this.stateEntity)];
    this.fixedUpdateSystems = [];
    this.updateSystems = [createRuntimeUpdateSystem(this.stateEntity)];
    this.lateUpdateSystems = [];
  }

  initializeBoot(): string {
    runSystems(this.world, this.bootSystems);
    return "Boot initialized.";
  }

  enterMain(): string {
    runSystems(this.world, this.mainEnterSystems);
    return "Main entered.";
  }

  fixedUpdate(deltaTime: number): void {
    runSystems(this.world, this.fixedUpdateSystems, deltaTime);
  }

  update(deltaTime: number): void {
    runSystems(this.world, this.updateSystems, deltaTime);
  }

  lateUpdate(deltaTime: number): void {
    runSystems(this.world, this.lateUpdateSystems, deltaTime);
  }

  dispose(): void {
    console.log("Game runtime disposed.");
  }
}
