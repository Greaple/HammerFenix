export type ControlAction = 'left' | 'right' | 'jump' | 'down' | 'attack' | 'pause';

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
};

/**
 * Unified input controller combining Keyboard (QWERTY + AZERTY + Arrows),
 * Gamepad API, and on-screen touch controls.
 *
 * Implements Hammerfest's lockable edge-triggered `consumePress(action)`
 * alongside continuous `isDown(action)` (used for pogo-jumping on `jump`).
 */
export class InputController {
  private readonly keyHeld = new Set<ControlAction>();
  private readonly touchHeld = new Set<ControlAction>();
  private readonly padHeld = new Set<ControlAction>();
  private readonly locked = new Set<ControlAction>();

  onAnyGesture?: () => void;

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (document.querySelector('dialog[open]')) return;

    this.onAnyGesture?.();
    const act = KEY_MAP[e.code];
    if (!act) return;
    if (act !== 'pause') e.preventDefault();
    this.keyHeld.add(act);
  };

  private readonly handleKeyUp = (e: KeyboardEvent) => {
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

    for (const act of [...this.locked]) {
      if (!this.isDown(act)) {
        this.locked.delete(act);
      }
    }
  }

  isDown(action: ControlAction): boolean {
    return this.keyHeld.has(action) || this.touchHeld.has(action) || this.padHeld.has(action);
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
