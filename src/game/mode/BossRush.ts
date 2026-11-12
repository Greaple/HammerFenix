import { Chrono } from '../Chrono';
import { Data } from '../Data';
import type { PlayerEntity } from '../entity/Player';
import { FxManager } from '../FxManager';
import type { GameSession } from '../GameSession';
import { Adventure } from './Adventure';

/**
 * Port of `mode.BossRush` (`class/hammer/mode/BossRush.mt`): the site's `$mode` `bossrush`, the
 * "Tubercourse" (static 36). The Adventure against the clock: the same levels and dimensions,
 * with a faster player (`speedFactor` 1.5) who has two bombs and the up kick, given again at each
 * life; no disguise, mirror or nightmare. A real-time chrono (`Chrono`, stopped while the game is
 * locked) shows the last level's time when the next one starts, the time on the world map every
 * ten levels (`Data.EVENT_TIME`), and the total and the average level time on the pause screen
 * (frame 4). The end of the game is the Adventure's: the score, the level reached and the items
 * found go to the site.
 *
 * Deviation, as for the co-op: it starts on `firstLevel` (0 in the original), for the debug
 * tools.
 *
 * Kept from the original: `levelCount` is counted but never read, and the original never sets it
 * before `++` (here it starts at 0). An empty `main` branch for the dev mode (a commented out
 * `Log.print`) is left out.
 */
export class BossRush extends Adventure {
  chrono: Chrono;
  /** Running average of the level times: each new time is averaged with it. */
  levelAvg: number;
  levelCount = 0;
  /** The chrono when the current level started. */
  levelTimer: number;
  /** The time of the level just left, shown when the next one starts. */
  lastLevelTimer: number | null;

  constructor(m: GameSession, id: number) {
    super(m, id);
    this._name = '$bossRush';
    this.fl_disguise = false;
    this.fl_map = true;
    this.fl_mirror = false;
    this.fl_nightmare = false;

    this.levelTimer = 0;
    this.levelAvg = 0;
    this.lastLevelTimer = null;

    this.chrono = new Chrono(m.getTimer);
  }

  // ------------------------------------------------------------------ chrono

  /** `BossRush.unlock`: the chrono runs with the game. */
  override unlock(): void {
    super.unlock();
    this.chrono.start();
  }

  /** `BossRush.lock` */
  override lock(): void {
    super.lock();
    this.chrono.stop();
  }

  // ------------------------------------------------------------------ players

  /** `BossRush.initPlayer` */
  protected override initPlayer(p: PlayerEntity): void {
    super.initPlayer(p);
    this.upgradePlayer(p);
  }

  /** `BossRush.upgradePlayer`: faster, two bombs, and the up kick. */
  upgradePlayer(p: PlayerEntity): void {
    p.speedFactor = 1.5;
    p.maxBombs = 2;
    p.fl_upKick = true; // `p.ctrl.fl_upKick`
  }

  /** `BossRush.onResurrect`: the upgrade again, as the new life reset it. */
  override onResurrect(): void {
    super.onResurrect();
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      this.upgradePlayer(p);
    }
  }

  // ------------------------------------------------------------------ pause

  /**
   * `BossRush.onPause`: the times (frame 4): "Tubercourse", the chrono and the average level
   * time, or "--" before the first level is done. Frame 4 has no keys, tip or sector.
   */
  override onPause(): void {
    super.onPause();
    const mc = this.pauseMC;
    if (!this.fl_pause || !mc) return;

    mc.gotoAndStop('4');
    const lang = (id: number) => this.dataStore.getLangText(id);
    const setText = (name: string, text: string) => {
      const field = mc.getText(name);
      if (field) field.text = text;
    };
    setText('title', `${lang(36)}`);
    setText('timeLabel', `${lang(37)}`);
    setText('time', this.chrono.getStrShort());
    setText('timeAvgLabel', `${lang(38)}`);
    if (this.levelAvg > 0) {
      setText('timeAvg', this.chrono.formatTimeShort(Math.round(this.levelAvg)));
    } else {
      setText('timeAvg', '--');
    }
  }

  /** Port addition (`GameMode.showPausePrompts`): frame 4 shows no keys to replace. */
  protected override showPausePrompts(): void {
    if (this.pauseMC?._currentframe === 4) return;
    super.showPausePrompts();
  }

  // ------------------------------------------------------------------ levels

  /**
   * `BossRush.goto`: leaving level 10, 20... puts the chrono on the world map; the level's time
   * is kept, even when the level change does not happen (the game locked).
   */
  override goto(id: number): void {
    if ((id - 1) % 10 === 0 && id > 1) {
      this.registerMapEvent(Data.EVENT_TIME, this.chrono.getStrShort());
    }

    this.registerLevelTime();

    super.goto(id);
  }

  /** `BossRush.switchDimensionById`: a portal ends the level too. */
  override switchDimensionById(did: number, lid: number, pid: number): void {
    this.registerLevelTime();
    super.switchDimensionById(did, lid, pid);
  }

  /** `BossRush.registerLevelTime`: the time of the level being left, and the new average. */
  registerLevelTime(): void {
    this.lastLevelTimer = this.chrono.get() - this.levelTimer;
    if (this.levelAvg === 0) {
      this.levelAvg = this.lastLevelTimer;
    }
    this.levelAvg = 0.5 * (this.levelAvg + this.lastLevelTimer);
  }

  /**
   * `BossRush.startLevel`: the first level starts the chrono, the next ones show the last
   * level's time.
   */
  override startLevel(): void {
    super.startLevel();
    if (!this.chrono.fl_init) {
      this.chrono.reset();
    } else {
      this.displayTime(this.lastLevelTimer);
      this.lastLevelTimer = null;
    }
    this.levelTimer = this.chrono.get();
    this.levelCount++;
  }

  /**
   * `BossRush.displayTime`: "Temps: +MM\" SS" slides in at the bottom left, as an effect (so not
   * while the game is locked). A missing time reads as 0 (Flash's `new Date(null)`).
   */
  displayTime(t: number | null): void {
    const mc = this.fxMan.attachFx(5, Data.DOC_HEIGHT - 45, 'hammer_interf_time')?.mc;
    if (!mc) return;
    const field = mc.getClip('sub')?.getText('field');
    if (field) {
      field.text = `${this.dataStore.getLangText(39)} +${this.chrono.formatTimeShort(t ?? 0)}`;
    }
    FxManager.addGlow(mc, Data.DARK_COLORS[0], 2);
  }

  /** `BossRush.main` */
  override main(): void {
    this.chrono.update();
    super.main();
  }
}
