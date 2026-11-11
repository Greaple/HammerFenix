import type { ControlAction, PlayerAction } from './Input';

/**
 * Controllers (roadmap G.1, G.2). Port addition: the Flash game had the keyboard only.
 *
 * Reads the players' controllers with the Gamepad API's standard mapping
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
  /** Right bumper (R1, RB, R). */
  R1: 5,
  /** Left trigger (L2, LT, ZL). */
  L2: 6,
  /** Right trigger (R2, RT, ZR). */
  R2: 7,
  BACK: 8,
  START: 9,
  /** Stick presses (L3, R3). */
  L3: 10,
  R3: 11,
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

/** What one read of a controller gives. */
export interface PadState {
  /** Game actions held. */
  readonly actions: Set<ControlAction>;
  /** Menu actions held. */
  readonly menu: Set<MenuAction>;
  /** A button is pressed or the stick pushed: the player is using the controller. */
  readonly active: boolean;
}

export const EMPTY_PAD: PadState = { actions: new Set(), menu: new Set(), active: false };

/** One controller, by its `Gamepad.index` and `id`, and the state of its left stick. */
class Pad {
  private readonly stick = new Set<Dir>();

  constructor(
    readonly index: number,
    readonly id: string,
  ) {}

  /** Whether `pad` is this controller, still plugged in. */
  is(pad: Gamepad | null | undefined): pad is Gamepad {
    return !!pad && pad.connected && pad.index === this.index && pad.id === this.id;
  }

