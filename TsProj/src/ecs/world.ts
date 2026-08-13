import { ComponentType } from "./component";
import { EntityId } from "./entity";

type AnyComponentType = ComponentType<object>;
type ComponentValues<TTypes extends readonly AnyComponentType[]> = {
  [Index in keyof TTypes]: TTypes[Index] extends ComponentType<infer TValue>
    ? TValue
    : never;
};
type QueryResult<TTypes extends readonly AnyComponentType[]> = [
  EntityId,
  ...ComponentValues<TTypes>
];

export class World {
  private static nextEntityId = 1;

  private readonly aliveEntities = new Set<EntityId>();
  private readonly components = new Map<AnyComponentType, Map<EntityId, object>>();
  private disposed = false;

  createEntity(): EntityId {
    this.assertActive();

    const entity = World.nextEntityId as EntityId;
    World.nextEntityId += 1;
    this.aliveEntities.add(entity);
    return entity;
  }

  isAlive(entity: EntityId): boolean {
    return !this.disposed && this.aliveEntities.has(entity);
  }

  destroyEntity(entity: EntityId): void {
    this.assertEntityAlive(entity);

    for (const store of this.components.values()) {
      store.delete(entity);
    }

    this.aliveEntities.delete(entity);
  }

  add<T extends object>(entity: EntityId, type: ComponentType<T>, component: T): void {
    this.assertEntityAlive(entity);

    const store = this.getOrCreateStore(type);
    if (store.has(entity)) {
      throw new Error(`Entity ${entity} already has component ${type.name}.`);
    }

    store.set(entity, component);
  }

  emplace<T extends object>(entity: EntityId, type: ComponentType<T>): T {
    const component = type.create();
    this.add(entity, type, component);
    return component;
  }

  get<T extends object>(entity: EntityId, type: ComponentType<T>): T {
    this.assertEntityAlive(entity);

    const store = this.getStore(type);
    if (!store?.has(entity)) {
      throw new Error(`Entity ${entity} does not have component ${type.name}.`);
    }

    return store.get(entity) as T;
  }

  tryGet<T extends object>(entity: EntityId, type: ComponentType<T>): T | undefined {
    this.assertEntityAlive(entity);
    return this.getStore(type)?.get(entity);
  }

  has<T extends object>(entity: EntityId, type: ComponentType<T>): boolean {
    this.assertEntityAlive(entity);
    return this.getStore(type)?.has(entity) ?? false;
  }

  remove<T extends object>(entity: EntityId, type: ComponentType<T>): boolean {
    this.assertEntityAlive(entity);
    return this.getStore(type)?.delete(entity) ?? false;
  }

  query<TTypes extends readonly [AnyComponentType, ...AnyComponentType[]]>(
    ...types: TTypes
  ): Array<QueryResult<TTypes>> {
    this.assertActive();

    const stores = types.map((type) => this.components.get(type));
    if (stores.some((store) => store === undefined)) {
      return [];
    }

    const availableStores = stores as Array<Map<EntityId, object>>;
    let primaryStore = availableStores[0];
    for (const store of availableStores) {
      if (store.size < primaryStore.size) {
        primaryStore = store;
      }
    }

    const result: Array<QueryResult<TTypes>> = [];

    for (const entity of primaryStore.keys()) {
      const componentValues: object[] = [];

      for (const store of availableStores) {
        const component = store.get(entity);
        if (component === undefined) {
          componentValues.length = 0;
          break;
        }

        componentValues.push(component);
      }

      if (componentValues.length === types.length) {
        result.push(
          [entity, ...componentValues] as unknown as QueryResult<TTypes>
        );
      }
    }

    return result;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.components.clear();
    this.aliveEntities.clear();
    this.disposed = true;
  }

  private getStore<T extends object>(
    type: ComponentType<T>
  ): Map<EntityId, T> | undefined {
    return this.components.get(type) as Map<EntityId, T> | undefined;
  }

  private getOrCreateStore<T extends object>(
    type: ComponentType<T>
  ): Map<EntityId, T> {
    let store = this.getStore(type);
    if (!store) {
      store = new Map<EntityId, T>();
      this.components.set(type, store);
    }

    return store;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("World has been disposed.");
    }
  }

  private assertEntityAlive(entity: EntityId): void {
    this.assertActive();
    if (!this.aliveEntities.has(entity)) {
      throw new Error(`Entity ${entity} is not alive in this world.`);
    }
  }
}
