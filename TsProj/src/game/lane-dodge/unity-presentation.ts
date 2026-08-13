import { EntityGuid } from "../../ecs/entity-guid";
import {
  applyLayout,
  color,
  createButton,
  createCanvas,
  createPanel,
  createText,
  destroy,
  ensureEventSystem,
  fixedLayout,
  stretchLayout,
  UiNode
} from "../../ui/unity-ui";
import { GameCommand, LaneDodgeSnapshot, LaneObjectSnapshot } from "./model";

const Unity = CS.UnityEngine;

const LANE_X = [-280, 0, 280] as const;
const PLAYER_Y = -610;
const DISTANCE_SCALE = 96;

const COLORS = {
  background: color(0.045, 0.055, 0.065, 1),
  track: color(0.22, 0.25, 0.28, 0.85),
  player: color(0.1, 0.78, 0.82, 1),
  obstacle: color(0.94, 0.27, 0.25, 1),
  coin: color(1, 0.76, 0.12, 1),
  overlay: color(0.025, 0.03, 0.035, 0.94),
  panel: color(0.11, 0.125, 0.14, 0.98),
  primary: color(0.12, 0.62, 0.65, 1),
  secondary: color(0.23, 0.26, 0.29, 1),
  white: color(0.96, 0.97, 0.98, 1),
  muted: color(0.72, 0.76, 0.8, 1)
} as const;

interface LaneDodgePresentationPort {
  dispatch(command: GameCommand): void;
  getSnapshot(): LaneDodgeSnapshot;
}

interface ObjectView {
  readonly gameObject: CS.UnityEngine.GameObject;
  readonly rectTransform: CS.UnityEngine.RectTransform;
  readonly image: CS.UnityEngine.UI.Image;
  kind: LaneObjectSnapshot["kind"];
}

export class UnityLaneDodgePresentation {
  private readonly canvas = createCanvas("Lane Dodge TypeScript UI", 10);
  private readonly eventSystem = ensureEventSystem();
  private readonly objectViews = new Map<EntityGuid, ObjectView>();
  private readonly buttonNodes: Array<UiNode<CS.UnityEngine.UI.Button>> = [];
  private readonly playfield: UiNode<CS.UnityEngine.UI.Image>;
  private readonly player: UiNode<CS.UnityEngine.UI.Image>;
  private readonly menuPage: UiNode<CS.UnityEngine.UI.Image>;
  private readonly hudPage: UiNode<CS.UnityEngine.UI.Image>;
  private readonly pausePage: UiNode<CS.UnityEngine.UI.Image>;
  private readonly gameOverPage: UiNode<CS.UnityEngine.UI.Image>;
  private readonly menuBestText: UiNode<CS.UnityEngine.UI.Text>;
  private readonly menuCoinsText: UiNode<CS.UnityEngine.UI.Text>;
  private readonly scoreText: UiNode<CS.UnityEngine.UI.Text>;
  private readonly coinText: UiNode<CS.UnityEngine.UI.Text>;
  private readonly resultScoreText: UiNode<CS.UnityEngine.UI.Text>;
  private readonly resultCoinText: UiNode<CS.UnityEngine.UI.Text>;
  private snapshot: LaneDodgeSnapshot;
  private disposed = false;

  constructor(private readonly port: LaneDodgePresentationPort) {
    this.snapshot = port.getSnapshot();
    this.playfield = createPanel(
      "Playfield",
      this.canvas.gameObject.transform,
      COLORS.background,
      stretchLayout()
    );
    this.createTrack();
    this.player = createPanel(
      "Player",
      this.playfield.gameObject.transform,
      COLORS.player,
      fixedLayout(0, PLAYER_Y, 150, 76)
    );

    const menu = this.createMenuPage();
    this.menuPage = menu.page;
    this.menuBestText = menu.best;
    this.menuCoinsText = menu.coins;
    const hud = this.createHudPage();
    this.hudPage = hud.page;
    this.scoreText = hud.score;
    this.coinText = hud.coins;
    this.pausePage = this.createPausePage();
    const result = this.createGameOverPage();
    this.gameOverPage = result.page;
    this.resultScoreText = result.score;
    this.resultCoinText = result.coins;
    this.sync();
  }

