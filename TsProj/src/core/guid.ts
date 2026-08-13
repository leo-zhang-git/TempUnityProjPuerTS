declare const guidBrand: unique symbol;

export type Guid = string & {
  readonly [guidBrand]: "Guid";
};

export interface GuidGenerator {
  generate(): Guid;
}

export interface UuidV7GeneratorOptions {
  readonly now?: () => number;
  readonly random?: () => number;
}

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TIMESTAMP = 0xffffffffffff;
const MAX_SEQUENCE = 0xfff;

export class UuidV7Generator implements GuidGenerator {
  private readonly now: () => number;
  private readonly random: () => number;
  private lastTimestamp = -1;
  private sequence = 0;

  constructor(options: UuidV7GeneratorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  generate(): Guid {
    let timestamp = normalizeTimestamp(this.now());
    if (timestamp < this.lastTimestamp) {
      timestamp = this.lastTimestamp;
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence += 1;
      if (this.sequence > MAX_SEQUENCE) {
        timestamp += 1;
        this.sequence = randomInteger(this.random, MAX_SEQUENCE + 1);
      }
    } else {
      this.sequence = randomInteger(this.random, MAX_SEQUENCE + 1);
    }

    if (timestamp > MAX_TIMESTAMP) {
      throw new Error("GUID timestamp exceeds the UUIDv7 48-bit range.");
    }

    this.lastTimestamp = timestamp;
    const timestampHex = timestamp.toString(16).padStart(12, "0");
    const sequenceHex = this.sequence.toString(16).padStart(3, "0");
    const randomHex = createRandomHex(this.random, 15);
    const variant = (8 + randomInteger(this.random, 4)).toString(16);

    return asGuid(
      `${timestampHex.slice(0, 8)}-${timestampHex.slice(8)}-7${sequenceHex}-${variant}${randomHex.slice(0, 3)}-${randomHex.slice(3)}`
    );
  }
}

export const defaultGuidGenerator: GuidGenerator = new UuidV7Generator();

export function generateGuid(): Guid {
  return defaultGuidGenerator.generate();
}

export function asGuid(value: string): Guid {
  if (!GUID_PATTERN.test(value)) {
    throw new Error(`Invalid GUID: ${value}.`);
  }
  return value.toLowerCase() as Guid;
}

export function isGuid(value: string): value is Guid {
  return GUID_PATTERN.test(value);
}

function normalizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`GUID timestamp must be a finite non-negative number; received ${value}.`);
  }
  return Math.floor(value);
}

function createRandomHex(random: () => number, length: number): string {
  let result = "";
  while (result.length < length) {
    result += randomInteger(random, 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }
  return result.slice(0, length);
}

function randomInteger(random: () => number, upperBound: number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`GUID random source must return a number in [0, 1); received ${value}.`);
  }
  return Math.floor(value * upperBound);
}
