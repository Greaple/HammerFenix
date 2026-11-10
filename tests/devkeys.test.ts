import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Timer } from '../src/engine/Timer';
import { flashKeyCode } from '../src/engine/Input';
import { InputRecorder } from '../src/engine/InputRecording';
import { Data } from '../src/game/Data';
import { BatBoss, TuberculozBoss } from '../src/game/entity/Boss';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

afterEach(() => {
  session.fl_debug = false;
  for (let c = 0; c < 256; c++) session.input.setKeyCode(c, false);
});

function step(n = 1): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** A fresh game on `level`, run until the player can move, with the dev keys on. */
function start(level = 1): void {
  session.startGame(level, 1234);
  step(30);
  session.game.player!.fl_godMode = true;
  session.fl_debug = true;
}

/** Holds key `code` for one tick, then releases it for one. */
function tap(code: number): void {
  session.input.setKeyCode(code, true);
  step();
  session.input.setKeyCode(code, false);
  step();
}

describe('flashKeyCode', () => {
  it('maps browser key codes to Flash key codes', () => {
    expect(flashKeyCode('KeyK')).toBe(75);
    expect(flashKeyCode('Numpad7')).toBe(103);
    expect(flashKeyCode('Digit7')).toBe(103); // laptops: the top row stands for the numpad
    expect(flashKeyCode('ShiftRight')).toBe(16);
    expect(flashKeyCode('NumpadDivide')).toBe(111);
    expect(flashKeyCode('ArrowLeft')).toBe(37);
    expect(flashKeyCode('F1')).toBeUndefined();
  });
});

describe('dev keys (GameMode, Player.getDebugControls)', () => {
  it('do nothing with the dev switch off', () => {
    start();
    session.fl_debug = false;
    tap(75);
    expect(session.game.hasKey(3)).toBe(false);
  });

  it('are off while recording, since the recording would not replay', () => {
    start();
    session.input.startRecording(new InputRecorder());
    tap(75);
    session.input.stopRecording();
    expect(session.game.hasKey(3)).toBe(false);
  });

  it('Ctrl and three digits go to that level', () => {
    start(1);
    session.input.setKeyCode(17, true);
    tap(96 + 0);
    tap(96 + 1);
    expect(session.game.player!.debugInput).toBe('01');
    tap(96 + 2);
    session.input.setKeyCode(17, false);
    expect(session.game.player!.debugInput).toBe('');
    step(80);
    expect(session.game.world.currentId).toBe(12);
  });

  it('Backspace clears the digits; three digits alone spawn that special item', () => {
    start();
    tap(96 + 5);
    tap(8);
    expect(session.game.player!.debugInput).toBe('');
    const before = session.game.countList(Data.SPECIAL_ITEM);
    tap(96);
    tap(96);
    tap(96 + 4);
    expect(session.game.countList(Data.SPECIAL_ITEM)).toBe(before + 1);
  });

  it('K gives every key, N goes to the next level', () => {
    start(1);
    tap(75);
    for (let i = 0; i < 50; i++) expect(session.game.hasKey(i)).toBe(true);
    tap(78);
    step(80);
    expect(session.game.world.currentId).toBe(2);
  });

  it('numpad * removes every enemy', () => {
    start(10);
    for (let i = 0; i < 100 && session.game.countList(Data.BAD) === 0; i++) step();
    expect(session.game.countList(Data.BAD)).toBeGreaterThan(0);
    tap(106);
    step();
    expect(session.game.countList(Data.BAD)).toBe(0);
  });

  it('W cycles the weapons 1 to 9', () => {
    start();
    session.game.player!.changeWeapon(9);
    tap(87);
    expect(session.game.player!.currentWeapon).toBe(1);
  });

  it('H makes the hurry up timer run 21 times faster', () => {
    start();
    const t = session.game.huTimer;
    session.input.setKeyCode(72, true);
    step();
    expect(session.game.huTimer - t).toBe(21);
  });

  it('Shift slows the game (tmod 0.3) while held, Home puts it back', () => {
    start();
    session.input.setKeyCode(16, true);
    step();
    expect(Timer.tmod).toBe(0.3);
    session.input.setKeyCode(36, true);
    step();
    expect(Timer.tmod).toBe(1);
    session.input.setKeyCode(36, false);
    session.input.setKeyCode(16, false);
    step();
    expect(Timer.tmod).toBe(1);
  });
});

describe('boss dev keys', () => {
  it('K kills the Bat', () => {
    start(Data.BAT_LEVEL);
    const bat = session.game.getList(Data.BOSS)[0] as BatBoss;
    expect(bat).toBeInstanceOf(BatBoss);
    session.input.setKeyCode(75, true);
    step();
    expect(bat.fl_death).toBe(true);
  });

  it('Enter kills Tuberculoz, Shift takes his lives', () => {
    start(Data.TUBERCULOZ_LEVEL);
    const tub = session.game.getList(Data.BOSS)[0] as TuberculozBoss;
    expect(tub).toBeInstanceOf(TuberculozBoss);
    const lives = tub.lives;
    session.input.setKeyCode(16, true);
    step(3);
    expect(tub.lives).toBe(lives - 3);
    session.input.setKeyCode(16, false);
    session.input.setKeyCode(13, true);
    step();
    expect(tub.fl_death).toBe(true);
  });
});
