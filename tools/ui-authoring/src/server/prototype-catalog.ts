import { readFile } from "node:fs/promises";
import {
  assertValidPrototype,
  assertValidReference,
  createPrototypeCatalog,
  createReferenceCatalog,
  type PrototypeCatalog,
  type PrototypeCatalogInput,
  type ReferenceCatalog,
  type ReferenceCatalogInput,
} from "../kernel/prototype.js";
import { parsePrototype, parseReference } from "../kernel/prototype-canonical.js";
import type { SourceCatalog } from "../kernel/source-catalog.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import { listFiles, safeChildPath } from "./workspace.js";

export async function loadReferenceCatalogInputs(sourceRoot: string): Promise<ReferenceCatalogInput[]> {
  const paths = await listFiles(sourceRoot, ".ui-reference.json");
  return Promise.all(
    paths.map(async (path) => ({
      path,
      reference: parseReference(await readFile(safeChildPath(sourceRoot, path), "utf8")),
    })),
  );
}

export async function loadReferenceCatalog(
  sourceRoot: string,
  override?: { readonly path: string; readonly reference: UiReference },
): Promise<ReferenceCatalog> {
  const inputs = await loadReferenceCatalogInputs(sourceRoot);
  const retained = override ? inputs.filter((entry) => entry.path !== override.path) : inputs;
  return createReferenceCatalog(override ? [...retained, override] : retained);
}

export async function loadValidatedReferenceCatalog(
  sourceRoot: string,
  sourceCatalog: SourceCatalog,
  override?: { readonly path: string; readonly reference: UiReference },
): Promise<ReferenceCatalog> {
  const catalog = await loadReferenceCatalog(sourceRoot, override);
  for (const entry of catalog.entries.values()) assertValidReference(entry.reference, sourceCatalog, catalog);
  return catalog;
}

export async function loadPrototypeCatalogInputs(sourceRoot: string): Promise<PrototypeCatalogInput[]> {
  const paths = await listFiles(sourceRoot, ".ui-prototype.json");
  return Promise.all(
    paths.map(async (path) => ({
      path,
      prototype: parsePrototype(await readFile(safeChildPath(sourceRoot, path), "utf8")),
    })),
  );
}

async function loadPrototypeCatalog(
  sourceRoot: string,
  override?: { readonly path: string; readonly prototype: UiPrototype },
): Promise<PrototypeCatalog> {
  const inputs = await loadPrototypeCatalogInputs(sourceRoot);
  const retained = override ? inputs.filter((entry) => entry.path !== override.path) : inputs;
  return createPrototypeCatalog(override ? [...retained, override] : retained);
}

export async function loadValidatedPrototypeCatalog(
  sourceRoot: string,
  sourceCatalog: SourceCatalog,
  referenceCatalog: ReferenceCatalog,
  override?: { readonly path: string; readonly prototype: UiPrototype },
): Promise<PrototypeCatalog> {
  const catalog = await loadPrototypeCatalog(sourceRoot, override);
  for (const entry of catalog.entries.values()) assertValidPrototype(entry.prototype, referenceCatalog, sourceCatalog);
  return catalog;
}
