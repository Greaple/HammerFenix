import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAD, padLayout } from '../src/engine/Gamepad';
import { InputController } from '../src/engine/Input';
import { Data } from '../src/game/Data';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import type { GameSession } from '../src/game/GameSession';
import { PAD_THEMES, padIconHtml, padLabel, padStartText } from '../src/game/gui/PadGlyphs';
import { createHeadlessSession } from './helpers/headless';

/** A fake controller with the standard mapping. */
class FakePad {
  connected = true;
  readonly mapping = 'standard';
  readonly buttons = Array.from({ length: 17 }, () => ({
    pressed: false,
    touched: false,
    value: 0,
  }));
  readonly axes = [0, 0, 0, 0];
  constructor(
    readonly index: number,
    readonly id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  ) {}

  press(button: number, on = true): this {
    this.buttons[button].pressed = on;
    this.buttons[button].value = on ? 1 : 0;
    return this;
  }

  stick(x: number, y: number): this {
    this.axes[0] = x;
    this.axes[1] = y;
    return this;
  }
}

let pads: (FakePad | null)[] = [];

beforeEach(() => {
  pads = [];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The input after one poll. */
function poll(input: InputController): InputController {
  input.poll();
  return input;
}

describe('controller mapping (G.1)', () => {
  it('maps the standard buttons to the game actions', () => {
    const pad = new FakePad(0);
    pads = [pad];
    const input = new InputController();
    const cases: [number, string][] = [
      [PAD.LEFT, 'left'],
      [PAD.RIGHT, 'right'],
      [PAD.UP, 'jump'],
      [PAD.A, 'jump'],
      [PAD.DOWN, 'down'],
      [PAD.B, 'attack'],
      [PAD.X, 'attack'],
      [PAD.R2, 'attack'],
      [PAD.START, 'pause'],
      [PAD.BACK, 'music'],
      [PAD.Y, 'disguise'],
      [PAD.L1, 'map'],
    ];
    for (const [button, action] of cases) {
      pad.press(button);
      expect(poll(input).isDown(action as never), `button ${button}`).toBe(true);
      pad.press(button, false);
      expect(poll(input).isDown(action as never)).toBe(false);
    }
    // The other buttons (R1, L2, the sticks' clicks) do nothing
    for (const b of [5, 6, 10, 11]) pad.press(b);
    poll(input);
    for (const [, action] of cases) expect(input.isDown(action as never)).toBe(false);
  });

  it('reads the left stick with a dead zone and hysteresis', () => {
    const pad = new FakePad(0);
    pads = [pad];
    const input = new InputController();
    pad.stick(-0.4, 0);
    expect(poll(input).isDown('left')).toBe(false); // in the dead zone
    pad.stick(-0.6, 0);
    expect(poll(input).isDown('left')).toBe(true);
    pad.stick(-0.4, 0);
    expect(poll(input).isDown('left')).toBe(true); // held until under the release point
    pad.stick(-0.2, 0);
    expect(poll(input).isDown('left')).toBe(false);
    // Up asks a firmer push
    pad.stick(0, -0.6);
    expect(poll(input).isDown('jump')).toBe(false);
    pad.stick(0, -0.8);
    expect(poll(input).isDown('jump')).toBe(true);
    pad.stick(0, 0.9);
    poll(input);
    expect(input.isDown('jump')).toBe(false);
    expect(input.isDown('down')).toBe(true);
  });

  it('player 1 is the first controller; the next one takes over when it is unplugged', () => {
    const first = new FakePad(0);
    const second = new FakePad(1, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c)');
    pads = [first, second];
    const input = new InputController();
    const events: string[] = [];
    input.onPadConnect = (id) => events.push(`+${id.slice(0, 4)}`);
    input.onPadDisconnect = (id) => events.push(`-${id.slice(0, 4)}`);
    second.press(PAD.B);
    expect(poll(input).isDown('attack')).toBe(false);
    expect(input.padLayout).toBe('xbox');
    pads = [null, second];
    poll(input);
    expect(events).toEqual(['+Xbox', '-Xbox', '+Wire']);
    expect(input.isDown('attack')).toBe(true);
    expect(input.padLayout).toBe('playstation');
  });

  it('menus: the D-pad moves, A and Start confirm, B goes back', () => {
    const pad = new FakePad(0);
    pads = [pad];
    const input = new InputController();
    pad.press(PAD.A);
    poll(input);
    expect(input.consumeMenu('ok')).toBe(true);
    expect(input.consumeMenu('ok')).toBe(false); // edge only
    expect(input.consumeMenu('up')).toBe(false); // A jumps in the game, not up in a menu
    pad.press(PAD.A, false).press(PAD.B);
    poll(input);
    expect(input.consumeMenu('back')).toBe(true);
    expect(input.consumeMenu('ok')).toBe(false); // B drops bombs, it does not confirm
    pad.press(PAD.B, false).press(PAD.START);
    poll(input);
    expect(input.consumeMenu('ok')).toBe(true);
    pad.press(PAD.START, false).press(PAD.DOWN);
    poll(input);
    expect(input.consumeMenu('down')).toBe(true);
  });

  it('the keyboard keeps its menu keys: arrows, bomb key confirms, pause goes back', () => {
    const input = new InputController();
    input.setTouch('attack', true);
    poll(input);
    expect(input.consumeMenu('ok')).toBe(true);
    input.setTouch('attack', false);
    input.setTouch('jump', true);
    poll(input);
    expect(input.consumeMenu('up')).toBe(true);
  });

  it('follows the device in use for the prompts', () => {
    const pad = new FakePad(0);
    pads = [pad];
    const input = new InputController();
    const seen: string[] = [];
    input.onDeviceChange = (d) => seen.push(d);
    expect(input.device).toBe('keyboard');
    poll(input); // plugged in, not used yet
    expect(input.device).toBe('keyboard');
    pad.stick(0.9, 0);
    poll(input);
    expect(input.device).toBe('gamepad');
    input.setTouch('jump', true);
    expect(input.device).toBe('touch');
    pad.press(PAD.A);
    poll(input);
    expect(input.device).toBe('gamepad');
    // Unplugged: back to the last other device
    pads = [];
    poll(input);
    expect(input.device).toBe('touch');
    expect(seen).toEqual(['gamepad', 'touch', 'gamepad', 'touch']);
  });

  it('names the buttons of each maker', () => {
    expect(padLayout('054c-09cc-Wireless Controller')).toBe('playstation');
    expect(padLayout('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)')).toBe(
      'playstation',
    );
    expect(padLayout('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe(
      'nintendo',
    );
    expect(padLayout('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(padLayout('USB Gamepad (Vendor: 0079 Product: 0011)')).toBe('generic');
    expect(padLabel('start', 'generic')).toBe('START');
    expect(padLabel('a', 'xbox')).toBe('A');
    expect(padLabel('a', 'playstation')).toBe('✕');
    expect(padLabel('a', 'nintendo')).toBe('B'); // the bottom button
    expect(padLabel('start', 'nintendo')).toBe('+');
    expect(['xbox', 'playstation', 'nintendo'].map((l) => padLabel('l1', l as never))).toEqual([
      'LB',
      'L1',
      'L',
    ]);
    expect(padStartText('fr', 'xbox')).toBe('Appuyez sur A pour commencer...');
    expect(padStartText('en', 'playstation')).toBe('Press ✕ to start...');
  });
});

describe('controller icons (assets-src/pad-icons)', () => {
  it('draws the Figma icons in the screen colors, with fallbacks', () => {
    const a = padIconHtml('a', 'xbox', 24)!;
    expect(a).toMatch(/^<svg width="32" height="32"/); // a 24 px button in its 32 px frame
    expect(a).toContain(PAD_THEMES.onLight.body);
    expect(a).not.toContain('__');
    // An unknown controller: Xbox's buttons, its own Start drawn as a label
    expect(padIconHtml('a', 'generic', 24)).toBe(a);
    expect(padIconHtml('start', 'generic', 24)).toBeNull();
    // Each maker has its own, for every button the screens show
    expect(padIconHtml('dpad', 'playstation', 24)).not.toBe(padIconHtml('dpad', 'xbox', 24));
    for (const layout of ['xbox', 'playstation', 'nintendo'] as const) {
      for (const b of ['a', 'b', 'x', 'y', 'l1', 'r2', 'start', 'back', 'dpad', 'stick'] as const) {
        expect(padIconHtml(b, layout, 24), `${layout} ${b}`).not.toBeNull();
      }
    }
  });
});

describe('controller in a game (G.1)', () => {
  let session: GameSession;

  beforeAll(async () => {
    session = await createHeadlessSession();
  });

  it('drops a bomb with B, through the recorded action mask', () => {
    const pad = new FakePad(0);
    pads = [pad];
    session.initGame(1, 1234);
    for (let i = 0; i < 30; i++) session.gameLoop.stepSingleFrame();
    pad.press(PAD.B);
    session.gameLoop.stepSingleFrame();
    expect(session.countList(Data.BOMB)).toBe(1);
    pad.press(PAD.B, false);
    session.gameLoop.stepSingleFrame();
  });

  it('Start pauses and unpauses', () => {
    const pad = new FakePad(0);
    pads = [pad];
    session.initGame(1, 1234);
    for (let i = 0; i < 30; i++) session.gameLoop.stepSingleFrame();
    pad.press(PAD.START);
    session.gameLoop.stepSingleFrame();
    expect(session.fl_pause).toBe(true);
    // The pause screen hides its keyboard keys for the controller's buttons
    const mc = (session as unknown as { pauseMC: SwfMovieClip }).pauseMC;
    expect(mc.childAtDepth(26)?.visible).toBe(false); // the space bar
    pad.press(PAD.START, false);
    session.gameLoop.stepSingleFrame();
    session.input.setDevice('keyboard');
    session.gameLoop.stepSingleFrame();
    expect(mc.childAtDepth(26)?.visible).toBe(true);
    pad.press(PAD.START);
    session.gameLoop.stepSingleFrame();
    expect(session.fl_pause).toBe(false);
    pad.press(PAD.START, false);
    session.gameLoop.stepSingleFrame();
  });

  it('a pause asked during a level change waits for the controls to unlock', () => {
    session.initGame(1, 1234);
    for (let i = 0; i < 30; i++) session.gameLoop.stepSingleFrame();
    session.lock();
    session.requestPause();
    expect(session.fl_pause).toBe(false);
    session.gameLoop.stepSingleFrame();
    expect(session.fl_pause).toBe(false);
    session.unlock();
    session.gameLoop.stepSingleFrame();
    expect(session.fl_pause).toBe(true);
    session.onUnpause();
  });
});
