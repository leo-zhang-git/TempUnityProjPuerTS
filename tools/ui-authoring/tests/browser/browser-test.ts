export interface RegisteredBrowserTest {
  readonly file: string;
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const registered: RegisteredBrowserTest[] = [];
let registeringFile: string | undefined;

export default function test(name: string, run: () => void | Promise<void>): void {
  if (!registeringFile) throw new Error(`Browser test registered outside the suite runner: ${name}`);
  registered.push({ file: registeringFile, name, run });
}

export function beginBrowserTestFile(file: string): void {
  registeringFile = file;
}

export function endBrowserTestFile(): void {
  registeringFile = undefined;
}

export function takeRegisteredBrowserTests(): readonly RegisteredBrowserTest[] {
  return registered.splice(0);
}
