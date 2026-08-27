import { CANVAS_DESIGN_SIZE, type UiConcreteSource } from "../schema/ui-source-schema.js";

export function assertPositiveSize(size: readonly [number, number] | undefined, label: string): asserts size is readonly [number, number] {
  if (size && size.every((value) => Number.isFinite(value) && value > 0)) return;
  throw new RangeError(`${label} must contain finite positive width and height`);
}

export function artifactInitialSize(source: UiConcreteSource): readonly [number, number] {
  const size = source.artifactType === "Canvas" ? CANVAS_DESIGN_SIZE : source.initialSize;
  assertPositiveSize(size, `Artifact '${source.artifactKey}' initialSize`);
  return size;
}
