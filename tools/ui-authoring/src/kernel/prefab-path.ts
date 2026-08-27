export interface ArtifactSourceIdentity {
  readonly path: string;
  readonly artifactKey: string;
}

const PREFAB_ROOT = "Assets/Resources/UI/Prefab";
const sourceSuffix = ".ui.json";
const artifactKeyPattern = /^[A-Z][A-Za-z0-9]*$/;

export function artifactSourceIdentity(input: {
  readonly path: string;
  readonly source: { readonly artifactKey: string };
}): ArtifactSourceIdentity {
  const identity = artifactSourceIdentityFromPath(input.path);
  if (identity.artifactKey !== input.source.artifactKey) {
    throw new Error(`Artifact Source path '${input.path}' must end with '${input.source.artifactKey}${sourceSuffix}'`);
  }
  return identity;
}

export function artifactSourceIdentityFromPath(inputPath: string): ArtifactSourceIdentity {
  const path = normalizeSourcePath(inputPath);
  const fileName = path.split("/").at(-1)!;
  const artifactKey = fileName.slice(0, -sourceSuffix.length);
  if (!artifactKeyPattern.test(artifactKey)) throw new Error(`Invalid artifactKey '${artifactKey}'`);
  return { path, artifactKey };
}

export function artifactPrefabPath(input: ArtifactSourceIdentity): string {
  const identity = normalizeArtifactSourceIdentity(input);
  const slash = identity.path.lastIndexOf("/");
  const relativeDirectory = slash < 0 ? "" : identity.path.slice(0, slash);
  return `${PREFAB_ROOT}/${relativeDirectory ? `${relativeDirectory}/` : ""}${identity.artifactKey}.prefab`;
}

export function assertArtifactPrefabPath(path: string, identity: ArtifactSourceIdentity): void {
  const expected = artifactPrefabPath(identity);
  if (path !== expected) throw new Error(`Artifact Prefab path must be '${expected}', received '${path}'`);
}

function normalizeArtifactSourceIdentity(input: ArtifactSourceIdentity): ArtifactSourceIdentity {
  if (!artifactKeyPattern.test(input.artifactKey)) throw new Error(`Invalid artifactKey '${input.artifactKey}'`);
  const path = normalizeSourcePath(input.path);
  const fileName = path.split("/").at(-1)!;
  if (fileName !== `${input.artifactKey}${sourceSuffix}`) {
    throw new Error(`Artifact Source path '${input.path}' must end with '${input.artifactKey}${sourceSuffix}'`);
  }
  return { path, artifactKey: input.artifactKey };
}

function normalizeSourcePath(inputPath: string): string {
  const path = inputPath.replaceAll("\\", "/");
  if (!path.endsWith(sourceSuffix) || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Invalid Artifact Source path '${inputPath}'`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid Artifact Source path '${inputPath}'`);
  }
  return path;
}
