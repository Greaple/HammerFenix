import { Key } from '../../engine/Input';
import { Data } from '../Data';
import type { PlayerEntity } from '../entity/Player';
import type { GameSession } from '../GameSession';
import { TimeAttack } from './TimeAttack';

/**
 * Port of `mode.TimeAttackMulti` (`class/hammer/mode/TimeAttackMulti.mt`): the Time Attack for
 * two players on the same keyboard, the site's `$mode` `multitime`. The runs of the set
 * `multiTime` (`set_mta_N`), Igor on the arrows and Enter, Sandy on Z, S, Q, D and A (AZERTY
 * letters, as Flash read the layout), each with three lives. Everything else is `TimeAttack`'s,
 * with one difference that comes from the mode's name (`$timeMulti`, not `$time`): the
 * Tornade boost applies (`Player`).
 *
 * The pause screen is `GameMode`'s one-player frame, as the original has no `onPause` here.
 *
 * Port addition (G.3): a game started from the menu first asks each player to pick their
 * controller or keyboard side, before the countdown (`GameMode.askJoin`).
 */
export class TimeAttackMulti extends TimeAttack {
  constructor(m: GameSession, id: number) {
    super(m, id);
    this._name = '$timeMulti';
  }

  /** `TimeAttackMulti.initRunId` */
  protected override initRunId(): void {
    if (this.config.hasOption(Data.OPT_SET_MTA_0)) this.runId = 0;
    if (this.config.hasOption(Data.OPT_SET_MTA_1)) this.runId = 1;
    if (this.config.hasOption(Data.OPT_SET_MTA_2)) this.runId = 2;
  }

  /** `TimeAttackMulti.initWorld` (`xml_multitime`) */
  protected override initWorld(): void {
    this.addWorld('multiTime');
  }

  /**
   * `TimeAttackMulti.initGame`: the Adventure's player makes way for two, on the level's start
   * column and its mirror.
   */
  protected override initGame(): void {
    super.initGame();

    this.destroyList(Data.PLAYER);
    this.cleanKills();

    const px = this.world.current.playerX;
    const py = this.world.current.playerY;

    const p1 = this.insertPlayer(px, py);
    p1.ctrl.setKeys(Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, Key.ENTER);

    const p2 = this.insertPlayer(Data.LEVEL_WIDTH * 0.5 + (Data.LEVEL_WIDTH * 0.5 - px), py);
    // The original's comment says A for the third key, which is 81 (Q)
    p2.ctrl.setKeys(90 /*Z*/, 83 /*S*/, 81 /*Q*/, 68 /*D*/, 65 /*A*/);

    this.initializePlayers();
  }

  /** `TimeAttackMulti.initPlayer`: player 2 is Sandy (her skin and head, not her name). */
  protected override initPlayer(p: PlayerEntity): void {
    super.initPlayer(p);

    p.baseColor = Data.BASE_COLORS[p.pid];
    if (p.pid === 1) {
      p.skin = 2;
      p.defaultHead = Data.HEAD_SANDY;
      p.head = p.defaultHead;
    }
  }
}
