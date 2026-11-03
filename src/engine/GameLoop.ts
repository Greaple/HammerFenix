/**
 * Deterministic fixed-timestep game loop matching Motion Twin's `Timer.wantedFPS = 32`
 * (`Data.SECOND = 32` cycles per second, `tmod = 1.0` per fixed step).
 *
 * Also drives Flash MovieClip visual timelines at 40 Hz (`loader.xml` `fps="40"`).
 */
export class FixedGameLoop {
  static readonly LOGIC_HZ = 32;
  static readonly ANIM_HZ = 40;

  private rafId = 0;
  private running = false;
  private lastTimeMs = 0;
  private logicAccum = 0;
  private animAccum = 0;
  timeScale = 1.0;

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
    this.logicAccum = 0;
    this.animAccum = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  stepSingleFrame(): void {
    this.onLogicStep();
    this.onAnimStep();
  }

  private readonly tick = (nowMs: number) => {
    if (!this.running) return;
    const dtSec = Math.min(0.1, Math.max(0, (nowMs - this.lastTimeMs) / 1000)) * this.timeScale;
    this.lastTimeMs = nowMs;

    const logicDt = 1 / FixedGameLoop.LOGIC_HZ;
    const animDt = 1 / FixedGameLoop.ANIM_HZ;

    this.logicAccum += dtSec;
    this.animAccum += dtSec;

    let steps = 0;
    while (this.logicAccum >= logicDt && steps < 4) {
      this.onLogicStep();
      this.logicAccum -= logicDt;
      steps++;
    }

    let animSteps = 0;
    while (this.animAccum >= animDt && animSteps < 5) {
      this.onAnimStep();
      this.animAccum -= animDt;
      animSteps++;
    }

    this.onRender?.(this.logicAccum / logicDt);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