  /** Reads the controller; the moves are the buttons of `moves` (the stick is the D-pad). */
  read(pad: Gamepad, moves: PadMoves): PadState {
    const s = this.readStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const btn = (i: number) => pad.buttons[i]?.pressed === true || stickHolds(s, i);

    const left = btn(PAD.LEFT);
    const right = btn(PAD.RIGHT);
    const up = btn(PAD.UP);
    const down = btn(PAD.DOWN);

    const actions = new Set<ControlAction>();
    for (const [a, list] of Object.entries(moves) as [PlayerAction, readonly number[]][]) {
      if (list.some(btn)) actions.add(a);
    }
    if (btn(PAD.START)) actions.add('pause');
    if (btn(PAD.BACK)) actions.add('music');
    if (btn(PAD.Y)) actions.add('disguise');
    if (btn(PAD.L1)) actions.add('map');
    if (btn(PAD.R1)) actions.add('sound');

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

/** Whether the stick, pushed to `dirs`, holds D-pad button `i`. */
function stickHolds(dirs: ReadonlySet<Dir>, i: number): boolean {
  return (
    (i === PAD.LEFT && dirs.has('left')) ||
    (i === PAD.RIGHT && dirs.has('right')) ||
    (i === PAD.UP && dirs.has('up')) ||
    (i === PAD.DOWN && dirs.has('down'))
  );
}

/** The buttons of each move (G.4, `Bindings.pad`). */
export type PadMoves = Readonly<Record<PlayerAction, readonly number[]>>;

/** The buttons the game gave the moves before G.4 (`DEFAULT_BINDINGS.pad`). */
export const DEFAULT_PAD_MOVES: PadMoves = {
  left: [PAD.LEFT],
  right: [PAD.RIGHT],
  jump: [PAD.A, PAD.UP],
  down: [PAD.DOWN],
  attack: [PAD.B, PAD.X, PAD.R2],
};

/** A controller, as the Gamepad API names it. */
export interface PadRef {
  readonly index: number;
  readonly id: string;
}

function getPads(): readonly (Gamepad | null)[] {
  return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
    ? navigator.getGamepads()
    : [];
}

/**
 * The controllers, given to the players in connection order (G.2): the first one plugged in is
 * player 1's, the next player 2's. Controllers beyond the number of players wait, and take the
 * place of a player's controller that is unplugged (so in a solo game the next one takes over).
 * A player keeps their place when another player's controller is unplugged, and a controller
 * plugged in then takes the free place.
 *
 * In a two-player game started from the menu the players choose their controllers themselves
 * (`assign`, G.3).
 */
export class PadManager {
  /** The controller of each player, by pid. */
  private readonly slots: (Pad | null)[] = [null];
  /** Controllers with no player, in connection order. */
  private waiting: Pad[] = [];
  /**
   * The players chose their controllers (`assign`, G.3): a free place then stays free until
   * the next `assign` or `release`, instead of going to the next controller.
   */
  private fixed = false;

  /** A controller was given to player `pid` (plugged in, or taking a free place). */
  onConnect?: (id: string, pid: number) => void;
  /** The controller of player `pid` was unplugged. */
  onDisconnect?: (id: string, pid: number) => void;

  get playerCount(): number {
    return this.slots.length;
  }

  /**
   * Sets the number of players. The controllers of the players gone wait again, first in line;
   * new players take the waiting ones.
   */
  setPlayerCount(n: number): void {
    n = Math.max(1, n);
    const freed = this.slots.splice(n).filter((p): p is Pad => p !== null);
    while (this.slots.length < n) this.slots.push(null);
    this.waiting.unshift(...freed);
    this.fill();
  }

  /** The buttons of each move, for every controller (G.4). */
  moves: PadMoves = DEFAULT_PAD_MOVES;

  /**
   * The buttons held on any controller plugged in, the stick counting as the D-pad (G.4: a
   * move's new button). Read with the joining's thresholds, apart from the players' sticks.
   */
  heldButtons(): Set<number> {
    const out = new Set<number>();
    for (const pad of getPads()) {
      if (!pad?.connected) continue;
      pad.buttons.forEach((b, i) => {
        if (b.pressed) out.add(i);
      });
      const [x = 0, y = 0] = pad.axes;
      if (x < -STICK_X.PRESS) out.add(PAD.LEFT);
      if (x > STICK_X.PRESS) out.add(PAD.RIGHT);
      if (y < -STICK_Y.PRESS) out.add(PAD.UP);
      if (y > STICK_Y.PRESS) out.add(PAD.DOWN);
    }
    return out;
  }

  /** The controllers plugged in that have a button pressed, whoever holds them (G.3: joining). */
  pressed(): PadRef[] {
    const out: PadRef[] = [];
    for (const pad of getPads()) {
      if (pad?.connected && pad.buttons.some((b) => b.pressed)) {
        out.push({ index: pad.index, id: pad.id });
      }
    }
    return out;
  }

  /**
   * Gives each player the controller they chose, or none (G.3). The other controllers wait,
   * and no longer take a free place by themselves.
   */
  assign(list: readonly (PadRef | null)[]): void {
    const known = [...this.slots, ...this.waiting].filter((p): p is Pad => p !== null);
    const slots = list.map((d) =>
      d
        ? (known.find((p) => p.index === d.index && p.id === d.id) ?? new Pad(d.index, d.id))
        : null,
    );
    this.waiting = known.filter((p) => !slots.includes(p));
    this.slots.splice(0, this.slots.length, ...slots);
    this.fixed = true;
  }

  /** Back to the controllers in connection order (a new game). */
  release(): void {
    if (!this.fixed) return;
    this.fixed = false;
    this.fill();
  }

  /** Whether a player has a controller. */
  get connected(): boolean {
    return this.slots.some((p) => p !== null);
  }

  /** `Gamepad.id` of player `pid`'s controller, or `''`. */
  idOf(pid: number): string {
    return this.slots[pid]?.id ?? '';
  }

  /** Reads every player's controller now (`EMPTY_PAD` for a player without one). */
  read(): PadState[] {
    const pads = getPads();
    this.update(pads);
    return this.slots.map((p) => (p ? p.read(pads[p.index]!, this.moves) : EMPTY_PAD));
  }

  /** Notices the controllers unplugged and plugged in since the last read. */
  private update(pads: readonly (Gamepad | null)[]): void {
    for (let pid = 0; pid < this.slots.length; pid++) {
      const p = this.slots[pid];
      if (p && !p.is(pads[p.index])) {
        this.slots[pid] = null;
        this.onDisconnect?.(p.id, pid);
      }
    }
    this.waiting = this.waiting.filter((p) => p.is(pads[p.index]));
    const known = [...this.slots, ...this.waiting];
    for (const pad of pads) {
      if (!pad || !pad.connected || known.some((p) => p?.is(pad))) continue;
      this.waiting.push(new Pad(pad.index, pad.id));
    }
    this.fill();
  }

  /** Gives the waiting controllers to the players without one, in order. */
  private fill(): void {
    if (this.fixed) return;
    for (let pid = 0; pid < this.slots.length && this.waiting.length > 0; pid++) {
      if (this.slots[pid]) continue;
      const p = this.waiting.shift()!;
      this.slots[pid] = p;
      this.onConnect?.(p.id, pid);
    }
  }
}
