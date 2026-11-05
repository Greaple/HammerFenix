import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { BadEntity } from '../src/game/entity/Bad';
import { ClassicBomb } from '../src/game/entity/Bomb';
import { FramBallShoot } from '../src/game/entity/Shoot';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

/** The fields of `FramboiseBad` (not exported) that the tests read. */
type Framboise = BadEntity & {
  fl_phased: boolean;
  tx: number;
  ty: number;
  arrived: number;
};

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession('deepnight');
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** deepnight 214: a single Framboise. Waits until it stands on a platform. */
function startLevel214(): Framboise {
  session.initGame(214, 1234);
  step(20);
  const b = session.getBads()[0] as Framboise;
  expect(b.constructor.name).toBe('FramboiseBad');
  for (let i = 0; i < 200 && !b.isReady(); i++) step(1);
  expect(b.isReady()).toBe(true);
  return b;
}

function frags(b: Framboise): FramBallShoot[] {
  return session
    .getList(Data.SHOOT)
    .filter(
      (s) => s instanceof FramBallShoot && (s.owner as unknown) === b && !s.fl_destroy,
    ) as FramBallShoot[];
}

/** Drops a player bomb next to the Framboise and steps until it bursts. */
function burst(b: Framboise): void {
  ClassicBomb.attach(session, b.x, b.y);
  for (let i = 0; i < 40 && !b.fl_phased; i++) step(1);
  expect(b.fl_phased).toBe(true);
}

describe('Framboise (task 2.12)', () => {
  it('bursts into 6 fragments when a player bomb is close, hidden off screen', () => {
    const b = startLevel214();
    const ox = b.x;
    const oy = b.y;
    burst(b);
    expect(b.mc._visible).toBe(false);
    expect(b.mc._currentframe).toBe(15);
    const f = frags(b);
    expect(f.length).toBe(6);
    expect(f.map((s) => s.mc._currentframe).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    // the target is a platform top at least 8 cases away
    expect(Math.hypot(b.tx - ox, b.ty - oy)).toBeGreaterThan(Data.CASE_WIDTH * 7);
    step(1);
    expect(b.x).toBe(100);
    expect(b.y).toBeCloseTo(-200, 0);
  });

  it('rebuilds itself piece by piece at the target, then walks again', () => {
    const b = startLevel214();
    burst(b);
    const sub = b.mc.getClip('sub')!;
    expect(sub._currentframe).toBe(1);
    expect(sub.getClip('o1')!._visible).toBe(false);
    for (let i = 0; i < Data.SECOND * 4 + 2 && b.arrived === 0; i++) step(1);
    expect(b.arrived).toBeGreaterThan(0);
    expect(b.mc._visible).toBe(true);
    expect(b.x).toBe(b.tx);
    for (let i = 0; i < Data.SECOND * 4 + 2 && b.fl_phased; i++) step(1);
    expect(b.fl_phased).toBe(false);
    expect(b.arrived).toBe(6);
    expect(frags(b).length).toBe(0);
    // 4 pieces in the sub timeline, 2 as o1 / o2
    expect(sub._currentframe).toBe(5);
    expect(sub.getClip('o1')!._visible).toBe(true);
    expect(sub.getClip('o2')!._visible).toBe(true);
  });

  it('a kill while phased removes the fragments', () => {
    const b = startLevel214();
    burst(b);
    expect(frags(b).length).toBe(6);
    b.killHit(0);
    expect(b.fl_phased).toBe(false);
    expect(frags(b).length).toBe(0);
    // still hidden: the next update shows it at the target
    step(1);
    expect(b.mc._visible).toBe(true);
  });
});

describe('Baleine (task 2.12)', () => {
  it('is a plain Flyer of its own class', async () => {
    const adv = await createHeadlessSession();
    adv.initGame(99, 1234);
    for (let i = 0; i < 20; i++) adv.gameLoop.stepSingleFrame();
    const names = adv.getBads().map((b) => b.constructor.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(['BaleineBad']));
  });
});
