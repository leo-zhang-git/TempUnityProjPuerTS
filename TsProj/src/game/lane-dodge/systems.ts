import { EntityGuid } from "../../ecs/entity-guid";
import { SystemBase } from "../../ecs/system";
import { World } from "../../ecs/world";
import { GameCommand, Lane } from "./model";
import { LaneDodgeProfileStore } from "./profile";
import {
  CollectibleComponent,
  CollisionSizeComponent,
  CommandQueueComponent,
  DifficultyStateComponent,
  GameFlowStateComponent,
  LanePositionComponent,
  MoveSpeedComponent,
  ObstacleComponent,
  PendingDestroyComponent,
  PlayerComponent,
  ProfileStateComponent,
  RunEntityComponent,
  RunStateComponent,
  SpawnStateComponent
} from "./state";

const PLAYER_DISTANCE = 0;
const SPAWN_DISTANCE = 12;
const DESPAWN_DISTANCE = -2;
const INITIAL_SPAWN_DELAY = 0.75;
const BASE_SPEED = 5;
const MAX_SPEED = 10;
const BASE_SPAWN_INTERVAL = 0.9;
const MIN_SPAWN_INTERVAL = 0.38;
const COIN_CHANCE = 0.2;
const COIN_SCORE = 50;

export class CommandSystem extends SystemBase {
  constructor(private readonly stateEntityGuid: EntityGuid) {
    super("laneDodge.command");
  }

  protected onUpdate(world: World): void {
    const queue = world.get(this.stateEntityGuid, CommandQueueComponent);
    const commands = queue.commands.splice(0);
    for (const command of commands) {
      this.applyCommand(world, command);
    }
  }

  private applyCommand(world: World, command: GameCommand): void {
    const flow = world.get(this.stateEntityGuid, GameFlowStateComponent);

    switch (command.type) {
      case "start-run":
        if (flow.phase === "Menu" || flow.phase === "GameOver") {
          startNewRun(world, this.stateEntityGuid);
        }
        break;
      case "restart-run":
        if (flow.phase !== "Menu") {
          startNewRun(world, this.stateEntityGuid);
        }
        break;
      case "return-to-menu":
        clearRunEntities(world);
        flow.phase = "Menu";
        break;
      case "pause-run":
        if (flow.phase === "Playing") {
          flow.phase = "Paused";
        }
        break;
      case "resume-run":
        if (flow.phase === "Paused") {
          flow.phase = "Playing";
        }
        break;
      case "move-left":
        if (flow.phase === "Playing") {
          movePlayer(world, -1);
        }
        break;
      case "move-right":
        if (flow.phase === "Playing") {
          movePlayer(world, 1);
        }
        break;
    }
  }
}

export class SpawnSystem extends SystemBase {
  constructor(
    private readonly stateEntityGuid: EntityGuid,
    private readonly random: () => number
  ) {
    super("laneDodge.spawn");
  }

  protected onUpdate(world: World, deltaTime: number): void {
    if (!isPlaying(world, this.stateEntityGuid)) {
      return;
    }

    const spawn = world.get(this.stateEntityGuid, SpawnStateComponent);
    const difficulty = world.get(this.stateEntityGuid, DifficultyStateComponent);
    spawn.timeUntilSpawn -= deltaTime;

    let spawnCount = 0;
    while (spawn.timeUntilSpawn <= 0 && spawnCount < 32) {
      createFallingObject(world, difficulty.objectSpeed, this.random);
      spawn.timeUntilSpawn += difficulty.spawnInterval;
      spawnCount += 1;
    }

    if (spawnCount === 32 && spawn.timeUntilSpawn <= 0) {
      spawn.timeUntilSpawn = difficulty.spawnInterval;
    }
  }
}

export class MovementSystem extends SystemBase {
  constructor(private readonly stateEntityGuid: EntityGuid) {
    super("laneDodge.movement");
  }

