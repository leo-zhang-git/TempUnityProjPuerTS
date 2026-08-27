import { EntityGuid } from "../../ecs/entity-guid";
import {
  GameCommand,
  LaneDodgeSnapshot,
  LaneObjectSnapshot
} from "../../game/lane-dodge/model";
import type { LaneDodgeCanvasUI } from "../generated/canvas/lane-dodge-canvas-ui";
import {
  applyLayout,
  color,
  createPanel,
  destroy,
  fixedLayout,
  RectLayout
} from "../common/unity-ui";
import { CanvasBase } from "./canvas-base";

const Unity = CS.UnityEngine;

const LANE_X = [-280, 0, 280] as const;
const PLAYER_BOTTOM_OFFSET = 350;
const DISTANCE_SCALE = 96;

const OBJECT_COLORS = {
  obstacle: color(0.94, 0.27, 0.25, 1),
  coin: color(1, 0.76, 0.12, 1)
} as const;

interface LaneDodgeCanvasPort {
  dispatch(command: GameCommand): void;
  getSnapshot(): LaneDodgeSnapshot;
}

interface ObjectView {
  readonly gameObject: CS.UnityEngine.GameObject;
  readonly rectTransform: CS.UnityEngine.RectTransform;
  readonly image: CS.UnityEngine.UI.Image;
  kind: LaneObjectSnapshot["kind"];
}

export class LaneDodgeCanvas extends CanvasBase {
  private readonly objectViews = new Map<EntityGuid, ObjectView>();
  private snapshot!: LaneDodgeSnapshot;

  private get ui(): LaneDodgeCanvasUI {
    return this.getBinderUI<LaneDodgeCanvasUI>();
  }

  private readonly handleStartClick = (): void => {
    this.dispatch("start-run");
  };

  private readonly handleResumeClick = (): void => {
    this.dispatch("resume-run");
  };

  private readonly handleRestartClick = (): void => {
    this.dispatch("restart-run");
  };

  private readonly handleMenuClick = (): void => {
    this.dispatch("return-to-menu");
  };

  constructor(private readonly port: LaneDodgeCanvasPort) {
    super("LaneDodgeCanvas");
  }

  dispatchHudCommand(type: GameCommand["type"]): void {
    this.dispatch(type);
  }

  protected override onLoaded(): void {
    this.snapshot = this.port.getSnapshot();
    this.bindClick(this.ui.btn_start, this.handleStartClick);
    this.bindClick(this.ui.btn_resume, this.handleResumeClick);
    this.bindClick(this.ui.btn_pause_restart, this.handleRestartClick);
    this.bindClick(this.ui.btn_pause_menu, this.handleMenuClick);
    this.bindClick(this.ui.btn_run_again, this.handleRestartClick);
    this.bindClick(this.ui.btn_game_over_menu, this.handleMenuClick);
    this.sync();
  }

  protected override onUpdate(_deltaTime: number): void {
    this.snapshot = this.port.getSnapshot();
    this.handleKeyboard();
  }

  protected override onLateUpdate(_deltaTime: number): void {
    this.sync();
  }

  protected override onDestroying(): void {
    this.objectViews.clear();
  }

  private bindClick(
    button: CS.UnityEngine.UI.ButtonEx,
    callback: () => void
  ): void {
    button.onClick.AddListener(callback);
    this.registerDisposer(() => button.onClick.RemoveListener(callback));
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
    this.ui.sr_phase.SetCurrentState(this.snapshot.phase, false);
    if (this.snapshot.phase === "Playing") {
      this.ui.LaneDodgeHudWidget.show();
    } else {
      this.ui.LaneDodgeHudWidget.hide();
    }

    if (this.snapshot.playerLane !== null) {
      applyLayout(
        this.ui.img_player.transform as CS.UnityEngine.RectTransform,
        laneObjectLayout(
          LANE_X[this.snapshot.playerLane],
          PLAYER_BOTTOM_OFFSET,
          150,
          76
        )
      );
    }

    this.ui.LaneDodgeHudWidget.render(this.snapshot);
    this.ui.txt_result_score.text = `SCORE  ${this.snapshot.score}`;
    this.ui.txt_result_coins.text =
      `COINS  ${this.snapshot.runCoins}   BEST  ${this.snapshot.bestScore}`;
    this.ui.txt_menu_best.text = `BEST  ${this.snapshot.bestScore}`;
    this.ui.txt_menu_coins.text = `TOTAL COINS  ${this.snapshot.totalCoins}`;
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
        laneObjectLayout(
          LANE_X[laneObject.lane],
          PLAYER_BOTTOM_OFFSET + laneObject.distance * DISTANCE_SCALE,
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
      this.ui.img_playfield.transform,
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
    return kind === "coin" ? OBJECT_COLORS.coin : OBJECT_COLORS.obstacle;
  }

  private dispatch(type: GameCommand["type"]): void {
    this.port.dispatch({ type });
  }
}

function laneObjectLayout(
  x: number,
  bottomOffset: number,
  width: number,
  height: number
): RectLayout {
  return {
    anchorMin: [0.5, 0],
    anchorMax: [0.5, 0],
    size: [width, height],
    position: [x, bottomOffset]
  };
}
