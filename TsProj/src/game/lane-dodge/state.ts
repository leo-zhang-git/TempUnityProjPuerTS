import { defineComponent } from "../../ecs/component";
import { EntityGuid } from "../../ecs/entity-guid";
import { World } from "../../ecs/world";
import { LaneDodgeProfile } from "./profile";
import {
  GameCommand,
  GamePhase,
  Lane,
  LaneDodgeSnapshot,
  LaneObjectSnapshot
} from "./model";

export interface GameFlowState {
  phase: GamePhase;
}

export interface RunState {
  elapsedSeconds: number;
  score: number;
  runCoins: number;
}

export interface SpawnState {
  timeUntilSpawn: number;
}

export interface DifficultyState {
  objectSpeed: number;
  spawnInterval: number;
}

export interface CommandQueue {
  commands: GameCommand[];
}

export interface LanePosition {
  lane: Lane;
  distance: number;
  previousDistance: number;
}

export interface MoveSpeed {
  unitsPerSecond: number;
}

export interface CollisionSize {
  radius: number;
}

export interface Collectible {
  value: number;
}

export interface PlayerTag {
  readonly tag: "player";
}

export interface ObstacleTag {
  readonly tag: "obstacle";
}

export interface RunEntityTag {
  readonly tag: "runEntity";
}

export interface PendingDestroyTag {
  readonly tag: "pendingDestroy";
}

export const GameFlowStateComponent = defineComponent<GameFlowState>(
  "laneDodge.gameFlowState",
  () => ({ phase: "Menu" })
);
export const RunStateComponent = defineComponent<RunState>(
  "laneDodge.runState",
  () => ({ elapsedSeconds: 0, score: 0, runCoins: 0 })
);
export const SpawnStateComponent = defineComponent<SpawnState>(
  "laneDodge.spawnState",
  () => ({ timeUntilSpawn: 0.75 })
);
export const DifficultyStateComponent = defineComponent<DifficultyState>(
  "laneDodge.difficultyState",
  () => ({ objectSpeed: 5, spawnInterval: 0.9 })
);
export const CommandQueueComponent = defineComponent<CommandQueue>(
  "laneDodge.commandQueue",
  () => ({ commands: [] })
);
export const LanePositionComponent = defineComponent<LanePosition>(
  "laneDodge.lanePosition",
  () => ({ lane: 1, distance: 0, previousDistance: 0 })
);
export const MoveSpeedComponent = defineComponent<MoveSpeed>(
  "laneDodge.moveSpeed",
  () => ({ unitsPerSecond: 0 })
);
export const CollisionSizeComponent = defineComponent<CollisionSize>(
  "laneDodge.collisionSize",
  () => ({ radius: 0.35 })
);
export const CollectibleComponent = defineComponent<Collectible>(
  "laneDodge.collectible",
  () => ({ value: 1 })
);
export const PlayerComponent = defineComponent<PlayerTag>(
  "laneDodge.player",
  () => ({ tag: "player" })
);
export const ObstacleComponent = defineComponent<ObstacleTag>(
  "laneDodge.obstacle",
  () => ({ tag: "obstacle" })
);
export const RunEntityComponent = defineComponent<RunEntityTag>(
  "laneDodge.runEntity",
  () => ({ tag: "runEntity" })
);
export const PendingDestroyComponent = defineComponent<PendingDestroyTag>(
  "laneDodge.pendingDestroy",
  () => ({ tag: "pendingDestroy" })
);
export const ProfileStateComponent = defineComponent<LaneDodgeProfile>(
  "laneDodge.profileState",
  () => {
    throw new Error("Lane-dodge profile state requires loaded save data.");
  }
);

export function createLaneDodgeState(
  world: World,
  stateEntityGuid: EntityGuid,
  profile: LaneDodgeProfile
): void {
  world.emplace(stateEntityGuid, GameFlowStateComponent);
  world.emplace(stateEntityGuid, RunStateComponent);
  world.emplace(stateEntityGuid, SpawnStateComponent);
  world.emplace(stateEntityGuid, DifficultyStateComponent);
  world.emplace(stateEntityGuid, CommandQueueComponent);
  world.add(stateEntityGuid, ProfileStateComponent, profile);
}

export function createLaneDodgeSnapshot(
  world: World,
  stateEntityGuid: EntityGuid
): LaneDodgeSnapshot {
  const flow = world.get(stateEntityGuid, GameFlowStateComponent);
  const run = world.get(stateEntityGuid, RunStateComponent);
  const profile = world.get(stateEntityGuid, ProfileStateComponent);
  const difficulty = world.get(stateEntityGuid, DifficultyStateComponent);
  const player = world.query(PlayerComponent, LanePositionComponent)[0];
  const objects: LaneObjectSnapshot[] = [];

  for (const [entityGuid, , position] of world.query(
    ObstacleComponent,
    LanePositionComponent
  )) {
    objects.push({
      entityGuid,
      kind: "obstacle",
      lane: position.lane,
      distance: position.distance
    });
  }

  for (const [entityGuid, , position] of world.query(
    CollectibleComponent,
    LanePositionComponent
  )) {
    objects.push({
      entityGuid,
      kind: "coin",
      lane: position.lane,
      distance: position.distance
    });
  }

  objects.sort((left, right) => left.entityGuid.localeCompare(right.entityGuid));
  return {
    profileGuid: profile.profileGuid,
    phase: flow.phase,
    elapsedSeconds: run.elapsedSeconds,
    score: run.score,
    runCoins: run.runCoins,
    bestScore: profile.bestScore,
    totalCoins: profile.totalCoins,
    playerLane: player?.[2].lane ?? null,
    speed: difficulty.objectSpeed,
    spawnInterval: difficulty.spawnInterval,
    objects
  };
}
