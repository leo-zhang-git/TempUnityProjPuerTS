import { asGuid, Guid, GuidGenerator, isGuid } from "../../core/guid";
import { StringStorage } from "../../save/string-storage";
import { VersionedJsonSlot } from "../../save/versioned-json-slot";

const SAVE_KEY = "template.laneDodge.profile";
const SAVE_VERSION = 1;

export interface LaneDodgeProfile {
  readonly profileGuid: Guid;
  bestScore: number;
  totalCoins: number;
}

export class LaneDodgeProfileStore {
  private readonly slot: VersionedJsonSlot<LaneDodgeProfile>;

  constructor(storage: StringStorage) {
    this.slot = new VersionedJsonSlot(
      storage,
      SAVE_KEY,
      SAVE_VERSION,
      decodeLaneDodgeProfile
    );
  }

  loadOrCreate(guidGenerator: GuidGenerator): LaneDodgeProfile {
    try {
      const saved = this.slot.load();
      if (saved) {
        return saved;
      }
    } catch (error) {
      console.warn("Lane-dodge save is invalid and will be replaced.", error);
    }

    const profile: LaneDodgeProfile = {
      profileGuid: guidGenerator.generate(),
      bestScore: 0,
      totalCoins: 0
    };
    this.slot.save(profile);
    return profile;
  }

  save(profile: LaneDodgeProfile): void {
    this.slot.save(profile);
  }
}

function decodeLaneDodgeProfile(data: unknown): LaneDodgeProfile {
  if (!isRecord(data)) {
    throw new Error("Lane-dodge profile must be an object.");
  }

  const profileGuid = data.profileGuid;
  if (typeof profileGuid !== "string" || !isGuid(profileGuid)) {
    throw new Error("Lane-dodge profile contains an invalid profileGuid.");
  }

  return {
    profileGuid: asGuid(profileGuid),
    bestScore: readNonNegativeInteger(data.bestScore, "bestScore"),
    totalCoins: readNonNegativeInteger(data.totalCoins, "totalCoins")
  };
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Lane-dodge profile ${field} must be a non-negative integer.`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
