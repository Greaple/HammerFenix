import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import { Data } from '../src/game/Data';
import type { LevelSet } from '../src/game/data/types';
import { SpecialItem } from '../src/game/entity/Item';
import type { GameSession } from '../src/game/GameSession';
import { LevelWorld } from '../src/game/levels/LevelWorld';
import type { Adventure } from '../src/game/mode/Adventure';
import { createHeadlessSession } from './helpers/headless';

/** IA parse of a level: 500 cases, 30 per frame (`GameMechanics.parseCurrentIA`). */
const PARSE = 17;
/** Level scroll: `SCROLL_SPEED` 0.04 per frame up to PI / 2. */
const SCROLL = 40;

let session: GameSession;

/** The session's `ViewManager` and darkness state, private in `GameSession`. */
interface Internals {
  fake: SwfMovieClip | null;
  fl_scrolling: boolean;
  fl_hscrolling: boolean;
  fl_fading: boolean;
  scrollDir: number;
  fl_rightPortal: boolean;
  darknessMC: SwfMovieClip | null;
  darknessHoles: SwfMovieClip[];
  targetDark: number;
}
const internals = () => session.game as unknown as Internals;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** Steps until the game unlocks; returns the number of frames it took. */
function framesUntilReady(max = 200): number {
  for (let i = 1; i <= max; i++) {
    step(1);
    if (!session.game.fl_lock) return i;
  }
  return -1;
}

describe('IA parse over frames (GameMechanics.parseCurrentIA)', () => {
  it('takes 17 frames and gives the same map as a parse at once', () => {
    const set = JSON.parse(
      readFileSync(join(__dirname, '../public/data/levels/adventure.json'), 'utf-8'),
    ) as LevelSet;
    const world = new LevelWorld(set, 12, true);
    expect(world.fl_parsing).toBe(true);
    let calls = 0;
    while (!world.parseCurrentIA()) calls++;
    expect(calls + 1).toBe(PARSE);
    expect(world.isDataReady()).toBe(true);
    const flags = world.flagMap.map((c) => [...c]);
    const falls = world.fallMap.map((c) => [...c]);
    world.parseAllIA();
    expect(world.flagMap).toEqual(flags);
    expect(world.fallMap).toEqual(falls);
  });
});

describe('level transitions (ViewManager)', () => {
  it('a new game shows its first level once parsed, without a scroll', () => {
    session.startGame(5, 1234);
    expect(session.game.fl_lock).toBe(true);
    expect(session.game.view.fl_attach).toBe(false);
    expect(framesUntilReady()).toBe(PARSE);
    expect(session.game.view.fl_attach).toBe(true);
    expect(session.game.view.viewY).toBe(0);
    expect(internals().fake).toBeNull();
    expect(session.game.player!.mc._visible).toBe(true);
  });

  it('the next level scrolls up over the old one after its parse', () => {
    session.startGame(5, 1234);
    framesUntilReady();
    session.game.nextLevel();
    expect(session.game.world.currentId).toBe(6);

    // Parse: the old view stays
    step(PARSE - 1);
    expect(internals().fl_scrolling).toBe(false);
    expect(internals().fake).toBeNull();
    step(1);
    expect(internals().fl_scrolling).toBe(true);
    expect(internals().fake).not.toBeNull();
    expect(session.game.view.viewY).toBe(Data.GAME_HEIGHT);

    // Halfway
    step(SCROLL / 2);
    const y = Data.GAME_HEIGHT - Math.sin(Data.SCROLL_SPEED * (SCROLL / 2)) * Data.GAME_HEIGHT;
    expect(session.game.view.viewY).toBeCloseTo(y, 6);
    expect(internals().fake!._y).toBeCloseTo(y - Data.GAME_HEIGHT, 6);
    expect(session.game.fl_lock).toBe(true);

    expect(framesUntilReady()).toBe(SCROLL / 2);
    expect(session.game.view.viewY).toBe(0);
    expect(internals().fake).toBeNull();
  });

  it('the warp start (Adventure.nextLevel) shows level 10 without a scroll', () => {
    session.startGame(0, 1234);
    framesUntilReady();
    (session.game as Adventure).fl_warpStart = true;
    session.game.fl_clear = true;
    session.game.nextLevel();
    expect(session.game.world.currentId).toBe(10);
    expect(framesUntilReady()).toBe(PARSE);
    expect(internals().fake).toBeNull();
  });

  it.each([
    [true, 1],
    [false, -1],
  ])('a portal on the right (%s) scrolls the new world in sideways (dir %i)', (right, dir) => {
    const link = session.dataStore.portalLinks.links.find(
      (l) => l.from_did === 0 && l.to_pid >= 0,
    )!;
    session.startGame(link.from_lid, 1234);
    framesUntilReady();
    session.game.fl_clear = true;
    internals().fl_rightPortal = right;
    session.game.switchDimensionById(link.to_did, link.to_lid, link.to_pid);
    expect(session.game.currentDim).toBe(link.to_did);
    expect(internals().fake).not.toBeNull();

    step(PARSE);
    expect(internals().fl_hscrolling).toBe(true);
    expect(internals().scrollDir).toBe(dir);
    expect(session.game.view.viewX).toBe(Data.GAME_WIDTH);
    step(1);
    const x0 = dir > 0 ? Data.GAME_WIDTH + 20 : -Data.GAME_WIDTH - 20;
    expect(Math.sign(session.game.view.viewX!)).toBe(Math.sign(x0));

    expect(framesUntilReady()).toBe(SCROLL - 1);
    expect(session.game.view.viewX).toBe(0);
    expect(internals().fake).toBeNull();
    expect(session.game.player!.mc._visible).toBe(true);
  });

  it('arriving at no portal (pid < 0) fades the old world out', () => {
    session.startGame(5, 1234);
    framesUntilReady();
    session.game.fl_clear = true;
    session.game.switchDimensionById(1, 0, -1);
    step(PARSE);
    expect(internals().fl_fading).toBe(true);
    expect(session.game.view.viewX).toBe(0);
    const alpha = internals().fake!._alpha;
    step(1);
    expect(internals().fake!._alpha).toBe(alpha - Data.FADE_SPEED);
    expect(framesUntilReady()).toBe(Math.ceil(alpha / Data.FADE_SPEED) - 1);
    expect(internals().fake).toBeNull();
  });
});

