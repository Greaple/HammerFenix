import type { Random } from './Random';

/**
 * Port of `RandomManager` (`class/hammer/RandomManager.mt`): weighted draws from registered
 * tables, where each table holds one weight per index (item rarity, extend letter odds).
 *
 * Skipped: `expand` (deprecated cache, its call is commented out in the original),
 * `evaluateChances` (debug traces only) and `drawSpecial` (empty).
 */
export class RandomManager {
  readonly bulks: number[][] = [];
  readonly sums: number[] = [];
  private readonly rand: Random;

  constructor(rand: Random) {
    this.rand = rand;
  }

  /** Adds a table. The array is kept, not copied, as in the original. */
  register(id: number, bulk: number[]): void {
    this.bulks[id] = bulk;
    this.computeSum(id);
  }

  /** Sums the weights of a table, replacing holes with 0. */
  computeSum(id: number): void {
    const bulk = this.bulks[id];
    this.sums[id] = 0;
    for (let i = 0; i < bulk.length; i++) {
      if (bulk[i] == null) {
        bulk[i] = 0;
      }
      this.sums[id] += bulk[i];
    }
  }

  /** Draws an index of the table, weighted by its values. Null if the table is empty. */
  draw(id: number): number | null {
    const tab = this.bulks[id];
    let i = 0;
    const target = this.rand.random(this.sums[id]);
    let sum = 0;
    let result: number | null = null;
    while (i < tab.length && result === null) {
      sum += tab[i];
      if (target < sum) {
        result = i;
      }
      i++;
    }

    if (result === null) {
      console.warn(`null draw in array ${id}`);
    }

    return result;
  }

  /** Stops an index from ever being drawn again (used by unique items such as hearts). */
  remove(rid: number, id: number): void {
    this.bulks[rid][id] = 0;
    this.computeSum(rid);
  }
}
