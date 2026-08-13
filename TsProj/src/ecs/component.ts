export type ComponentFactory<T extends object> = () => T;

export class ComponentType<T extends object> {
  // The private marker keeps the generic type nominal without adding runtime data.
  private declare readonly componentType: T;

  constructor(
    public readonly name: string,
    private readonly factory: ComponentFactory<T>
  ) {
    if (name.trim().length === 0) {
      throw new Error("Component type name cannot be empty.");
    }

    Object.freeze(this);
  }

  create(): T {
    return this.factory();
  }
}

export function defineComponent<T extends object>(
  name: string,
  factory: ComponentFactory<T>
): ComponentType<T> {
  return new ComponentType(name, factory);
}
