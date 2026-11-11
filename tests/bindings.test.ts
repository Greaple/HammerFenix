import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BINDINGS_KEY,
  type Bindings,
  bindButton,
  bindingKeys,
  bindKey,
  DEFAULT_BINDINGS,
  isBindableKey,
  keyName,
  loadBindings,
  saveBindings,
} from '../src/engine/Bindings';
import { PAD } from '../src/engine/Gamepad';
import { DEFAULT_KEYS, flashKeyCode, InputController, Key } from '../src/engine/Input';
import type { GameSession } from '../src/game/GameSession';
import { padButtonOf, padLabel } from '../src/game/gui/PadGlyphs';
import { createHeadlessSession } from './helpers/headless';

/** A `Storage` in memory. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

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
    readonly id = `Pad ${index}`,
  ) {}

  press(button: number, on = true): this {
    this.buttons[button].pressed = on;
    this.buttons[button].value = on ? 1 : 0;
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

const L = 76;
const K = 75;

/** Applies bindings to the input, as `main.ts` does. */
function apply(input: InputController, b: Bindings): void {
  input.setMoveKeys(bindingKeys(b), b.pad);
}

describe('bindings model (G.4)', () => {
  it('starts on the keys the game had before G.4', () => {
    expect(bindingKeys(DEFAULT_BINDINGS)).toEqual(DEFAULT_KEYS);
  });

  it('puts a key in one slot and takes it off the other moves', () => {
    const b = bindKey(DEFAULT_BINDINGS, 'jump', 0, 65); // A, a left key
    expect(b.keys.jump).toEqual([[65], [87, 90]]);
    expect(b.keys.left).toEqual([[Key.LEFT], [81]]);
    // The second slot of the same move too
    const c = bindKey(b, 'jump', 1, 65);
    expect(c.keys.jump).toEqual([[], [65]]);
    // The defaults are left alone
    expect(DEFAULT_BINDINGS.keys.left).toEqual([[Key.LEFT], [65, 81]]);
  });

  it('puts a button on one move and takes it off the others', () => {
    const b = bindButton(DEFAULT_BINDINGS, 'jump', PAD.B);
    expect(b.pad.jump).toEqual([PAD.B]);
    expect(b.pad.attack).toEqual([PAD.X, PAD.R2]);
  });

  it('names keys, and keeps the game keys out of the moves', () => {
    expect(keyName(Key.SPACE, 'fr')).toBe('Espace');
    expect(keyName(Key.SPACE, 'es')).toBe('Espacio');
    expect(keyName(L)).toBe('L');
    expect(keyName(97)).toBe('1');
    expect(keyName(Key.LEFT)).toBe('←');
    expect(keyName(112)).toBeNull(); // F1: the game cannot read it
    for (const kc of [80, 27, 77, 69, 67, 79]) expect(isBindableKey(kc)).toBe(false); // P Esc M E C O
    expect(isBindableKey(L)).toBe(true);
  });

  it('saves and loads, and checks what it loads', () => {
    const storage = memoryStorage();
    expect(loadBindings(storage)).toEqual(DEFAULT_BINDINGS);
    const b = bindButton(bindKey(DEFAULT_BINDINGS, 'right', 1, L), 'attack', PAD.L2);
    saveBindings(b, storage);
    expect(loadBindings(storage)).toEqual(b);

    storage.setItem(BINDINGS_KEY, '{not json');
    expect(loadBindings(storage)).toEqual(DEFAULT_BINDINGS);
    // A game key, an unknown key or button, a broken move: that move's defaults
    storage.setItem(
      BINDINGS_KEY,
      JSON.stringify({
        keys: { ...b.keys, jump: [[80], []], down: 'x' },
        pad: { ...b.pad, left: [PAD.START], right: [99] },
      }),
    );
    const got = loadBindings(storage);
    expect(got.keys.right).toEqual([[Key.RIGHT], [L]]);
    expect(got.keys.jump).toEqual(DEFAULT_BINDINGS.keys.jump);
    expect(got.keys.down).toEqual(DEFAULT_BINDINGS.keys.down);
    expect(got.pad.left).toEqual(DEFAULT_BINDINGS.pad.left);
    expect(got.pad.right).toEqual(DEFAULT_BINDINGS.pad.right);
    expect(got.pad.attack).toEqual([PAD.L2]);
  });

  it('shows every bindable button', () => {
    expect(padButtonOf(PAD.L2)).toBe('l2');
    expect(padButtonOf(PAD.LEFT)).toBe('dpadLeft');
    expect(padButtonOf(99)).toBeNull();
    expect(padLabel('l2', 'xbox')).toBe('LT');
    expect(padLabel('l2', 'nintendo')).toBe('ZL');
    expect(padLabel('r3', 'playstation')).toBe('R3');
  });
});

