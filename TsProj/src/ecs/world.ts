import { ComponentType } from "./component";
import { EntityId } from "./entity";

export class World {
  private nextEntityId = 1;
  private readonly components = new Map<string, Map<EntityId, unknown>>();

  createEntity(): EntityId {
    const entity = this.nextEntityId;
    this.nextEntityId += 1;
    return entity;
  }

  add<T>(entity: EntityId, type: ComponentType<T>, component: T): void {
    this.storeFor(type).set(entity, component);
  }

  get<T>(entity: EntityId, type: ComponentType<T>): T {
    const component = this.storeFor(type).get(entity);
    if (component === undefined) {
      throw new Error(`Entity ${entity} does not have component ${type.name}.`);
    }

    return component as T;
  }

  tryGet<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
    return this.storeFor(type).get(entity) as T | undefined;
  }

  has<T>(entity: EntityId, type: ComponentType<T>): boolean {
    return this.storeFor(type).has(entity);
  }

  remove<T>(entity: EntityId, type: ComponentType<T>): void {
    this.storeFor(type).delete(entity);
  }

  query<T1>(type1: ComponentType<T1>): Array<[EntityId, T1]>;
  query<T1, T2>(type1: ComponentType<T1>, type2: ComponentType<T2>): Array<[EntityId, T1, T2]>;
  query(...types: Array<ComponentType<unknown>>): Array<[EntityId, ...unknown[]]> {
    if (types.length === 0) {
      return [];
    }

    const primaryStore = this.storeFor(types[0]);
    const result: Array<[EntityId, ...unknown[]]> = [];

    for (const [entity, firstComponent] of primaryStore) {
      const components: unknown[] = [firstComponent];
      let matches = true;

      for (let index = 1; index < types.length; index += 1) {
        const component = this.storeFor(types[index]).get(entity);
        if (component === undefined) {
          matches = false;
          break;
        }

        components.push(component);
      }

      if (matches) {
        result.push([entity, ...components]);
      }
    }

    return result;
  }

  private storeFor<T>(type: ComponentType<T>): Map<EntityId, unknown> {
    let store = this.components.get(type.name);
    if (!store) {
      store = new Map<EntityId, unknown>();
      this.components.set(type.name, store);
    }

    return store;
  }
}