  update(): void {
    if (this.disposed) {
      return;
    }

    this.snapshot = this.port.getSnapshot();
    this.handleKeyboard();
  }

  lateUpdate(): void {
    if (!this.disposed) {
      this.sync();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (const button of this.buttonNodes) {
      button.component.onClick.RemoveAllListeners();
    }
    this.buttonNodes.length = 0;
    this.objectViews.clear();
    destroy(this.canvas.gameObject);
    destroy(this.eventSystem);
  }

  private createTrack(): void {
    for (const x of [-420, -140, 140, 420]) {
      createPanel(
        `Track Line ${x}`,
        this.playfield.gameObject.transform,
        COLORS.track,
        fixedLayout(x, 0, 7, 1500)
      );
    }
  }

  private createMenuPage(): {
    page: UiNode<CS.UnityEngine.UI.Image>;
    best: UiNode<CS.UnityEngine.UI.Text>;
    coins: UiNode<CS.UnityEngine.UI.Text>;
  } {
    const page = createPanel(
      "Menu Page",
      this.canvas.gameObject.transform,
      COLORS.overlay,
      stretchLayout()
    );
    createText(
      "Game Title",
      page.gameObject.transform,
      "LANE DODGE",
      82,
      COLORS.white,
      fixedLayout(0, 250, 820, 130)
    );
    createText(
      "Game Subtitle",
      page.gameObject.transform,
      "THREE-LANE RUN",
      32,
      COLORS.muted,
      fixedLayout(0, 135, 680, 70)
    );
    const best = createText(
      "Menu Best Score",
      page.gameObject.transform,
      "BEST  0",
      34,
      COLORS.white,
      fixedLayout(0, 35, 600, 64)
    );
    const coins = createText(
      "Menu Total Coins",
      page.gameObject.transform,
      "TOTAL COINS  0",
      28,
      COLORS.muted,
      fixedLayout(0, -35, 600, 56)
    );
    this.addButton(
      "Start Button",
      page.gameObject.transform,
      "START",
      () => this.dispatch("start-run"),
      fixedLayout(0, -175, 520, 112),
      COLORS.primary
    );
    return { page, best, coins };
  }

  private createHudPage(): {
    page: UiNode<CS.UnityEngine.UI.Image>;
    score: UiNode<CS.UnityEngine.UI.Text>;
    coins: UiNode<CS.UnityEngine.UI.Text>;
  } {
    const page = createPanel(
      "HUD Page",
      this.canvas.gameObject.transform,
      color(0, 0, 0, 0),
      stretchLayout()
    );
    const score = createText(
      "Score",
      page.gameObject.transform,
      "SCORE  0000",
      44,
      COLORS.white,
      {
        anchorMin: [0, 1],
        anchorMax: [0, 1],
        pivot: [0, 1],
        size: [500, 80],
        position: [38, -34]
      },
      Unity.TextAnchor.MiddleLeft
    );
    const coins = createText(
      "Coins",
      page.gameObject.transform,
      "COINS  0",
      30,
      COLORS.muted,
      {
        anchorMin: [0, 1],
        anchorMax: [0, 1],
        pivot: [0, 1],
        size: [420, 60],
        position: [38, -112]
      },
      Unity.TextAnchor.MiddleLeft
    );
    this.addButton(
      "Pause Button",
      page.gameObject.transform,
      "II",
      () => this.dispatch("pause-run"),
      {
        anchorMin: [1, 1],
        anchorMax: [1, 1],
        pivot: [1, 1],
        size: [110, 92],
        position: [-34, -34]
      },
      COLORS.secondary
    );
    this.addButton(
      "Move Left Button",
      page.gameObject.transform,
      "<",
      () => this.dispatch("move-left"),
      {
        anchorMin: [0, 0],
        anchorMax: [0, 0],
        pivot: [0, 0],
        size: [300, 120],
        position: [38, 42]
      },
      COLORS.secondary
    );
    this.addButton(
      "Move Right Button",
      page.gameObject.transform,
      ">",
      () => this.dispatch("move-right"),
      {
        anchorMin: [1, 0],
        anchorMax: [1, 0],
        pivot: [1, 0],
        size: [300, 120],
        position: [-38, 42]
      },
      COLORS.secondary
    );
    return { page, score, coins };
  }

  private createPausePage(): UiNode<CS.UnityEngine.UI.Image> {
    const page = createPanel(
      "Pause Page",
      this.canvas.gameObject.transform,
      COLORS.overlay,
      stretchLayout()
    );
    const panel = createPanel(
      "Pause Panel",
      page.gameObject.transform,
      COLORS.panel,
      fixedLayout(0, 0, 650, 650)
    );
    createText(
      "Pause Title",
      panel.gameObject.transform,
      "PAUSED",
      64,
      COLORS.white,
      fixedLayout(0, 220, 540, 100)
    );
    this.addButton(
      "Resume Button",
      panel.gameObject.transform,
      "RESUME",
      () => this.dispatch("resume-run"),
      fixedLayout(0, 65, 480, 96),
      COLORS.primary
    );
    this.addButton(
      "Restart Button",
      panel.gameObject.transform,
      "RESTART",
      () => this.dispatch("restart-run"),
      fixedLayout(0, -65, 480, 96),
      COLORS.secondary
    );
    this.addButton(
      "Pause Menu Button",
      panel.gameObject.transform,
      "MENU",
      () => this.dispatch("return-to-menu"),
      fixedLayout(0, -195, 480, 96),
      COLORS.secondary
    );
    return page;
  }

  private createGameOverPage(): {
    page: UiNode<CS.UnityEngine.UI.Image>;
    score: UiNode<CS.UnityEngine.UI.Text>;
    coins: UiNode<CS.UnityEngine.UI.Text>;
  } {
    const page = createPanel(
      "Game Over Page",
      this.canvas.gameObject.transform,
      COLORS.overlay,
      stretchLayout()
    );
    const panel = createPanel(
      "Game Over Panel",
      page.gameObject.transform,
      COLORS.panel,
      fixedLayout(0, 0, 690, 760)
    );
    createText(
      "Game Over Title",
      panel.gameObject.transform,
      "RUN OVER",
      64,
      COLORS.white,
      fixedLayout(0, 285, 580, 100)
    );
    const score = createText(
      "Result Score",
      panel.gameObject.transform,
      "SCORE  0",
      42,
      COLORS.white,
      fixedLayout(0, 160, 540, 72)
    );
    const coins = createText(
      "Result Coins",
      panel.gameObject.transform,
      "COINS  0",
      32,
      COLORS.muted,
      fixedLayout(0, 80, 540, 64)
    );
    this.addButton(
      "Run Again Button",
      panel.gameObject.transform,
      "RUN AGAIN",
      () => this.dispatch("restart-run"),
      fixedLayout(0, -80, 500, 100),
      COLORS.primary
    );
    this.addButton(
      "Game Over Menu Button",
      panel.gameObject.transform,
      "MENU",
      () => this.dispatch("return-to-menu"),
      fixedLayout(0, -220, 500, 100),
      COLORS.secondary
    );
    return { page, score, coins };
  }

  private addButton(
    name: string,
    parent: CS.UnityEngine.Transform,
    label: string,
    onClick: () => void,
    layout: Parameters<typeof createButton>[4],
    background: CS.UnityEngine.Color
  ): void {
    this.buttonNodes.push(
      createButton(
        name,
        parent,
        label,
        onClick,
        layout,
        background,
        COLORS.white
      )
    );
  }

  private handleKeyboard(): void {
    const Input = Unity.Input;
    const Key = Unity.KeyCode;
    switch (this.snapshot.phase) {
      case "Menu":
        if (Input.GetKeyDown(Key.Return) || Input.GetKeyDown(Key.Space)) {
          this.dispatch("start-run");
        }
        break;
      case "Playing":
        if (Input.GetKeyDown(Key.LeftArrow) || Input.GetKeyDown(Key.A)) {
          this.dispatch("move-left");
        }
        if (Input.GetKeyDown(Key.RightArrow) || Input.GetKeyDown(Key.D)) {
          this.dispatch("move-right");
        }
        if (Input.GetKeyDown(Key.Escape) || Input.GetKeyDown(Key.P)) {
          this.dispatch("pause-run");
        }
        break;
      case "Paused":
        if (Input.GetKeyDown(Key.Escape) || Input.GetKeyDown(Key.P)) {
          this.dispatch("resume-run");
        }
        if (Input.GetKeyDown(Key.R)) {
          this.dispatch("restart-run");
        }
        break;
      case "GameOver":
        if (Input.GetKeyDown(Key.Return) || Input.GetKeyDown(Key.R)) {
          this.dispatch("restart-run");
        }
        if (Input.GetKeyDown(Key.Escape)) {
          this.dispatch("return-to-menu");
        }
        break;
    }
  }

  private sync(): void {
    this.snapshot = this.port.getSnapshot();
    const phase = this.snapshot.phase;
    this.menuPage.gameObject.SetActive(phase === "Menu");
    this.hudPage.gameObject.SetActive(phase === "Playing");
    this.pausePage.gameObject.SetActive(phase === "Paused");
    this.gameOverPage.gameObject.SetActive(phase === "GameOver");
    this.player.gameObject.SetActive(phase !== "Menu");

    if (this.snapshot.playerLane !== null) {
      applyLayout(
        this.player.rectTransform,
        fixedLayout(LANE_X[this.snapshot.playerLane], PLAYER_Y, 150, 76)
      );
    }

    this.scoreText.component.text = `SCORE  ${this.snapshot.score
      .toString()
      .padStart(4, "0")}`;
    this.coinText.component.text = `COINS  ${this.snapshot.runCoins}`;
    this.resultScoreText.component.text = `SCORE  ${this.snapshot.score}`;
    this.resultCoinText.component.text =
      `COINS  ${this.snapshot.runCoins}   BEST  ${this.snapshot.bestScore}`;
    this.menuBestText.component.text = `BEST  ${this.snapshot.bestScore}`;
    this.menuCoinsText.component.text = `TOTAL COINS  ${this.snapshot.totalCoins}`;
    this.syncObjectViews();
  }

  private syncObjectViews(): void {
    const visibleGuids = new Set<EntityGuid>();
    for (const laneObject of this.snapshot.objects) {
      visibleGuids.add(laneObject.entityGuid);
      let view = this.objectViews.get(laneObject.entityGuid);
      if (!view) {
        view = this.createObjectView(laneObject);
        this.objectViews.set(laneObject.entityGuid, view);
      } else if (view.kind !== laneObject.kind) {
        view.kind = laneObject.kind;
        view.image.color = this.colorForObject(laneObject.kind);
      }

      applyLayout(
        view.rectTransform,
        fixedLayout(
          LANE_X[laneObject.lane],
          PLAYER_Y + laneObject.distance * DISTANCE_SCALE,
          laneObject.kind === "coin" ? 74 : 154,
          laneObject.kind === "coin" ? 74 : 84
        )
      );
    }

    for (const [entityGuid, view] of this.objectViews) {
      if (!visibleGuids.has(entityGuid)) {
        destroy(view.gameObject);
        this.objectViews.delete(entityGuid);
      }
    }
  }

  private createObjectView(laneObject: LaneObjectSnapshot): ObjectView {
    const node = createPanel(
      `${laneObject.kind}:${laneObject.entityGuid}`,
      this.playfield.gameObject.transform,
      this.colorForObject(laneObject.kind),
      fixedLayout(0, 0, 1, 1)
    );
    return {
      gameObject: node.gameObject,
      rectTransform: node.rectTransform,
      image: node.component,
      kind: laneObject.kind
    };
  }

  private colorForObject(kind: LaneObjectSnapshot["kind"]): CS.UnityEngine.Color {
    return kind === "coin" ? COLORS.coin : COLORS.obstacle;
  }

  private dispatch(type: GameCommand["type"]): void {
    this.port.dispatch({ type });
  }
}
