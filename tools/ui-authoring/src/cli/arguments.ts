import { type CliCommandName, type CliCommandOptions, cliOptionsForCommand, isCliCommandName } from "./command-registry.js";

export interface CliInvocation {
  readonly raw: readonly string[];
  readonly command?: CliCommandName;
  readonly commandToken?: string;
  readonly input?: string;
  readonly helpRequested: boolean;
  has(name: string): boolean;
  option(name: string): string | undefined;
  options(name: string): string[];
}

export function parseCliInvocation(raw: readonly string[]): CliInvocation {
  const commandToken = raw[0];
  const command = isCliCommandName(commandToken) ? commandToken : undefined;
  const helpRequested = commandToken === "--help" || commandToken === "-h" || raw.includes("--help") || raw.includes("-h");
  if (command && !helpRequested) validateOptions(command, raw, cliOptionsForCommand(command));
  return {
    raw: [...raw],
    ...(command ? { command } : {}),
    ...(commandToken ? { commandToken } : {}),
    ...(raw[1] && !raw[1].startsWith("-") ? { input: raw[1] } : {}),
    helpRequested,
    has: (name) => raw.includes(name),
    option: (name) => {
      const index = raw.indexOf(name);
      return index >= 0 ? raw[index + 1] : undefined;
    },
    options: (name) => raw.flatMap((value, index) => (value === name && raw[index + 1] ? [raw[index + 1]!] : [])),
  };
}

function validateOptions(command: CliCommandName, raw: readonly string[], allowed: CliCommandOptions): void {
  const counts = new Map<string, number>();
  for (let index = 1; index < raw.length; index += 1) {
    const token = raw[index]!;
    if (!token.startsWith("-")) continue;
    const kind = allowed[token];
    if (!kind) throw new Error(`Unknown option '${token}' for command '${command}'`);
    const count = (counts.get(token) ?? 0) + 1;
    counts.set(token, count);
    if (kind !== "repeatable" && count > 1) throw new Error(`Option '${token}' cannot be repeated for command '${command}'`);
    if (kind === "boolean") continue;
    const value = raw[index + 1];
    if (value === undefined || value === "-h" || value.startsWith("--")) {
      throw new Error(`Option '${token}' requires a value for command '${command}'`);
    }
    index += 1;
  }
}
