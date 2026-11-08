import { type MenuAction, PadReader, type PadLayout } from './Gamepad';
import { ACTION_BITS, type InputPlayer, type InputRecorder } from './InputRecording';

export type { MenuAction } from './Gamepad';

/**
 * The device the player used last: the screens show its buttons (a keycap, a controller
 * button, or nothing on a touch screen).
 */
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

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

/** The keyboard's and touch buttons' menu moves: the arrows, the bomb key confirms, pause goes back. */
const MENU_OF: [MenuAction, ControlAction][] = [
  ['up', 'jump'],
  ['down', 'down'],
  ['left', 'left'],
  ['right', 'right'],
  ['ok', 'attack'],
  ['back', 'pause'],
];

/** A touch screen with no mouse: the page starts with touch prompts. */
function startDevice(): InputDevice {
  if (typeof window === 'undefined') return 'keyboard';
  return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ? 'touch' : 'keyboard';
}

/**
 * Unified input controller combining Keyboard (QWERTY + AZERTY + Arrows),
 * player 1's controller (`Gamepad.ts`), and on-screen touch controls.
 *
 * Implements Hammerfest's lockable edge-triggered presses (`consumePress` for menus and game
 * keys, `keyIsDown` for the player's controller) alongside continuous `isDown(action)` (used
 * for pogo-jumping on `jump`).
 *
 * Input is sampled once per logic tick by `poll()`, so a tick sees one consistent state. That
 * sample can be recorded, or replaced by a replay's.
 */
export class InputController {
  private readonly keyHeld = new Set<ControlAction>();
  private readonly touchHeld = new Set<ControlAction>();
  private padHeld = new Set<ControlAction>();
  private padMenu = new Set<MenuAction>();
  private readonly pad = new PadReader();
  /**
   * Set while a dialog is open, and after until the controller is let go: its buttons then
   * act on the dialog (`onDialogPad`), not on the game or the menu under it.
   */
  private padBlocked = false;
  private padDialogHeld = new Set<MenuAction>();
  /** Menu moves held this sample, and their locks (`consumeMenu`). */
  private menuSampled = new Set<MenuAction>();
  private readonly menuLocked = new Set<MenuAction>();
  private readonly locked = new Set<ControlAction>();
  /**
   * The player's key locks (`PlayerController.keyLocks`), apart from the menus' and the game's:
   * released only when the controller runs (`releaseControllerLocks`).
   */
  private readonly ctrlLocked = new Set<ControlAction>();
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

  /** The device the player used last. */
  device: InputDevice = startDevice();
  /** The last device that was not a controller, for when it is unplugged. */
  private otherDevice: InputDevice = this.device;
  onDeviceChange?: (device: InputDevice) => void;
  /** Player 1's controller was plugged in, or unplugged. */
  onPadConnect?: (id: string) => void;
  onPadDisconnect?: (id: string) => void;
  /** A controller press while a dialog is open. */
  onDialogPad?: (action: MenuAction) => void;

  constructor() {
    this.pad.onConnect = (id) => this.onPadConnect?.(id);
    this.pad.onDisconnect = (id) => {
      if (this.device === 'gamepad') this.setDevice(this.otherDevice);
      this.onPadDisconnect?.(id);
    };
  }

  /** How player 1's controller names its buttons. */
  get padLayout(): PadLayout {
    return this.pad.layout;
  }

  get padConnected(): boolean {
    return this.pad.connected;
  }

  setDevice(device: InputDevice): void {
    if (device !== 'gamepad') this.otherDevice = device;
    if (device === this.device) return;
    this.device = device;
    this.onDeviceChange?.(device);
  }

  /**
   * A click or touch switches the prompts once it is over: redrawing a screen under a pointer
   * that is down would lose the click.
   */
  private readonly handlePointerDown = (e: PointerEvent) => {
    this.pointerDevice = e.pointerType === 'touch' ? 'touch' : 'keyboard';
  };

