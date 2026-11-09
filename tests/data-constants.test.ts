import { describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { readOriginalData } from './helpers/originalData';

describe('Data constants', () => {
  const original = readOriginalData();

  it('reads the constants of Data.mt', () => {
    // Spot values that need the counters and earlier constants.
    expect(original.get('DP_SOUNDS')).toBe(18);
    expect(original.get('ACTION_MOVE')).toBe(19);
    expect(original.get('RAND_SCORES_ID')).toBe(25);
    expect(original.get('SPEAR')).toBe(1 << 20);
    expect(original.get('FL_TELEPORTER')).toBe(1 << 12);
    expect(original.get('STAT_DEATH')).toBe(8);
    expect(original.get('OPT_MIRROR')).toBe('mirror');
    expect(original.get('RARITY')).toEqual([0, 2000, 1000, 300, 100, 10, 1, 60]);
    expect(original.size).toBeGreaterThan(360);
  });

  it('has every constant of Data.mt, with its value', () => {
    const port = Data as unknown as Record<string, unknown>;
    const missing = [...original.keys()].filter((k) => !(k in port));
    expect(missing).toEqual([]);
    for (const [name, value] of original) {
      expect({ name, value: port[name] }).toEqual({ name, value });
    }
  });
});
