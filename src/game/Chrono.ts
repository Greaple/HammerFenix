import { Data } from './Data';

/** `Std.getTimer()`: milliseconds of real time, as an integer. */
export const realTimer = (): number => Math.floor(performance.now());

/**
 * Port of `Chrono` (`class/hammer/Chrono.mt`): a stopwatch in real time (`Std.getTimer`), read
 * once per frame by `update()`. `GameMode` stops it while the game is locked (level scrolls,
 * pause). The clock can be swapped so tests can drive it.
 *
 * `formatTime` builds a Flash `Date` in local time and removes one hour, so it was written for
 * France in winter (UTC+1). It is computed here as in UTC+1 whatever the browser's time zone.
 */
export class Chrono {
  gameTimer: number;
  suspendTimer: number | null;
  haltedTimer: number | null;
  fl_stop = false;
  fl_init = false;

  /** Time of the current frame. */
  frameTimer: number;
  prevFrameTimer = 0;

  private readonly getTimer: () => number;

  constructor(getTimer: () => number = realTimer) {
    this.getTimer = getTimer;
    this.suspendTimer = null;
    this.frameTimer = getTimer();
    this.gameTimer = this.frameTimer;
    this.haltedTimer = this.get();

    this.reset();
    this.fl_stop = true;
    this.fl_init = false;
  }

  /** Minutes, seconds and milliseconds: `MM" SS' mmm`. */
  formatTime(t: number): string {
    const d = Chrono.franceDate(t);
    return (
      Data.leadingZeros(d.getUTCMinutes() + (d.getUTCHours() - 1) * 60, 2) +
      '" ' +
      Data.leadingZeros(d.getUTCSeconds(), 2) +
      "' " +
      Data.leadingZeros(d.getUTCMilliseconds(), 3)
    );
  }

  /** Minutes and rounded seconds: `MM" SS` (the original can show 60 seconds). */
  formatTimeShort(t: number): string {
    const d = Chrono.franceDate(t);
    let arrond = 0;
    if (d.getUTCMilliseconds() >= 500) {
      arrond = 1;
    }
    return (
      Data.leadingZeros(d.getUTCMinutes() + (d.getUTCHours() - 1) * 60, 2) +
      '" ' +
      Data.leadingZeros(d.getUTCSeconds() + arrond, 2)
    );
  }

  /** A date read as in UTC+1 through its `getUTC*` fields. */
  private static franceDate(t: number): Date {
    return new Date(t + 3600 * 1000);
  }

  /** Current value, in milliseconds. */
  get(): number {
    if (this.fl_stop) {
      return this.haltedTimer as number;
    }
    return Math.floor(this.frameTimer - this.gameTimer);
  }

  getStr(): string {
    return this.formatTime(this.get());
  }

  getStrShort(): string {
    return this.formatTimeShort(this.get());
  }

  reset(): void {
    this.fl_init = true;
    this.fl_stop = false;
    this.suspendTimer = null;
    this.gameTimer = this.frameTimer;
  }

  start(): void {
    if (this.suspendTimer !== null) {
      const d = this.frameTimer - this.suspendTimer;
      this.gameTimer += d;
    }
    this.haltedTimer = null;
    this.fl_stop = false;
    this.suspendTimer = null;
  }

  stop(): void {
    if (this.fl_stop) {
      return;
    }
    this.haltedTimer = this.get();
    this.fl_stop = true;
    this.suspendTimer = this.frameTimer;
  }

  /** Takes `n` seconds off the chrono, without going below 0. */
  timeShift(n: number): void {
    this.gameTimer = Math.trunc(Math.min(this.frameTimer, this.gameTimer + n * 1000));
  }

  update(): void {
    this.prevFrameTimer = this.frameTimer;
    this.frameTimer = this.getTimer();
  }
}
