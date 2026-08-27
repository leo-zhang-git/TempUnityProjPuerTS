import { assetUrl } from "../shared/api/client.js";

const globalFonts = globalThis as typeof globalThis & {
  __uiAuthoringAliPuHuiFontPromise?: Promise<void>;
};

if (typeof document !== "undefined" && !globalFonts.__uiAuthoringAliPuHuiFontPromise) {
  const fontFace = new FontFace("AliPuHui", `url(${JSON.stringify(assetUrl("Font/alipuhui.ttf"))})`, { display: "swap" });
  document.fonts.add(fontFace);
  globalFonts.__uiAuthoringAliPuHuiFontPromise = fontFace
    .load()
    .then(() => undefined)
    .catch(() => undefined);
}
