import { runQueuedFrameActions } from './swf/SwfMovieClip';

/**
 * Deterministic fixed-timestep game loop matching Motion Twin's `Timer.wantedFPS = 32`
 * (`Data.SECOND = 32` cycles per second, `tmod = 1.0` per fixed step).
 *
 * Also drives Flash MovieClip visual timelines at 40 Hz (`loader.xml` `fps="40"`). Animation
 * steps are tied to logic ticks (5 per 4 ticks) rather than to wall-clock time, because some
 * logic reads clip frames: a replay must see the same interleaving as live play.
 */
export class FixedGameLoop {
  static readonly LOGIC_HZ = 32;
  static readonly ANIM_HZ = 40;

  private rafId = 0;
  private running = false;
  private lastTimeMs = 0;
  private logicAccum = 0;
  private logicTicks = 0;
  private animTicks = 0;
  private steps = 0;
  timeScale = 1.0;
  /**
   * This tick's `Timer.tmod` (bullet time, the dev key Shift): slows the game on top of
   * `timeScale`, since logic always steps by 1.
   */
  bulletScale = 1.0;
  /** `Timer.fps()`: logic ticks run per real second, measured over half a second. */
  fps: number = FixedGameLoop.LOGIC_HZ;
  /**
   * Frames the page drew per real second, measured with `fps`. Flash ran the game once per
   * drawn frame, so this is what `Timer.fps()` saw when the machine lagged (the lag manager).
   */
  frameRate: number = FixedGameLoop.ANIM_HZ;
  private fpsStartMs = 0;
  private fpsSteps = 0;
  private fpsFrames = 0;

  private readonly onLogicStep: () => void;
  private readonly onAnimStep: () => void;
  private readonly onRender?: (alpha: number) => void;

  constructor(opts: {
    onLogicStep: () => void;
    onAnimStep: () => void;
    onRender?: (alpha: number) => void;
  }) {
    this.onLogicStep = opts.onLogicStep;
    this.onAnimStep = opts.onAnimStep;
    this.onRender = opts.onRender;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = performance.now();
    this.fpsStartMs = this.lastTimeMs;
    this.fpsSteps = 0;
    this.fpsFrames = 0;
    this.logicAccum = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** True between `start()` and `stop()`. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Logic ticks run since the page opened. The game only changes on a tick (animation steps
   * are tied to them), so the page renders only when this moves.
   */
  get stepCount(): number {
    return this.steps;
  }

  /** Runs one logic tick, plus the animation steps that fall in it. */
  stepSingleFrame(): void {
    this.onLogicStep();
    runQueuedFrameActions();
    this.steps++;
    this.logicTicks++;
    const target = Math.floor((this.logicTicks * FixedGameLoop.ANIM_HZ) / FixedGameLoop.LOGIC_HZ);
    while (this.animTicks < target) {
      this.onAnimStep();
      runQueuedFrameActions();
      this.animTicks++;
    }
  }

  /** Restarts the logic/animation interleaving, so a new game always starts in the same phase. */
  resetPhase(): void {
    this.logicTicks = 0;
    this.animTicks = 0;
  }

  private readonly tick = (nowMs: number) => {
    if (!this.running) return;
    const dtSec =
      Math.min(0.1, Math.max(0, (nowMs - this.lastTimeMs) / 1000)) *
      this.timeScale *
      this.bulletScale;
    this.lastTimeMs = nowMs;

    const logicDt = 1 / FixedGameLoop.LOGIC_HZ;
    this.logicAccum += dtSec;

    let steps = 0;
    while (this.logicAccum >= logicDt && steps < 4) {
      this.stepSingleFrame();
      this.logicAccum -= logicDt;
      steps++;
    }
    this.fpsSteps += steps;
    this.fpsFrames++;
    if (nowMs - this.fpsStartMs >= 500) {
      this.fps = (this.fpsSteps * 1000) / (nowMs - this.fpsStartMs);
      this.frameRate = (this.fpsFrames * 1000) / (nowMs - this.fpsStartMs);
      this.fpsStartMs = nowMs;
      this.fpsSteps = 0;
      this.fpsFrames = 0;
    }

    this.onRender?.(this.logicAccum / logicDt);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
