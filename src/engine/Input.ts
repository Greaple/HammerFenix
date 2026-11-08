import { ACTION_BITS, type InputPlayer, type InputRecorder } from './InputRecording';

/**
 * `music` is M and `suicide` Ctrl+Shift+K, the keys `GameMode.main` reads besides the controls
 * (the music switch and giving up the game).
 */
export type ControlAction =
  'left' | 'right' | 'jump' | 'down' | 'attack' | 'pause' | 'music' | 'suicide';

const KEY_MAP: Record<string, ControlAction> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  KeyQ: 'left', // AZERTY friendly!
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  KeyZ: 'jump', // AZERTY friendly!
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'attack',
  ControlLeft: 'attack',
  ControlRight: 'attack',
  KeyX: 'attack',
  KeyJ: 'attack',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'music',
};

/** Flash key codes (`Key.*`) of the keys that are not a letter or a digit. */
const FLASH_KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Enter: 13,
  NumpadEnter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  Escape: 27,
  Space: 32,
  Home: 36,
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDivide: 111,
};

/**
 * The Flash key code (`Key.isDown`'s argument) of a `KeyboardEvent.code`. Port addition: the
 * top row digits count as the numpad's (96 to 105), since laptops have no numpad.
 */
export function flashKeyCode(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^(Numpad|Digit)\d$/.test(code)) return 96 + Number(code.slice(-1));
  return FLASH_KEY_CODES[code];
}

/** Keys the browser would act on (Home scrolls, Alt opens the menu) while the dev keys are on. */
const DEV_PREVENT = new Set([18, 36]);

/** The action of key event `e`: Ctrl+Shift+K gives up the game (`GameMode.main`). */
function actionOf(e: KeyboardEvent): ControlAction | undefined {
  if (e.code === 'KeyK') return e.ctrlKey && e.shiftKey ? 'suicide' : undefined;
  return KEY_MAP[e.code];
}

/**
 * Unified input controller combining Keyboard (QWERTY + AZERTY + Arrows),
 * Gamepad API, and on-screen touch controls.
 *
 * Implements Hammerfest's lockable edge-triggered `consumePress(action)`
 * alongside continuous `isDown(action)` (used for pogo-jumping on `jump`).
 *
 * Input is sampled once per logic tick by `poll()`, so a tick sees one consistent state. That
 * sample can be recorded, or replaced by a replay's.
 */
export class InputController {
  private readonly keyHeld = new Set<ControlAction>();
  private readonly touchHeld = new Set<ControlAction>();
  private readonly padHeld = new Set<ControlAction>();
  private readonly locked = new Set<ControlAction>();
  /** Flash key codes held now, and in this tick's sample (for the dev keys). */
  private readonly codesHeld = new Set<number>();
  private codesSampled = new Set<number>();
  /** Actions held this tick, as `ACTION_BITS`. */
  private sampled = 0;
  private recorder: InputRecorder | null = null;
  private player: InputPlayer | null = null;

  /**
   * The original's dev keys (`GameManager.fl_debug`) read every key with `isKeyDown`. Off while
   * recording or replaying: they are not in the recorded action mask.
   */
  devKeys = false;

  onAnyGesture?: () => void;

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (document.querySelector('dialog[open]')) return;

