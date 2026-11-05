import { beforeAll, describe, expect, it } from 'vitest';
import { Chrono } from '../src/game/Chrono';
import { Data } from '../src/game/Data';
import type { BadEntity } from '../src/game/entity/Bad';
import { SpecialItem } from '../src/game/entity/Item';
import type { GameSession } from '../src/game/GameSession';
import { Stat } from '../src/game/StatsManager';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;
let clock = 0;

beforeAll(async () => {
  session = await createHeadlessSession();
  session.getTimer = () => clock;
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** A fresh game on level 6, run until it is ready. */
function start(): void {
  session.initGame(6, 1234);
  step(20);
}

/** Leaves for the next level and runs its transition (IA parse and scroll). */
function nextLevel(): void {
  session.nextLevel();
  step(60);
}

describe('Stat', () => {
  it('adds the current value to the total on reset', () => {
    const s = new Stat();
    s.inc(3);
    s.inc(2);
    expect(s.current).toBe(5);
    s.reset();
    s.inc(1);
    s.reset();
    expect(s.current).toBe(0);
    expect(s.total).toBe(6);
  });
});

describe('StatsManager', () => {
  it('gives one letter, plus one per combo step above 1, at most 7', () => {
    start();
    const sm = session.statsMan;
    const count = (combo: number) => {
      sm.write(Data.STAT_MAX_COMBO, combo);
      return sm.countExtend();
    };
    expect(count(0)).toBe(1);
    expect(count(1)).toBe(1);
    expect(count(2)).toBe(2);
    expect(count(4)).toBe(4);
    expect(count(7)).toBe(7);
    expect(count(12)).toBe(7);
  });

  it('records the best combo of the level when an enemy drops its crystal', () => {
    start();
    const bad = session.getBads()[0] as BadEntity;
    bad.comboId = 999;
    bad.dropReward();
    bad.dropReward();
    bad.dropReward();
    expect(session.statsMan.read(Data.STAT_MAX_COMBO)).toBe(3);
    // A smaller combo does not lower it
    bad.comboId = 998;
    bad.dropReward();
    expect(session.statsMan.read(Data.STAT_MAX_COMBO)).toBe(3);
  });

  it("sets the next level's letters from the combo of the level left, then resets", () => {
    start();
    session.statsMan.write(Data.STAT_MAX_COMBO, 4);
    nextLevel();
    expect(session.world.currentId).toBe(7);
    expect(session.world.current.specialSlots.length).toBeGreaterThan(0);

    const list = session.statsMan.extendList;
    expect(list.length).toBe(4);
    expect(new Set(list).size).toBe(4);
    for (const id of list) expect(id).toBeGreaterThanOrEqual(0);
    for (const id of list) expect(id).toBeLessThan(Data.EXTENDS.length);

    expect(session.statsMan.read(Data.STAT_MAX_COMBO)).toBe(0);
    expect(session.statsMan.getTotal(Data.STAT_MAX_COMBO)).toBe(4);
  });

  it('drops only letters from the list, every EXTEND_TIMER, on the ground', () => {
    start();
    nextLevel();
    const list = session.statsMan.extendList;
    expect(list.length).toBe(1);
    const letters = () =>
      session.getList(Data.SPECIAL_ITEM).filter((e) => (e as SpecialItem).id === 0);
    expect(letters().length).toBe(0);
    step(Data.EXTEND_TIMER + 2);
    expect(letters().length).toBe(1);
    expect((letters()[0] as SpecialItem).subId).toBe(list[0]);
  });

  it('drops no letter once the level is clear', () => {
    start();
    session.statsMan.extendList = [2];
    session.fl_clear = true;
    expect(session.statsMan.attachExtend()).toBeNull();
  });

  it('counts jumps, bombs and deaths of the level', () => {
    start();
    const sm = session.statsMan;
    const p = session.player!;
    for (let i = 0; i < 100 && !p.fl_stable; i++) step(1);
    expect(p.fl_stable).toBe(true);
    session.input.setTouch('jump', true);
    step(1);
    session.input.setTouch('jump', false);
    expect(sm.read(Data.STAT_JUMP)).toBe(1);
    for (let i = 0; i < 100 && !p.fl_stable; i++) step(1);
    session.input.setTouch('attack', true);
    step(1);
    session.input.setTouch('attack', false);
    expect(sm.read(Data.STAT_BOMB)).toBe(1);
    p.killPlayer();
    expect(sm.read(Data.STAT_DEATH)).toBe(1);
  });
});

describe('Chrono', () => {
  it('starts stopped at 0, then runs from its creation time', () => {
    clock = 1000;
    const c = new Chrono(() => clock);
    expect(c.fl_stop).toBe(true);
    expect(c.fl_init).toBe(false);
    expect(c.get()).toBe(0);
    clock = 1500;
    c.update();
    expect(c.get()).toBe(0);
    c.start();
    expect(c.get()).toBe(500);
  });

  it('leaves out the time it was stopped', () => {
    clock = 0;
    const c = new Chrono(() => clock);
    c.start();
    clock = 1000;
    c.update();
    c.stop();
    clock = 5000;
    c.update();
    expect(c.get()).toBe(1000);
    c.start();
    clock = 6000;
    c.update();
    expect(c.get()).toBe(2000);
  });

  it('takes seconds off, never below 0', () => {
    clock = 0;
    const c = new Chrono(() => clock);
    c.start();
    clock = 10000;
    c.update();
    c.timeShift(3);
    expect(c.get()).toBe(7000);
    c.timeShift(60);
    expect(c.get()).toBe(0);
  });

  it('formats minutes, seconds and milliseconds', () => {
    const c = new Chrono(() => 0);
    expect(c.formatTime(0)).toBe(`00" 00' 000`);
    expect(c.formatTime(83_456)).toBe(`01" 23' 456`);
    expect(c.formatTime(75 * 60_000 + 5_007)).toBe(`75" 05' 007`);
    expect(c.formatTimeShort(83_456)).toBe(`01" 23`);
    expect(c.formatTimeShort(83_500)).toBe(`01" 24`);
    // The original rounds the seconds alone
    expect(c.formatTimeShort(59_600)).toBe(`00" 60`);
  });
});

describe('game chrono', () => {
  it('runs while the level is played and stops during the pause', () => {
    clock = 0;
    start();
    const t0 = session.gameChrono.get();
    expect(session.gameChrono.fl_stop).toBe(false);
    clock += 2000;
    step(1);
    expect(session.gameChrono.get()).toBe(t0 + 2000);

    session.onPause();
    expect(session.fl_lock).toBe(true);
    clock += 10_000;
    step(1);
    expect(session.gameChrono.get()).toBe(t0 + 2000);

    session.onUnpause();
    clock += 1000;
    step(1);
    expect(session.gameChrono.get()).toBe(t0 + 3000);
  });

  it('stops during a level change', () => {
    clock = 0;
    start();
    session.nextLevel();
    const t = session.gameChrono.get();
    expect(session.gameChrono.fl_stop).toBe(true);
    clock += 5000;
    step(10);
    expect(session.gameChrono.get()).toBe(t);
  });
});
