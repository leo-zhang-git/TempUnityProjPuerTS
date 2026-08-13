import { defaultGuidGenerator, GuidGenerator } from "../core/guid";
import { EntityGuid } from "../ecs/entity-guid";
import { SystemGroup } from "../ecs/system";
import { World } from "../ecs/world";
import { MemoryStringStorage, StringStorage } from "../save/string-storage";
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
import { GameCommand, LaneDodgeSnapshot } from "./lane-dodge/model";
import {
  CommandQueueComponent,
  createLaneDodgeSnapshot,
  createLaneDodgeState
} from "./lane-dodge/state";
import {
  CollisionSystem,
  CommandSystem,
  DifficultySystem,
  MovementSystem,
  PendingDestroySystem,
  ProfileSaveSystem,
  RunProgressSystem,
  SpawnSystem
} from "./lane-dodge/systems";
import { LaneDodgeProfileStore } from "./lane-dodge/profile";
import { RuntimeUpdateSystem } from "./systems";

type RuntimePhase = "created" | "bootInitialized" | "main" | "disposed";

export interface GameRuntimeOptions {
  readonly random?: () => number;
  readonly guidGenerator?: GuidGenerator;
  readonly saveStorage?: StringStorage;
}

export class GameRuntime {
  private readonly world: World;
  private readonly stateEntityGuid: EntityGuid;
  private readonly fixedUpdateSystems: SystemGroup;
  private readonly updateSystems = new SystemGroup("update", [
    new RuntimeUpdateSystem()
  ]);
  private readonly lateUpdateSystems = new SystemGroup("lateUpdate", []);
  private phase: RuntimePhase = "created";

  constructor(options: GameRuntimeOptions = {}) {
    const guidGenerator = options.guidGenerator ?? defaultGuidGenerator;
    const profileStore = new LaneDodgeProfileStore(
      options.saveStorage ?? new MemoryStringStorage()
    );
    this.world = new World(guidGenerator);
    this.stateEntityGuid = this.world.createEntity();
    this.world.emplace(this.stateEntityGuid, SceneStateComponent);
    this.world.emplace(this.stateEntityGuid, EnvironmentStateComponent);
    this.world.emplace(this.stateEntityGuid, RuntimeStateComponent);
    createLaneDodgeState(
      this.world,
      this.stateEntityGuid,
      profileStore.loadOrCreate(guidGenerator)
    );

    this.fixedUpdateSystems = new SystemGroup("fixedUpdate", [
      new CommandSystem(this.stateEntityGuid),
      new SpawnSystem(this.stateEntityGuid, options.random ?? Math.random),
      new MovementSystem(this.stateEntityGuid),
      new CollisionSystem(this.stateEntityGuid),
      new RunProgressSystem(this.stateEntityGuid),
      new ProfileSaveSystem(this.stateEntityGuid, profileStore),
      new DifficultySystem(this.stateEntityGuid),
      new PendingDestroySystem()
    ]);
  }

  initializeBoot(): string {
    this.assertPhase("created", "initialize Boot");

    markBootResourcesCleaned(this.world, this.stateEntityGuid);
    initializeEnvironment(this.world, this.stateEntityGuid);
    this.phase = "bootInitialized";
    return "Boot initialized.";
  }

  enterMain(): string {
    this.assertPhase("bootInitialized", "enter Main");

    activateMainScene(this.world, this.stateEntityGuid);
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
    assertDeltaTime(deltaTime);
    this.fixedUpdateSystems.update(this.world, deltaTime);
  }

  update(deltaTime: number): void {
    this.assertPhase("main", "run Update");
    assertDeltaTime(deltaTime);
    this.updateSystems.update(this.world, deltaTime);
  }

  lateUpdate(deltaTime: number): void {
    this.assertPhase("main", "run LateUpdate");
    assertDeltaTime(deltaTime);
    this.lateUpdateSystems.update(this.world, deltaTime);
  }

  dispatch(command: GameCommand): void {
    this.assertPhase("main", "dispatch a game command");
    this.world.get(this.stateEntityGuid, CommandQueueComponent).commands.push(command);
  }

  getSnapshot(): LaneDodgeSnapshot {
    this.assertPhase("main", "read the game snapshot");
    return createLaneDodgeSnapshot(this.world, this.stateEntityGuid);
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

function assertDeltaTime(deltaTime: number): void {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new Error(
      `Delta time must be a finite non-negative number; received ${deltaTime}.`
    );
  }
}

function groupDisposeIgnoringError(group: SystemGroup, world: World): void {
  try {
    group.dispose(world);
  } catch (error) {
    console.error(`Failed to dispose system group ${group.name}.`, error);
  }
}
