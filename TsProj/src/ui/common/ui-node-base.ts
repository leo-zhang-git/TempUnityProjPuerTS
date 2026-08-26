import { destroy } from "./unity-ui";
import { initBinderUI } from "./generated-base";

export type UiNodeLoadState = "created" | "loading" | "loaded" | "destroyed";

export interface BinderWidgetFactory {
  create(
    parent: UINodeBase,
    binder: CS.PuerTsTemplate.UI.UIBinder
  ): UINodeBase;
}

export abstract class UINodeBase {
  private loadStateValue: UiNodeLoadState = "created";
  private requestedVisible = false;
  private visible = false;
  private root: CS.UnityEngine.GameObject | undefined;
  private ownsRoot = false;
  private parent: UINodeBase | undefined;
  private binderWidgetFactory: BinderWidgetFactory | undefined;
  private readonly children = new Set<UINodeBase>();
  private readonly disposers: Array<() => void> = [];

  get loadState(): UiNodeLoadState {
    return this.loadStateValue;
  }

  get isLoaded(): boolean {
    return this.loadStateValue === "loaded";
  }

  get isShown(): boolean {
    return this.visible;
  }

  get gameObject(): CS.UnityEngine.GameObject {
    if (!this.root) {
      throw new Error(`UI node root is unavailable while state=${this.loadStateValue}.`);
    }
    return this.root;
  }

  createBinderWidget(binder: CS.PuerTsTemplate.UI.UIBinder): UINodeBase {
    if (!this.binderWidgetFactory) {
      throw new Error(
        `Cannot create Binder Widget without a factory while state=${this.loadStateValue}.`
      );
    }
    return this.binderWidgetFactory.create(this, binder);
  }

  show(): void {
    this.assertLoaded("show");
    if (this.requestedVisible) {
      return;
    }

    this.requestedVisible = true;
    this.reconcileVisibility();
  }

  hide(): void {
    this.assertLoaded("hide");
    if (!this.requestedVisible) {
      return;
    }

    this.requestedVisible = false;
    this.reconcileVisibility();
  }

  update(deltaTime: number): void {
    if (!this.visible) {
      return;
    }

    this.onUpdate(deltaTime);
    for (const child of [...this.children]) {
      child.update(deltaTime);
    }
  }

  lateUpdate(deltaTime: number): void {
    if (!this.visible) {
      return;
    }

    this.onLateUpdate(deltaTime);
    for (const child of [...this.children]) {
      child.lateUpdate(deltaTime);
    }
  }

  destroy(): void {
    if (this.loadStateValue === "destroyed") {
      return;
    }

    const wasVisible = this.visible;
    this.loadStateValue = "destroyed";
    this.requestedVisible = false;
    this.visible = false;

    let firstError: unknown;
    if (wasVisible) {
      firstError = captureFirstError(firstError, () => this.onHide());
    }

    for (const child of [...this.children].reverse()) {
      firstError = captureFirstError(firstError, () => child.destroy());
    }
    this.children.clear();

    for (const disposer of [...this.disposers].reverse()) {
      firstError = captureFirstError(firstError, disposer);
    }
    this.disposers.length = 0;

    firstError = captureFirstError(firstError, () => this.onDestroying());

    const parent = this.parent;
    this.parent = undefined;
    this.binderWidgetFactory = undefined;
    parent?.children.delete(this);

    const root = this.root;
    this.root = undefined;
    if (this.ownsRoot) {
      firstError = captureFirstError(firstError, () => destroy(root));
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  }

  protected initializeNode(
    root: CS.UnityEngine.GameObject,
    ownsRoot: boolean,
    parent?: UINodeBase,
    binderWidgetFactory?: BinderWidgetFactory
  ): void {
    if (this.loadStateValue !== "created") {
      throw new Error(`Cannot initialize UI node while state=${this.loadStateValue}.`);
    }
    if (parent && parent.loadState === "destroyed") {
      throw new Error("Cannot attach a UI node to a destroyed parent.");
    }

    this.loadStateValue = "loading";
    this.root = root;
    this.ownsRoot = ownsRoot;
    this.parent = parent;
    this.binderWidgetFactory = binderWidgetFactory ?? parent?.binderWidgetFactory;
    parent?.children.add(this);
    root.SetActive(false);

    try {
      initBinderUI(this);
      this.onLoaded();
      this.loadStateValue = "loaded";
      this.reconcileVisibility();
    } catch (error) {
      try {
        this.destroy();
      } catch (cleanupError) {
        void cleanupError;
      }
      throw error;
    }
  }

  protected registerDisposer(disposer: () => void): void {
    if (this.loadStateValue === "destroyed") {
      throw new Error("Cannot register a disposer on a destroyed UI node.");
    }
    this.disposers.push(disposer);
  }

  protected get uiParent(): UINodeBase | undefined {
    return this.parent;
  }

  protected onLoaded(): void {}

  protected onShow(): void {}

  protected onHide(): void {}

  protected onUpdate(_deltaTime: number): void {}

  protected onLateUpdate(_deltaTime: number): void {}

  protected onDestroying(): void {}

  private assertLoaded(operation: string): void {
    if (this.loadStateValue !== "loaded") {
      throw new Error(`Cannot ${operation} UI node while state=${this.loadStateValue}.`);
    }
  }

  private reconcileVisibility(): void {
    if (this.loadStateValue !== "loaded") {
      return;
    }

    const targetVisible = this.requestedVisible && (!this.parent || this.parent.visible);
    if (targetVisible === this.visible) {
      return;
    }

    if (targetVisible) {
      this.gameObject.SetActive(true);
      this.visible = true;
      try {
        this.onShow();
      } catch (error) {
        this.visible = false;
        this.requestedVisible = false;
        this.gameObject.SetActive(false);
        throw error;
      }
    } else {
      this.visible = false;
      for (const child of this.children) {
        child.reconcileVisibility();
      }
      try {
        this.onHide();
      } finally {
        this.gameObject.SetActive(false);
      }
      return;
    }

    for (const child of this.children) {
      child.reconcileVisibility();
    }
  }
}

function captureFirstError(
  firstError: unknown,
  operation: () => void
): unknown {
  try {
    operation();
  } catch (error) {
    return firstError === undefined ? error : firstError;
  }
  return firstError;
}
