interface BinderTarget {
  readonly gameObject: CS.UnityEngine.GameObject;
  createBinderWidget(binder: CS.PuerTsTemplate.UI.UIBinder): unknown;
}

export function initBinderUI(target: BinderTarget): void {
  const binder = target.gameObject.GetComponent(
    puer.$typeof(CS.PuerTsTemplate.UI.UIBinder)
  ) as CS.PuerTsTemplate.UI.UIBinder | null;
  if (!binder) {
    return;
  }

  const bindings = binder.ResolveEffectiveBindings();
  if (bindings.fieldNames.Length !== bindings.values.Length) {
    throw new Error(
      `UIBinder returned mismatched arrays on ${target.gameObject.name}.`
    );
  }

  const binderType = puer.$typeof(CS.PuerTsTemplate.UI.UIBinder);
  const fields = target as unknown as Record<string, unknown>;
  for (let index = 0; index < bindings.fieldNames.Length; index += 1) {
    const fieldName = bindings.fieldNames[index];
    const value = bindings.values[index];
    if (!fieldName || !value) {
      throw new Error(
        `UIBinder returned an empty field at index=${index} root=${target.gameObject.name}.`
      );
    }

    fields[fieldName] = binderType.IsInstanceOfType(value)
      ? target.createBinderWidget(value as CS.PuerTsTemplate.UI.UIBinder)
      : value;
  }
}