    this.onAnyGesture?.();
    const kc = flashKeyCode(e.code);
    if (kc !== undefined) {
      this.codesHeld.add(kc);
      // Ctrl and a digit is the dev level jump, not the browser's tab switch
      if (this.devKeys && (DEV_PREVENT.has(kc) || (e.ctrlKey && kc >= 96 && kc <= 105))) {
        e.preventDefault();
      }
    }
    const act = actionOf(e);
    if (!act) return;
    if (act !== 'pause') e.preventDefault();
    this.keyHeld.add(act);
  };

  private readonly handleKeyUp = (e: KeyboardEvent) => {
    const kc = flashKeyCode(e.code);
    if (kc !== undefined) this.codesHeld.delete(kc);
    if (e.code === 'KeyK') this.keyHeld.delete('suicide');
    const act = KEY_MAP[e.code];
    if (!act) return;
    this.keyHeld.delete(act);
  };

  private readonly handleBlur = () => {
    this.codesHeld.clear();
    this.keyHeld.clear();
    this.touchHeld.clear();
    this.padHeld.clear();
    this.locked.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  /** Holds or releases a key by its Flash key code, as the keyboard does (for tests). */
  setKeyCode(code: number, pressed: boolean): void {
    if (pressed) this.codesHeld.add(code);
    else this.codesHeld.delete(code);
  }

  setTouch(action: ControlAction, pressed: boolean): void {
    this.onAnyGesture?.();
    if (pressed) this.touchHeld.add(action);
    else this.touchHeld.delete(action);
  }

  /** Polls connected gamepads and updates lock states once per simulation tick. */
  poll(): void {
    this.padHeld.clear();
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (const pad of pads) {
        if (!pad) continue;
        const axX = pad.axes[0] ?? 0;
        const axY = pad.axes[1] ?? 0;
        if (axX < -0.35 || pad.buttons[14]?.pressed) this.padHeld.add('left');
        if (axX > 0.35 || pad.buttons[15]?.pressed) this.padHeld.add('right');
        if (axY < -0.45 || pad.buttons[12]?.pressed || pad.buttons[0]?.pressed) {
          this.padHeld.add('jump');
        }
        if (axY > 0.45 || pad.buttons[13]?.pressed) this.padHeld.add('down');
        if (pad.buttons[1]?.pressed || pad.buttons[2]?.pressed || pad.buttons[3]?.pressed) {
          this.padHeld.add('attack');
        }
        if (pad.buttons[9]?.pressed) this.padHeld.add('pause');
      }
    }

    let mask = 0;
    for (const [act, bit] of Object.entries(ACTION_BITS) as [ControlAction, number][]) {
      if (this.keyHeld.has(act) || this.touchHeld.has(act) || this.padHeld.has(act)) mask |= bit;
    }
    if (this.player) {
      mask = this.player.next();
      if (this.player.done) this.player = null; // replay over: back to live input
    }
    this.sampled = mask;
    this.recorder?.push(mask);
    this.codesSampled =
      this.devKeys && !this.recorder && !this.player ? new Set(this.codesHeld) : new Set();

    for (const act of [...this.locked]) {
      if (!this.isDown(act)) {
        this.locked.delete(act);
      }
    }
  }

  isDown(action: ControlAction): boolean {
    return (this.sampled & ACTION_BITS[action]) !== 0;
  }

  /**
   * `Key.isDown(code)` for the dev keys: whether the key with Flash key code `code` was held at
   * this tick's sample. Always false when `devKeys` is off.
   */
  isKeyDown(code: number): boolean {
    return this.codesSampled.has(code);
  }

  /** Records every tick's sample from the next `poll()` on. */
  startRecording(recorder: InputRecorder): void {
    this.recorder = recorder;
  }

  stopRecording(): InputRecorder | null {
    const r = this.recorder;
    this.recorder = null;
    return r;
  }

  /** Replaces live input with a replay's, from the next `poll()` on. */
  startReplay(player: InputPlayer): void {
    this.player = player;
    this.resetState();
  }

  stopReplay(): void {
    this.player = null;
  }

  get replaying(): InputPlayer | null {
    return this.player;
  }

  /** Forgets the current sample and key locks, so a new game starts from a clean input state. */
  resetState(): void {
    this.sampled = 0;
    this.locked.clear();
  }

  /** Edge-triggered press matching `PlayerController.keyIsDown` + `lockKey`. */
  consumePress(action: ControlAction): boolean {
    if (this.isDown(action) && !this.locked.has(action)) {
      this.locked.add(action);
      return true;
    }
    return false;
  }

  lock(action: ControlAction): void {
    this.locked.add(action);
  }
}
