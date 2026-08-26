export function instantiateLocalUiPrefab(
  assetPath: string,
  parent: CS.UnityEngine.Transform
): CS.UnityEngine.GameObject {
  return CS.PuerTsTemplate.UI.LocalUiPrefabLoader.Instantiate(assetPath, parent);
}
