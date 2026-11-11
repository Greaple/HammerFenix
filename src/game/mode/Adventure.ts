import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import packageJson from '../../../package.json';
import { Data } from '../Data';
import { BatBoss, TuberculozBoss } from '../entity/Boss';
import { BaseEntity } from '../entity/Entity';
import type { PlayerEntity } from '../entity/Player';
import { SupaItem } from '../entity/Supa';
import type { GameSession } from '../GameSession';
import { GameMode } from './GameMode';

/**
 * Port of `mode.Adventure` (`class/hammer/mode/Adventure.mt`): the main game, down the caverns
 * and through the portals to the other dimensions.
 *
 * Deviation: the port's set picker (debug toolbar) plays any level set with these rules, so the
 * main world is the session's current set (`initWorld`, `saveScore`).
 *
 * Not ported: `getDebugControls`' Ctrl+Shift+M (starts the co-op mode, Phase 4), `endMode` (it
 * opens the level editor), `trackPos` (only read by a commented out `playMusicAt`), and the dev
 * world `xml_dev`.
 */
export class Adventure extends GameMode {
  /**
   * Kill order of the level's enemies, for the super item. `TimeAttack` sets it to null at the
   * level's end, so no super item falls (AS2 reads nothing from null, hence the guards).
   */
  perfectOrder: number[] | null = [];
  perfectCount = 0;

  firstLevel: number;

  /** The bucket of level 0 was bombed: the next level is 10 (`nextLevel`). */
  fl_warpStart: boolean;

  constructor(m: GameSession, id: number) {
    super(m);
    this.firstLevel = id;

    this.fl_warpStart = false;
    this.fl_map = true;
    this._name = '$adventure';
  }

  /** `Adventure.init` */
  override init(): void {
    super.init();

    this.initGame();

    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      this.initPlayer(p);
    }

