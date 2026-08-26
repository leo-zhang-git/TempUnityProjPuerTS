export const CanvasSortingLayer = {
  Scene: 1,
  General: 2,
  Overlay: 3,
  UnderLoading: 4,
  Loading: 5,
  OverLoading: 6,
  Debug: 7
} as const;

export type CanvasSortingLayerName = keyof typeof CanvasSortingLayer;
export type CanvasSortingLayerValue =
  (typeof CanvasSortingLayer)[CanvasSortingLayerName];
