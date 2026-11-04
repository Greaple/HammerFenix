import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { SpecialItem } from '../src/game/entity/Item';
import { Particle } from '../src/game/entity/Particle';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** A fresh game on a level, past its IA parse, with no enemies left. */
function start(level = 6): void {
  session.initGame(level, 1234);
  step(Data.SECOND);
  for (const b of session.getBads()) b.destroy();
  session.cleanKills();
}

function particles(pid?: number): Particle[] {
  return (session.getList(Data.FX) as Particle[]).filter(
    (p) => !p.fl_kill && (pid === undefined || p.pid === pid),
  );
}

describe('particles (entity.fx.Particle, FxManager.inGameParticles)', () => {
  it('throws n particles of the type, left and right in turn', () => {
    start();
    session.fxMan.inGameParticles(Data.PARTICLE_STONE, 200, 200, 6);
    const l = particles(Data.PARTICLE_STONE);
    expect(l.length).toBe(6);
    for (const p of l) {
      expect(p).toBeInstanceOf(Particle);
      expect(p.mc._currentframe).toBe(Data.PARTICLE_STONE);
      expect(p.isType(Data.ENTITY)).toBe(true);
    }
    const signs = l.map((p) => Math.sign(p.next!.dx));
    for (let i = 1; i < signs.length; i++) expect(signs[i]).toBe(-signs[i - 1]);
  });

  it('inGameParticlesDir throws them all one way', () => {
    start();
    session.fxMan.inGameParticlesDir(Data.PARTICLE_METAL, 200, 200, 5, -3);
    for (const p of particles()) expect(p.next!.dx).toBeLessThan(0);
  });

  it('none while the game is locked', () => {
    start();
    session.fl_lock = true;
    session.fxMan.inGameParticles(Data.PARTICLE_ICE, 200, 200, 5);
    session.fl_lock = false;
    expect(particles().length).toBe(0);
  });

  it(`at most MAX_FX (${Data.MAX_FX}): past it, half as many and old ones removed`, () => {
    start();
    session.fxMan.inGameParticles(Data.PARTICLE_ICE, 200, 100, 16);
    session.fxMan.inGameParticles(Data.PARTICLE_SPARK, 200, 100, 10);
    session.cleanKills();
    expect(particles(Data.PARTICLE_SPARK).length).toBe(5);
    expect(particles().length).toBe(Data.MAX_FX);
  });

  it('they jump, fall, bounce and run out', () => {
    start();
    session.fxMan.inGameParticles(Data.PARTICLE_ICE, 200, 100, 4);
    const p = particles()[0];
    step(1);
    expect(p.dy).toBeLessThan(0);
    step(Data.SECOND * 6);
    expect(particles().length).toBe(0);
  });

  it('sparks are twice as big and last a second; ice from enemies jumps up gently', () => {
    start();
    session.fxMan.inGameParticles(Data.PARTICLE_SPARK, 200, 100, 1);
    const s = particles(Data.PARTICLE_SPARK)[0];
    expect(s.scaleFactor).toBeGreaterThanOrEqual(1);
    expect(s.lifeTimer).toBe(Data.SECOND);
    session.fxMan.inGameParticles(Data.PARTICLE_ICE_BAD, 200, 100, 3);
    for (const p of particles(Data.PARTICLE_ICE_BAD)) {
      expect(p.next!.dy).toBeLessThan(0);
      expect(Math.abs(p.next!.dx)).toBeLessThanOrEqual(6 * 0.3);
    }
  });

  it('bubbles float up and pop at the ceiling', () => {
    start();
    session.fxMan.inGameParticles(Data.PARTICLE_BUBBLE, 200, 300, 1);
    const b = particles(Data.PARTICLE_BUBBLE)[0];
    expect(b.next).toBeNull();
    expect(b.fl_gravity).toBe(false);
    const y = b.y;
    step(10);
    expect(b.y).toBeLessThan(y);
    step(Data.SECOND * 4);
    expect(b.fl_kill).toBe(true);
  });

  it('rain drops fall, splash on the ground and shrink the player they touch', () => {
    start();
    const p = session.player!;
    p.fl_shield = false;
    session.fxMan.inGameParticles(Data.PARTICLE_RAIN, p.x, p.y - 60, 1);
    const r = particles(Data.PARTICLE_RAIN)[0];
    expect(r.next).toBeNull();
    expect(r.mc._yscale).toBeGreaterThan(10);
    const scale = p.scaleFactor;
    for (let i = 0; i < Data.SECOND && !r.fl_kill; i++) {
      p.fl_shield = false;
      step(1);
    }
    expect(r.fl_kill).toBe(true);
    expect(p.scaleFactor).toBeCloseTo(scale - 0.01, 5);
  });

  it('100: the Guu doll rains on the player', () => {
    start();
    const item = SpecialItem.attach(session, 100, 100, 100, null)!;
    session.player!.executeSpecialItem(item);
    item.destroy();
    step(3);
    expect(particles(Data.PARTICLE_RAIN).length).toBeGreaterThan(0);
  });

  it('things moving on a water level ($AQUA) leave bubbles; particles do not', () => {
    session.initGame(6, 1234);
    step(Data.SECOND); // the level's enemies walk
    session.setDynamicVar('$AQUA', '1');
    let bubbles = 0;
    for (let i = 0; i < 40; i++) {
      step(1);
      bubbles = Math.max(bubbles, particles(Data.PARTICLE_BUBBLE).length);
    }
    expect(bubbles).toBeGreaterThan(0);

    for (const b of session.getBads()) b.destroy();
    session.destroyList(Data.FX);
    session.cleanKills();
    session.fxMan.inGameParticles(Data.PARTICLE_STONE, 200, 100, 4);
    step(1);
    expect(particles(Data.PARTICLE_BUBBLE).length).toBe(0);
    session.initGame(6, 1234); // clears the dynamic vars
  });
});
