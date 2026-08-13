import { World } from "./world";

type SystemState = "created" | "initializing" | "initialized" | "disposed";
type SystemGroupState = "created" | "initializing" | "initialized" | "disposed";

export abstract class SystemBase {
  private state: SystemState = "created";

  protected constructor(public readonly name: string) {
    if (name.trim().length === 0) {
      throw new Error("System name cannot be empty.");
    }
  }

  initialize(world: World): void {
    if (this.state !== "created") {
      throw new Error(`System ${this.name} cannot initialize from state ${this.state}.`);
    }

    this.state = "initializing";
    try {
      this.onInitialize(world);
      this.state = "initialized";
    } catch (error) {
      try {
        this.onDispose(world);
      } catch (disposeError) {
        console.error(
          `Failed to clean up system ${this.name} after initialization failed.`,
          disposeError
        );
      } finally {
        this.state = "disposed";
      }

      throw error;
    }
  }

  update(world: World, deltaTime: number): void {
    if (this.state !== "initialized") {
      throw new Error(`System ${this.name} cannot update from state ${this.state}.`);
    }

    this.onUpdate(world, deltaTime);
  }

  dispose(world: World): void {
    if (this.state === "disposed") {
      return;
    }

    if (this.state === "initialized") {
      try {
        this.onDispose(world);
      } finally {
        this.state = "disposed";
      }
      return;
    }

    this.state = "disposed";
  }

  protected onInitialize(_world: World): void {}

  protected abstract onUpdate(world: World, deltaTime: number): void;

  protected onDispose(_world: World): void {}
}

export class SystemGroup {
  private state: SystemGroupState = "created";

  constructor(
    public readonly name: string,
    private readonly systems: readonly SystemBase[]
  ) {
    if (name.trim().length === 0) {
      throw new Error("System group name cannot be empty.");
    }
  }

  initialize(world: World): void {
    if (this.state !== "created") {
      throw new Error(
        `System group ${this.name} cannot initialize from state ${this.state}.`
      );
    }

    this.state = "initializing";
    let initializedCount = 0;
    try {
      for (const system of this.systems) {
        system.initialize(world);
        initializedCount += 1;
      }
      this.state = "initialized";
    } catch (error) {
      for (let index = initializedCount - 1; index >= 0; index -= 1) {
        try {
          this.systems[index].dispose(world);
        } catch (disposeError) {
          console.error(
            `Failed to roll back system ${this.systems[index].name}.`,
            disposeError
          );
        }
      }
      this.state = "disposed";
      throw error;
    }
  }

  update(world: World, deltaTime: number): void {
    if (this.state !== "initialized") {
      throw new Error(`System group ${this.name} is not initialized.`);
    }

    for (const system of this.systems) {
      system.update(world, deltaTime);
    }
  }

  dispose(world: World): void {
    if (this.state === "disposed") {
      return;
    }

    let firstError: unknown;
    for (let index = this.systems.length - 1; index >= 0; index -= 1) {
      try {
        this.systems[index].dispose(world);
      } catch (error) {
        firstError ??= error;
      }
    }

    this.state = "disposed";
    if (firstError !== undefined) {
      throw firstError;
    }
  }
}
