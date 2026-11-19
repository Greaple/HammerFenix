import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromCloudDoc, toCloudDoc } from '../src/cloud/CloudDoc';
import {
  type CloudSnapshot,
  isNewProfile,
  mergeProfiles,
  mergeSnapshots,
} from '../src/cloud/merge';
import { DEFAULT_BINDINGS } from '../src/engine/Bindings';
import type { ItemsData, QuestDef } from '../src/game/data/types';
import { DEFAULT_SETTINGS } from '../src/game/GameParameters';
import { encodeProfile } from '../src/game/Profile';
import { newProfile, type ProfileData, QuestEngine } from '../src/game/Quests';

const DATA = join(__dirname, '../public/data');
const items: ItemsData = JSON.parse(readFileSync(join(DATA, 'items.json'), 'utf-8'));
const quests: QuestDef[] = JSON.parse(readFileSync(join(DATA, 'quests.json'), 'utf-8'));
const engine = new QuestEngine(quests, items);

/** The items quests ask for, so random games complete some. */
const wanted = [
  ...new Set(engine.quests.flatMap((q) => engine.requirements(q.id).map((r) => r.item))),
];

/** A small seeded generator (mulberry32), so a failure can be replayed. */
function rng(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/** A profile after `games` random games, as `Profile.recordGame` builds it. */
function played(seed: number, games: number): ProfileData {
  const r = rng(seed);
  const p = newProfile();
  for (let g = 0; g < games; g++) {
    const picks: [number, number][] = [];
    for (let k = r(12); k > 0; k--) picks.push([wanted[r(wanted.length)], 1 + r(30)]);
    picks.sort((x, y) => x[0] - y[0]);
    engine.addGame(p, picks);
  }
  return p;
}

const derived = (p: ProfileData) => ({
  quests: p.quests,
  families: [...p.families].sort((a, b) => a - b),
  options: [...p.options].sort(),
  modes: [...p.modes].sort(),
  tokens: p.tokens,
  bank: p.bank,
});

function snapshot(profile: ProfileData, over: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return {
    profile,
    save: { highScore: 0, highestLevel: {}, preferredLang: 'fr', muted: false },
    settings: { ...DEFAULT_SETTINGS },
    controls: DEFAULT_BINDINGS,
    settingsAt: 0,
    ...over,
  };
}

describe('QuestEngine.replay', () => {
  it('rebuilds what the quests gave, for any history', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = played(seed, 1 + (seed % 40));
      const q = newProfile();
      engine.replay(q, p.quests);
      expect(derived(q), `seed ${seed}`).toEqual(derived(p));
    }
  });

  it('completes some quests in the test histories', () => {
    expect(played(7, 40).quests.length).toBeGreaterThan(5);
  });
});

describe('mergeProfiles', () => {
  it('keeps a side as it is when the other is new or the same', () => {
    const p = played(3, 20);
    expect(mergeProfiles(p, newProfile(), engine)).toBe(p);
    expect(mergeProfiles(newProfile(), p, engine)).toBe(p);
    const copy = structuredClone(p);
    expect(mergeProfiles(p, copy, engine)).toBe(p);
    expect(isNewProfile(newProfile())).toBe(true);
    expect(isNewProfile(p)).toBe(false);
  });

  it('keeps the highest item counts and games, and the lowest times', () => {
    const a = newProfile();
    const b = newProfile();
    a.items[2] = 5;
    b.items[2] = 8;
    b.items[1100] = 3;
    a.games = 4;
    b.games = 2;
    a.times = { timeattack: [90000] };
    b.times = { timeattack: [80000], multitime: [100000] };
    const m = mergeProfiles(a, b, engine);
    expect(m.items[2]).toBe(8);
    expect(m.items[1100]).toBe(3);
    expect(m.games).toBe(4);
    expect(m.times).toEqual({ timeattack: [80000], multitime: [100000] });
  });

  it('has every quest of both sides, and those their items complete together', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const a = played(seed, 10 + (seed % 20));
      const b = played(seed + 1000, 5 + (seed % 30));
      const m = mergeProfiles(a, b, engine);
      for (const id of [...a.quests, ...b.quests]) expect(m.quests).toContain(id);
      expect(engine.check(structuredClone(m)), `seed ${seed}`).toEqual([]);
    }
  });

  it('keeps the families quests took away', () => {
    // A quest that removes a family a new player has
    const q = engine.quests.find((d) =>
      d.actions.some((x) => x.type === 'remove' && 'family' in x.attrs),
    )!;
    const removed = parseInt(q.actions.find((x) => x.type === 'remove')!.attrs.family, 10);
    const a = newProfile();
    a.games = 1;
    a.items[1] = 1;
    engine.replay(a, [q.id]);
    expect(a.families).not.toContain(removed);
    const b = played(11, 3);
    const m = mergeProfiles(a, b, engine);
    if (
      !b.quests.some((id) =>
        engine
          .get(id)!
          .actions.some((x) => x.type === 'give' && x.attrs.family === String(removed)),
      )
    )
      expect(m.families).not.toContain(removed);
  });

  it('is idempotent and gives the same progress either way', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const a = played(seed, 15);
      const b = played(seed + 500, 25);
      const m = mergeProfiles(a, b, engine);
      expect(encodeProfile(mergeProfiles(a, m, engine))).toBe(encodeProfile(m));
      expect(encodeProfile(mergeProfiles(m, b, engine))).toBe(encodeProfile(m));
      const n = mergeProfiles(b, a, engine);
      expect(n.items).toEqual(m.items);
      expect(new Set(n.quests)).toEqual(new Set(m.quests));
    }
  });
});