  protected onUpdate(world: World, deltaTime: number): void {
    if (!isPlaying(world, this.stateEntityGuid)) {
      return;
    }

    for (const [entityGuid, position, speed] of world.query(
      LanePositionComponent,
      MoveSpeedComponent
    )) {
      position.previousDistance = position.distance;
      position.distance -= speed.unitsPerSecond * deltaTime;
      if (position.distance < DESPAWN_DISTANCE) {
        markForDestroy(world, entityGuid);
      }
    }
  }
}

export class CollisionSystem extends SystemBase {
  constructor(private readonly stateEntityGuid: EntityGuid) {
    super("laneDodge.collision");
  }

  protected onUpdate(world: World): void {
    if (!isPlaying(world, this.stateEntityGuid)) {
      return;
    }

    const playerResult = world.query(
      PlayerComponent,
      LanePositionComponent,
      CollisionSizeComponent
    )[0];
    if (!playerResult) {
      throw new Error("A playing lane-dodge run requires exactly one player entity.");
    }

    const [, , playerPosition, playerCollision] = playerResult;
    for (const [, , position, collision] of world.query(
      ObstacleComponent,
      LanePositionComponent,
      CollisionSizeComponent
    )) {
      if (
        hasCrossedPlayer(
          playerPosition.lane,
          position,
          playerCollision.radius + collision.radius
        )
      ) {
        world.get(this.stateEntityGuid, GameFlowStateComponent).phase = "GameOver";
        return;
      }
    }

    const run = world.get(this.stateEntityGuid, RunStateComponent);
    for (const [entityGuid, collectible, position, collision] of world.query(
      CollectibleComponent,
      LanePositionComponent,
      CollisionSizeComponent
    )) {
      if (
        hasCrossedPlayer(
          playerPosition.lane,
          position,
          playerCollision.radius + collision.radius
        )
      ) {
        run.runCoins += collectible.value;
        markForDestroy(world, entityGuid);
      }
    }
  }
}

export class RunProgressSystem extends SystemBase {
  constructor(private readonly stateEntityGuid: EntityGuid) {
    super("laneDodge.runProgress");
  }

  protected onUpdate(world: World, deltaTime: number): void {
    const run = world.get(this.stateEntityGuid, RunStateComponent);
    if (isPlaying(world, this.stateEntityGuid)) {
      run.elapsedSeconds += deltaTime;
    }
    run.score = Math.floor(run.elapsedSeconds * 10) + run.runCoins * COIN_SCORE;
  }
}

export class ProfileSaveSystem extends SystemBase {
  private previousPhase: string | undefined;

  constructor(
    private readonly stateEntityGuid: EntityGuid,
    private readonly profileStore: LaneDodgeProfileStore
  ) {
    super("laneDodge.profileSave");
  }

  protected onInitialize(world: World): void {
    this.previousPhase = world.get(
      this.stateEntityGuid,
      GameFlowStateComponent
    ).phase;
  }

  protected onUpdate(world: World): void {
    const phase = world.get(this.stateEntityGuid, GameFlowStateComponent).phase;
    if (phase === "GameOver" && this.previousPhase !== "GameOver") {
      const run = world.get(this.stateEntityGuid, RunStateComponent);
      const profile = world.get(this.stateEntityGuid, ProfileStateComponent);
      profile.bestScore = Math.max(profile.bestScore, run.score);
      profile.totalCoins += run.runCoins;
      this.profileStore.save(profile);
    }
    this.previousPhase = phase;
  }
}

export class DifficultySystem extends SystemBase {
  constructor(private readonly stateEntityGuid: EntityGuid) {
    super("laneDodge.difficulty");
  }

  protected onUpdate(world: World): void {
    if (!isPlaying(world, this.stateEntityGuid)) {
      return;
    }

    const elapsed = world.get(this.stateEntityGuid, RunStateComponent).elapsedSeconds;
    const difficulty = world.get(this.stateEntityGuid, DifficultyStateComponent);
    difficulty.objectSpeed = Math.min(MAX_SPEED, BASE_SPEED + elapsed * 0.06);
    difficulty.spawnInterval = Math.max(
      MIN_SPAWN_INTERVAL,
      BASE_SPAWN_INTERVAL - elapsed * 0.006
    );

    for (const [, speed] of world.query(MoveSpeedComponent)) {
      speed.unitsPerSecond = difficulty.objectSpeed;
    }
  }
}

