import { GameCommand, LaneDodgeSnapshot } from "../../game/lane-dodge/model";
import type { LaneDodgeHudWidgetUI } from "../generated/widget/lane-dodge-hud-widget-ui";
import { WidgetBase } from "./widget-base";

const LANE_LABELS = ["LEFT", "CENTER", "RIGHT"] as const;

interface LaneDodgeHudParent {
  dispatchHudCommand(type: GameCommand["type"]): void;
}

export class LaneDodgeHudWidget extends WidgetBase {
  private parentPort: LaneDodgeHudParent | undefined;

  private get ui(): LaneDodgeHudWidgetUI {
    return this.getBinderUI<LaneDodgeHudWidgetUI>();
  }

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
    this.ui.txt_score.text = `SCORE  ${snapshot.score.toString().padStart(4, "0")}`;
    this.ui.txt_coins.text = `COINS  ${snapshot.runCoins}`;
    this.ui.txt_lane.text = snapshot.playerLane === null
      ? "LANE  --"
      : `LANE  ${LANE_LABELS[snapshot.playerLane]}`;
  }

  protected override onLoaded(): void {
    const parent = this.uiParent as unknown as Partial<LaneDodgeHudParent> | undefined;
    if (!parent || typeof parent.dispatchHudCommand !== "function") {
      throw new Error("LaneDodgeHudWidget requires a LaneDodgeHudParent.");
    }
    this.parentPort = parent as LaneDodgeHudParent;

    this.ui.btn_pause.onClick.AddListener(this.handlePauseClick);
    this.ui.btn_move_left.onClick.AddListener(this.handleMoveLeftClick);
    this.ui.btn_move_right.onClick.AddListener(this.handleMoveRightClick);
  }

  protected override onDestroying(): void {
    this.ui.btn_pause.onClick.RemoveListener(this.handlePauseClick);
    this.ui.btn_move_left.onClick.RemoveListener(this.handleMoveLeftClick);
    this.ui.btn_move_right.onClick.RemoveListener(this.handleMoveRightClick);
    this.parentPort = undefined;
  }

  private dispatch(type: GameCommand["type"]): void {
    this.parentPort?.dispatchHudCommand(type);
  }
}
