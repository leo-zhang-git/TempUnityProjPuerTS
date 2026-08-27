import { runCli } from "./application.js";

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
});
