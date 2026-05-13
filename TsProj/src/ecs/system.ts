import { World } from "./world";

export interface System {
  readonly name: string;
  update(world: World, deltaTime: number): void;
}

export function runSystems(world: World, systems: readonly System[], deltaTime = 0): void {
  for (const system of systems) {
    system.update(world, deltaTime);
  }
}
