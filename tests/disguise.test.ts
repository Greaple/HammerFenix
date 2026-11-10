import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let s: GameSession;

beforeAll(async () => {
  s = await createHeadlessSession();
});

function step(n = 1): void {
  for (let i = 0; i < n; i++) s.gameLoop.stepSingleFrame();
}

/** A new game with the system families and `extra`, stepped until its first level is ready. */
function start(extra: number[]): void {
  s.setParameters([SYSTEM_FAMILIES, ...extra].join(','), '');
  s.startGame(1, 1234);
  step(60);
}

/** One press of the disguise key, then let go. */
function press(): number {
  s.input.setTouch('disguise', true);
  step();
  s.input.setTouch('disguise', false);
  step();
  return s.game.player!.head;
}

describe('disguises (GameMode.getControls, key D)', () => {
  it('cycles through the heads of the quest families the profile has', () => {
    start([109, 110, 111, 112, 113]);
    expect(s.game.player!.head).toBe(Data.HEAD_NORMAL);
    const heads = [press(), press(), press(), press(), press(), press()];
    expect(heads).toEqual([
      Data.HEAD_AFRO,
      Data.HEAD_CERBERE,
      Data.HEAD_PIOU,
      Data.HEAD_MARIO,
      Data.HEAD_TUB,
      Data.HEAD_NORMAL,
    ]);
  });

  it('skips the heads whose family is missing', () => {
    start([110, 112]);
    expect([press(), press(), press()]).toEqual([
      Data.HEAD_CERBERE,
      Data.HEAD_MARIO,
      Data.HEAD_NORMAL,
    ]);
  });

  it('does nothing with no disguise family, and a held key changes the head once', () => {
    start([]);
    expect(press()).toBe(Data.HEAD_NORMAL);

    start([109]);
    s.input.setTouch('disguise', true);
    step(10);
    expect(s.game.player!.head).toBe(Data.HEAD_AFRO);
    s.input.setTouch('disguise', false);
    step();
  });

  it('works during the pause, and not when fl_disguise is off', () => {
    start([109]);
    s.game.onPause();
    expect(press()).toBe(Data.HEAD_AFRO);
    s.game.onUnpause();
    step();
    s.game.fl_disguise = false;
    expect(press()).toBe(Data.HEAD_AFRO);
    s.game.fl_disguise = true;
  });
});
