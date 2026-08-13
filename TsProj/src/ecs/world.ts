import { ComponentType } from "./component";
import { defaultGuidGenerator, GuidGenerator } from "../core/guid";
import { EntityGuid } from "./entity-guid";

type AnyComponentType = ComponentType<object>;
type ComponentValues<TTypes extends readonly AnyComponentType[]> = {
  [Index in keyof TTypes]: TTypes[Index] extends ComponentType<infer TValue>
    ? TValue
    : never;
};
type QueryResult<TTypes extends readonly AnyComponentType[]> = [
  EntityGuid,
  ...ComponentValues<TTypes>
];

export class World {
  private readonly aliveEntities = new Set<EntityGuid>();
  private readonly issuedEntityGuids = new Set<EntityGuid>();
  private readonly components = new Map<AnyComponentType, Map<EntityGuid, object>>();
  private disposed = false;

  constructor(private readonly guidGenerator: GuidGenerator = defaultGuidGenerator) {}

  createEntity(): EntityGuid {
    this.assertActive();

    const entityGuid = this.guidGenerator.generate() as EntityGuid;
    if (this.issuedEntityGuids.has(entityGuid)) {
      throw new Error(`GUID generator produced duplicate entity GUID ${entityGuid}.`);
    }

    this.issuedEntityGuids.add(entityGuid);
    this.aliveEntities.add(entityGuid);
    return entityGuid;
  }

  isAlive(entityGuid: EntityGuid): boolean {
    return !this.disposed && this.aliveEntities.has(entityGuid);
  }

  destroyEntity(entityGuid: EntityGuid): void {
    this.assertEntityAlive(entityGuid);

    for (const store of this.components.values()) {
      store.delete(entityGuid);
    }

    this.aliveEntities.delete(entityGuid);
  }

  add<T extends object>(entityGuid: EntityGuid, type: ComponentType<T>, component: T): void {
    this.assertEntityAlive(entityGuid);

    const store = this.getOrCreateStore(type);
    if (store.has(entityGuid)) {
      throw new Error(`Entity ${entityGuid} already has component ${type.name}.`);
    }

    store.set(entityGuid, component);
  }

  emplace<T extends object>(entityGuid: EntityGuid, type: ComponentType<T>): T {
    const component = type.create();
    this.add(entityGuid, type, component);
    return component;
  }

  get<T extends object>(entityGuid: EntityGuid, type: ComponentType<T>): T {
    this.assertEntityAlive(entityGuid);

    const store = this.getStore(type);
    if (!store?.has(entityGuid)) {
      throw new Error(`Entity ${entityGuid} does not have component ${type.name}.`);
    }

    return store.get(entityGuid) as T;
  }

  tryGet<T extends object>(entityGuid: EntityGuid, type: ComponentType<T>): T | undefined {
    this.assertEntityAlive(entityGuid);
    return this.getStore(type)?.get(entityGuid);
  }

  has<T extends object>(entityGuid: EntityGuid, type: ComponentType<T>): boolean {
    this.assertEntityAlive(entityGuid);
    return this.getStore(type)?.has(entityGuid) ?? false;
  }

  remove<T extends object>(entityGuid: EntityGuid, type: ComponentType<T>): boolean {
    this.assertEntityAlive(entityGuid);
    return this.getStore(type)?.delete(entityGuid) ?? false;
  }

  query<TTypes extends readonly [AnyComponentType, ...AnyComponentType[]]>(
    ...types: TTypes
  ): Array<QueryResult<TTypes>> {
    this.assertActive();

    const stores = types.map((type) => this.components.get(type));
    if (stores.some((store) => store === undefined)) {
      return [];
    }

    const availableStores = stores as Array<Map<EntityGuid, object>>;
    let primaryStore = availableStores[0];
    for (const store of availableStores) {
      if (store.size < primaryStore.size) {
        primaryStore = store;
      }
    }

    const result: Array<QueryResult<TTypes>> = [];

    for (const entityGuid of primaryStore.keys()) {
      const componentValues: object[] = [];

      for (const store of availableStores) {
        const component = store.get(entityGuid);
        if (component === undefined) {
          componentValues.length = 0;
          break;
        }

        componentValues.push(component);
      }

      if (componentValues.length === types.length) {
        result.push(
          [entityGuid, ...componentValues] as unknown as QueryResult<TTypes>
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
    this.issuedEntityGuids.clear();
    this.disposed = true;
  }

  private getStore<T extends object>(
    type: ComponentType<T>
  ): Map<EntityGuid, T> | undefined {
    return this.components.get(type) as Map<EntityGuid, T> | undefined;
  }

  private getOrCreateStore<T extends object>(
    type: ComponentType<T>
  ): Map<EntityGuid, T> {
    let store = this.getStore(type);
    if (!store) {
      store = new Map<EntityGuid, T>();
      this.components.set(type, store);
    }

    return store;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("World has been disposed.");
    }
  }

  private assertEntityAlive(entityGuid: EntityGuid): void {
    this.assertActive();
    if (!this.aliveEntities.has(entityGuid)) {
      throw new Error(`Entity ${entityGuid} is not alive in this world.`);
    }
  }
}