describe('darkness (GameMode.updateDarkness, holeUpdate)', () => {
  function useItem(id: number): void {
    const item = SpecialItem.attach(session.game, 100, 100, id, null)!;
    session.game.player!.executeSpecialItem(item);
    item.destroy();
  }

  it('no darkness before level 16', () => {
    session.startGame(15, 1234);
    framesUntilReady();
    expect(internals().darknessMC).toBeNull();
  });

  it('the darkness eases to the level number and the light follows the player', () => {
    session.startGame(40, 1234);
    framesUntilReady();
    const d = internals().darknessMC!;
    // startLevel's updateDarkness, then the frame's holeUpdate: 2 steps of 2
    expect(d._alpha).toBe(4);
    step(10);
    expect(d._alpha).toBe(24);
    step(30);
    expect(d._alpha).toBe(40);
    expect(session.game.world.darknessFactor).toBe(40);

    const hole = internals().darknessHoles[0];
    expect(hole.blendMode).toBe('erase');
    const p = session.game.player!;
    step(20);
    expect(hole._x).toBeCloseTo(p.x + Data.CASE_WIDTH * 0.5, 0);
    expect(hole._y).toBeCloseTo(p.y - Data.CASE_HEIGHT, 0);
  });

  it('68: the candle widens the light; 26: the light bulb halves the darkness', () => {
    session.startGame(40, 1234);
    framesUntilReady();
    useItem(68);
    session.game.updateDarkness();
    expect(internals().darknessHoles[0]._xscale).toBe(150);
    useItem(26);
    expect(internals().targetDark).toBe(20);
  });

  it('torches add light spots; code trigger 14 removes them', () => {
    session.startGame(40, 1234);
    framesUntilReady();
    session.game.addHole(100, 100, 180);
    session.game.updateDarkness();
    expect(internals().darknessHoles.length).toBe(3);
    const hole = internals().darknessHoles[2];
    expect(hole._width).toBeCloseTo(180, 0);
    expect(hole.blendMode).toBe('erase');
    session.game.clearExtraHoles();
    expect(internals().darknessHoles.length).toBe(2);
    expect(hole.parent).toBeNull();
  });

  it('a dimension starts with the darkness of the level it was entered from', () => {
    const link = session.dataStore.portalLinks.links.find(
      (l) => l.from_did === 0 && l.from_lid >= 30 && l.to_pid >= 0,
    )!;
    session.startGame(link.from_lid, 1234);
    framesUntilReady();
    step(60);
    const dark = session.game.world.darknessFactor;
    expect(dark).toBeGreaterThan(0);
    session.game.fl_clear = true;
    session.game.switchDimensionById(link.to_did, link.to_lid, link.to_pid);
    expect(session.game.world.darknessFactor).toBe(dark);
    // The snapshot is drawn as dark as the darkness under it
    expect(internals().fake!._alpha).toBe(100 - dark);
  });
});
