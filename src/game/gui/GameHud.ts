import type { SwfMovieClip, SwfTextField } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { IGameContext } from '../GameContext';

const BASE_X = 92;
const BASE_WIDTH = 20;
const MAX_LIVES = 8;

/**
 * Port of `gui.GameInterface` (`class/hammer/gui/GameInterface.mt`):
 * renders the bottom 20 px HUD bar (`hammer_interf_game`), rolling score counter,
 * life icons (`hammer_interf_life`), C-R-Y-S-T-A-L extend letters, and level number.
 */
export class GameHud {
  readonly game: IGameContext;
  readonly mc: SwfMovieClip;

  private readonly scoreField: SwfTextField | null;
  private readonly levelField: SwfTextField | null;
  private readonly letters: (SwfMovieClip | null)[] = [];
  private readonly lifeIcons: SwfMovieClip[] = [];
  private moreIcon: SwfMovieClip | null = null;

  private realScore = 0;
  private fakeScore = 0;
  private currentLives = 0;
  /** `fl_light`: the minimal HUD of `lightMode`, which no longer shows lives. */
  private fl_light = false;

  constructor(game: IGameContext, initialScore = 0, initialLives = 2, initialLevel = 0) {
    this.game = game;
    this.mc = game.depthMan.attach('hammer_interf_game', Data.DP_TOP);
    this.mc._x = -game.xOffset;
    this.mc._y = Data.DOC_HEIGHT;
    this.mc.gotoAndStop('1');

    this.scoreField = this.mc.getText('score0');
    this.levelField = this.mc.getText('level');

    if (this.scoreField) {
      this.scoreField.textColor = Data.BASE_COLORS[0];
    }

    for (let i = 0; i < 7; i++) {
      this.letters.push(this.mc.getClip(`letter0_${i}`));
    }

    this.clearExtends();
    this.setScore(initialScore, true);
    this.setLives(initialLives);
    this.setLevel(initialLevel);
    this.update();
  }

  setScore(value: number, immediate = false): void {
    this.realScore = Math.max(0, Math.floor(value));
    if (immediate) this.fakeScore = this.realScore;
  }

  setLevel(id: number): void {
    if (this.levelField) {
      this.levelField.text = String(id);
      this.levelField.textColor = Data.BASE_COLORS[0];
    }
  }

  hideLevel(): void {
    if (this.levelField) {
      this.levelField.text = '?';
      this.levelField.textColor = Data.BASE_COLORS[0];
    }
  }

  /**
   * `lightMode`: the minimal HUD, no score and no lives. Only the Learning mode uses it
   * (`Tutorial.initGame`, not ported yet).
   */
  lightMode(): void {
    if (this.scoreField) this.scoreField.visible = false;
    this.setLives(0);
    this.moreIcon?.removeMovieClip();
    this.moreIcon = null;
    this.fl_light = true;
  }

  setLives(v: number): void {
    if (this.fl_light) {
      return;
    }
    const target = Math.max(0, v);
    if (this.currentLives > v) {
      this.game.logAction('$LL');
    }
    while (this.currentLives > target) {
      const icon = this.lifeIcons.pop();
      icon?.removeMovieClip();
      this.currentLives--;
    }

    while (this.currentLives < target && this.currentLives < MAX_LIVES) {
      const icon = this.game.depthMan.lib.attach('hammer_interf_life');
      icon._x = BASE_X + this.currentLives * BASE_WIDTH;
      icon._y = -19;
      icon.zIndex = 200 + this.currentLives;
      this.mc.addChild(icon);
      this.lifeIcons.push(icon);
      this.currentLives++;
    }

    if (target > MAX_LIVES && !this.moreIcon) {
      this.moreIcon = this.game.depthMan.lib.attach('hammer_interf_more');
      this.moreIcon._x = BASE_X + BASE_WIDTH * MAX_LIVES - 4;
      this.moreIcon._y = -25;
      this.moreIcon.zIndex = 300;
      this.mc.addChild(this.moreIcon);
    } else if (target <= MAX_LIVES && this.moreIcon) {
      this.moreIcon.removeMovieClip();
      this.moreIcon = null;
    }
  }

  getExtend(letterIndex: number): void {
    const l = this.letters[letterIndex];
    if (l && !l._visible) {
      const fx = this.game.depthMan.lib.attach('hammer_fx_letter_pop');
      fx._x = l._x + l._width * 0.5;
      fx._y = l._y;
      fx.zIndex = 400 + letterIndex;
      this.mc.addChild(fx);
      l._visible = true;
    }
  }

  clearExtends(): void {
    for (const l of this.letters) {
      if (l) l._visible = false;
    }
  }

  update(): void {
    if (this.fakeScore < this.realScore) {
      this.fakeScore += Math.round(Math.max(90, (this.realScore - this.fakeScore) / 5));
      if (this.fakeScore > this.realScore) this.fakeScore = this.realScore;
    } else if (this.fakeScore > this.realScore) {
      this.fakeScore = this.realScore;
    }

    if (this.scoreField) {
      this.scoreField.text = Data.formatNumberStr(this.fakeScore);
    }
  }

  destroy(): void {
    this.mc.removeMovieClip();
  }
}
