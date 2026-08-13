export interface StringStorage {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  flush(): void;
}

export class MemoryStringStorage implements StringStorage {
  private readonly values = new Map<string, string>();

  get(key: string): string | undefined {
    return this.values.get(key);
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  flush(): void {}
}
