import { StringStorage } from "./string-storage";

interface SaveEnvelope {
  readonly version: number;
  readonly data: unknown;
}

export class VersionedJsonSlot<T> {
  constructor(
    private readonly storage: StringStorage,
    private readonly key: string,
    private readonly version: number,
    private readonly decode: (data: unknown) => T
  ) {
    if (key.trim().length === 0) {
      throw new Error("Save slot key cannot be empty.");
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`Save slot version must be a positive integer; received ${version}.`);
    }
  }

  load(): T | undefined {
    const serialized = this.storage.get(this.key);
    if (serialized === undefined) {
      return undefined;
    }

    const envelope = parseEnvelope(serialized);
    if (envelope.version !== this.version) {
      throw new Error(
        `Save slot ${this.key} has version ${envelope.version}; expected ${this.version}.`
      );
    }
    return this.decode(envelope.data);
  }

  save(value: T): void {
    this.storage.set(
      this.key,
      JSON.stringify({ version: this.version, data: value } satisfies SaveEnvelope)
    );
    this.storage.flush();
  }

  clear(): void {
    this.storage.delete(this.key);
    this.storage.flush();
  }
}

function parseEnvelope(serialized: string): SaveEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    const parseError = new Error(`Save data is not valid JSON.${detail}`) as Error & {
      cause?: unknown;
    };
    parseError.cause = error;
    throw parseError;
  }

  if (!isRecord(value) || !Number.isInteger(value.version) || !("data" in value)) {
    throw new Error("Save data does not contain a valid versioned envelope.");
  }
  return { version: value.version as number, data: value.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
