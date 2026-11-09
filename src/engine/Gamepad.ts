import type { ControlAction } from './Input';

/**
 * Controllers (roadmap G.1). Port addition: the Flash game had the keyboard only.
 *
 * Reads player 1's controller with the Gamepad API's standard mapping
 * (`Gamepad.mapping === 'standard'`). A controller without it is read with the same button
 * numbers, which most of them follow.
 */

/** The standard mapping's buttons. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  /** Left bumper (L1, LB, L). */
  L1: 4,
  /** Right trigger (R2, RT, ZR). */
  R2: 7,
  BACK: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/**
 * How the controller names its buttons: the prompts draw the right ones. `generic` is an
 * unknown controller: Xbox letters, with Start and Select.
 */
export type PadLayout = 'xbox' | 'playstation' | 'nintendo' | 'generic';

/**
 * The layout of a controller from its `Gamepad.id` (vendor 054c is Sony, 057e Nintendo). Sony
 * pads call themselves "Wireless Controller", as Xbox ones do: the vendor tells them apart.
 */
export function padLayout(id: string): PadLayout {
  const s = id.toLowerCase();
  if (/054c|playstation|dualshock|dualsense/.test(s)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  if (/045e|xbox|xinput/.test(s)) return 'xbox';
  return 'generic';
}

/** Menu moves: arrows and confirm / back, apart from the game's actions. */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

/**
 * Left stick dead zone, with hysteresis: a direction is pressed past `PRESS` and released
 * under `RELEASE`, so a stick resting near the edge does not flicker. Up jumps, so it asks a
 * firmer push than the sides.
 */
const STICK_X = { PRESS: 0.5, RELEASE: 0.3 };
const STICK_Y = { PRESS: 0.65, RELEASE: 0.4 };
/** Any axis past this counts as the controller being used (for the prompts). */
const ACTIVE_AXIS = 0.5;

type Dir = 'left' | 'right' | 'up' | 'down';

/** What one read of player 1's controller gives. */
export interface PadState {
  /** Game actions held. */
  readonly actions: Set<ControlAction>;
  /** Menu actions held. */
  readonly menu: Set<MenuAction>;
  /** A button is pressed or the stick pushed: the player is using the controller. */
  readonly active: boolean;
}

const EMPTY: PadState = { actions: new Set(), menu: new Set(), active: false };

/**
 * Player 1's controller: the first one connected. The others are ignored (one input per
 * player is G.2). When it is unplugged, the next connected one takes over.
 */
export class PadReader {
  /** `Gamepad.index` of player 1's controller, or -1. */
  private index = -1;
  private padId = '';
  private readonly stick = new Set<Dir>();

  /** Player 1's controller was plugged in (or first seen). */
  onConnect?: (id: string) => void;
  /** Player 1's controller was unplugged. */
  onDisconnect?: (id: string) => void;

  get connected(): boolean {
    return this.index >= 0;
  }

  /** `Gamepad.id` of player 1's controller, or `''`. */
  get id(): string {
    return this.padId;
  }

  get layout(): PadLayout {
    return padLayout(this.padId);
  }

  /** Reads player 1's controller now. */
  read(): PadState {
    const pad = this.find();
    if (!pad) return EMPTY;
    const btn = (i: number) => pad.buttons[i]?.pressed === true;
    const s = this.readStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);

    const left = btn(PAD.LEFT) || s.has('left');
    const right = btn(PAD.RIGHT) || s.has('right');
    const up = btn(PAD.UP) || s.has('up');
    const down = btn(PAD.DOWN) || s.has('down');

    const actions = new Set<ControlAction>();
    if (left) actions.add('left');
    if (right) actions.add('right');
    if (up || btn(PAD.A)) actions.add('jump');
    if (down) actions.add('down');
    if (btn(PAD.B) || btn(PAD.X) || btn(PAD.R2)) actions.add('attack');
    if (btn(PAD.START)) actions.add('pause');
    if (btn(PAD.BACK)) actions.add('music');
    if (btn(PAD.Y)) actions.add('disguise');
    if (btn(PAD.L1)) actions.add('map');

    const menu = new Set<MenuAction>();
    if (left) menu.add('left');
    if (right) menu.add('right');
    if (up) menu.add('up');
    if (down) menu.add('down');
    if (btn(PAD.A) || btn(PAD.START)) menu.add('ok');
    if (btn(PAD.B)) menu.add('back');

    const active =
      pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > ACTIVE_AXIS);
    return { actions, menu, active };
  }

  /** Player 1's controller, after noticing it was plugged in or unplugged. */
  private find(): Gamepad | null {
    const pads =
      typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? navigator.getGamepads()
        : [];
    if (this.index >= 0) {
      const pad = pads[this.index];
      if (pad && pad.connected && pad.id === this.padId) return pad;
      const id = this.padId;
      this.index = -1;
      this.padId = '';
      this.stick.clear();
      this.onDisconnect?.(id);
    }
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      this.index = pad.index;
      this.padId = pad.id;
      this.onConnect?.(pad.id);
      return pad;
    }
    return null;
  }

  private readStick(x: number, y: number): Set<Dir> {
    const set = (d: Dir, v: number, t: { PRESS: number; RELEASE: number }) => {
      if (v > t.PRESS) this.stick.add(d);
      else if (v < t.RELEASE) this.stick.delete(d);
    };
    set('left', -x, STICK_X);
    set('right', x, STICK_X);
    set('up', -y, STICK_Y);
    set('down', y, STICK_Y);
    return this.stick;
  }
}
