import { DEFAULT_PAD_MOVES, PAD } from './Gamepad';
import { GAME_KEY_CODES, Key, PLAYER_ACTIONS } from './Input';
import type { PlayerAction, PlayerKeys } from './Input';

/**
 * The player's own keys and buttons for the five moves (roadmap G.4). Port addition: the Flash
 * game had fixed keys. Its SWF has a key setup screen no code attaches (`#910`): the five
 * moves with a key each (`labLeft`, `labRight`, `labJump`, `labDown`, `labFire1`), and a
 * second frame "Appuyez sur la touche souhaitée" / "[ ECHAP pour annuler ]". The settings
 * page's controls page does the same, with two keys per move and a controller button.
 *
 * The bindings replace `DEFAULT_KEYS` for the players a mode gives no keys (every solo game);
 * the keys of the co-op mode's two sides stay the mode's. The menus keep their fixed keys
 * (arrows, space, P or Escape, and the controller's D-pad, A and B). The game's own keys (pause,
 * music, disguise, map, sound) are not remapped and cannot be given to a move.
 */
export interface Bindings {
  /** Two keyboard slots per move, each holding Flash key codes (usually one). */
  readonly keys: Readonly<Record<PlayerAction, readonly [readonly number[], readonly number[]]>>;
  /** The controller buttons of each move (standard mapping numbers; the stick is the D-pad). */
  readonly pad: Readonly<Record<PlayerAction, readonly number[]>>;
}

/** `localStorage` key of the bindings; a new format gets a new key. */
export const BINDINGS_KEY = 'hammerfenix_controls_v1';

const code = (letter: string) => letter.charCodeAt(0);

/**
 * The keys as before G.4 (`DEFAULT_KEYS`, a test keeps them in step): the original's (arrows, Space and Ctrl) first, the port's W A S D
 * (Z Q S D on AZERTY) and X or J second.
 */
export const DEFAULT_BINDINGS: Bindings = {
  keys: {
    left: [[Key.LEFT], [code('A'), code('Q')]],
    right: [[Key.RIGHT], [code('D')]],
    jump: [[Key.UP], [code('W'), code('Z')]],
    down: [[Key.DOWN], [code('S')]],
    attack: [
      [Key.SPACE, Key.CONTROL],
      [code('X'), code('J')],
    ],
  },
  pad: DEFAULT_PAD_MOVES,
};

/** Names of the keys that are not a letter, as the slots show them. */
const KEY_NAMES: Record<number, string | Record<'fr' | 'en' | 'es', string>> = {
  8: '⌫',
  9: 'Tab',
  13: { fr: 'Entrée', en: 'Enter', es: 'Intro' },
  16: { fr: 'Maj', en: 'Shift', es: 'Mayús' },
  17: 'Ctrl',
  18: 'Alt',
  32: { fr: 'Espace', en: 'Space', es: 'Espacio' },
  33: 'PgUp',
  34: 'PgDn',
  35: { fr: 'Fin', en: 'End', es: 'Fin' },
  36: { fr: 'Début', en: 'Home', es: 'Inicio' },
  37: '←',
  38: '↑',
  39: '→',
  40: '↓',
  45: 'Ins',
  46: { fr: 'Suppr', en: 'Del', es: 'Supr' },
  106: '*',
  107: '+',
  109: '−',
  110: '.',
  111: '/',
};

/** The name of a key, by its Flash key code, or null for a key a move cannot have. */
export function keyName(kc: number, lang = 'fr'): string | null {
  if (kc >= 65 && kc <= 90) return String.fromCharCode(kc);
  if (kc >= 96 && kc <= 105) return String(kc - 96);
  const n = KEY_NAMES[kc];
  if (n === undefined) return null;
  if (typeof n === 'string') return n;
  return n[lang === 'en' || lang === 'es' ? lang : 'fr'];
}

/** Keys the game keeps for itself: pause, music, disguise, map, sound (and Escape cancels). */
export function isReservedKey(kc: number): boolean {
  return GAME_KEY_CODES.includes(kc);
}

/** Whether a move can have this key. */
export function isBindableKey(kc: number): boolean {
  return keyName(kc) !== null && !isReservedKey(kc);
}

/**
 * Controller buttons a move can have: A, B, X, the triggers, the stick presses and the D-pad
 * (which the left stick follows). Y, the bumpers, Start and Back are the game's.
 */
export const BINDABLE_BUTTONS: readonly number[] = [
  PAD.A,
  PAD.B,
  PAD.X,
  PAD.L2,
  PAD.R2,
  PAD.L3,
  PAD.R3,
  PAD.UP,
  PAD.DOWN,
  PAD.LEFT,
  PAD.RIGHT,
];

/** The keys of each move, both slots together, as the input reads them. */
export function bindingKeys(b: Bindings): PlayerKeys {
  const out = {} as Record<PlayerAction, readonly number[]>;
  for (const a of PLAYER_ACTIONS) out[a] = [...b.keys[a][0], ...b.keys[a][1]];
  return out;
}

/**
 * Key `kc` in slot `slot` of move `action`, alone. The key leaves any other slot, so a key
 * does one move.
 */
export function bindKey(b: Bindings, action: PlayerAction, slot: 0 | 1, kc: number): Bindings {
  const keys = {} as Record<PlayerAction, [number[], number[]]>;
  for (const a of PLAYER_ACTIONS) {
    keys[a] = [b.keys[a][0].filter((c) => c !== kc), b.keys[a][1].filter((c) => c !== kc)];
  }
  keys[action][slot] = [kc];
  return { keys, pad: b.pad };
}

/** Button `button` for move `action`, alone. The button leaves the other moves. */
export function bindButton(b: Bindings, action: PlayerAction, button: number): Bindings {
  const pad = {} as Record<PlayerAction, number[]>;
  for (const a of PLAYER_ACTIONS) pad[a] = b.pad[a].filter((x) => x !== button);
  pad[action] = [button];
  return { keys: b.keys, pad };
}

/** The saved bindings, each list checked, or the defaults. */
export function loadBindings(storage: Storage | null = defaultStorage()): Bindings {
  try {
    const raw = storage?.getItem(BINDINGS_KEY);
    if (!raw) return DEFAULT_BINDINGS;
    const data = JSON.parse(raw) as { keys?: unknown; pad?: unknown };
    const list = (v: unknown, ok: (n: number) => boolean): number[] | null =>
      Array.isArray(v) && v.every((n) => Number.isInteger(n) && ok(n)) ? [...new Set(v)] : null;
    const keys = {} as Record<PlayerAction, [number[], number[]]>;
    const pad = {} as Record<PlayerAction, number[]>;
    const kIn = (data.keys ?? {}) as Record<string, unknown>;
    const pIn = (data.pad ?? {}) as Record<string, unknown>;
    for (const a of PLAYER_ACTIONS) {
      const slots = kIn[a];
      const s0 = Array.isArray(slots) ? list(slots[0], isBindableKey) : null;
      const s1 = Array.isArray(slots) ? list(slots[1], isBindableKey) : null;
      const def = DEFAULT_BINDINGS.keys[a];
      keys[a] = s0 && s1 ? [s0, s1] : [[...def[0]], [...def[1]]];
      pad[a] = list(pIn[a], (n) => BINDABLE_BUTTONS.includes(n)) ?? [...DEFAULT_BINDINGS.pad[a]];
    }
    return { keys, pad };
  } catch {
    // unreadable storage or data: the defaults
    return DEFAULT_BINDINGS;
  }
}

export function saveBindings(b: Bindings, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(BINDINGS_KEY, JSON.stringify(b));
  } catch {
    // ignore storage quota / sandbox write errors
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
