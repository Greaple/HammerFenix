import { beforeAll, describe, expect, it } from 'vitest';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** The `loading` clip's text field `name`. */
function text(name: string): string | undefined {
  return session.loader.loading?.getText(name)?.text;
}

describe('game start from the site (Loader.gameReady / startGame)', () => {
  it('waits on "click to start" with the game stopped', () => {
    session.gameReady('solo');
    step(10);
    expect(session.loader.gameRunning).toBe(false);
    expect(session.gameRoot.visible).toBe(false);
    expect(text('title')).toBe(session.dataStore.getStatic(50));
    expect(text('bottom')).toBe(session.dataStore.getStatic(53));
    expect(text('subBottom')).toBe(session.dataStore.getStatic(57));
  });

  it('free modes say so instead of costing a game', () => {
    session.gameReady('tutorial');
    expect(text('subBottom')).toBe(session.dataStore.getStatic(58));
  });

  it('a click builds a new game and fades out the cover while it runs', () => {
    session.gameReady('solo');
    session.clickStart();
    expect(session.loader.gameRunning).toBe(true);
    expect(session.gameRoot.visible).toBe(true);
    expect(session.world.currentId).toBe(0);
    expect(session.loader.loading).not.toBeNull();
    // 2% per Flash frame: 50 frames at 40 Hz, 40 logic ticks
    step(45);
    expect(session.loader.loading).toBeNull();
    expect(session.player).not.toBeNull();
  });

  it('the menu starts at once: no "click to start", no cover (port addition)', () => {
    session.startNow('solo');
    expect(session.loader.gameRunning).toBe(true);
    expect(session.loader.waitingStart).toBe(false);
    expect(session.loader.loading).toBeNull();
    expect(session.gameRoot.visible).toBe(true);
    expect(session.siteMode).toBe('solo');
    // The level is read first, with nothing drawn: the menu waits for `levelShown`
    expect(session.levelShown).toBe(false);
    step(20);
    expect(session.levelShown).toBe(true);
    expect(session.player).not.toBeNull();
  });

  it('ignores clicks during a game', () => {
    const seed = session.seed;
    session.clickStart();
    expect(session.seed).toBe(seed);
  });
});
