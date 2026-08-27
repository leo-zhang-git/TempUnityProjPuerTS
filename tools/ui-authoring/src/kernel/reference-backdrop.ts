import type { ReferenceBackdropImage } from "../schema/ui-prototype-schema.js";

export function referenceBackdropImage(
  images: readonly ReferenceBackdropImage[],
  viewport: readonly [number, number],
): ReferenceBackdropImage | undefined {
  const exact = images.find((image) => image.viewport[0] === viewport[0] && image.viewport[1] === viewport[1]);
  if (exact) return exact;
  const targetAspect = viewport[0] / viewport[1];
  const targetArea = viewport[0] * viewport[1];
  let best: ReferenceBackdropImage | undefined;
  let bestAspectDistance = Number.POSITIVE_INFINITY;
  let bestAreaDistance = Number.POSITIVE_INFINITY;
  for (const image of images) {
    const aspectDistance = Math.abs(image.viewport[0] / image.viewport[1] - targetAspect);
    const areaDistance = Math.abs(image.viewport[0] * image.viewport[1] - targetArea);
    if (aspectDistance < bestAspectDistance || (aspectDistance === bestAspectDistance && areaDistance < bestAreaDistance)) {
      best = image;
      bestAspectDistance = aspectDistance;
      bestAreaDistance = areaDistance;
    }
  }
  return best;
}
