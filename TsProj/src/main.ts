import { App, RuntimeHost } from "./app";

let app: App | undefined;

export function start(host?: RuntimeHost): void {
  if (app) {
    return;
  }

  app = new App(host);
  app.start();
}

export function dispose(): void {
  app?.dispose();
  app = undefined;
}

export function onHelloButtonClick(): string {
  if (!app) {
    start();
  }

  return app!.showHelloWorld();
}

start();
