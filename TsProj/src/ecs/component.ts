export interface ComponentType<T> {
  readonly name: string;
  readonly __type?: T;
}

export function defineComponent<T>(name: string): ComponentType<T> {
  return { name };
}
