import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import type { GameSession } from '../GameSession';
import { GameMode } from './GameMode';
import { Shareware } from './Shareware';

/**
 * Port of `mode.Tutorial` (`class/hammer/mode/Tutorial.mt`): the Learning mode, the site's
 * `$mode` `tutorial`. Free and unlimited: the lessons of the set `tutorial`, with no lives to
 * lose, no score, no hurry up and no music. Its end (level 18's door, or the door of level 0
 * that skips it: `$e_goto` 999) starts the `Shareware` mode.
 *
 * Deviation: the original builds its world without `addWorld`, which leaves `dimensions` empty
 * and the world unmirrored whatever the options say. Here `addWorld` is used, as the port reads
 * `dimensions[0]` where the original read `undefined` without harm; the site sent this mode no
 * option (`try.html`), so the mirror flag is off either way.
 *
 * Not ported: the set name checks (`GameManager.fatal`, against modified files).
 */
export class Tutorial extends GameMode {
  constructor(m: GameSession) {
    super(m);
    this._name = '$tutorial';
  }

  /** `Tutorial.init` */
  override init(): void {
    super.init();

    this.initGame();
    this.initInterface();
  }

  /** `Tutorial.initGame` */
  protected override initGame(): void {
    super.initGame();
    this.gotoFirstLevel(0);

    const p = this.insertPlayer(this.world.current.playerX, this.world.current.playerY);
    p.lives = 99999;
  }

  /** `Tutorial.initInterface`: the HUD shows no score and no lives. */
  protected override initInterface(): void {
    super.initInterface();
    this.hud.lightMode();
  }

  /** `Tutorial.initWorld` */
  protected override initWorld(): void {
    super.initWorld();
    const world = this.addWorld('tutorial');
    if (world) world.fl_shadow = false;
  }

  /** `Tutorial.endMode` (Escape in the original's local mode, which the port never is). */
  override endMode(): void {
    this.stopMusic();
    this.manager.startGameMode(new Shareware(this.manager, 0));
  }

  /** `Tutorial.onGameOver`: the player gave up (Ctrl+Shift+K). Back to the site's `$out`. */
  override onGameOver(): void {
    this.fl_gameOver = true;
    this.lock();
    this.manager.redirect(this.manager.out, null);
  }

  /** `Tutorial.onPause` */
  override onPause(): void {
    super.onPause();
    const sector = this.pauseMC?.getText('sector');
    if (sector) {
      sector.text = `${this.dataStore.getLangText(14)} «${this.dataStore.getLangText(16)}»`;
    }
  }

  /** `Tutorial.onHurryUp`: switched off. */
  override onHurryUp(): SwfMovieClip | null {
    return null;
  }

  /** `Tutorial.onLevelReady` */
  override onLevelReady(): void {
    super.onLevelReady();
    if (this.world.currentId === 0) {
      this.fxMan.attachLevelPop(this.dataStore.getLangText(16), false);
    }
  }

  /** `Tutorial.onEndOfSet`: the demo levels follow. */
  override onEndOfSet(): void {
    super.onEndOfSet();
    this.manager.startGameMode(new Shareware(this.manager, 0));
  }
}
