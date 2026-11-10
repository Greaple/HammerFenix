import type { SwfMovieClip, SwfTextField } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import { FxManager } from '../FxManager';
import type { PlayerEntity } from '../entity/Player';
import type { IGameContext } from '../GameContext';

const BASE_X = 92; // lives
const BASE_X_RIGHT = 300;
const BASE_WIDTH = 20;
const MAX_LIVES = 8;

/**
 * Port of `gui.GameInterface` (`class/hammer/gui/GameInterface.mt`): the bottom 20 px HUD bar
 * (`hammer_interf_game`) with each player's rolling score, life icons (`hammer_interf_life`)
 * and C-R-Y-S-T-A-L extend letters, and the level number. `initSingle` is frame 1; `initMulti`
 * (two players or more) is frame 2, with player 2 on the right and its lives going leftwards.
 *
 * Not ported: `initTime` (the Time Attack interface, roadmap 4.1) and `print` / `cls`, which
 * only that mode uses.
 */
export class GameHud {
  static readonly GLOW_COLOR = 0x70658d;

  readonly game: IGameContext;
  readonly mc: SwfMovieClip;

  /** `fl_multi`: the two-player interface. */
  readonly fl_multi: boolean;

  private readonly scores: (SwfTextField | null)[];
  private readonly levelField: SwfTextField | null;
  /** By pid, then by letter. */
  private readonly letters: (SwfMovieClip | null)[][] = [];
  /** `lives`: each player's life icons, by pid. */
  private readonly lives: SwfMovieClip[][] = [];
  private readonly more: (SwfMovieClip | null)[] = [];

  private readonly realScores: number[] = [];
  private readonly fakeScores: number[] = [];
  private readonly currentLives: number[] = [];
  /** `fl_light`: the minimal HUD of `lightMode`, which no longer shows lives. */
  private fl_light = false;
  private readonly baseColor = Data.BASE_COLORS[0];

  constructor(game: IGameContext) {
    this.game = game;
    const pl = game.getList(Data.PLAYER) as PlayerEntity[];
    this.fl_multi = pl.length !== 1;

    // skin
    this.mc = game.depthMan.attach('hammer_interf_game', Data.DP_TOP);
    this.mc._x = -game.xOffset;
    this.mc._y = Data.DOC_HEIGHT;
    this.mc.gotoAndStop(this.fl_multi ? '2' : '1');
    this.scores = this.fl_multi
      ? [this.mc.getText('score0'), this.mc.getText('score1')]
      : [this.mc.getText('score0')];
    this.levelField = this.mc.getText('level');

    // Extend letters
    for (let pid = 0; pid < this.scores.length; pid++) {
      this.letters[pid] = [];
      for (let i = 0; i < 7; i++) {
        this.letters[pid].push(this.mc.getClip(`letter${pid}_${i}`));
      }
    }

    // `initSingle` reads the first player only; `initMulti` each player by pid
    for (const p of this.fl_multi ? pl : pl.slice(0, 1)) {
      const pid = this.fl_multi ? p.pid : 0;
      this.fakeScores[pid] = 0;
      this.realScores[pid] = 0;
      this.currentLives[pid] = 0;
      this.lives[pid] = [];

      this.setScore(pid, p.score);
      this.setLives(pid, p.lives);

      this.clearExtends(pid);
      const field = this.scores[pid];
      if (field) {
        field.textColor = Data.BASE_COLORS[0];
        FxManager.addGlow(field, GameHud.GLOW_COLOR, 2);
      }
    }

    if (this.levelField) FxManager.addGlow(this.levelField, GameHud.GLOW_COLOR, 2);

    this.setLevel(game.world.currentId);

    this.update();
  }

  setScore(pid: number, v: number): void {
    this.realScores[pid] = v;
  }

  setLevel(id: number): void {
    if (this.levelField) {
      this.levelField.text = String(id);
      this.levelField.textColor = this.baseColor;
    }
  }

  hideLevel(): void {
    if (this.levelField) {
      this.levelField.text = '?';
      this.levelField.textColor = this.baseColor;
    }
  }

  /** `lightMode`: the minimal HUD, no score and no lives (the Learning mode). */
  lightMode(): void {
    const field = this.scores[0];
    if (field) field.visible = false;
    this.setLives(0, 0);
    this.more[0]?.removeMovieClip();
    this.more[0] = null;
    this.more[1]?.removeMovieClip();
    this.more[1] = null;
    this.fl_light = true;
  }

  setLives(pid: number, v: number): void {
    let baseX = BASE_X;
    let baseWid = BASE_WIDTH;
    if (this.fl_multi) {
      baseWid = 0.6 * BASE_WIDTH;
    }
    if (pid === 1) {
      baseWid *= -1;
      baseX = BASE_X_RIGHT;
    }

    const plives = this.lives[pid];
    if (this.fl_light || !plives) {
      return;
    }
    if (this.currentLives[pid] > v) {
      this.game.logAction('$LL');
      while (this.currentLives[pid] > v) {
        plives.pop()?.removeMovieClip();
        this.currentLives[pid]--;
      }
    } else {
      while (this.currentLives[pid] < v && this.currentLives[pid] < MAX_LIVES) {
        const icon = this.game.depthMan.lib.attach('hammer_interf_life');
        icon._x = baseX + this.currentLives[pid] * baseWid;
        icon._y = -19;
        icon.zIndex = 200 + pid * 20 + this.currentLives[pid];
        this.mc.addChild(icon);
        plives[this.currentLives[pid]] = icon;
        this.currentLives[pid]++;
      }
      if (v > MAX_LIVES && !this.more[pid]) {
        const more = this.game.depthMan.lib.attach('hammer_interf_more');
        more._x = baseX + baseWid * MAX_LIVES - 4;
        if (pid > 0) {
          more._x -= baseWid;
        }
        more._y = -25;
        more.zIndex = 300 + pid;
        this.mc.addChild(more);
        this.more[pid] = more;
      }
      if (v <= MAX_LIVES && this.more[pid]) {
        this.more[pid]?.removeMovieClip();
        this.more[pid] = null;
      }
    }
  }

  getExtend(pid: number, id: number): void {
    const l = this.letters[pid]?.[id];
    if (l && !l._visible) {
      const fx = this.game.depthMan.lib.attach('hammer_fx_letter_pop');
      fx._x = l._x + l._width * 0.5;
      fx._y = l._y;
      fx.zIndex = 400 + pid * 10 + id;
      this.mc.addChild(fx);
      l._visible = true;
    }
  }

  clearExtends(pid: number): void {
    for (const l of this.letters[pid] ?? []) {
      if (l) l._visible = false;
    }
  }

  update(): void {
    for (let pid = 0; pid < this.scores.length; pid++) {
      const field = this.scores[pid];
      if (!field || this.realScores[pid] === undefined) continue;
      if (this.fakeScores[pid] < this.realScores[pid]) {
        this.fakeScores[pid] += Math.round(
          Math.max(90, (this.realScores[pid] - this.fakeScores[pid]) / 5),
        );
      }
      if (this.fakeScores[pid] > this.realScores[pid]) {
        this.fakeScores[pid] = this.realScores[pid];
      }
      field.text = Data.formatNumberStr(this.fakeScores[pid]);
    }
  }

  destroy(): void {
    this.mc.removeMovieClip();
  }
}
