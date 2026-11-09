/**
 * Dimension spot checks (roadmap 2B.6, docs/LEVELS.md) that can't be compared in Ruffle: hiko
 * (no portal leads there in the original) and the script blocks that only run with a game
 * option (`ScriptEngine.isVerified`: `night`, `mirror`, `ninja`, `multi`). The engine's code
 * for them matches the original line by line; these tests pin that each one runs.
 */
import { describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

function stepper(s: GameSession) {
  return (n: number) => {
    for (let i = 0; i < n; i++) s.gameLoop.stepSingleFrame();
  };
}

/** A new game with `options`, entered into a dimension by the village door, then level `lid`. */
async function deepnight(lid: number, options = ''): Promise<GameSession> {
  const s = await createHeadlessSession();
  const step = stepper(s);
  s.setParameters(SYSTEM_FAMILIES, options);
  s.initGame(0, 1234);
  step(40);
  s.usePortal(0, null);
  step(150);
  expect(s.world.set.name).toBe('deepnight');
  s.forcedGoto(lid);
  step(60);
  expect(s.world.currentId).toBe(lid);
  return s;
}

const map = (s: GameSession) => s.world.current.map.map((col) => col.join('')).join('|');

describe('option blocks', () => {
  it('night block of deepnight 185 (inside an explosion trigger) breaks the statue only in nightmare', async () => {
    const off = await deepnight(185);
    const on = await deepnight(185, 'nightmare');
    for (const s of [off, on]) {
      // A bomb on the statue at (11, 22)
      s.scriptRunner!.onExplode(Data.CASE_WIDTH * 11.5, Data.CASE_HEIGHT * 22, 50);
      stepper(s)(5);
    }
    for (const x of [11, 12]) {
      expect(off.world.current.map[x][22]).toBeGreaterThan(0);
      expect(on.world.current.map[x][22]).toBe(0);
    }
  });

  it('ninja block of deepnight 141 fills row 21 only in ninja', async () => {
    const off = await deepnight(141);
    const on = await deepnight(141, 'ninja');
    const row = (s: GameSession) => s.world.current.map.map((col) => col[21]);
    expect(row(off).every((v) => v > 0)).toBe(false);
    expect(row(on).every((v) => v > 0)).toBe(true);
  });

  it('mirror block of deepnight 134 moves tiles at its timer only in mirror', async () => {
    const off = await deepnight(134);
    const on = await deepnight(134, 'mirror');
    const before = [map(off), map(on)];
    stepper(off)(100);
    stepper(on)(100);
    expect(map(off)).toBe(before[0]);
    expect(map(on)).not.toBe(before[1]);
  });

  it('multi block of deepnight 125 (item 225 in place of 219) stays off in solo', async () => {
    const s = await deepnight(125);
    stepper(s)(40);
    const ids = s
      .getList(Data.ITEM)
      .filter((i) => i.scriptId === 666)
      .map((i) => (i as unknown as { id: number }).id);
    expect(ids).toEqual([219]);
  });
});

describe('ayame', () => {
  it('19: clearing the level lays the item line, a bomb at (19, 2) opens the way and the portal', async () => {
    const s = await createHeadlessSession();
    const step = stepper(s);
    s.initGame(0, 1234);
    step(40);
    s.switchDimensionById(3, 19, -1);
    step(120);
    expect([s.world.set.name, s.world.currentId]).toEqual(['ayame', 19]);
    const m = s.world.current.map;
    expect(m[19][3]).toBeGreaterThan(0);
    expect(m[14][14]).toBe(0);

    // Every bad killed: the `end` trigger drops an item every 10 cycles, from x 17 to 2 on row 1
    s.destroyList(Data.BAD);
    step(2);
    s.checkLevelClear();
    const seen = new Map<object, number>();
    for (let i = 0; i < 32 * 7; i++) {
      step(1);
      for (const it of s.getList(Data.ITEM).filter((i) => i.constructor.name === 'ScoreItem'))
        if (!seen.has(it)) seen.set(it, it.cx);
    }
    expect([...seen.values()]).toEqual(Array.from({ length: 16 }, (_, k) => 17 - k));

    s.scriptRunner!.onExplode(Data.CASE_WIDTH * 19.5, Data.CASE_HEIGHT * 2, 50);
    step(5);
    expect(m[19][3]).toBe(0);
    expect(m[14][14]).toBeGreaterThan(0);
    expect((s as unknown as { portalMcList: unknown[] }).portalMcList[0]).toBeTruthy();
  });
});

describe('hiko', () => {
  it('0: the trigger at (17, 21) spawns 10 Citrons, the one at (2, 23) kills them (code trigger 11)', async () => {
    const s = await createHeadlessSession();
    const step = stepper(s);
    s.initGame(0, 1234);
    step(40);
    s.switchDimensionById(2, 0, -1);
    step(120);
    expect(s.world.set.name).toBe('hiko');
    const citrons = () =>
      s
        .getList(Data.BAD)
        .filter((b) => (b as unknown as { badId: number }).badId === Data.BAD_CITRON).length;
    const p = s.player!;
    p.moveToCase(12, 22);
    step(10);
    p.moveToCase(17, 21);
    step(10);
    expect(citrons()).toBe(10);
    p.moveToCase(2, 23);
    step(10);
    expect(citrons()).toBe(0);
    expect(s.getList(Data.BAD).length).toBe(5); // the Spears stay
  });

  it('4: the darkness flickers by script (e_darkness 0 and 100)', async () => {
    const s = await createHeadlessSession();
    const step = stepper(s);
    s.initGame(0, 1234);
    step(40);
    s.switchDimensionById(2, 0, -1);
    step(120);
    s.forcedGoto(4);
    const seen = new Set<number | null>();
    for (let i = 0; i < 300; i++) {
      step(1);
      seen.add(s.forcedDarkness);
    }
    expect(s.world.currentId).toBe(4);
    expect(seen).toContain(0);
    expect(seen).toContain(100);
  });
});
