import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Key, type PlayerKeys } from '../src/engine/Input';
import { Data } from '../src/game/Data';
import { FlyerBad, WalkerBad } from '../src/game/entity/Bad';
import type { PlayerEntity } from '../src/game/entity/Player';
import type { GameSession } from '../src/game/GameSession';
import type { GameResult } from '../src/game/Loader';
import { Adventure } from '../src/game/mode/Adventure';
import { TimeAttack } from '../src/game/mode/TimeAttack';
import { TimeAttackMulti } from '../src/game/mode/TimeAttackMulti';
import { decodeProfile, encodeProfile, NO_TIME, Profile } from '../src/game/Profile';
import { QuestEngine } from '../src/game/Quests';
import { formatRunTime } from '../src/ui/Shell';
import { createHeadlessSession } from './helpers/headless';

const keys = (j: number, d: number, l: number, r: number, a: number): PlayerKeys => ({
  jump: [j],
  down: [d],
  left: [l],
  right: [r],
  attack: [a],
});

/** Roadmap 4.1 and 4.3: the Time Attack modes (`mode.TimeAttack`, `mode.TimeAttackMulti`). */
describe('Time Attack', () => {
  let session: GameSession;
  let results: GameResult[];
  /** A fake `Std.getTimer()`: 1/32 s per logic tick. */
  let clock = 0;

  beforeAll(async () => {
    session = await createHeadlessSession();
    session.onGameResult = (r) => results.push(r);
    session.getTimer = () => clock;
  });

  beforeEach(() => {
    results = [];
    clock = 100000;
  });

  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      clock += 1000 / 32;
      session.gameLoop.stepSingleFrame();
    }
  };
  const game = () => session.game as TimeAttack;
  const players = () => session.game.getList(Data.PLAYER) as PlayerEntity[];
  const timeText = () => session.game.hud.mc.getText('time')?.text;
  /** Starts a game and runs it until the countdown shows. */
  const start = (mode = 'timeattack', options = 'set_ta_0') => {
    session.setParameters('0,7,1000,18', options);
    session.startGame(0, 42, mode);
    for (let i = 0; i < 200 && !game().mcStarter; i++) run(1);
  };
  /** Runs the countdown out: the game is unlocked. */
  const go = () => {
    for (let i = 0; i < 200 && game().fl_lock; i++) run(1);
  };
  const untilResult = () => {
    for (let i = 0; i < 400 && results.length === 0; i++) session.stepAnimation();
  };

  it('plays the run of the set timeAttack with three lives and no extras', () => {
    start();
    const g = game();
    expect(g).toBeInstanceOf(TimeAttack);
    expect(g).toBeInstanceOf(Adventure);
    expect(session.isTimeAttack()).toBe(true);
    expect(g._name).toBe('$time');
    expect(g.world.set.name).toBe('timeAttack');
    expect(g.dimensions.length).toBe(1);
    expect(g.runId).toBe(0);
    expect(g.firstLevel).toBe(0);
    expect(g.world.currentId).toBe(0);
    expect(g.fl_static).toBe(true);
    expect(g.fl_bullet).toBe(false);
    expect(players().length).toBe(1);
    expect(players()[0].lives).toBe(3);
    // No items: no extend letter, special or score item on the level
    expect(g.getItems().length).toBe(0);
  });

  it('ignores the mirror and nightmare options', () => {
    start('timeattack', 'set_ta_0,mirror,nightmare');
    expect(game().fl_mirror).toBe(false);
    expect(game().fl_nightmare).toBe(false);
    expect(game().world.fl_mirror).toBe(false);
  });

  it('starts run N on level 9 N, and needs a run', () => {
    start('timeattack', 'set_ta_1');
    expect(game().runId).toBe(1);
    expect(game().world.currentId).toBe(9);

    session.setParameters('0,7,1000,18', '');
    expect(() => session.startGame(0, 42, 'timeattack')).toThrow('unknown run ID');
    start();
    expect(game().world.currentId).toBe(0);
  });

  it('shows the Time Attack interface: the chrono, the lives, no score', () => {
    start();
    const hud = session.game.hud;
    expect(hud.mc._currentframe).toBe(3);
    expect(hud.mc.getText('level')).toBeNull();
    expect(timeText()).toBe(`00" 00' 000`);
    const lives = (hud as unknown as { lives: { _x: number }[][] }).lives;
    expect(lives[0].map((l) => l._x)).toEqual([8, 23, 38]);
    // Points are not counted
    const p = players()[0];
    p.getScore(null, 5000);
    p.getScoreHidden(5000);
    expect(p.score).toBe(0);
    run(5);
    expect(timeText()).toBe(`00" 00' 000`);
  });

  it('counts down 3, 2, 1 with the game locked, then starts the chrono', () => {
    start();
    const g = game();
    expect(g.fl_lock).toBe(true);
    expect(g.mcStarter!.getText('field')!.text).toBe('');
    const seen: string[] = [];
    let ticks = 0;
    while (g.fl_lock && ticks < 200) {
      run(1);
      ticks++;
      const s = g.mcStarter?.getText('field')?.text;
      if (s && seen[seen.length - 1] !== s) seen.push(s);
    }
    expect(seen).toEqual(['3', '2', '1']);
    // 3.5 s, from the frame after the level showed
    expect(ticks).toBe(Data.SECOND * 3.5);
    expect(g.mcStarter).toBeNull();
    // As in the original, the chrono restarts from the frame before (`frameTimer` is read after)
    expect(g.getChrono()).toBe(31);

    run(32);
    expect(g.getChrono()).toBe(1031);
    expect(timeText()).toBe(`00" 01' 031`);
  });

  it('starts the enemies in a fixed direction', () => {
    start();
    const bads = session.game.getBads();
    expect(bads.length).toBeGreaterThan(0);
    for (const b of bads) {
      if (b instanceof WalkerBad) expect(b.dir).toBe(1);
      if (b instanceof FlyerBad) expect(b.dir).toBe(-1);
    }
  });

  it('stops the chrono during the pause', () => {
    start();
    go();
    run(32);
    const g = game();
    g.onPause();
    expect(g.fl_pause).toBe(true);
    const before = g.getChrono();
    run(64);
    g.onUnpause();
    expect(g.getChrono()).toBe(before);
    run(32);
    expect(g.getChrono()).toBe(before + 1000);
  });

  it('takes seconds off for a crystal, never below 0', () => {
    start();
    go();
    run(32 * 10);
    const g = game();
    expect(g.getChrono()).toBe(10031);
    g.pickUpScore(0, 2);
    expect(g.getChrono()).toBe(5031);
    g.pickUpScore(0, 99);
    expect(g.getChrono()).toBe(0);
    expect(Data.getCrystalTime(0)).toBe(1);
    expect(Data.getCrystalTime(5)).toBe(10);
    expect(Data.getCrystalTime(null)).toBe(1);
  });

  it('alerts at each new minute', () => {
    start();
    go();
    run(32 * 61);
    expect(game().fl_alerts[1]).toBe(true);
    expect(game().fl_alerts[2]).toBeUndefined();
  });

  it('keeps each level time, shows the last one and sends the sum at the end of the run', () => {
    start();
    go();
    const g = game();
    const attached: string[] = [];
    const attach = g.depthMan.attach.bind(g.depthMan);
    g.depthMan.attach = (linkage, plan) => {
      attached.push(linkage);
      return attach(linkage, plan);
    };
    run(64);
    // The time of the frame before, as the original (`prevFrameTimer`)
    g.goto(1);
    expect(g.times).toEqual([2000]);
    for (let i = 0; i < 200 && g.world.currentId !== 1; i++) run(1);
    for (let i = 0; i < 200 && g.fl_lock; i++) run(1);
    expect(g.world.currentId).toBe(1);
    // The level change is not counted
    expect(g.getChrono()).toBeLessThan(2100);
    expect(attached).toContain('hammer_interf_time');

    run(32);
    // Leaving for the empty level 6 ends the run before this level's time is kept
    g.goto(6);
    untilResult();
    expect(results.length).toBe(1);
    const r = results[0];
    if (r.kind !== 'gameOver') throw new Error('expected a score');
    expect(r.runId).toBe(0);
    expect(r.score).toBe(2000);
    expect(r.stats.item2).toBeNull();
    expect(r.stats.data).toBeNull();
    expect(r.uniqueItems).toBe(0);
  });

  it('sends no time on a game over', () => {
    start();
    go();
    run(10);
    game().onGameOver();
    untilResult();
    const r = results[0];
    if (r.kind !== 'gameOver') throw new Error('expected a score');
    expect(r.score).toBe(TimeAttack.INFINITY);
    expect(r.score).toBe(NO_TIME);
    expect(game().formatTime(r.score)).toBe(`59" 59' 999`);
  });

  it('gives no super item', () => {
    start();
    go();
    const g = game();
    g.onLevelClear();
    expect(g.perfectOrder).toBeNull();
    expect(session.game.getList(Data.SUPA).length).toBe(0);
  });

  describe('for two players (4.3)', () => {
    const multi = () => start('multitime', 'set_mta_0');

    it('plays the set multiTime with Igor and Sandy, three lives each', () => {
      multi();
      const g = game();
      expect(g).toBeInstanceOf(TimeAttackMulti);
      expect(session.isMultiTime()).toBe(true);
      expect(g._name).toBe('$timeMulti');
      expect(g.world.set.name).toBe('multiTime');
      expect(g.runId).toBe(0);
      const [p1, p2] = players();
      expect(players().length).toBe(2);
      expect([p1.lives, p2.lives]).toEqual([3, 3]);
      expect([p1.baseColor, p2.baseColor]).toEqual([Data.BASE_COLORS[0], Data.BASE_COLORS[1]]);
      expect(p2.skin).toBe(2);
      expect(p2.head).toBe(Data.HEAD_SANDY);
      // Level 0 starts on column 10, whose mirror is itself
      expect(p1.cx).toBe(10);
      expect(p2.cx).toBe(10);
      expect(session.input.playerKeys(0)).toEqual(
        keys(Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, Key.ENTER),
      );
      expect(session.input.playerKeys(1)).toEqual(keys(90, 83, 81, 68, 65));
      // The Time Attack interface, lives at both ends
      const lives = (session.game.hud as unknown as { lives: { _x: number }[][] }).lives;
      expect(lives[0].map((l) => l._x)).toEqual([8, 23, 38]);
      expect(lives[1].map((l) => l._x)).toEqual([386, 371, 356]);
      expect(session.game.hud.mc._currentframe).toBe(3);
    });

    it('needs its own run options', () => {
      session.setParameters('0,7,1000,18', 'set_ta_0');
      expect(() => session.startGame(0, 42, 'multitime')).toThrow('unknown run ID');
      start('multitime', 'set_mta_1');
      expect(game().world.currentId).toBe(9);
    });

    it('lets the players choose their devices before the countdown', () => {
      session.setParameters('0,7,1000,18', 'set_mta_0');
      session.startGame(0, 42, 'multitime');
      session.game.askJoin();
      for (let i = 0; i < 200 && !session.game.joining; i++) run(1);
      const g = game();
      expect(g.joining).toBe(true);
      const starter = g.starter;
      expect(starter).toBe(Data.SECOND * 3.5);
      run(64);
      expect(g.starter).toBe(starter);

      for (const code of [Key.ENTER, 65]) {
        session.input.setKeyCode(code, true);
        run(2);
        session.input.setKeyCode(code, false);
        run(2);
      }
      run(Data.SECOND);
      expect(g.joining).toBe(false);
      // Still locked: the countdown goes on, then the race starts
      expect(g.fl_lock).toBe(true);
      expect(g.starter).toBeLessThan(starter);
      go();
      expect(g.fl_lock).toBe(false);
      expect(g.getChrono()).toBe(31);
    });
  });

  describe('profile and site screens', () => {
    const quests = () => new QuestEngine(session.dataStore.quests, session.dataStore.items);
    const memory = () => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
      };
    };

    it('sends the run with the options', () => {
      const p = new Profile(quests(), memory());
      expect(p.hasMode('timeattack')).toBe(false);
      expect(p.runOption('timeattack')).toBeNull();
      expect(p.runOption('solo')).toBeNull();
      // Quest 73
      p.data.modes.push('timeattack');
      p.data.options.push('set_ta_0');
      expect(p.hasMode('timeattack')).toBe(true);
      expect(p.optionsParam('timeattack')).toBe('set_ta_0');
      // The two-player version: with the co-op too (a guess), on run 0
      expect(p.hasMode('multitime')).toBe(false);
      p.data.modes.push('multicoop');
      expect(p.hasMode('multitime')).toBe(true);
      expect(p.optionsParam('multitime')).toBe('set_mta_0');
      p.data.options.push('boost');
      expect(p.optionsParam('multitime')).toBe('boost,set_mta_0');
    });

    it('keeps the best time of each run', () => {
      const storage = memory();
      const p = new Profile(quests(), storage);
      expect(p.bestTime('timeattack', 0)).toBeNull();
      expect(p.timeResult('timeattack', 0, 40000, true)).toEqual({
        mode: 'timeattack',
        runId: 0,
        time: 40000,
        best: null,
        isNew: true,
      });
      expect(p.timeResult('timeattack', 0, 45000, true).isNew).toBe(false);
      expect(p.timeResult('timeattack', 0, 30000, false).isNew).toBe(true);
      expect(p.bestTime('timeattack', 0)).toBe(40000);
      expect(p.timeResult('timeattack', 0, 35000, true).best).toBe(40000);
      expect(p.bestTime('timeattack', 0)).toBe(35000);
      expect(p.timeResult('timeattack', 0, NO_TIME, true).isNew).toBe(false);
      p.timeResult('multitime', 1, 50000, true);

      const again = new Profile(quests(), storage);
      expect(again.bestTime('timeattack', 0)).toBe(35000);
      expect(again.bestTime('multitime', 1)).toBe(50000);
      expect(again.bestTime('multitime', 0)).toBeNull();
      // An older save, without times, still loads
      const old = { ...p.data } as Partial<typeof p.data>;
      delete old.times;
      expect(decodeProfile(encodeProfile(old as typeof p.data))?.times).toEqual({});
    });

    it('writes times as the site ranking did', () => {
      expect(formatRunTime(6597)).toBe(`0' 06" 597`);
      expect(formatRunTime(11034)).toBe(`0' 11" 034`);
      expect(formatRunTime(83456)).toBe(`1' 23" 456`);
    });
  });
});
