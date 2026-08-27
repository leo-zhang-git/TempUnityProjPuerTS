import { basename } from "node:path";

export function cssModuleClassName(localName: string, filename: string): string {
  const owner = basename(filename)
    .replace(/\.module\.css$/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLocaleLowerCase();
  return `ui-${owner}__${localName}`;
}