  private readonly handlePointerUp = () => {
    const d = this.pointerDevice;
    this.pointerDevice = null;
    if (d) window.setTimeout(() => this.setDevice(d), 0);
  };

  private pointerDevice: InputDevice | null = null;

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    this.setDevice('keyboard');
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
    this.menuLocked.clear();
    this.ctrlLocked.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('pointerup', this.handlePointerUp, true);
    window.addEventListener('pointercancel', this.handlePointerUp, true);
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('pointerup', this.handlePointerUp, true);
    window.removeEventListener('pointercancel', this.handlePointerUp, true);
  }

  /** Holds or releases a key by its Flash key code, as the keyboard does (for tests). */
  setKeyCode(code: number, pressed: boolean): void {
    if (pressed) this.codesHeld.add(code);
    else this.codesHeld.delete(code);
  }

  setTouch(action: ControlAction, pressed: boolean): void {
    this.onAnyGesture?.();
    if (pressed) {
      this.setDevice('touch');
      this.touchHeld.add(action);
    } else {
      this.touchHeld.delete(action);
    }
  }

  /** Polls player 1's controller and updates lock states once per simulation tick. */
  poll(): void {
    this.pollPad();

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

    // Menu moves: live input, never a replay's
    this.menuSampled = new Set(this.padMenu);
    for (const [m, act] of MENU_OF) {
      if (this.keyHeld.has(act) || this.touchHeld.has(act)) this.menuSampled.add(m);
    }
    for (const m of [...this.menuLocked]) {
      if (!this.menuSampled.has(m)) this.menuLocked.delete(m);
    }

    for (const act of [...this.locked]) {
      if (!this.isDown(act)) {
        this.locked.delete(act);
      }
    }
  }

  /**
   * Reads player 1's controller into `padHeld` and `padMenu`. While a dialog is open its
   * presses go to `onDialogPad` instead, and the game and menus see nothing until it is let
   * go, so the press that closed the dialog does not act again under it.
   */
  private pollPad(): void {
    const state = this.pad.read();
    if (state.active) this.setDevice('gamepad');
    const dialogOpen =
      typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
    if (dialogOpen) {
      if (this.padBlocked) {
        for (const m of state.menu) if (!this.padDialogHeld.has(m)) this.onDialogPad?.(m);
      }
      this.padBlocked = true;
      this.padDialogHeld = state.menu;
    } else if (this.padBlocked && !state.active) {
      this.padBlocked = false;
    }
    const usable = !this.padBlocked;
    this.padHeld = usable ? state.actions : new Set();
    this.padMenu = usable ? state.menu : new Set();
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
    this.menuLocked.clear();
    this.ctrlLocked.clear();
  }

  /**
   * Edge-triggered press for the menus and the game's own keys (`GameMode.keyLock`): its lock
   * is released on the first poll the action is up. The player uses `keyIsDown`.
   */
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

  /**
   * Edge-triggered menu move (the site screens, the loader): the keyboard's arrows, bomb key
   * (confirm) and pause key (back), or the controller's D-pad and stick, A or Start (confirm)
   * and B (back). Locked until released, apart from the game's actions.
   */
  consumeMenu(action: MenuAction): boolean {
    if (this.menuSampled.has(action) && !this.menuLocked.has(action)) {
      this.menuLocked.add(action);
      return true;
    }
    return false;
  }

  /** `PlayerController.keyIsDown`: held and not locked by the controller; locks it. */
  keyIsDown(action: ControlAction): boolean {
    if (this.isDown(action) && !this.ctrlLocked.has(action)) {
      this.ctrlLocked.add(action);
      return true;
    }
    return false;
  }

  /** `PlayerController.lockKey` */
  lockKey(action: ControlAction): void {
    this.ctrlLocked.add(action);
  }

  /** The start of `PlayerController.getControls`: unlocks the keys no longer held. */
  releaseControllerLocks(): void {
    for (const act of [...this.ctrlLocked]) {
      if (!this.isDown(act)) this.ctrlLocked.delete(act);
    }
  }
}
