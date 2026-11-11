import type { SwfMovieClip, SwfTextField } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import { FxManager } from '../FxManager';
import type { IGameContext } from '../GameContext';
import { GameHud, type GameInterface } from './GameHud';

/**
 * Port of `gui.SoccerInterface` (`class/hammer/gui/SoccerInterface.mt`): the soccer mode's bottom
 * bar, frame 3 of `hammer_interf_game` (the Time Attack's), with each team's goals at the edges
 * (`score0`, `score1`) and the match time in the middle (`time`).
 *
 * The goals reach it as the players' scores: `Soccer.goal` gives the first player of the list
 * one point per goal of team 0 and the second one per goal of team 1, and `Player.getScoreHidden`
 * shows a player's score here by pid. The other methods of `GameInterface` are empty, as the
 * original's calls to them did nothing.
 */
export class SoccerHud implements GameInterface {
  static readonly GLOW_COLOR = GameHud.GLOW_COLOR;

  readonly mc: SwfMovieClip;
  readonly game: IGameContext;
  readonly scores: (SwfTextField | null)[];
  readonly time: SwfTextField | null;

  constructor(game: IGameContext) {
    this.game = game;

    // `init`. `cacheAsBitmap` only made Flash draw it faster.
    this.mc = game.depthMan.attach('hammer_interf_game', Data.DP_TOP);
    this.mc._x = -game.xOffset;
    this.mc._y = Data.DOC_HEIGHT;
    this.mc.gotoAndStop('3');

    this.scores = [this.mc.getText('score0'), this.mc.getText('score1')];
    this.time = this.mc.getText('time');

    for (const field of [this.scores[0], this.scores[1], this.time]) {
      if (field) FxManager.addGlow(field, SoccerHud.GLOW_COLOR, 2);
    }

    this.setScore(0, 0);
    this.setScore(1, 0);
  }

  /** `setScore`: a team's goals. */
  setScore(pid: number, n: number): void {
    const field = this.scores[pid];
    if (field) field.text = '' + n;
  }

  /** `setTime` */
  setTime(str: string): void {
    if (this.time) this.time.text = str;
  }

  destroy(): void {
    this.mc.removeMovieClip();
  }

  update(): void {
    // do nothing
  }

  // Not in `SoccerInterface`
  setLives(): void {}
  setLevel(): void {}
  hideLevel(): void {}
  lightMode(): void {}
  print(): void {}
  cls(): void {}
  getExtend(): void {}
  clearExtends(): void {}
}
