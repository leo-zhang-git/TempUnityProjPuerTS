import { GameCommand, LaneDodgeSnapshot } from "../../game/lane-dodge/model";
import type { LaneDodgeHudWidgetUI } from "../generated/widget/lane-dodge-hud-widget-ui";
import { WidgetBase } from "./widget-base";

const LANE_LABELS = ["LEFT", "CENTER", "RIGHT"] as const;

interface LaneDodgeHudParent {
  dispatchHudCommand(type: GameCommand["type"]): void;
}

export interface LaneDodgeHudWidget extends LaneDodgeHudWidgetUI {}

export class LaneDodgeHudWidget extends WidgetBase {
  private selectedLane: LaneDodgeSnapshot["playerLane"] | undefined;
  private parentPort: LaneDodgeHudParent | undefined;

  private readonly handlePauseClick = (): void => {
    this.dispatch("pause-run");
  };

  private readonly handleMoveLeftClick = (): void => {
    this.dispatch("move-left");
  };

  private readonly handleMoveRightClick = (): void => {
    this.dispatch("move-right");
  };

  constructor() {
    super("LaneDodgeHudWidget");
  }

  render(snapshot: LaneDodgeSnapshot): void {
    this.scoreText.text = `SCORE  ${snapshot.score.toString().padStart(4, "0")}`;
    this.coinText.text = `COINS  ${snapshot.runCoins}`;
    this.laneText.text = snapshot.playerLane === null
      ? "LANE  --"
      : `LANE  ${LANE_LABELS[snapshot.playerLane]}`;

    if (this.selectedLane !== snapshot.playerLane) {
      this.selectedLane = snapshot.playerLane;
      if (snapshot.playerLane === 0) {
        this.laneToggle.Select(0, false);
      } else if (snapshot.playerLane === 2) {
        this.laneToggle.Select(1, false);
      } else {
        this.laneToggle.DeselectAll();
      }
    }
  }

  protected override onLoaded(): void {
    const parent = this.uiParent as unknown as Partial<LaneDodgeHudParent> | undefined;
    if (!parent || typeof parent.dispatchHudCommand !== "function") {
      throw new Error("LaneDodgeHudWidget requires a LaneDodgeHudParent.");
    }
    this.parentPort = parent as LaneDodgeHudParent;

    this.pauseButton.onClick.AddListener(this.handlePauseClick);
    this.moveLeftButton.onClick.AddListener(this.handleMoveLeftClick);
    this.moveRightButton.onClick.AddListener(this.handleMoveRightClick);
  }

  protected override onDestroying(): void {
    this.pauseButton.onClick.RemoveListener(this.handlePauseClick);
    this.moveLeftButton.onClick.RemoveListener(this.handleMoveLeftClick);
    this.moveRightButton.onClick.RemoveListener(this.handleMoveRightClick);
    this.parentPort = undefined;
    this.selectedLane = undefined;
  }

  private dispatch(type: GameCommand["type"]): void {
    this.parentPort?.dispatchHudCommand(type);
  }
}
