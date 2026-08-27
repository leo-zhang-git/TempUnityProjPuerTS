import { cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function copyDefaultFontAssets(workspaceRoot: string): Promise<void> {
  const sourceAssetsRoot = resolve(import.meta.dirname, "../../../../My project/Assets");
  const targetAssetsRoot = join(workspaceRoot, "My project", "Assets");
  const targetFontDirectory = join(targetAssetsRoot, "Resources", "UI", "Font");
  const targetSettingsDirectory = join(targetAssetsRoot, "TextMesh Pro", "Resources");
  await mkdir(targetFontDirectory, { recursive: true });
  await mkdir(targetSettingsDirectory, { recursive: true });
  for (const name of ["alipuhui SDF.asset", "alipuhui SDF.asset.meta", "alipuhui.ttf", "alipuhui.ttf.meta"]) {
    await cp(join(sourceAssetsRoot, "Resources", "UI", "Font", name), join(targetFontDirectory, name));
  }
  await cp(join(sourceAssetsRoot, "TextMesh Pro", "Resources", "TMP Settings.asset"), join(targetSettingsDirectory, "TMP Settings.asset"));
}
