import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const cssModulePattern = /\.module\.css$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!cssModulePattern.test(specifier)) return nextResolve(specifier, context);
    return {
      format: "module",
      shortCircuit: true,
      url: new URL(specifier, context.parentURL).href,
    };
  },
  load(url, context, nextLoad) {
    if (!cssModulePattern.test(url)) return nextLoad(url, context);
    const css = readFileSync(fileURLToPath(url), "utf8");
    const owner = fileURLToPath(url)
      .split(/[\\/]/)
      .at(-1)
      .replace(/\.module\.css$/, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .toLowerCase();
    const names = [...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))];
    const styles = Object.fromEntries(names.map((name) => [name, `ui-${owner}__${name}`]));
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(styles)};`,
    };
  },
});
