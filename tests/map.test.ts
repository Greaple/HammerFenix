import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

/** Roadmap 2C.4: the world map (`GameMode.onMap`) and its events (`registerMapEvent`). */

let s: GameSession;

beforeAll(async () => {
  s = await createHeadlessSession();
  s.setParameters(SYSTEM_FAMILIES, '');
});

const step = (n = 1) => {
  for (let i = 0; i < n; i++) s.gameLoop.stepSingleFrame();
};

/** Steps until the game unlocks (level parsed and shown). */
function ready(max = 300): void {
  for (let i = 0; i < max && s.game.fl_lock; i++) step();
  expect(s.game.fl_lock).toBe(false);
}

/** Clears the level of its enemies, as `portals.test.ts` does, and waits out the knock. */
function clear(): void {
  for (let i = 0; i < 60 && !(i > 2 && s.game.fl_clear); i++) {
    for (const b of s.game.getBads()) b.destroy();
    step();
  }
  for (let i = 0; i < 100 && s.game.player!.fl_knock; i++) step();
}

/** A new game at main-world level `lid`, cleared of its enemies. */
function start(lid: number): void {
  s.startGame(lid, 1234);
  ready();
  clear();
}

/** Enters portal field `pid` of the current level and steps until the level changes. */
function takePortal(pid: number): void {
  const from = `${s.game.currentDim}:${s.game.world.currentId}`;
  const field = s.game.world.portalList[pid];
  s.game.player!.moveToCase(field.cx, field.cy);
  (s.game.player as unknown as { infix(): void }).infix();
  for (let i = 0; i < 300 && `${s.game.currentDim}:${s.game.world.currentId}` === from; i++) step();
  ready();
}

function press(action: 'map' | 'pause'): void {
  s.input.setTouch(action, true);
  step();
  s.input.setTouch(action, false);
  step();
}

const travels = () => s.game.mapTravels.map((e) => [e.lid, e.eid, e.misc]);
const events = () => s.game.mapEvents.map((e) => [e.lid, e.eid, e.misc]);

describe('map events (GameMode.registerMapEvent)', () => {
  it('a portal records its exit with the target level name, and only in the main world', () => {
    start(33);
    expect(travels()).toEqual([]);
    takePortal(0);
    expect(s.game.currentDim).toBe(1);
    const name = s.dataStore.getLevelName(1, 60);
    expect(name).toBeTruthy();
    const side = (s.game as unknown as { fl_rightPortal: boolean }).fl_rightPortal
      ? Data.EVENT_EXIT_RIGHT
      : Data.EVENT_EXIT_LEFT;
    expect(travels()).toEqual([[33, side, `34. ${name}`]]);

    // Back from deepnight: its exit is not recorded (not the main world), the return is. The
    // original's filter for return trips reads mapEvents, where travels never go.
    clear();
    takePortal(0);
    expect(s.game.currentDim).toBe(0);
    expect(s.game.world.currentId).toBe(33);
    const pt = s.game.world.portalList[0];
    const back = pt.cx >= Data.LEVEL_WIDTH / 2 ? Data.EVENT_BACK_RIGHT : Data.EVENT_BACK_LEFT;
    expect(travels()).toEqual([
      [33, side, `34. ${name}`],
      [33, back, null],
    ]);
  });

  it('leaves out returns and repeated exits on the same side, keeps the others', () => {
    start(5);
    s.game.registerMapEvent(Data.EVENT_EXIT_RIGHT, 'a');
    s.game.registerMapEvent(Data.EVENT_EXIT_RIGHT, 'b');
    s.game.registerMapEvent(Data.EVENT_BACK_RIGHT, null);
    s.game.registerMapEvent(Data.EVENT_BACK_LEFT, null);
    expect(travels()).toEqual([
      [5, Data.EVENT_EXIT_RIGHT, 'a'],
      [5, Data.EVENT_EXIT_RIGHT, 'b'],
      [5, Data.EVENT_BACK_RIGHT, null],
      [5, Data.EVENT_BACK_LEFT, null],
    ]);
    // The filter reads mapEvents, where travels never go: as in the original, it never applies
    expect(events()).toEqual([]);
  });

  it('records deaths and extends apart from the travels, and a new game forgets them', () => {
    start(4);
    s.game.player!.lives = 3;
    s.game.player!.killHit(0);
    for (let i = 0; i < 400 && s.game.mapEvents.length === 0; i++) step();
    expect(events()).toEqual([[4, Data.EVENT_DEATH, null]]);
    s.game.registerMapEvent(Data.EVENT_EXTEND, null);
    expect(events()).toEqual([
      [4, Data.EVENT_DEATH, null],
      [4, Data.EVENT_EXTEND, null],
    ]);
    expect(travels()).toEqual([]);
    start(4);
    expect(events()).toEqual([]);
  });
});

describe('the world map (GameMode.onMap)', () => {
  const mapClip = () =>
    (s.game as unknown as { mapMC: { getClip(n: string): { _y: number } } | null }).mapMC;
  const icons = () => (s.game as unknown as { mapIcons: { _x: number; _y: number }[] }).mapIcons;

  it('C pauses the game under the map, C or P closes it', () => {
    start(12);
    s.game.registerMapEvent(Data.EVENT_DEATH, null);
    s.game.registerMapEvent(Data.EVENT_EXTEND, null);
    s.game.registerMapEvent(Data.EVENT_EXIT_LEFT, '13. X');
    press('map');
    expect(s.game.fl_pause).toBe(true);
    expect(s.game.fl_lock).toBe(true);
    expect(mapClip()).not.toBeNull();
    expect(mapClip()!.getClip('ptr')._y).toBe(s.game.getMapY(12));
    // One travel icon, then each of the 2 events of level 12 twice (the original's double loop)
    expect(icons().length).toBe(1 + 2 * 2);
    expect(icons()[0]).toMatchObject({
      _x: Data.GAME_WIDTH / 2 - 5,
      _y: Math.floor(s.game.getMapY(12)),
    });
    expect(
      icons()
        .slice(1, 3)
        .map((m) => m._x),
    ).toEqual([196, 204]);

    press('map');
    expect(s.game.fl_pause).toBe(false);
    expect(mapClip()).toBeNull();
    expect(icons()).toEqual([]);

    press('map');
    expect(mapClip()).not.toBeNull();
    press('pause');
    expect(s.game.fl_pause).toBe(false);
    expect(mapClip()).toBeNull();
  });

  it('closes the pause screen instead of opening over it, and waits for fl_map', () => {
    start(12);
    press('pause');
    expect(s.game.fl_pause).toBe(true);
    press('map');
    expect(s.game.fl_pause).toBe(false);
    expect(mapClip()).toBeNull();

    s.game.fl_map = false;
    press('map');
    expect(s.game.fl_pause).toBe(false);
    s.game.fl_map = true;
  });

  it('getMapY: 3.5 px a level from 84, down to 434', () => {
    expect([0, 1, 50, 100, 101].map((l) => s.game.getMapY(l))).toEqual([84, 87.5, 259, 434, 434]);
  });
});