    this.initInterface();
  }

  /** `Adventure.addLevelItems`: the level's extend letter, special item and score item. */
  protected override addLevelItems(): void {
    super.addLevelItems();

    // Extends
    if (this.world.current.specialSlots.length > 0) {
      this.statsMan.spreadExtend();
    }

    // Special
    if (this.world.current.specialSlots.length > 0) {
      const pt =
        this.world.current.specialSlots[this.rand.random(this.world.current.specialSlots.length)];
      this.scriptRunner?.insertSpecialItem(
        this.randMan.draw(Data.RAND_ITEMS_ID) ?? 0,
        null,
        pt.x,
        pt.y,
        Data.SPECIAL_ITEM_TIMER,
        null,
        false,
        true,
      );
    }

    // Score
    if (this.world.current.scoreSlots.length > 0) {
      const pt =
        this.world.current.scoreSlots[this.rand.random(this.world.current.scoreSlots.length)];
      this.scriptRunner?.insertScoreItem(
        this.randMan.draw(Data.RAND_SCORES_ID) ?? 0,
        null,
        pt.x,
        pt.y,
        Data.SCORE_ITEM_TIMER,
        null,
        false,
        true,
      );

      if (this.globalActives[94]) {
        const cx = this.rand.random(Data.LEVEL_WIDTH);
        const cy = this.rand.random(Data.LEVEL_HEIGHT - 5);
        const ptC = this.world.getGround(cx, cy);
        this.scriptRunner?.insertScoreItem(
          this.randMan.draw(Data.RAND_SCORES_ID) ?? 0,
          null,
          ptC.x,
          ptC.y,
          Data.SCORE_ITEM_TIMER,
          null,
          false,
          true,
        );
      }
    }
  }

  /** `Adventure.attachBad`: keeps the perfect order for the super item. */
  override attachBad(id: number, x: number, y: number): BaseEntity {
    const b = super.attachBad(id, x, y);
    if (b.isType(Data.BAD_CLEAR)) {
      this.perfectOrder?.push(b.uniqId);
      this.perfectCount++;
    }
    return b;
  }

  /**
   * `Adventure.initWorld`: the adventure and the four dimensions its portals lead to. Another
   * set (the port's set picker) is played alone.
   */
  protected override initWorld(): void {
    super.initWorld();

    this.addWorld(this.manager.currentSetName);
    if (this.manager.currentSetName === 'adventure') {
      this.addWorld('deepnight');
      this.addWorld('hiko');
      this.addWorld('ayame');
      this.addWorld('hk');
    }
  }

  /** `Adventure.initGame` */
  protected override initGame(): void {
    super.initGame();
    this.playMusicTrack(0);
    this.gotoFirstLevel(this.firstLevel);
    // Attached hidden; onLevelReady shows it
    this.insertPlayer(this.world.current.playerX, this.world.current.playerY);
  }

  /** `Adventure.goto` */
  override goto(id: number): void {
    this.perfectOrder = [];
    this.perfectCount = 0;

    super.goto(id);
  }

  /** `Adventure.startLevel` */
  override startLevel(): void {
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.setBaseAnims(Data.ANIM_PLAYER_WALK, Data.ANIM_PLAYER_STOP);
    }
    this.perfectOrder = [];
    this.perfectCount = 0;
    super.startLevel();

    // Boss 1
    if (this.world.fl_mainWorld && this.world.currentId === Data.BAT_LEVEL) {
      BatBoss.attach(this);
      this.fl_clear = false;
    }

    // Boss 2
    if (this.world.fl_mainWorld && this.world.currentId === Data.TUBERCULOZ_LEVEL) {
      TuberculozBoss.attach(this);
      this.fl_clear = false;
    }

    // No exit arrow on level 0
    if (this.world.fl_mainWorld && this.world.currentId === 0) {
      this.fxMan.detachExit();
    }
  }

  /** `Adventure.nextLevel` */
  override nextLevel(): void {
    super.nextLevel();

    if (this.fl_warpStart) {
      this.world.currentId = 0;
      this.unlock();
      this.view.detach(); // level 10 shows at once, without a scroll
      this.forcedGoto(10);
    }
  }

  /**
   * `Adventure.saveScore`: hands the score to the Loader. The original first checks the set's
   * checksum, and stops with a fatal error for any set but the adventure; the port's set picker
   * plays every set in this mode, so they all send their score.
   */
  override saveScore(): void {
    this.manager.gameOver(this.savedScores[0], null, {
      reachedLevel: this.dimensions[0].currentId,
      item2: this.getPicks2(),
      data: this.manager.history,
    });
  }

  /** `Adventure.isBossLevel` */
  override isBossLevel(id: number): boolean {
    return (
      super.isBossLevel(id) ||
      (this.world.fl_mainWorld &&
        ((id >= 30 && id % 10 === 0) || id === Data.BAT_LEVEL || id === Data.TUBERCULOZ_LEVEL))
    );
  }

  /** `Adventure.onLevelReady`: the secret door after the warp, and the level's name. */
  override onLevelReady(): void {
    super.onLevelReady();
    if (this.fl_warpStart) {
      if (this.world.fl_mainWorld) {
        // The original uses x_ctr for the y coordinate here
        this.view.attachSprite(
          'door_secret',
          BaseEntity.x_ctr(this.world.current.playerX),
          BaseEntity.x_ctr(this.world.current.playerY) + Data.CASE_HEIGHT * 0.5,
          true,
        );
      }
      this.fl_warpStart = false;
    }
    if (!this.world.isVisited()) {
      this.fxMan.attachLevelPop(
        this.dataStore.getLevelName(this.currentDim, this.world.currentId),
        this.world.currentId > 0,
      );
    }
  }

  /** `Adventure.onLevelClear`: a super item falls when the enemies were killed in order. */
  override onLevelClear(): void {
    super.onLevelClear();
    if (
      !this.world.isVisited() &&
      this.perfectOrder?.length === 0 &&
      (this.scriptRunner?.cycle ?? 0) >= 10
    ) {
      for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
        p.setBaseAnims(Data.ANIM_PLAYER_WALK_V, Data.ANIM_PLAYER_STOP_V);
      }
      SupaItem.attach(this, this.perfectCount - 1);
      this.statsMan.inc(Data.STAT_SUPAITEM, 1);
    }
  }

  /** `Adventure.onKillBad` */
  override onKillBad(b: BaseEntity): void {
    super.onKillBad(b);

    // Boss Tuberculoz
    if (this.world.fl_mainWorld && this.world.currentId === Data.TUBERCULOZ_LEVEL) {
      this.getBoss()?.onKillBad?.();
    }

    // Perfect order
    if (this.badCount > 1 && b.uniqId === this.perfectOrder?.[0]) {
      this.perfectOrder.splice(0, 1);
    }
  }

  /** `Adventure.onExplode`: a player bomb exploded. */
  override onExplode(x: number, y: number, radius: number): void {
    super.onExplode(x, y, radius);

    if (this.world.fl_mainWorld && this.world.currentId === Data.TUBERCULOZ_LEVEL) {
      this.getBoss()?.onExplode?.(x, y, radius);
    }
  }

  /** `Adventure.onEndOfSet` */
  override onEndOfSet(): void {
    super.onEndOfSet();
    this.exitGame();
  }

  /** `Adventure.onGameOver` */
  override onGameOver(): void {
    super.onGameOver();
    this.manager.logAction('$t=' + Math.round(this.duration / Data.SECOND));

    const fl_illegal = this.manager.history.join('|').indexOf('!', 0) >= 0;

    // `F=` is the site's `$version` parameter: the port's version here
    this.manager.history = ['F=' + packageJson.version, 'T=' + this.gameChrono.get()];
    if (fl_illegal) {
      this.manager.history.push('$illegal'.substring(1));
    }

    this.stopMusic();

    this.saveScore();
  }

  /** `Adventure.onHurryUp`: the hurry-up music. */
  override onHurryUp(): SwfMovieClip | null {
    const mc = super.onHurryUp();
    if (this.currentTrack === 0) {
      this.playMusicTrack(2);
    }
    return mc;
  }

  /** `Adventure.resetHurry` */
  override resetHurry(): void {
    super.resetHurry();
    if (this.currentTrack === 2) {
      this.playMusicTrack(0);
    }
  }

  /** `ScriptEngine`'s code trigger 6 (`downcast(game).fl_warpStart = true`). */
  override setWarpStart(): void {
    this.fl_warpStart = true;
  }
}
