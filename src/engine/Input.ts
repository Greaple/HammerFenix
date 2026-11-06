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
  /** Actions held this tick, as `ACTION_BITS`. */
  private sampled = 0;
  private recorder: InputRecorder | null = null;
  private player: InputPlayer | null = null;

  onAnyGesture?: () => void;

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (document.querySelector('dialog[open]')) return;

    this.onAnyGesture?.();
    const act = actionOf(e);
    if (!act) return;
    if (act !== 'pause') e.preventDefault();
    this.keyHeld.add(act);
  };

  private readonly handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyK') this.keyHeld.delete('suicide');
    const act = KEY_MAP[e.code];
    if (!act) return;
    this.keyHeld.delete(act);
  };

  private readonly handleBlur = () => {
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

    for (const act of [...this.locked]) {
      if (!this.isDown(act)) {
        this.locked.delete(act);
      }
    }
  }

  isDown(action: ControlAction): boolean {
    return (this.sampled & ACTION_BITS[action]) !== 0;
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
