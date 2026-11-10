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
  disguise: 1 << 8,
  map: 1 << 9,
  sound: 1 << 10,
};

/** A run-length encoded list of input masks: `[mask, ticks]` pairs. */
export type InputRuns = [number, number][];

/**
 * A recorded game: where it starts, its seed, and the held actions of every logic tick.
 * `input` is player 1's masks (with the game's own keys: pause, music...), run-length encoded as
 * `[mask, ticks]` pairs.
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
  /**
   * `$detail` and `$shake` when 0 (they change the random draws); absent means on, as in the
   * replays recorded before the settings screen.
   */
  detail?: number;
  shake?: number;
  input: InputRuns;
  /**
   * The masks of players 2 and on, one list each, as long as `input` (G.2). Absent in a game
   * with one player.
   */
  otherInputs?: InputRuns[];
}

/** Collects each player's input mask, every logic tick. */
export class InputRecorder {
  /** The masks of each player, by pid. */
  private readonly tracks: InputRuns[] = [];
  private count = 0;

  /**
   * Adds a tick: each player's mask, by pid. A player who joins later had nothing held before;
   * one who is gone holds nothing.
   */
  push(masks: readonly number[]): void {
    while (this.tracks.length < masks.length) {
      this.tracks.push(this.count > 0 ? [[0, this.count]] : []);
    }
    this.tracks.forEach((runs, pid) => {
      const mask = masks[pid] ?? 0;
      const last = runs[runs.length - 1];
      if (last && last[0] === mask) last[1]++;
      else runs.push([mask, 1]);
    });
    this.count++;
  }

  get ticks(): number {
    return this.count;
  }

  toReplay(set: string, level: number, seed: number, families?: string, options?: string): Replay {
    const copy = (runs: InputRuns): InputRuns => runs.map(([m, n]) => [m, n]);
    const replay: Replay = {
      version: 1,
      set,
      level,
      seed,
      families,
      options,
      input: copy(this.tracks[0] ?? []),
    };
    if (this.tracks.length > 1) replay.otherInputs = this.tracks.slice(1).map(copy);
    return replay;
  }
}

/** Plays one player's masks back. */
class Track {
  private run = 0;
  private used = 0;

  constructor(private readonly input: readonly [number, number][]) {}

  get done(): boolean {
    return this.run >= this.input.length;
  }

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

/** Plays a replay's input masks back, one per player each logic tick. */
export class InputPlayer {
  private readonly tracks: Track[];
  readonly ticks: number;

  /** `input` is player 1's masks, `otherInputs` the other players' (`Replay`). */
  constructor(input: readonly [number, number][], otherInputs: readonly InputRuns[] = []) {
    this.tracks = [input, ...otherInputs].map((runs) => new Track(runs));
    this.ticks = input.reduce((n, [, count]) => n + count, 0);
  }

  /** The number of players the replay holds. */
  get players(): number {
    return this.tracks.length;
  }

  get done(): boolean {
    return this.tracks[0].done;
  }

  /** The next tick's masks, by pid; 0 (nothing held) once the replay is over. */
  next(): number[] {
    return this.tracks.map((t) => t.next());
  }
}
