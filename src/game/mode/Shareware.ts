import { Data } from '../Data';
import type { PlayerEntity } from '../entity/Player';
import type { GameSession } from '../GameSession';
import { Adventure } from './Adventure';

/**
 * Port of `mode.Shareware` (`class/hammer/mode/Shareware.mt`): the demo that follows the
 * Learning mode (`Tutorial.onEndOfSet`), the seven levels of the set `shareware` with the
 * Adventure's rules and two lives. Its end and its game over both leave for the site's `$out`,
 * with no score.
 *
 * Deviation: as for `Tutorial`, the world is added with `addWorld` (the original sets it
 * directly, leaving `dimensions` empty). It shows on the world map, which this mode has from
 * `Adventure`: the original's pointer stays where the clip has it (`getMapY(undefined)`), the
 * port's is at the demo's level.
 */
export class Shareware extends Adventure {
  constructor(m: GameSession, id: number) {
    super(m, id);
    this._name = '$shareware';
  }

  /** `Shareware.initWorld`: its own set only (it does not call `Adventure`'s). */
  protected override initWorld(): void {
    this.addWorld('shareware');
  }

  /**
   * `Shareware.initGame`. The original then calls `gi.setLives`, but the interface is not built
   * yet (`initInterface` comes after and reads the lives).
   */
  protected override initGame(): void {
    super.initGame();
    const p = this.getOne(Data.PLAYER) as PlayerEntity;
    p.lives = 2;
  }

  /** `Shareware.endMode`: back to the site. */
  override endMode(): void {
    this.lock();
    this.manager.redirect(this.manager.out, null);
  }

  /** `Shareware.onEndOfSet` */
  override onEndOfSet(): void {
    this.endMode();
  }

  /** `Shareware.onGameOver` */
  override onGameOver(): void {
    this.endMode();
  }

  /** `Shareware.onLevelReady` */
  override onLevelReady(): void {
    super.onLevelReady();
    if (this.world.currentId === 0) {
      this.fxMan.attachLevelPop(this.dataStore.getLangText(17), true);
    }
  }

  /** `Shareware.onPause` */
  override onPause(): void {
    super.onPause();
    const sector = this.pauseMC?.getText('sector');
    if (sector) {
      sector.text = `${this.dataStore.getLangText(14)} «${this.dataStore.getLangText(17)}»`;
    }
  }
}
