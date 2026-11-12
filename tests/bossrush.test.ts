import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import { Data } from '../src/game/Data';
import type { PlayerEntity } from '../src/game/entity/Player';
import type { GameSession } from '../src/game/GameSession';
import type { GameResult } from '../src/game/Loader';
import { Adventure } from '../src/game/mode/Adventure';
import { BossRush } from '../src/game/mode/BossRush';
import { BOSS_RUSH_FAMILY, Profile } from '../src/game/Profile';
import { QuestEngine } from '../src/game/Quests';
import { createHeadlessSession } from './helpers/headless';

/** Roadmap 4.5: the boss rush, the "Tubercourse" (`mode.BossRush`). */
describe('Boss rush', () => {
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
  const game = () => session.game as BossRush;
  const players = () => session.game.getList(Data.PLAYER) as PlayerEntity[];
  const lang = (id: number) => session.dataStore.getLangText(id);
  /** Runs until the level shows and the game is unlocked. */
  const ready = () => {
    for (let i = 0; i < 300 && (game().fl_lock || !game().chrono.fl_init); i++) run(1);
  };
  /** Level 3 by default: an idle player stays on it (level 1 drops them to level 2). */
  const start = (level = 3, options = '', families = '0,7,1000,18') => {
    session.setParameters(families, options);
    session.startGame(level, 42, 'bossrush');
    ready();
  };
  /** Changes level and waits for the next one to be played. */
  const changeLevel = (id: number) => {
    game().goto(id);
    for (let i = 0; i < 300 && game().world.currentId !== id; i++) run(1);
    ready();
  };

  it('plays the Adventure and its dimensions, without disguise, mirror or nightmare', () => {
    start(3, 'mirror,nightmare');
    const g = game();
    expect(g).toBeInstanceOf(BossRush);
    expect(g).toBeInstanceOf(Adventure);
    expect(session.isBossRush()).toBe(true);
    expect(g._name).toBe('$bossRush');
    expect(g.world.set.name).toBe('adventure');
    expect(g.dimensions.length).toBe(5);
    expect(g.world.currentId).toBe(3);
    expect(g.fl_map).toBe(true);
    expect(g.fl_disguise).toBe(false);
    expect(g.fl_mirror).toBe(false);
    expect(g.fl_nightmare).toBe(false);
    expect(g.world.fl_mirror).toBe(false);
  });

  it('gives a faster player two bombs and the up kick, again after a death', () => {
    // The Tornade option is overridden too
    start(3, 'boost', '0,7,1000,18,102');
    const p = players()[0];
    expect(p.speedFactor).toBe(1.5);
    expect(p.maxBombs).toBe(2);
    expect(p.fl_upKick).toBe(true);
    expect(p.lives).toBe(2);

    p.maxBombs = 1;
    p.fl_upKick = false;
    p.killPlayer();
    expect(p.lives).toBe(1);
    for (let i = 0; i < 200 && p.speedFactor !== 1.5; i++) run(1);
    expect(p.speedFactor).toBe(1.5);
    expect(p.maxBombs).toBe(2);
    expect(p.fl_upKick).toBe(true);
  });

  it('starts the chrono with the first level, and stops it while the game is locked', () => {
    start();
    const g = game();
    expect(g.chrono.fl_init).toBe(true);
    expect(g.chrono.fl_stop).toBe(false);
    const t0 = g.chrono.get();
    expect(t0).toBeLessThan(100);
    run(64);
    expect(g.chrono.get()).toBe(t0 + 2000);

    g.onPause();
    expect(g.fl_pause).toBe(true);
    const paused = g.chrono.get();
    run(64);
    expect(g.chrono.get()).toBe(paused);
    g.onUnpause();
    run(32);
    expect(g.chrono.get()).toBe(paused + 1000);
  });

  it('shows the time and the average level time on the pause screen (frame 4)', () => {
    start();
    const g = game();
    run(32 * 65);
    g.onPause();
    const mc = g['pauseMC']!;
    expect(mc._currentframe).toBe(4);
    const text = (name: string) => mc.getText(name)?.text;
    expect(text('title')).toBe(lang(36));
    expect(text('timeLabel')).toBe(lang(37));
    expect(text('time')).toBe(`01" 05`);
    expect(text('timeAvgLabel')).toBe(lang(38));
    // No level done yet
    expect(text('timeAvg')).toBe('--');
    g.onUnpause();

    changeLevel(4);
    run(32 * 10);
    g.onPause();
    expect(g['pauseMC']!.getText('timeAvg')!.text).toBe(`01" 05`);
    expect(g['pauseMC']!.getText('time')!.text).toBe(`01" 15`);
    g.onUnpause();
  });

  it('keeps each level time, averages it, and shows it when the next level starts', () => {
    start();
    const g = game();
    const shown: SwfMovieClip[] = [];
    const attach = g.depthMan.attach.bind(g.depthMan);
    g.depthMan.attach = (linkage, plan) => {
      const mc = attach(linkage, plan);
      if (linkage === 'hammer_interf_time') shown.push(mc);
      return mc;
    };
    run(32 * 4);
    changeLevel(4);
    expect(g.levelAvg).toBe(4000);
    expect(g.lastLevelTimer).toBeNull();
    expect(shown.length).toBe(1);
    expect(shown[0]._x).toBe(5);
    expect(shown[0].getClip('sub')!.getText('field')!.text).toBe(`${lang(39)} +00" 04`);

    // The scroll is not counted; the average is halved with each new time
    run(32 * 8);
    changeLevel(5);
    expect(g.levelAvg).toBe(6000);
    expect(g.levelTimer).toBe(g.chrono.get());
  });

  it('puts the chrono on the world map when leaving level 10, 20...', () => {
    start(10);
    const g = game();
    run(32 * 3);
    changeLevel(11);
    // With the travels, as the original keeps it
    const times = g.mapTravels.filter((e) => e.eid === Data.EVENT_TIME);
    expect(times.map((e) => [e.lid, e.misc])).toEqual([[10, `00" 03`]]);
    run(32);
    changeLevel(12);
    expect(g.mapTravels.filter((e) => e.eid === Data.EVENT_TIME).length).toBe(1);
  });

  it('sends the Adventure result at the game over', () => {
    start();
    const p = players()[0];
    p.getScore(null, 1200);
    p.lives = 0;
    p.killPlayer();
    expect(game().fl_gameOver).toBe(true);
    for (let i = 0; i < 400 && results.length === 0; i++) session.stepAnimation();
    const r = results[0];
    if (r?.kind !== 'gameOver') throw new Error('expected a game over');
    expect(r.score).toBe(1200);
    expect(r.runId).toBeNull();
    expect(r.stats.reachedLevel).toBe(3);
  });

  describe('menu', () => {
    const quests = () => new QuestEngine(session.dataStore.quests, session.dataStore.items);
    const memory = () => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
      };
    };

    it('opens with Tuberculoz cape (quest 48), with no option to choose', () => {
      const engine = quests();
      const p = new Profile(engine, memory());
      expect(p.hasMode('bossrush')).toBe(false);
      expect(engine.addGame(p.data, [[113, 1]])).toContain(48);
      expect(p.data.families).toContain(BOSS_RUSH_FAMILY);
      expect(p.hasMode('bossrush')).toBe(true);
      expect(p.optionsParam('bossrush')).toBe('');
      expect(p.runOption('bossrush')).toBeNull();
    });
  });
});
