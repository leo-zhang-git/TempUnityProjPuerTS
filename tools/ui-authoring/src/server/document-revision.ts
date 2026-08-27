import { createHash } from "node:crypto";
import { formatSource, parseSource } from "../kernel/canonical.js";
import { formatPrototype, formatReference, parsePrototype, parseReference } from "../kernel/prototype-canonical.js";
import type { UiDocumentKind } from "../schema/ui-diagnostics.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiSource } from "../schema/ui-source-schema.js";

type RevisionDocument = UiSource | UiReference | UiPrototype;

export function documentRevision(kind: UiDocumentKind, document: RevisionDocument): string {
  const canonical =
    kind === "artifact"
      ? formatSource(document as UiSource)
      : kind === "reference"
        ? formatReference(document as UiReference)
        : formatPrototype(document as UiPrototype);
  return `json-sha256:${sha256(canonical)}`;
}

export function documentRevisionFromText(kind: UiDocumentKind, content: string): string {
  try {
    const document = kind === "artifact" ? parseSource(content) : kind === "reference" ? parseReference(content) : parsePrototype(content);
    return documentRevision(kind, document);
  } catch {
    return `raw-sha256:${sha256(content)}`;
  }
}

export function documentKindFromPath(path: string): UiDocumentKind | undefined {
  if (path.endsWith(".ui-reference.json")) return "reference";
  if (path.endsWith(".ui-prototype.json")) return "prototype";
  if (path.endsWith(".ui.json")) return "artifact";
  return undefined;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