describe('mergeSnapshots', () => {
  it('uploads this device as it is when the cloud has nothing', () => {
    const s = snapshot(played(1, 5));
    expect(mergeSnapshots(s, null, engine)).toBe(s);
  });

  it('takes the preferences changed last, and the best scores', () => {
    const local = snapshot(newProfile(), {
      save: { highScore: 500, highestLevel: { adventure: 12 }, preferredLang: 'en', muted: true },
      settings: { ...DEFAULT_SETTINGS, volume: 30 },
      settingsAt: 2000,
    });
    const remote = snapshot(newProfile(), {
      save: {
        highScore: 900,
        highestLevel: { adventure: 8, deepnight: 3 },
        preferredLang: 'es',
        muted: false,
      },
      settings: { ...DEFAULT_SETTINGS, volume: 70 },
      settingsAt: 1000,
    });
    const m = mergeSnapshots(local, remote, engine);
    expect(m.save).toEqual({
      highScore: 900,
      highestLevel: { adventure: 12, deepnight: 3 },
      preferredLang: 'en',
      muted: true,
    });
    expect(m.settings.volume).toBe(30);
    expect(m.settingsAt).toBe(2000);
    // A device that never changed them takes the cloud's
    const fresh = mergeSnapshots({ ...local, settingsAt: 0 }, remote, engine);
    expect(fresh.settings.volume).toBe(70);
    expect(fresh.save.preferredLang).toBe('es');
  });
});

describe('the cloud document', () => {
  it('reads back what it wrote', () => {
    const s = snapshot(played(5, 12), {
      save: { highScore: 1234, highestLevel: { adventure: 20 }, preferredLang: 'en', muted: true },
      settings: { ...DEFAULT_SETTINGS, volume: 40, shake: 0 },
      settingsAt: 99,
    });
    const back = fromCloudDoc(toCloudDoc(s, null), 'fr')!;
    expect(encodeProfile(back.profile)).toBe(encodeProfile(s.profile));
    expect(back.save).toEqual(s.save);
    expect(back.settings).toEqual(s.settings);
    expect(back.controls).toEqual(s.controls);
    expect(back.settingsAt).toBe(99);
  });

  it('checks every field read from the cloud', () => {
    expect(fromCloudDoc(null, 'fr')).toBeNull();
    expect(fromCloudDoc({ v: 2 }, 'fr')).toBeNull();
    const back = fromCloudDoc(
      {
        v: 1,
        profile: 'damaged',
        save: { highScore: -5, muted: 'yes' },
        settings: { volume: 900 },
        controls: '{',
      },
      'fr',
    )!;
    expect(isNewProfile(back.profile)).toBe(true);
    expect(back.save).toEqual({
      highScore: 0,
      highestLevel: {},
      preferredLang: 'fr',
      muted: false,
    });
    expect(back.settings.volume).toBe(100);
    expect(back.controls).toEqual(DEFAULT_BINDINGS);
    expect(back.settingsAt).toBe(0);
  });
});
