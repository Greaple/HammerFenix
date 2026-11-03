import { describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { Random } from '../src/game/Random';
import { RandomManager } from '../src/game/RandomManager';

describe('Random', () => {
  it('replays the same sequence from the same seed', () => {
    const a = new Random(1234);
    const b = new Random(1234);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);

    a.reseed(1234);
    expect(Array.from({ length: 100 }, () => a.next())).toEqual(seqA);
  });

  it('gives different sequences for different seeds', () => {
    const a = new Random(1);
    const b = new Random(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('random(n) returns integers in [0, n) like Std.random', () => {
    const r = new Random(42);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.random(7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
    expect(r.random(0)).toBe(0);
  });

  it('next() stays in [0, 1)', () => {
    const r = new Random(7);
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('RandomManager', () => {
  it('fills holes with 0 and sums weights', () => {
    const m = new RandomManager(new Random(1));
    const bulk: number[] = [];
    bulk[2] = 10;
    bulk[5] = 30;
    m.register(0, bulk);
    expect(m.bulks[0]).toEqual([0, 0, 10, 0, 0, 30]);
    expect(m.sums[0]).toBe(40);
  });

  it('only draws indexes with a weight, in proportion to it', () => {
    const m = new RandomManager(new Random(99));
    const bulk: number[] = [];
    bulk[2] = 10;
    bulk[5] = 30;
    m.register(0, bulk);
    const counts = new Map<number, number>();
    for (let i = 0; i < 4000; i++) {
      const v = m.draw(0)!;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([2, 5]);
    const ratio = counts.get(5)! / counts.get(2)!;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });

  it('never draws a removed index again', () => {
    const m = new RandomManager(new Random(3));
    m.register(Data.RAND_ITEMS_ID, [5, 5, 5]);
    m.remove(Data.RAND_ITEMS_ID, 1);
    expect(m.sums[Data.RAND_ITEMS_ID]).toBe(10);
    for (let i = 0; i < 500; i++) {
      expect(m.draw(Data.RAND_ITEMS_ID)).not.toBe(1);
    }
  });

  it('returns null for an empty table', () => {
    const m = new RandomManager(new Random(3));
    m.register(0, []);
    const warn = console.warn;
    console.warn = () => {};
    expect(m.draw(0)).toBeNull();
    console.warn = warn;
  });
});
