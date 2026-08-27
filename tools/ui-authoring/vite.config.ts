import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { cssModuleClassName } from "./src/web/styles/css-module-name.js";

export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      generateScopedName: cssModuleClassName,
    },
  },
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
});
