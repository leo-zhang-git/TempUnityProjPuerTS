export type StateRootBinding<TState extends string> = Omit<
  CS.UIState.StateRoot,
  "CurrentState" | "SetCurrentState"
> & {
  readonly CurrentState: number;
  SetCurrentState(value: TState, notify?: boolean, force?: boolean): void;
};

export function nativeStateRoot<TState extends string>(
  stateRoot: StateRootBinding<TState>
): CS.UIState.StateRoot {
  return stateRoot as unknown as CS.UIState.StateRoot;
}
