import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

describe('FX animations (Animation.update)', () => {
  it('the shield plays its intro once, then loops from its "loop" label', () => {
    session.initGame(6, 1234);
    step(20);
    const player = session.player!;
    player.shield(Data.SECOND * 60);
    const mc = (player as any).shieldMC.mc;

    const frames: number[] = [];
    for (let i = 0; i < 200; i++) {
      step(1);
      frames.push(mc._currentframe);
    }
    // `Animation.update` sends the last frame (48) back to 1, then that frame's queued
    // `gotoAndPlay("loop")` (frame 19) runs: the intro (frames 1 to 18) plays only once
    const firstLoop = frames.indexOf(47) + 1;
    expect(firstLoop).toBeGreaterThan(0);
    expect(frames.slice(0, firstLoop)).toContain(2);
    expect(Math.min(...frames.slice(firstLoop))).toBeGreaterThanOrEqual(19);
    expect(frames.slice(firstLoop).filter((f) => f === 47).length).toBeGreaterThanOrEqual(3);
  });
});
