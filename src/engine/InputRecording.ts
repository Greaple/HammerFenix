import type { ControlAction } from './Input';

/** Bit of each action in a tick's input mask. Never reorder: recordings depend on it. */
export const ACTION_BITS: Record<ControlAction, number> = {
  left: 1 << 0,
  right: 1 << 1,
  jump: 1 << 2,
  down: 1 << 3,
  attack: 1 << 4,
  pause: 1 << 5,
  music: 1 << 6,
  suicide: 1 << 7,
};

/**
 * A recorded game: where it starts, its seed, and the held actions of every logic tick.
 * `input` is run-length encoded as `[mask, ticks]` pairs.
 */
export interface Replay {
  version: 1;
  set: string;
  level: number;
  seed: number;
  /**
   * `$families` and `$options` of the game (`GameParameters`). Absent in the first replays,
   * which were recorded with families 0, 1, 2, 1000, 1001, 1002; a replay without them plays
   * with the system families.
   */
  families?: string;
  options?: string;
  input: [number, number][];
}

/** Collects one input mask per logic tick. */
export class InputRecorder {
  private readonly runs: [number, number][] = [];

  push(mask: number): void {
    const last = this.runs[this.runs.length - 1];
    if (last && last[0] === mask) last[1]++;
    else this.runs.push([mask, 1]);
  }

  get ticks(): number {
    return this.runs.reduce((n, [, count]) => n + count, 0);
  }

  toReplay(set: string, level: number, seed: number, families?: string, options?: string): Replay {
    return {
      version: 1,
      set,
      level,
      seed,
      families,
      options,
      input: this.runs.map(([m, n]) => [m, n]),
    };
  }
}

/** Plays a replay's input masks back, one per logic tick. */
export class InputPlayer {
  private run = 0;
  private used = 0;

  constructor(private readonly input: readonly [number, number][]) {}

  get done(): boolean {
    return this.run >= this.input.length;
  }

  get ticks(): number {
    return this.input.reduce((n, [, count]) => n + count, 0);
  }

  /** The next tick's mask, or 0 (nothing held) once the replay is over. */
  next(): number {
    if (this.done) return 0;
    const [mask, count] = this.input[this.run];
    if (++this.used >= count) {
      this.run++;
      this.used = 0;
    }
    return mask;
  }
}
