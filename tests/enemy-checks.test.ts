/**
 * Fixes from the enemy spot checks against the original in Ruffle (roadmap 2B.5,
 * docs/LEVELS.md).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

describe('new game while paused', () => {
  it('drops the old pause screen (a new GameMode has none)', () => {
    session.restartLevel();
    step(80);
    session.game.onPause();
    const paused = (session.game as unknown as { pauseMC: SwfMovieClip | null }).pauseMC;
    expect(paused?.parent).toBeTruthy();
    session.restartLevel();
    step(80);
    expect(session.game.fl_pause).toBe(false);
    expect((session.game as unknown as { pauseMC: SwfMovieClip | null }).pauseMC).toBeNull();
    expect(paused?.parent).toBeFalsy();
  });
});
