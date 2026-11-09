import { beforeAll, describe, expect, it } from 'vitest';
import { Timer } from '../src/engine/Timer';
import { Data } from '../src/game/Data';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n = 1): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** A fresh game on `level`, past its level change, with the player out of harm's way. */
function start(level = 1): void {
  session.initGame(level, 1234);
  step(60);
  session.player!.fl_godMode = true;
}

const dvars = () => (session as unknown as { dvars: Map<string, string> }).dvars;

describe('Timer.tmod (2C.7)', () => {
  it('is 1 on every tick outside bullet time', () => {
    start();
    step(5);
    expect(Timer.tmod).toBe(1);
    expect([session.gFriction, session.xFriction]).toEqual([Data.FRICTION_GROUND, Data.FRICTION_X]);
  });

  it('bullet time: 0.3 of the game per tick, for 2 s of real ticks', () => {
    start();
    session.bulletTime(Data.SECOND * 2);
    const hu = session.huTimer;
    const cycle = session.cycle;
    step(10);
    expect(Timer.tmod).toBeCloseTo(0.3);
    expect(session.huTimer - hu).toBeCloseTo(3);
    expect(session.cycle - cycle).toBeCloseTo(3);
    expect(session.gFriction).toBeCloseTo(Math.pow(Data.FRICTION_GROUND, 0.3));
    step(Data.SECOND * 2 - 10);
    expect(Timer.tmod).toBe(1);
  });

  it('slows the moves: a falling player gains 0.3 of the fall speed per tick', () => {
    start();
    const p = session.player!;
    p.dx = 0;
    p.dy = 5;
    p.fl_stable = false;
    p.moveTo(200, 100);
    session.bulletTime(Data.SECOND * 2);
    step(1);
    const dy = p.dy;
    const y = p.y;
    step(1);
    // gravity for 0.3 of a tick, then the air friction for 0.3 of a tick
    const fall = 0.3 * p.fallFactor * Data.FALL_SPEED;
    expect(p.dy).toBeCloseTo((dy + fall) * Data.FRICTION_Y ** 0.3, 5);
    expect(p.y - y).toBeLessThan(dy);
  });

  it('keeps the movie clips at 40 fps: 5 clip steps for 4 ticks, as outside bullet time', () => {
    start();
    session.bulletTime(Data.SECOND * 2);
    session.gameLoop.resetPhase();
    let anims = 0;
    const loop = session.gameLoop as unknown as { onAnimStep: () => void };
    const onAnim = loop.onAnimStep;
    loop.onAnimStep = () => {
      anims++;
      onAnim();
    };
    // the clip steps due before each tick run first: 10 before the 9th
    step(9);
    loop.onAnimStep = onAnim;
    expect(Timer.tmod).toBeCloseTo(0.3);
    expect(anims).toBe(10);
  });

  it('counts cycles only while the game is not locked (Mode.updateConstants)', () => {
    start();
    const cycle = session.cycle;
    session.lock();
    step(5);
    expect(session.cycle).toBe(cycle);
    session.unlock();
    step(5);
    expect(session.cycle).toBe(cycle + 5);
  });
});

describe('aqua wobble and wind (GameMode.main)', () => {
  it('$AQUA bobs and stretches the game, and its end puts it back', () => {
    start();
    session.setDynamicVar('$AQUA', '1');
    step(10);
    const t = 0.03 * 10;
    expect(session.gameRoot._y).toBeCloseTo(-7 + 7 * Math.cos(t), 5);
    expect(session.gameRoot._yscale).toBeCloseTo(102 - 2 * Math.cos(t), 5);
    dvars().delete('aqua');
    step(1);
    expect(session.gameRoot._y).toBe(session.yOffset);
    expect(session.gameRoot._yscale).toBe(100);
  });

  it('wind stops when its timer runs out', () => {
    start();
    session.wind(1.5, 10);
    expect([session.fl_wind, session.windSpeed]).toEqual([true, 1.5]);
    step(9);
    expect(session.fl_wind).toBe(true);
    step(1);
    expect(session.fl_wind).toBe(false);
  });
});
