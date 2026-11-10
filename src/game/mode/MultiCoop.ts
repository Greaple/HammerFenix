import { Key } from '../../engine/Input';
import { Data } from '../Data';
import type { PlayerEntity } from '../entity/Player';
import type { GameSession } from '../GameSession';
import { showPlayerDevices } from '../gui/JoinScreen';
import { Adventure } from './Adventure';

/**
 * Port of `mode.MultiCoop` (`class/hammer/mode/MultiCoop.mt`): the Adventure for two players
 * on the same keyboard, the site's `$mode` `multicoop`. Igor is on the arrows and Enter, Sandy
 * on R, F, D, G and A. Each has half the lives (rounded up), there is no disguise and no bullet
 * time, and the mirror and nightmare options are the mode's own (`mirrormulti`,
 * `nightmaremulti`). The game ends when a player has no life left, unless the life sharing
 * option takes one from the other (`Player.killPlayer`). No score is sent, only each player's
 * in `$data`.
 *
 * Port addition (G.3): a game started from the menu first asks each player to pick their
 * controller or keyboard side (`GameMode.askJoin`); any other game keeps the original's keys.
 *
 * Not ported: `entity.WalkingBomb`, the bomb the `bombcontrol` option lets a lone player walk
 * (Page Up and Page Down). No quest gives that option; with it the mode has one player, on the
 * arrows, Enter and Ctrl, as in the original, but the bombs stay still.
 */
export class MultiCoop extends Adventure {
  constructor(m: GameSession, id: number) {
    super(m, id);
    this._name = '$multi';
    this.fl_bullet = false;
    this.fl_disguise = false;
    this.fl_nightmare = m.config.hasOption(Data.OPT_NIGHTMARE_MULTI);
    this.fl_mirror = m.config.hasOption(Data.OPT_MIRROR_MULTI);
    this.fl_map = true;
    this.fl_bombControl = m.config.hasOption(Data.OPT_BOMB_CONTROL);
  }

  /** `MultiCoop.initGame`: the Adventure's player makes way for the two of this mode. */
  protected override initGame(): void {
    super.initGame();

    this.destroyList(Data.PLAYER);
    this.cleanKills();

    const p1 = this.insertPlayer(5, -2);
    p1.ctrl.setKeys(Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, Key.ENTER);

    if (!this.fl_bombControl) {
      const p2 = this.insertPlayer(14, -2);
      p2.ctrl.setKeys(82 /*R*/, 70 /*F*/, 68 /*D*/, 71 /*G*/, 65 /*A*/);
    } else {
      p1.ctrl.setAlt(p1.ctrl.attack, Key.CONTROL);
    }
  }

  /**
   * `MultiCoop.onPause`: the two players' keys (frame 3). It draws a second tip, after the one
   * `GameMode.onPause` drew.
   */
  override onPause(): void {
    super.onPause();
    const mc = this.pauseMC;
    if (!this.fl_pause || !mc) return;

    mc.gotoAndStop('3');
    const lang = (id: number) => this.dataStore.getLangText(id);
    const setText = (name: string, text: string) => {
      const field = mc.getText(name);
      if (field) field.text = text;
    };
    setText('move', `${lang(29)}`);
    setText('attack', `${lang(42)}`);
    setText('click', '');

    let tip = lang(301 + this.tipId++);
    if (tip === null) {
      this.tipId = 0;
      tip = lang(301 + this.tipId++);
    }
    const tipField = mc.getText('tip');
    if (tipField) tipField.htmlText = `<b>${lang(300)}</b>${tip}`;

    // The rows of frame 3 are there now
    this.pausePrompts = 'frame3';
    this.showPausePrompts();
  }

  /**
   * Port addition (`GameMode.showPausePrompts`): frame 3 shows each player's keyboard keys.
   * Once the players have chosen their devices (G.3), each row shows its player's.
   */
  protected override showPausePrompts(): void {
    const mc = this.pauseMC;
    if (!mc || !this.fl_join || this.pausePrompts === 'keys') return;
    const devices = (this.getList(Data.PLAYER) as PlayerEntity[]).map((p) =>
      this.input.playerDevice(p.pid),
    );
    const shown = JSON.stringify(devices);
    if (shown === this.pausePrompts) return;
    this.pausePrompts = shown;
    showPlayerDevices(this, mc, devices);
  }

  /** `MultiCoop.initPlayer`: half the lives; player 2 is Sandy. */
  protected override initPlayer(p: PlayerEntity): void {
    super.initPlayer(p);

    p.baseColor = Data.BASE_COLORS[p.pid];
    p.darkColor = Data.DARK_COLORS[p.pid];
    p.lives = Math.ceil(p.lives * 0.5);
    if (p.pid === 1) {
      p.name = 'Sandy';
      p.skin = 2;
      p.defaultHead = Data.HEAD_SANDY;
      p.head = p.defaultHead;
    }
  }

  /** `MultiCoop.saveScore`: no score (-1), each player's in `$data`. */
  override saveScore(): void {
    this.manager.gameOver(-1, null, {
      reachedLevel: this.dimensions[0].currentId,
      item2: this.getPicks2(),
      data: { s0: this.savedScores[0], s1: this.savedScores[1] },
    });
  }
}
