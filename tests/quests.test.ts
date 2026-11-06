import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { ItemsData, QuestDef } from '../src/game/data/types';
import { GameParameters, SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameResult } from '../src/game/Loader';
import {
  decodeProfile,
  encodeProfile,
  Profile,
  PROFILE_KEY,
  type ProfileStorage,
} from '../src/game/Profile';
import { newProfile, QuestEngine, START_FAMILIES } from '../src/game/Quests';

const DATA = join(__dirname, '../public/data');
const items: ItemsData = JSON.parse(readFileSync(join(DATA, 'items.json'), 'utf-8'));
const quests: QuestDef[] = JSON.parse(readFileSync(join(DATA, 'quests.json'), 'utf-8'));
const engine = new QuestEngine(quests, items);

/** Families the game itself reads (`Player`, `PlayerController`, `GameMode`): no items. */
const isSystemFamily = (id: number) => (id >= 100 && id <= 113) || (id >= 5000 && id < 5100);
const MODES = ['solo', 'tutorial', 'timeattack', 'multitime', 'multicoop', 'soccer', 'bossrush'];

function memoryStorage(): ProfileStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function gameOver(picks: Record<number, number>): GameResult {
  const item2: number[] = [];
  for (const [id, n] of Object.entries(picks)) item2[Number(id)] = n;
  return {
    kind: 'gameOver',
    score: 0,
    runId: null,
    stats: { reachedLevel: 1, item2, data: [] },
    uniqueItems: 0,
  };
}

describe('quests.xml data', () => {
  const itemIds = new Set(engine.itemIds);
  const familyIds = new Set([...items.special, ...items.score].map((f) => f.id));
  const options = new Set<unknown>(
    Object.entries(Data)
      .filter(([k]) => k.startsWith('OPT_'))
      .map(([, v]) => v),
  );

  it('has 76 quests', () => {
    expect(quests.map((q) => q.id)).toEqual([...Array(76).keys()]);
  });

  it('only names items, families, options and modes that exist', () => {
    for (const q of quests) {
      for (const a of q.actions) {
        const { item, family, option, mode } = a.attrs;
        if (item !== undefined) expect(itemIds.has(Number(item)), `quest ${q.id}`).toBe(true);
        if (family !== undefined) {
          const f = Number(family);
          expect(familyIds.has(f) || isSystemFamily(f), `quest ${q.id}`).toBe(true);
        }
        if (option !== undefined) expect(options.has(option), `quest ${q.id}`).toBe(true);
        if (mode !== undefined) expect(MODES, `quest ${q.id}`).toContain(mode);
      }
    }
  });

  it('handles every reward type', () => {
    for (const q of quests) {
      for (const a of q.actions) {
        expect(engine.apply(newProfile(), a), `quest ${q.id} ${a.type}`).toBe(true);
      }
    }
  });

  it('starts with families that exist', () => {
    for (const f of START_FAMILIES) expect(familyIds.has(f)).toBe(true);
    expect(new GameParameters(SYSTEM_FAMILIES, '').scoreItemFamilies).toEqual([1000]);
  });
});

describe('QuestEngine', () => {
  it('adds item counts up over games', () => {
    const p = newProfile();
    // Persévérance (5): 5 golden Igors
    expect(engine.addGame(p, [[36, 3]])).toEqual([]);
    expect(engine.status(p, 5)).toBe('progress');
    expect(engine.addGame(p, [[36, 2]])).toEqual([5]);
    expect(engine.status(p, 5)).toBe('done');
    expect(p.families).toContain(105);
    expect(p.games).toBe(2);
    // Done once
    expect(engine.addGame(p, [[36, 5]])).toEqual([]);
    expect(p.quests).toEqual([5]);
  });

  it('applies give and remove in order', () => {
    const p = newProfile();
    p.families.push(5); // given by quest 13
    // Les constellations (0): the 12 zodiac signs
    const signs: [number, number][] = [...Array(12).keys()].map((i) => [40 + i, 1]);
    expect(engine.addGame(p, signs)).toEqual([0]);
    expect(p.families).toContain(100);
    expect(p.families).toContain(6);
    expect(p.families).not.toContain(5);
  });

  it('gives tokens, bank, options and modes', () => {
    const p = newProfile();
    engine.addGame(p, [
      [109, 1],
      [10, 5],
      [1236, 100],
      [1219, 1],
    ]);
    expect(p.quests).toEqual(expect.arrayContaining([32, 35, 63, 73]));
    expect(p.tokens).toBe(5);
    expect(p.bank).toBe(25);
    expect(p.options).toEqual(expect.arrayContaining(['mirror', 'set_ta_0']));
    expect(p.modes).toContain('timeattack');
    expect(p.families).not.toContain(18);
  });

  it('puts an item in the fridge after its unlock count (10 by default)', () => {
    const p = newProfile();
    engine.addGame(p, [
      [103, 1],
      [0, 9],
    ]);
    expect(engine.inFridge(p, 103)).toBe(true);
    expect(engine.inFridge(p, 0)).toBe(false);
    engine.addGame(p, [[0, 1]]);
    expect(engine.inFridge(p, 0)).toBe(true);
  });

  it('marks a quest in progress once one of its items is found', () => {
    const p = newProfile();
    expect(engine.status(p, 6)).toBe('none');
    engine.addGame(p, [[1003, 1]]);
    expect(engine.status(p, 6)).toBe('progress');
  });
});

describe('Profile', () => {
  it('records a game, saves it and reads it back', () => {
    const storage = memoryStorage();
    const profile = new Profile(engine, storage);
    expect(profile.data.families).toEqual([...START_FAMILIES]);
    const rec = profile.recordGame(gameOver({ 103: 1, 36: 5, 1000: 3 }));
    expect(rec.quests).toEqual([2, 5]);
    expect(rec.fridge).toEqual([103]);
    expect(storage.map.has(PROFILE_KEY)).toBe(true);

    const again = new Profile(engine, storage);
    expect(again.data).toEqual(profile.data);
    expect(again.data.items[1000]).toBe(3);
    expect(again.familiesParam).toContain('102');
    expect(again.familiesParam).not.toContain(',7,');
  });

  it('starts a new profile when the save is damaged', () => {
    const storage = memoryStorage();
    storage.setItem(PROFILE_KEY, 'not a profile');
    expect(new Profile(engine, storage).data).toEqual(newProfile());
    const raw = encodeProfile(newProfile());
    expect(decodeProfile(raw.slice(0, -1) + (raw.endsWith('a') ? 'b' : 'a'))).toBeNull();
  });

  it('works without storage', () => {
    const profile = new Profile(engine, null);
    profile.recordGame(gameOver({ 36: 1 }));
    expect(profile.data.items[36]).toBe(1);
  });
});
