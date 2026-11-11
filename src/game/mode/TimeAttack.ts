import { Timer } from '../../engine/Timer';
import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { PlayerEntity } from '../entity/Player';
import { FxManager } from '../FxManager';
import type { GameSession } from '../GameSession';
import { Adventure } from './Adventure';

/**
 * Port of `mode.TimeAttack` (`class/hammer/mode/TimeAttack.mt`): the site's `$mode`
 * `timeattack`, unlocked by quest 73. One run of the set `timeAttack` against the clock: the run
 * the site chose (`set_ta_N`: run N starts on level 9 N) until an empty level, with three lives,
 * no score, no items, no hurry up, no bullet time, no mirror and no nightmare, and the enemies'
 * first moves fixed (`fl_static`). A 3.5 s countdown starts the first level. Crystals take
 * seconds off the chrono (`Data.getCrystalTime`). The chrono is real time (`Std.getTimer`),
 * stopped while the game is locked (level changes, pause). The game sends the time in
 * milliseconds as its score, with the run's id; a game over sends 3,599,999 (59" 59' 999).
 *
 * As in the original, the time sent is the chrono when the run's last level was entered: the
 * times are added up when leaving a level (`goto`), and leaving the last one ends the game first.
 *
 * Port addition (G.3): in the two-player version, the countdown waits for the players to choose
 * their devices (`canJoin`).
 *
 * Not ported: the empty `onResurrect` override (its body is commented out in the original).
 */
export class TimeAttack extends Adventure {
  /** `TimeAttack.INFINITY`: 59" 59' 999, the time of a game over. */
  static readonly INFINITY = 59 * 60 * 1000 + 59 * 1000 + 999;

  /** When the chrono started, moved forward by the stops and the crystals. */
  gameTimer = 0;
  suspendTimer: number | null = null;
  /** The chrono at the last frame, for the minute alerts. */
  last = 0;
  fl_chronoStop = false;
  /** Each level's time, in milliseconds (negative when crystals took more than the level took). */
  times: number[] = [];
  /** The minute alerts shown. */
  fl_alerts: boolean[] = [];

  /** Frames left of the countdown; unset (NaN, AS2's undefined) until the first level shows. */
  starter = NaN;
  mcStarter: SwfMovieClip | null = null;

  /** `Std.getTimer()` this frame and the frame before. */
  frameTimer: number;
  prevFrameTimer = 0;

  runId: number | null;

  constructor(m: GameSession, id: number) {
    super(m, id);

    this.runId = null;
    this.initRunId();
    if (this.runId === null) {
      m.fatal('unknown run ID');
    }
    this.firstLevel = (this.runId ?? 0) * 9;

    this._name = '$time';
    this.suspendTimer = null;
    this.times = [];
    this.frameTimer = m.getTimer();
    this.fl_alerts = [];
    this.fl_static = true;
    this.fl_bullet = false;
    this.fl_mirror = false;
    this.fl_nightmare = false;
  }

  /** `TimeAttack.initRunId`: the run the site chose. */
  protected initRunId(): void {
    if (this.config.hasOption(Data.OPT_SET_TA_0)) this.runId = 0;
    if (this.config.hasOption(Data.OPT_SET_TA_1)) this.runId = 1;
    if (this.config.hasOption(Data.OPT_SET_TA_2)) this.runId = 2;
  }

  /** `TimeAttack.initWorld` (`xml_time`) */
  protected override initWorld(): void {
    this.addWorld('timeAttack');
  }

  /** `TimeAttack.initGame` */
  protected override initGame(): void {
    super.initGame();

    this.initializePlayers();
    this.resetChrono();
  }