describe('the input with the player’s bindings (G.4)', () => {
  it('reads player 1’s own keys, for new players and new games too', () => {
    const input = new InputController();
    apply(input, bindKey(DEFAULT_BINDINGS, 'right', 0, L));
    input.setKeyCode(L, true);
    input.poll();
    expect(input.isDown('right')).toBe(true);
    input.setKeyCode(L, false);
    input.setKeyCode(Key.RIGHT, true);
    input.poll();
    expect(input.isDown('right')).toBe(false);
    input.setKeyCode(Key.RIGHT, false);
    input.resetKeys();
    expect(input.playerKeys(0).right).toEqual([L, 68]);
    input.setPlayerCount(2);
    expect(input.playerKeys(1).right).toEqual([L, 68]);
  });

  it('leaves the keys a mode gave a player', () => {
    const input = new InputController();
    const coop = { ...DEFAULT_KEYS, attack: [Key.ENTER] };
    input.setPlayerKeys(0, coop);
    apply(input, bindKey(DEFAULT_BINDINGS, 'attack', 0, K));
    expect(input.playerKeys(0)).toBe(coop);
  });

  it('reads the controller’s own buttons; the stick follows the D-pad', () => {
    const pad = new FakePad(0);
    pads = [pad];
    const input = new InputController();
    apply(input, bindButton(bindButton(DEFAULT_BINDINGS, 'attack', PAD.L2), 'jump', PAD.A));
    pad.press(PAD.L2);
    input.poll();
    expect(input.isDown('attack')).toBe(true);
    pad.press(PAD.L2, false).press(PAD.B);
    input.poll();
    expect(input.isDown('attack')).toBe(false);
    pad.press(PAD.B, false);
    // Up no longer jumps, on the D-pad or the stick
    pad.press(PAD.UP);
    input.poll();
    expect(input.isDown('jump')).toBe(false);
    pad.press(PAD.UP, false);
    pad.axes[1] = -1;
    input.poll();
    expect(input.isDown('jump')).toBe(false);
    pad.axes[1] = 0;
    // The stick is the D-pad: left on the stick is whatever the D-pad's left does
    apply(input, bindButton(DEFAULT_BINDINGS, 'right', PAD.LEFT));
    pad.axes[0] = -1;
    input.poll();
    expect(input.isDown('right')).toBe(true);
    expect(input.isDown('left')).toBe(false);
    // The menus keep their fixed buttons
    pad.axes[0] = 0;
    input.poll();
    pad.press(PAD.B);
    input.poll();
    expect(input.consumeMenu('back')).toBe(true);
  });
});

describe('waiting for a move’s new key or button (G.4)', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { querySelector: () => null });
  });

  /** A key event, as the page sends it to `InputController`. */
  function keyDown(input: InputController, code: string, key: string, repeat = false) {
    const e = { code, key, repeat, target: null, preventDefault: vi.fn() };
    (input as unknown as { handleKeyDown(e: unknown): void }).handleKeyDown(e);
    return e;
  }

  it('gives the key pressed, once, and keeps it from the browser', () => {
    const input = new InputController();
    input.startCapture();
    expect(input.pollCapture()).toBeNull();
    const e = keyDown(input, 'Tab', 'Tab');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(input.pollCapture()).toEqual({ kind: 'key', code: 9 });
    expect(input.pollCapture()).toBeNull();
    keyDown(input, 'Tab', 'Tab', true); // held: no repeat
    expect(input.pollCapture()).toBeNull();
    keyDown(input, 'F1', 'F1');
    expect(input.pollCapture()).toEqual({ kind: 'key', code: -1 });
    input.stopCapture();
    keyDown(input, 'KeyL', 'l');
    expect(input.pollCapture()).toBeNull();
  });

  it('counts a button held when it started once it is pressed again', () => {
    const pad = new FakePad(0).press(PAD.A);
    pads = [pad];
    const input = new InputController();
    input.startCapture();
    expect(input.pollCapture()).toBeNull();
    pad.press(PAD.A, false);
    expect(input.pollCapture()).toBeNull();
    pad.press(PAD.A);
    expect(input.pollCapture()).toEqual({ kind: 'button', button: PAD.A });
    // The stick counts as the D-pad; Start comes first
    pad.axes[0] = 1;
    expect(input.pollCapture()).toEqual({ kind: 'button', button: PAD.RIGHT });
    pad.press(PAD.X).press(PAD.START);
    expect(input.pollCapture()).toEqual({ kind: 'button', button: PAD.START });
  });

  it('locks the menu move of the key that ended it', () => {
    const input = new InputController();
    input.setKeyCode(Key.DOWN, true);
    input.lockMenuHeld();
    input.poll();
    expect(input.consumeMenu('down')).toBe(false);
    input.setKeyCode(Key.DOWN, false);
    input.poll();
    input.setKeyCode(Key.DOWN, true);
    input.poll();
    expect(input.consumeMenu('down')).toBe(true);
  });
});

describe('flashKeyCode (G.4)', () => {
  it('reads a letter wherever the layout puts it, and the keys a move can have', () => {
    expect(flashKeyCode('Semicolon', 'm')).toBe(77); // AZERTY's M
    expect(flashKeyCode('Semicolon', ';')).toBeUndefined();
    expect(flashKeyCode('Digit1', '&')).toBe(97);
    expect(flashKeyCode('Tab', 'Tab')).toBe(9);
    expect(flashKeyCode('Delete', 'Delete')).toBe(46);
    expect(flashKeyCode('PageDown', 'PageDown')).toBe(34);
  });
});

describe('a game with the player’s bindings (G.4)', () => {
  let session: GameSession;

  beforeAll(async () => {
    session = await createHeadlessSession();
  });

  afterEach(() => {
    session.input.setMoveKeys(DEFAULT_KEYS, DEFAULT_BINDINGS.pad);
  });

  function step(n = 1): void {
    for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
  }

  it('moves and drops bombs with them', () => {
    apply(session.input, bindKey(bindKey(DEFAULT_BINDINGS, 'right', 0, L), 'attack', 0, K));
    session.startGame(1, 1234);
    step(30);
    const p = session.game.player!;
    const x = p.x;
    session.input.setKeyCode(L, true);
    step(8);
    session.input.setKeyCode(L, false);
    expect(p.x).toBeGreaterThan(x);
    step(4);
    session.input.setKeyCode(Key.SPACE, true);
    step();
    session.input.setKeyCode(Key.SPACE, false);
    expect(session.game.getBombs()).toHaveLength(0);
    session.input.setKeyCode(K, true);
    step();
    session.input.setKeyCode(K, false);
    expect(session.game.getBombs()).toHaveLength(1);
  });
});
