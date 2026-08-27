import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles/runtime-fonts.js";
import "./styles/base.css";
import "./styles/tokens.css";
import { loadConfig } from "./shared/api/client.js";
import { ChromePageZoomProvider } from "./shared/chrome-page-zoom.js";
import { ThemeProvider } from "./shared/theme.js";
import { WebDiagnosticsProvider } from "./shared/web-diagnostics.js";

const AuthoringApp = lazy(async () => {
  const module = await import("./application/app.js");
  return { default: module.App };
});

const CapturePage = lazy(async () => {
  const module = await import("./capture/capture-page.js");
  return { default: module.CapturePage };
});

const GuideApp = lazy(async () => {
  const module = await import("./guide/guide-app.js");
  return { default: module.GuideApp };
});

const GuideLauncher = lazy(async () => {
  const module = await import("./guide/guide-app.js");
  return { default: module.GuideLauncher };
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
if (window.location.pathname === "/capture" || window.location.pathname === "/guide") {
  void loadConfig()
    .then((config) => {
      document.title = `Legma - ${config.workspace.name}`;
    })
    .catch(() => {});
}
const content =
  window.location.pathname === "/capture" ? (
    <CapturePage />
  ) : window.location.pathname === "/guide" ? (
    <GuideApp />
  ) : (
    <>
      <ChromePageZoomProvider>
        <AuthoringApp />
      </ChromePageZoomProvider>
      <GuideLauncher />
    </>
  );
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <WebDiagnosticsProvider>
        <Suspense
          fallback={
            <main>
              <span>正在加载 Canvas</span>
            </main>
          }
        >
          {content}
        </Suspense>
      </WebDiagnosticsProvider>
    </ThemeProvider>
  </StrictMode>,
);
