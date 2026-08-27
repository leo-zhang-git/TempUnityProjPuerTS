import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const sourceDir = resolve("tools", "src", "web");
const targetDir = resolve("dist", "tools", "src", "web");

mkdirSync(targetDir, { recursive: true });
for (const fileName of readdirSync(sourceDir)
	.filter((entry) => /\.(?:html|css)$/u.test(entry))
	.sort()) {
	copyFileSync(resolve(sourceDir, fileName), resolve(targetDir, fileName));
}

