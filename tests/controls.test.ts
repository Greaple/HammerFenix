import { beforeAll, describe, expect, it } from 'vitest';
import { InputController } from '../src/engine/Input';
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

describe('key locks (PlayerController.keyLocks)', () => {
  it('the controller releases its locks only when it runs', () => {
    const input = new InputController();
    input.setTouch('attack', true);
    input.poll();
    expect(input.keyIsDown('attack')).toBe(true);
    // Released while the controller does not run: the lock stays
    input.setTouch('attack', false);
    input.poll();
    input.setTouch('attack', true);
    input.poll();
    expect(input.keyIsDown('attack')).toBe(false);
    // The controller runs while the key is up: unlocked
    input.setTouch('attack', false);
    input.poll();
    input.releaseControllerLocks();
    input.setTouch('attack', true);
    input.poll();
    input.releaseControllerLocks();
    expect(input.keyIsDown('attack')).toBe(true);
  });

  it('menu presses (consumePress) keep their own locks, released on every poll', () => {
    const input = new InputController();
    input.setTouch('attack', true);
    input.poll();
    expect(input.keyIsDown('attack')).toBe(true);
    expect(input.consumePress('attack')).toBe(true);
    input.setTouch('attack', false);
    input.poll();
    input.setTouch('attack', true);
    input.poll();
    expect(input.consumePress('attack')).toBe(true);
  });

  it('a bomb key pressed again while the controls are locked drops no bomb on unlock', () => {
    session.startGame(1, 1234);
    step(30);
    const p = session.game.player!;
    const input = session.input;
    input.setTouch('attack', true);
    step();
    expect(session.game.countList(Data.BOMB)).toBe(1);
    p.fl_lockControls = true;
    input.setTouch('attack', false);
    step();
    input.setTouch('attack', true);
    step();
    session.game.destroyList(Data.BOMB); // so the bomb limit does not hide a drop
    step();
    expect(session.game.countList(Data.BOMB)).toBe(0);
    p.fl_lockControls = false;
    p.coolDown = 0;
    step(); // the controller runs with the key still locked: no bomb
    expect(session.game.countList(Data.BOMB)).toBe(0);
    input.setTouch('attack', false);
  });
});

describe('FxManager.dust', () => {
  it('attaches 7 dust clips, on frames 5 to 9', () => {
    session.startGame(1, 1234);
    step(30);
    const fx = session.game.fxMan as unknown as { animList: { mc: { _currentframe: number } }[] };
    const before = fx.animList.length;
    const p = session.game.player!;
    session.game.fxMan.dust(p.cx, p.cy + 1);
    const added = fx.animList.slice(before);
    expect(added).toHaveLength(7);
    for (const a of added) {
      expect(a.mc._currentframe).toBeGreaterThanOrEqual(5);
      expect(a.mc._currentframe).toBeLessThanOrEqual(9);
    }
  });
});