export class PendingDestroySystem extends SystemBase {
  constructor() {
    super("laneDodge.pendingDestroy");
  }

  protected onUpdate(world: World): void {
    for (const [entityGuid] of world.query(PendingDestroyComponent)) {
      world.destroyEntity(entityGuid);
    }
  }
}

function startNewRun(world: World, stateEntityGuid: EntityGuid): void {
  clearRunEntities(world);

  const flow = world.get(stateEntityGuid, GameFlowStateComponent);
  const run = world.get(stateEntityGuid, RunStateComponent);
  const spawn = world.get(stateEntityGuid, SpawnStateComponent);
  const difficulty = world.get(stateEntityGuid, DifficultyStateComponent);
  flow.phase = "Playing";
  run.elapsedSeconds = 0;
  run.score = 0;
  run.runCoins = 0;
  spawn.timeUntilSpawn = INITIAL_SPAWN_DELAY;
  difficulty.objectSpeed = BASE_SPEED;
  difficulty.spawnInterval = BASE_SPAWN_INTERVAL;

  const playerEntityGuid = world.createEntity();
  world.emplace(playerEntityGuid, RunEntityComponent);
  world.emplace(playerEntityGuid, PlayerComponent);
  const position = world.emplace(playerEntityGuid, LanePositionComponent);
  position.lane = 1;
  position.distance = PLAYER_DISTANCE;
  position.previousDistance = PLAYER_DISTANCE;
  world.emplace(playerEntityGuid, CollisionSizeComponent);
}

function clearRunEntities(world: World): void {
  for (const [entityGuid] of world.query(RunEntityComponent)) {
    world.destroyEntity(entityGuid);
  }
}

function movePlayer(world: World, direction: -1 | 1): void {
  const playerResult = world.query(PlayerComponent, LanePositionComponent)[0];
  if (!playerResult) {
    throw new Error("Cannot move because the player entity does not exist.");
  }

  playerResult[2].lane = clampLane(playerResult[2].lane + direction);
}

function clampLane(lane: number): Lane {
  return Math.max(0, Math.min(2, lane)) as Lane;
}

function createFallingObject(
  world: World,
  speedValue: number,
  random: () => number
): void {
  const entityGuid = world.createEntity();
  world.emplace(entityGuid, RunEntityComponent);

  const position = world.emplace(entityGuid, LanePositionComponent);
  position.lane = clampLane(Math.floor(normalizeRandom(random()) * 3));
  position.distance = SPAWN_DISTANCE;
  position.previousDistance = SPAWN_DISTANCE;

  const speed = world.emplace(entityGuid, MoveSpeedComponent);
  speed.unitsPerSecond = speedValue;
  world.emplace(entityGuid, CollisionSizeComponent);

  if (normalizeRandom(random()) < COIN_CHANCE) {
    world.emplace(entityGuid, CollectibleComponent);
  } else {
    world.emplace(entityGuid, ObstacleComponent);
  }
}

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Random source must return a finite number; received ${value}.`);
  }
  return Math.max(0, Math.min(0.9999999999999999, value));
}

function hasCrossedPlayer(
  playerLane: Lane,
  position: { lane: Lane; distance: number; previousDistance: number },
  collisionDistance: number
): boolean {
  return (
    playerLane === position.lane &&
    position.previousDistance >= -collisionDistance &&
    position.distance <= collisionDistance
  );
}

function markForDestroy(world: World, entityGuid: EntityGuid): void {
  if (!world.has(entityGuid, PendingDestroyComponent)) {
    world.emplace(entityGuid, PendingDestroyComponent);
  }
}

function isPlaying(world: World, stateEntityGuid: EntityGuid): boolean {
  return world.get(stateEntityGuid, GameFlowStateComponent).phase === "Playing";
}
