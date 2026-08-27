import { startUiAuthoringServer } from "./server.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const server = await startUiAuthoringServer({
  host: argument("--host") ?? "127.0.0.1",
  port: Number(argument("--port") ?? "4321"),
  development: process.argv.includes("--dev"),
});
process.stdout.write(`Legma listening at ${server.url}\n`);

let closing = false;
async function closeServer(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await server.close();
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`Legma shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void closeServer());
process.once("SIGTERM", () => void closeServer());
