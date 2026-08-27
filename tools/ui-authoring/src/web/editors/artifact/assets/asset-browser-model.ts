import type { AuthoringAssetEntry, AuthoringAssetKind } from "../../../../schema/asset-catalog.js";

export interface AssetDirectoryNode {
  readonly name: string;
  readonly path: string;
  readonly count: number;
  readonly directCount: number;
  readonly directories: readonly AssetDirectoryNode[];
}

export function normalizeAssetDirectory(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

export function assetDirectoryAncestors(path: string): readonly { readonly name: string; readonly path: string }[] {
  const normalized = normalizeAssetDirectory(path);
  const result: { name: string; path: string }[] = [{ name: "Assets/Resources/UI", path: "" }];
  let current = "";
  for (const part of normalized ? normalized.split("/") : []) {
    current = current ? `${current}/${part}` : part;
    result.push({ name: part, path: current });
  }
  return result;
}

export function childAssetDirectories(
  assets: readonly AuthoringAssetEntry[],
  directory: string,
  kind?: AuthoringAssetKind,
): readonly { readonly name: string; readonly path: string; readonly count: number }[] {
  const normalized = normalizeAssetDirectory(directory);
  const prefix = normalized ? `${normalized}/` : "";
  const counts = new Map<string, number>();
  for (const asset of assets) {
    if (kind && asset.kind !== kind) continue;
    if (!asset.directory.startsWith(prefix) || asset.directory === normalized) continue;
    const remainder = asset.directory.slice(prefix.length);
    const name = remainder.split("/")[0];
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, path: prefix ? `${prefix}${name}` : name, count }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

export function buildAssetDirectoryTree(assets: readonly AuthoringAssetEntry[], kind?: AuthoringAssetKind): AssetDirectoryNode {
  interface MutableDirectoryNode {
    readonly name: string;
    readonly path: string;
    count: number;
    directCount: number;
    readonly directories: Map<string, MutableDirectoryNode>;
  }

  const root: MutableDirectoryNode = { name: "Assets/Resources/UI", path: "", count: 0, directCount: 0, directories: new Map() };
  for (const asset of assets) {
    if (kind && asset.kind !== kind) continue;
    root.count += 1;
    const directory = normalizeAssetDirectory(asset.directory);
    if (!directory) {
      root.directCount += 1;
      continue;
    }
    let current = root;
    let path = "";
    for (const name of directory.split("/")) {
      path = path ? `${path}/${name}` : name;
      let child = current.directories.get(path);
      if (!child) {
        child = { name, path, count: 0, directCount: 0, directories: new Map() };
        current.directories.set(path, child);
      }
      child.count += 1;
      current = child;
    }
    current.directCount += 1;
  }

  const freeze = (node: MutableDirectoryNode): AssetDirectoryNode => ({
    name: node.name,
    path: node.path,
    count: node.count,
    directCount: node.directCount,
    directories: [...node.directories.values()].sort((left, right) => left.name.localeCompare(right.name)).map(freeze),
  });
  return freeze(root);
}

export function filterAssets(
  assets: readonly AuthoringAssetEntry[],
  directory: string,
  query: string,
  kind?: AuthoringAssetKind,
): readonly AuthoringAssetEntry[] {
  const normalizedDirectory = normalizeAssetDirectory(directory);
  const prefix = normalizedDirectory ? `${normalizedDirectory}/` : "";
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((asset) => {
    if (kind && asset.kind !== kind) return false;
    const inDirectory =
      tokens.length > 0
        ? asset.directory === normalizedDirectory || asset.directory.startsWith(prefix)
        : asset.directory === normalizedDirectory;
    if (!inDirectory) return false;
    const searchable = asset.path.toLocaleLowerCase();
    return tokens.every((token) => searchable.includes(token));
  });
}
