import { StringStorage } from "./string-storage";

const PlayerPrefs = CS.UnityEngine.PlayerPrefs;

export class UnityPlayerPrefsStorage implements StringStorage {
  get(key: string): string | undefined {
    return PlayerPrefs.HasKey(key) ? PlayerPrefs.GetString(key) : undefined;
  }

  set(key: string, value: string): void {
    PlayerPrefs.SetString(key, value);
  }

  delete(key: string): void {
    PlayerPrefs.DeleteKey(key);
  }

  flush(): void {
    PlayerPrefs.Save();
  }
}
