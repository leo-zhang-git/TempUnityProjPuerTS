import { SystemBase } from "../ecs/system";
import { World } from "../ecs/world";
import { RuntimeStateComponent } from "./components";

export class RuntimeUpdateSystem extends SystemBase {
  constructor() {
    super("runtime.update");
  }

  protected onUpdate(world: World, deltaTime: number): void {
    for (const [, runtime] of world.query(RuntimeStateComponent)) {
      runtime.elapsedSeconds += deltaTime;
    }
  }
}
