import { EntityGuid } from "../../ecs/entity-guid";
import { Guid } from "../../core/guid";

export type Lane = 0 | 1 | 2;
export type GamePhase = "Menu" | "Playing" | "Paused" | "GameOver";

export type GameCommand =
  | { readonly type: "start-run" }
  | { readonly type: "move-left" }
  | { readonly type: "move-right" }
  | { readonly type: "pause-run" }
  | { readonly type: "resume-run" }
  | { readonly type: "restart-run" }
  | { readonly type: "return-to-menu" };

export interface LaneObjectSnapshot {
  readonly entityGuid: EntityGuid;
  readonly kind: "obstacle" | "coin";
  readonly lane: Lane;
  readonly distance: number;
}

export interface LaneDodgeSnapshot {
  readonly profileGuid: Guid;
  readonly phase: GamePhase;
  readonly elapsedSeconds: number;
  readonly score: number;
  readonly runCoins: number;
  readonly bestScore: number;
  readonly totalCoins: number;
  readonly playerLane: Lane | null;
  readonly speed: number;
  readonly spawnInterval: number;
  readonly objects: readonly LaneObjectSnapshot[];
}