  /**
   * `TimeAttack.initializePlayers`: three lives and no score. The original sets `getScore` and
   * `getScoreHidden` to null, and AS2 ignores a call to null, so nothing changes the score.
   * The interface is not there yet at the game's start.
   */
  protected initializePlayers(): void {
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.getScore = () => {};
      p.getScoreHidden = () => {};
      p.lives = 3;
      this.hud?.setLives(p.pid, p.lives);
    }
  }

  /** `TimeAttack.pickUpScore`: a crystal takes seconds off the chrono. */
  override pickUpScore(id: number, subId: number | null): number {
    const ret = super.pickUpScore(id, subId);
    if (id === 0) {
      const bonus = Data.getCrystalTime(subId);
      this.timeShift(bonus);

      for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
        this.fxMan.attachScorePop(p.baseColor, p.darkColor, p.x, p.y, '-' + bonus + ' sec');
      }
    }
    return ret;
  }

  /** `TimeAttack.addLevelItems`: switched off (no extend letter, special or score item). */
  protected override addLevelItems(): void {
    // do nothing
  }

  /**
   * `TimeAttack.goto`: an empty level ends the run. Otherwise the level's time is kept and the
   * chrono shown until the next level starts.
   */
  override goto(id: number): void {
    if (this.world.isEmptyLevel(id, (cx) => this.flipCoordCase(cx))) {
      this.onEndOfSet();
      return;
    }
    this.stopChrono();
    const t = Math.floor(this.prevFrameTimer - this.gameTimer);
    let lt = t;
    for (const time of this.times) {
      lt -= time;
    }
    this.times.push(lt);
    this.display(this.formatTime(t));

    super.goto(id);
  }

  /** `TimeAttack.saveScore`: the run's time as the score, and the run's id. */
  override saveScore(): void {
    let t = 0;
    for (const time of this.times) {
      t += time;
    }
    this.manager.gameOver(t, this.runId, {
      reachedLevel: 0,
      item2: null,
      data: null,
    });
  }

  /** `TimeAttack.onEndOfSet`: the run is over. */
  override onEndOfSet(): void {
    this.saveScore();
  }

  /** `TimeAttack.onGameOver`: no time (`INFINITY`). */
  override onGameOver(): void {
    this.times = [3599999];
    this.saveScore();
  }

  /** `TimeAttack.onLevelClear`: "pas de supa item". */
  override onLevelClear(): void {
    this.perfectOrder = null;
    super.onLevelClear();
  }

  /**
   * `TimeAttack.onLevelReady`: no level name; the last level's time, or the countdown on the
   * first level, with the game locked.
   */
  override onLevelReady(): void {
    super.onLevelReady();

    // `levelName.removeMovieClip()`; `FxManager` then sees no name (`_name` is null)
    this.fxMan.levelName?.removeMovieClip();
    this.fxMan.levelName = null;

    // The previous level's time
    if (this.world.currentId !== this.firstLevel) {
      this.displayLastTime();
    }

    if (this.world.currentId === this.firstLevel) {
      this.lock();
      this.display(this.formatTime(0));
      this.starter = Data.SECOND * 3.5;
      const mc = this.depthMan.attach('hammer_interf_starter', Data.DP_INTERF);
      mc._x = Data.DOC_WIDTH * 0.5;
      mc._y = Data.DOC_HEIGHT * 0.5;
      const field = mc.getText('field');
      if (field) field.text = '';
      this.mcStarter = mc;
      this.resetChrono();
    }
  }

  /** `TimeAttack.getChrono`: the chrono, in milliseconds. */
  getChrono(): number {
    return Math.floor(this.frameTimer - this.gameTimer);
  }

  /** `TimeAttack.display`: the chrono in the interface, once per player as the original does. */
  display(str: string): void {
    const n = this.countList(Data.PLAYER);
    for (let i = 0; i < n; i++) {
      this.hud.print(0, str);
      this.hud.print(1, str);
    }
  }

  /** `TimeAttack.displayLastTime`: the previous level's time slides in at the bottom left. */
  displayLastTime(): void {
    const t = this.times[this.times.length - 1];
    if (t !== undefined) {
      const mc = this.depthMan.attach('hammer_interf_time', Data.DP_INTERF);
      mc._x = 20;
      mc._y = Data.DOC_HEIGHT - 50;
      const field = mc.getClip('sub')?.getText('field');
      if (field) field.text = '+ ' + this.formatTime(t);
      FxManager.addGlow(mc, Data.DARK_COLORS[0], 2);
    }
  }

  /**
   * `TimeAttack.formatTime`: `MM" SS' mmm`. Like `Chrono.formatTime`, the original reads a Flash
   * `Date` in local time and takes one hour off, so it was right in France in winter (UTC+1):
   * it is computed here as in UTC+1 whatever the time zone.
   */
  formatTime(t: number): string {
    const d = new Date(t + 3600 * 1000);
    return (
      Data.leadingZeros(d.getUTCMinutes() + (d.getUTCHours() - 1) * 60, 2) +
      '" ' +
      Data.leadingZeros(d.getUTCSeconds(), 2) +
      "' " +
      Data.leadingZeros(d.getUTCMilliseconds(), 3)
    );
  }

  // ------------------------------------------------------------------ chrono

  resetChrono(): void {
    this.last = this.getChrono();
    this.fl_chronoStop = false;
    this.suspendTimer = null;
    this.gameTimer = this.frameTimer;
  }

  startChrono(): void {
    if (this.suspendTimer !== null) {
      const d = this.frameTimer - this.suspendTimer;
      this.gameTimer += d;
    }
    this.fl_chronoStop = false;
    this.suspendTimer = null;
  }

  stopChrono(): void {
    if (this.fl_chronoStop) {
      return;
    }
    this.fl_chronoStop = true;
    this.suspendTimer = this.frameTimer;
  }

  /** `TimeAttack.lock`: the chrono stops with the game. */
  override lock(): void {
    super.lock();
    this.stopChrono();
  }

  override unlock(): void {
    super.unlock();
    this.startChrono();
  }

  override switchDimensionById(id: number, lid: number, pid: number): void {
    this.stopChrono();
    super.switchDimensionById(id, lid, pid);
  }

  /** `TimeAttack.timeShift`: `n` seconds off the chrono, which never goes below 0. */
  timeShift(n: number): void {
    this.gameTimer = Math.trunc(Math.min(this.frameTimer, this.gameTimer + n * 1000));
  }

  /**
   * Port addition (G.3): the players can choose their devices during the countdown, which
   * locks the game; the countdown waits for them (`main`).
   */
  protected override canJoin(): boolean {
    return super.canJoin() || this.starter > 0;
  }

  /** `TimeAttack.main`: no hurry up, the countdown, the chrono and its minute alerts. */
  override main(): void {
    // No hurry up
    this.huTimer = 0;

    // The countdown (port addition: held while the players choose their devices)
    const mc = this.mcStarter;
    if (this.starter > 0 && mc && !this.join && !this.joinAsked) {
      const old = Math.ceil(this.starter / 32);
      this.starter -= Timer.tmod;
      const now = Math.ceil(this.starter / 32);
      mc._xscale *= 0.99;
      mc._yscale = mc._xscale;
      mc._alpha *= 0.95;
      if (old !== now) {
        const field = mc.getText('field');
        if (field) field.text = '' + now;
        mc._alpha = 100;
        mc._xscale = 70 + 120 - now * 40;
        mc._yscale = mc._xscale;
      }
      if (this.starter <= 0) {
        mc.removeMovieClip();
        this.mcStarter = null;
        this.fxMan.attachAlert(this.dataStore.getStatic(20));
        this.unlock();
        this.resetChrono();
      }
    }

    this.prevFrameTimer = this.frameTimer;
    this.frameTimer = this.manager.getTimer();
    super.main();

    if (!this.fl_chronoStop) {
      // The minute alerts
      if (Math.floor(this.getChrono() / 60000) !== Math.floor(this.last / 60000)) {
        const m = Math.floor(this.getChrono() / 60000);
        if (m > 0 && this.fl_alerts[m] !== true) {
          this.fl_alerts[m] = true;
          // "MINUTE" without an s for the first
          const alert = this.fxMan.attachAlert(m + ' ' + this.dataStore.getStatic(m > 1 ? 19 : 18));
          alert._y += 40;
        }
      }
      this.last = this.getChrono();

      // The interface
      if (!this.fl_lock && this.starter <= 0) {
        this.display(this.formatTime(this.getChrono()));
      }
    }
  }
}
