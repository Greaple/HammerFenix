/**
 * Seeded stand-in for the original's two random sources: `Std.random(n)` and `Math.random()`.
 *
 * Flash's generator could not be seeded, so the sequence will never match the original's. What
 * matters is that the same seed and the same inputs replay the same game.
 * The generator is mulberry32 (32-bit state, fast, good enough for gameplay).
 */
export class Random {
  private state = 0;

  constructor(seed = Random.makeSeed()) {
    this.reseed(seed);
  }

  /** A fresh seed for a new, non-replayed game. */
  static makeSeed(): number {
    return (Math.random() * 0x100000000) >>> 0;
  }

  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Port of `Math.random()`: a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  /** Port of `Std.random(n)`: an integer in [0, n). Returns 0 when n <= 0, like Flash's `random()`. */
  random(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n);
  }
}
