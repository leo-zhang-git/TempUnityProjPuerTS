export interface RuntimeHost {
  log(message: string): void;
  setLabelText?(text: string): void;
}

const defaultHost: RuntimeHost = {
  log(message: string): void {
    console.log(message);
  }
};

export class App {
  private clickCount = 0;

  constructor(private readonly host: RuntimeHost = defaultHost) {
  }

  start(): void {
    this.host.log("TypeScript app started.");
  }

  dispose(): void {
    this.host.log("TypeScript app disposed.");
  }

  showHelloWorld(): string {
    this.clickCount += 1;
    const message = "hello world";

    this.host.log(`Button clicked ${this.clickCount} time(s): ${message}`);
    this.host.setLabelText?.(message);

    return message;
  }
}
