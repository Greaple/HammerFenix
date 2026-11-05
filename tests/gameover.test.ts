import { beforeAll, describe, expect, it } from 'vitest';
import { PersistCodec } from '../src/engine/codec/PersistCodec';
import { Data } from '../src/game/Data';
import { ScoreItem, SpecialItem } from '../src/game/entity/Item';
import type { GameSession } from '../src/game/GameSession';
import type { GameResult } from '../src/game/Loader';
import packageJson from '../package.json';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;
let results: GameResult[] = [];

beforeAll(async () => {
  session = await createHeadlessSession();
  session.onGameResult = (r) => results.push(r);
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** A fresh game on `level`, run until it is ready. */
function start(level = 6): void {
  session.initGame(level, 1234);
  results = [];
  step(20);
}

/** Loses the player's last life. */
function die(): void {
  session.player!.lives = 0;
  session.player!.killPlayer();
}

/** Logic ticks until the Loader is done (44 Flash frames at 40 Hz, 5 per 4 ticks). */
const FADE_TICKS = 40;

describe('game over', () => {
  it('stops the game and fades in the save screen, then hands over the result', () => {
    start();
    const score = 1234;
    session.player!.getScore(null, score);
    die();

    expect(session.fl_gameOver).toBe(true);
    expect(session.loader.fl_gameOver).toBe(true);
    const loading = session.loader.loading!;
    expect(loading).not.toBeNull();
    expect(loading._currentframe).toBe(5);
    expect(loading.getText('bottom')?.text).toBe(session.dataStore.getStatic(55));
    expect(loading.getText('subBottom')?.text).toBe(session.dataStore.getStatic(56));
    expect(loading._alpha).toBe(0);

    // The game's main stops at once
    const cycle = session.cycle;
    step(5);
    expect(session.cycle).toBe(cycle);
    expect(session.gameRoot.visible).toBe(true);

    // The game is removed when the screen is covered...
    step(15);
    expect(session.gameRoot.visible).toBe(false);
    expect(results.length).toBe(0);

    // ...and the site takes over once the alpha count reaches 220
    step(FADE_TICKS - 20);
    expect(session.loader.fl_done).toBe(true);
    expect(results.length).toBe(1);
    const r = results[0];
    expect(r).toBe(session.lastResult);
    if (r.kind !== 'gameOver') throw new Error('expected a game over');
    expect(r.score).toBe(score);
    expect(r.runId).toBeNull();
    expect(r.stats.reachedLevel).toBe(6);
    expect(r.stats.data[0]).toBe('F=' + packageJson.version);
    expect(r.stats.data[1]).toMatch(/^T=\d+$/);
    expect(r.stats.data.length).toBe(2);
  });

  it('sends the item picks, the score items at id + 1000', () => {
    start();
    const p = session.player!;
    const sp = SpecialItem.attach(session, p.x, p.y, 13, null)!;
    p.hit(sp);
    const sc = ScoreItem.attach(session, p.x, p.y, 7, null);
    p.hit(sc);
    p.hit(ScoreItem.attach(session, p.x, p.y, 7, null));
    die();
    step(FADE_TICKS);
    const r = results[0];
    if (r.kind !== 'gameOver') throw new Error('expected a game over');
    expect(r.stats.item2[13]).toBe(1);
    expect(r.stats.item2[1007]).toBe(2);
    expect(r.uniqueItems).toBe(2);
  });

  it('marks the game illegal when the score was changed from outside', () => {
    start();
    const p = session.player!;
    p.getScore(null, 500);
    p.score = 99999; // a memory editor
    p.getScore(null, 500);
    expect(session.history.some((h) => h.startsWith('!'))).toBe(true);
    die();
    step(FADE_TICKS);
    const r = results[0];
    if (r.kind !== 'gameOver') throw new Error('expected a game over');
    expect(r.stats.data).toEqual(['F=' + packageJson.version, expect.any(String), 'illegal']);
  });

  it('logs without "$" and with ":" as "."', () => {
    start();
    session.logAction('$a:b$c');
    expect(session.history.at(-1)).toBe('a.bc');
    session.logIllegal('$SCS');
    expect(session.history.at(-1)).toBe('!SCS');
  });

  it('keeps the first non-zero final score', () => {
    start();
    session.registerScore(1, 0);
    session.registerScore(1, 500);
    session.registerScore(1, 800);
    expect(session.savedScores[1]).toBe(500);
  });

  it('counts the frames played, not those of the level change', () => {
    start();
    const d = session.duration;
    step(10);
    expect(session.duration).toBe(d + 10);
    session.nextLevel();
    step(10);
    expect(session.duration).toBe(d + 10);
  });

  it('ends the game with the elevator timer, with the score registered', () => {
    start();
    session.player!.getScore(null, 777);
    session.endModeTimer = 1;
    step(1);
    expect(session.fl_gameOver).toBe(true);
    expect(session.savedScores[0]).toBe(777);
  });

  it('restarts on a key once the Loader is done (placeholder until 3.1c)', () => {
    start();
    die();
    session.input.setTouch('attack', true);
    step(5);
    session.input.setTouch('attack', false);
    expect(session.fl_gameOver).toBe(true); // too early: ignored
    step(FADE_TICKS);
    expect(session.loader.fl_done).toBe(true);
    session.input.setTouch('attack', true);
    step(1);
    session.input.setTouch('attack', false);
    expect(session.fl_gameOver).toBe(false);
    expect(session.loader.loading).toBeNull();
    expect(session.gameRoot.visible).toBe(true);
    expect(session.world.currentId).toBe(0);
  });
});

describe('end of the set', () => {
  it('leaves for endGame.html with the picks, the game running until it is covered', () => {
    start();
    const p = session.player!;
    p.hit(SpecialItem.attach(session, p.x, p.y, 13, null)!);
    p.hit(ScoreItem.attach(session, p.x, p.y, 7, null));
    session.onEndOfSet();

    expect(session.fl_gameOver).toBe(false);
    expect(session.fl_lock).toBe(true);
    expect(session.loader.fl_exit).toBe(true);
    expect(session.loader.loading!._currentframe).toBe(6);

    // The game's main still runs (locked) until its clip is removed
    const cycle = session.cycle;
    step(5);
    expect(session.cycle).toBeGreaterThan(cycle);
    step(FADE_TICKS);
    expect(session.loader.fl_done).toBe(true);

    const r = results[0];
    if (r.kind !== 'exitGame') throw new Error('expected an exit');
    expect(r.url).toBe('endGame.html');
    const codec = new PersistCodec();
    const [special, score] = codec.decode<string>(r.params!)!.split(':');
    expect(codec.decode<number[]>(special)![13]).toBe(1);
    expect(codec.decode<number[]>(score)![7]).toBe(1);
  });

  it('happens when going past the last level', () => {
    start();
    session.goto(session.world.levelCount);
    expect(session.loader.fl_exit).toBe(true);
  });
});
