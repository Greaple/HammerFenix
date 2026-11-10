import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { ItemsData, QuestDef } from '../src/game/data/types';
import { SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import type { BadEntity } from '../src/game/entity/Bad';
import { LevelWorld, type PortalData } from '../src/game/levels/LevelWorld';
import { decodeProfile, encodeProfile, MODE_OPTIONS, Profile } from '../src/game/Profile';
import { QuestEngine } from '../src/game/Quests';
import { createHeadlessSession } from './helpers/headless';

const DATA = join(__dirname, '../public/data');
const items: ItemsData = JSON.parse(readFileSync(join(DATA, 'items.json'), 'utf-8'));
const quests: QuestDef[] = JSON.parse(readFileSync(join(DATA, 'quests.json'), 'utf-8'));

/** A new game with `options`, stepped until its first level is ready. */
function start(s: GameSession, options: string, level = 1): void {
  s.setParameters(SYSTEM_FAMILIES, options);
  s.startGame(level, 1234);
  for (let i = 0; i < 40; i++) s.gameLoop.stepSingleFrame();
}

describe('game options (GameMode constructor)', () => {
  let s: GameSession;
  beforeAll(async () => {
    s = await createHeadlessSession();
  });

  it('sets the flags from $options at each new game', () => {
    start(s, 'mirror,nightmare,ninja,bombexpert');
    expect([s.game.fl_mirror, s.game.fl_nightmare, s.game.fl_ninja, s.game.fl_bombExpert]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(s.game.dimensions.every((w) => w.fl_mirror)).toBe(true);
    start(s, '');
    expect([s.game.fl_mirror, s.game.fl_nightmare, s.game.fl_ninja, s.game.fl_bombExpert]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(s.game.dimensions.some((w) => w.fl_mirror)).toBe(false);
  });

  it('mirror reads the levels flipped (SetManager.flip)', () => {
    start(s, '');
    const map = s.game.world.current.map.map((c) => c.slice());
    const px = s.game.world.current.playerX;
    start(s, 'mirror');
    const w = Data.LEVEL_WIDTH;
    for (let x = 0; x < w; x++) expect(s.game.world.current.map[x]).toEqual(map[w - x - 1]);
    expect(s.game.world.current.playerX).toBe(w - px - 1);
    // The player starts on the flipped case, not flipped twice
    expect(s.game.player!.cx).toBe(w - px - 1);
  });

  it('Tornade speeds the player up, more in nightmare', () => {
    start(s, '');
    expect(s.game.player!.speedFactor).toBe(1);
    start(s, 'boost');
    expect(s.game.player!.speedFactor).toBe(1.3);
    start(s, 'nightmare');
    expect(s.game.player!.speedFactor).toBe(1.3);
    start(s, 'nightmare,boost');
    expect(s.game.player!.speedFactor).toBe(1.6);
  });

  it('ninja picks one foe and its friends (GameMode.onBadsReady)', () => {
    const bads = () => s.game.getList(Data.BAD_CLEAR) as BadEntity[];
    const friends = () => bads().filter((b) => b.fl_ninFriend).length;
    start(s, '', 16);
    expect(bads().length).toBe(6);
    expect(bads().some((b) => b.fl_ninFoe || b.fl_ninFriend)).toBe(false);

    // Before level 20: one friend
    start(s, 'ninja', 16);
    expect(bads().filter((b) => b.fl_ninFoe).length).toBe(1);
    expect(friends()).toBe(1);
    expect(bads().some((b) => b.fl_ninFoe && b.fl_ninFriend)).toBe(false);
    // Nightmare: at least 2 friends, plus one
    start(s, 'ninja,nightmare', 16);
    expect(friends()).toBe(3);
    // From level 20: at least 2, one more every 10 levels after 20
    start(s, 'ninja', 20);
    expect(friends()).toBe(2);
  });
});

describe('SetManager.flipPortals', () => {
  it('reverses the portals of each row', () => {
    const world = Object.create(LevelWorld.prototype) as LevelWorld;
    const p = (cx: number, cy: number) => ({ cx, cy }) as PortalData;
    const a = p(2, 5);
    const b = p(15, 5);
    const c = p(4, 10);
    const d = p(1, 3);
    world.portalList = [a, b, c, d];
    world.flipPortals();
    expect(world.portalList).toEqual([d, b, a, c]);
  });
});

describe('menu options (profile)', () => {
  const profile = () => new Profile(new QuestEngine(quests, items), null);

  it('sends the ticked options that are unlocked, and Tornade once unlocked', () => {
    const p = profile();
    expect(p.optionsParam('solo')).toBe('');
    p.toggleOption('mirror'); // locked: no effect
    expect(p.data.chosen).toEqual([]);
    p.data.options.push('mirror', 'ninja', 'boost');
    expect(p.optionsParam('solo')).toBe('boost');
    p.toggleOption('ninja');
    p.toggleOption('mirror');
    expect(p.optionsParam('solo')).toBe('mirror,ninja,boost');
    p.toggleOption('ninja');
    expect(p.optionsParam('solo')).toBe('mirror,boost');
    // Tornade applies to every mode; the Adventure options do not
    expect(p.optionsParam('tutorial')).toBe('boost');
  });

  it('saves the ticked options with the profile', () => {
    const p = profile();
    p.data.options.push('nightmare');
    p.toggleOption('nightmare');
    expect(decodeProfile(encodeProfile(p.data))!.chosen).toEqual(['nightmare']);
  });

  it('offers every option an Adventure quest unlocks', () => {
    const given = quests.flatMap((q) =>
      q.actions.filter((a) => a.type === 'give' && a.attrs.option).map((a) => a.attrs.option),
    );
    for (const o of MODE_OPTIONS.solo) expect(given).toContain(o);
    expect(given).toContain(Data.OPT_BOOST);
  });
});
