import type { SwfMovieClip, SwfTextField } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import { FxManager } from '../FxManager';
import type { PlayerEntity } from '../entity/Player';
import type { IGameContext } from '../GameContext';

const MAX_LIVES = 8;

/**
 * Port of `gui.GameInterface` (`class/hammer/gui/GameInterface.mt`): the bottom 20 px HUD bar
 * (`hammer_interf_game`) with each player's rolling score, life icons (`hammer_interf_life`)
 * and C-R-Y-S-T-A-L extend letters, and the level number. `initSingle` is frame 1; `initMulti`
 * (two players or more) is frame 2, with player 2 on the right and its lives going leftwards.
 * `initTime` (the Time Attack modes, `$time` and `$timeMulti`) is frame 3: the chrono in the
 * middle (`print`), the lives at the edges, no score, no level and no extend letters.
 */
export class GameHud {
  static readonly GLOW_COLOR = 0x70658d;

  readonly game: IGameContext;
  readonly mc: SwfMovieClip;

  /** `fl_multi`: the two-player interface. */
  readonly fl_multi: boolean;

  /**
   * `BASE_X`, `BASE_X_RIGHT`, `BASE_WIDTH`: where the life icons go. Statics in the original,
   * which `initTime` changes; each game was a new page there, so they are per HUD here.
   */
  private baseX = 92; // lives
  private baseXRight = 300;
  private baseWidth = 20;

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
  /** `fl_print`: the score field shows a text of its own (`print`), not the score. */
  private fl_print = false;
  private readonly baseColor = Data.BASE_COLORS[0];

  constructor(game: IGameContext) {
    this.game = game;
    const pl = game.getList(Data.PLAYER) as PlayerEntity[];

    // skin
    this.mc = game.depthMan.attach('hammer_interf_game', Data.DP_TOP);
    this.mc._x = -game.xOffset;
    this.mc._y = Data.DOC_HEIGHT;

    if (game._name === '$time' || game._name === '$timeMulti') {
      // `initTime`: never sets `fl_multi`, so both players' lives are spaced as one player's
      this.fl_multi = false;
      this.mc.gotoAndStop('3');
      this.baseX = 8;
      this.baseXRight = 386;
      this.baseWidth *= 0.75;
      this.scores = [this.mc.getText('time')];
      // Frame 3 has no level field and no extend letters
      this.levelField = this.mc.getText('level');
      for (const p of pl) {
        this.fakeScores[p.pid] = 0;
        this.realScores[p.pid] = 0;
        this.currentLives[p.pid] = 0;
        this.lives[p.pid] = [];

        this.setScore(p.pid, p.score);
        this.setLives(p.pid, p.lives);
      }
      this.initScoreField(0);
    } else {
      this.fl_multi = pl.length !== 1;
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
        this.initScoreField(pid);
      }
    }

    if (this.levelField) FxManager.addGlow(this.levelField, GameHud.GLOW_COLOR, 2);

    this.setLevel(game.world.currentId);

    this.update();
  }

  /** The score field's color and glow (`initSingle`, `initMulti`, `initTime`). */
  private initScoreField(pid: number): void {
    const field = this.scores[pid];
    if (field) {
      field.textColor = Data.BASE_COLORS[0];
      FxManager.addGlow(field, GameHud.GLOW_COLOR, 2);
    }
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
    let baseX = this.baseX;
    let baseWid = this.baseWidth;
    if (this.fl_multi) {
      baseWid = 0.6 * this.baseWidth;
    }
    if (pid === 1) {
      baseWid *= -1;
      baseX = this.baseXRight;
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

  /** `print`: shows `s` in player `pid`'s score field instead of the score (the chrono). */
  print(pid: number, s: string): void {
    const field = this.scores[pid];
    if (field) field.text = s;
    this.fl_print = true;
  }

  /** `cls`: the score fields show the scores again. */
  cls(): void {
    this.fl_print = false;
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
    if (this.fl_print) return;
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
