import { EMPTY_PAD, type MenuAction, PadManager, type PadLayout, padLayout } from './Gamepad';
import { ACTION_BITS, type InputPlayer, type InputRecorder } from './InputRecording';

export type { MenuAction } from './Gamepad';

/**
 * The device the player used last: the screens show its buttons (a keycap, a controller
 * button, or nothing on a touch screen).
 */
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/** A player's moves (`PlayerController`): each player has their own. */
export type PlayerAction = 'left' | 'right' | 'jump' | 'down' | 'attack';

/**
 * The keys `GameMode.getControls` reads besides the players' moves, held in player 1's mask:
 * `music` is M, `suicide` Ctrl+Shift+K, `disguise` E and `map` C (the music switch, giving up
 * the game, the next disguise, the world map). The original's disguise key is D, which moves
 * right here (WASD and ZQSD). `sound` (O) opens the sound settings from the pause, a port
 * addition.
 */
export type GameAction = 'pause' | 'music' | 'suicide' | 'disguise' | 'map' | 'sound';

export type ControlAction = PlayerAction | GameAction;

export const PLAYER_ACTIONS: readonly PlayerAction[] = ['left', 'right', 'jump', 'down', 'attack'];

function isPlayerAction(a: ControlAction): a is PlayerAction {
  return (PLAYER_ACTIONS as readonly string[]).includes(a);
}

/** `Key.*`: the Flash key codes the original names. */
export const Key = {
  ENTER: 13,
  SHIFT: 16,
  CONTROL: 17,
  ESCAPE: 27,
  SPACE: 32,
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
} as const;

/** The keys of each of a player's moves, as Flash key codes. */
export type PlayerKeys = Record<PlayerAction, readonly number[]>;

/** Flash key code of a letter. */
const code = (letter: string) => letter.charCodeAt(0);

/**
 * `PlayerController`'s own keys, which every player has until their mode calls `setKeys`: the
 * arrows, Space and Ctrl (`setAlt`) for the bomb. Port addition: W A S D (Z Q S D on AZERTY)
 * move too, and X or J drops a bomb.
 */
export const DEFAULT_KEYS: PlayerKeys = {
  jump: [Key.UP, code('W'), code('Z')],
  down: [Key.DOWN, code('S')],
  left: [Key.LEFT, code('A'), code('Q')],
  right: [Key.RIGHT, code('D')],
  attack: [Key.SPACE, Key.CONTROL, code('X'), code('J')],
};

/** The game's keys (P or Escape pauses). Ctrl+Shift+K gives up the game (`GameMode.main`). */
const GAME_KEYS: [GameAction, readonly number[]][] = [
  ['pause', [code('P'), Key.ESCAPE]],
  ['music', [code('M')]],
  ['disguise', [code('E')]],
  ['map', [code('C')]],
  ['sound', [code('O')]],
];
const SUICIDE_KEYS = [Key.CONTROL, Key.SHIFT, code('K')];

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
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDivide: 111,
};

/**
 * The Flash key code (`Key.isDown`'s argument) of a key, from its `KeyboardEvent.code` and
 * `key`. A letter is the letter the keyboard layout gives (`key`), as Flash's key codes were:
 * the original's modes chose their letters for AZERTY (Z Q S D). A letter key that gives no
 * Latin letter counts by its place on a QWERTY keyboard. Port addition: the top row digits count
 * as the numpad's (96 to 105), since laptops have no numpad.
 */
export function flashKeyCode(code: string, key?: string): number | undefined {
  if (key && /^[a-z]$/i.test(key) && /^Key[A-Z]$/.test(code))
    return key.toUpperCase().charCodeAt(0);
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^(Numpad|Digit)\d$/.test(code)) return 96 + Number(code.slice(-1));
  return FLASH_KEY_CODES[code];
}

/** Keys the browser would act on (Home scrolls, Alt opens the menu) while the dev keys are on. */
const DEV_PREVENT = new Set([18, 36]);

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
 * The input of every player: the keyboard (each player's keys, `PlayerKeys`), the controllers
 * (`Gamepad.ts`, one per player in connection order) and player 1's on-screen touch buttons.
 *
 * Input is sampled once per logic tick by `poll()` into one action mask per player (G.2), so a
 * tick sees one consistent state. Those masks can be recorded, or replaced by a replay's. The
 * game's own keys (pause, music...) go in player 1's mask, from every device.
 *
 * Implements Hammerfest's lockable edge-triggered presses (`consumePress` for menus and game
 * keys, `keyIsDown` for each player's controller) alongside continuous `isDown(action)` (used
 * for pogo-jumping on `jump`).
 */
export class InputController {
  /** Keys held now: the Flash key code of each `KeyboardEvent.code` held. */
  private readonly keysDown = new Map<string, number>();
  /** Flash key codes held now, and in this tick's sample (for the dev keys). */
  private codesHeld = new Set<number>();
  private codesSampled = new Set<number>();
  private readonly touchHeld = new Set<ControlAction>();
  private readonly pads = new PadManager();
  /** `Gamepad.id` of the controller used last, for its button names. */
  private lastPadId = '';
  /** Menu moves of the players' controllers at the last poll. */
  private padMenu = new Set<MenuAction>();
  /**
   * Set while a dialog is open, and after until the controllers are let go: their buttons then
   * act on the dialog (`onDialogPad`), not on the game or the menu under it.
   */
  private padBlocked = false;
  private padDialogHeld = new Set<MenuAction>();
  /** Menu moves held this sample, and their locks (`consumeMenu`). */
  private menuSampled = new Set<MenuAction>();
  private readonly menuLocked = new Set<MenuAction>();
  private readonly locked = new Set<ControlAction>();
  /** The keys of each player, by pid (`PlayerController.setKeys`). */
  private keys: PlayerKeys[] = [DEFAULT_KEYS];
  /**
   * Each player's key locks (`PlayerController.keyLocks`), apart from the menus' and the
   * game's: released only when that player's controller runs (`releaseControllerLocks`).
   */
  private ctrlLocked: Set<PlayerAction>[] = [new Set()];
  /** Actions held this tick, as `ACTION_BITS`, by pid. */
  private masks: number[] = [0];
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
  /** A player's controller was plugged in (or given to them), or unplugged. */
  onPadConnect?: (id: string, pid: number) => void;
  onPadDisconnect?: (id: string, pid: number) => void;
  /** A controller press while a dialog is open. */
  onDialogPad?: (action: MenuAction) => void;

  constructor() {
    this.pads.onConnect = (id, pid) => this.onPadConnect?.(id, pid);
    this.pads.onDisconnect = (id, pid) => {
      if (this.device === 'gamepad' && !this.pads.connected) this.setDevice(this.otherDevice);
      this.onPadDisconnect?.(id, pid);
    };
  }

  /** How the controller used last names its buttons (else player 1's). */
  get padLayout(): PadLayout {
    const ids = Array.from({ length: this.playerCount }, (_, pid) => this.pads.idOf(pid));
    return padLayout(ids.includes(this.lastPadId) ? this.lastPadId : ids[0]);
  }

  /** Whether a player has a controller. */
  get padConnected(): boolean {
    return this.pads.connected;
  }

  /** The number of players: each has their own mask, keys and controller. */
  get playerCount(): number {
    return this.masks.length;
  }

  /**
   * Sets the number of players (`GameMode.insertPlayer`). New players have the default keys
   * and the next controllers.
   */
  setPlayerCount(n: number): void {
    n = Math.max(1, n);
    const fit = <T>(list: T[], make: () => T) => {
      list.length = Math.min(list.length, n);
      while (list.length < n) list.push(make());
    };
    fit(this.keys, () => DEFAULT_KEYS);
    fit(this.ctrlLocked, () => new Set());
    fit(this.masks, () => 0);
    this.pads.setPlayerCount(n);
  }

  /** Player `pid`'s keys (`PlayerController.setKeys`, `setAlt`). */
  setPlayerKeys(pid: number, keys: PlayerKeys): void {
    if (pid >= this.playerCount) this.setPlayerCount(pid + 1);
    this.keys[pid] = keys;
  }

  playerKeys(pid: number): PlayerKeys {
    return this.keys[pid] ?? DEFAULT_KEYS;
  }

  /** Every player back on the default keys, for a new game. */
  resetKeys(): void {
    this.keys = this.keys.map(() => DEFAULT_KEYS);
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

  /** Whether the game reads key `kc` (the browser must not act on it too). */
  private isGameKey(kc: number, e: KeyboardEvent): boolean {
    const all = [DEFAULT_KEYS, ...this.keys];
    return (
      (kc === code('K') && e.ctrlKey && e.shiftKey) ||
      all.some((k) => PLAYER_ACTIONS.some((a) => k[a].includes(kc))) ||
      GAME_KEYS.some(([a, codes]) => a !== 'pause' && codes.includes(kc))
    );
  }

  private readonly handleKeyDown = (e: KeyboardEvent) => {
    this.setDevice('keyboard');
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (document.querySelector('dialog[open]')) return;

    this.onAnyGesture?.();
    // A key keeps the code it was pressed with, even if Shift or Alt changes its letter
    const kc = this.keysDown.get(e.code) ?? flashKeyCode(e.code, e.key);
    if (kc === undefined) return;
    this.keysDown.set(e.code, kc);
    this.codesHeld = new Set(this.keysDown.values());
    // Ctrl and a digit is the dev level jump, not the browser's tab switch
    const dev = this.devKeys && (DEV_PREVENT.has(kc) || (e.ctrlKey && kc >= 96 && kc <= 105));
    if (dev || this.isGameKey(kc, e)) e.preventDefault();
  };

  private readonly handleKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
    this.codesHeld = new Set(this.keysDown.values());
  };

  private readonly handleBlur = () => {
    this.keysDown.clear();
    this.codesHeld = new Set();
    this.touchHeld.clear();
    this.locked.clear();
    this.menuLocked.clear();
    for (const l of this.ctrlLocked) l.clear();
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
    if (pressed) this.keysDown.set(`#${code}`, code);
    else this.keysDown.delete(`#${code}`);
    this.codesHeld = new Set(this.keysDown.values());
  }

  /** Player 1's on-screen buttons. */
  setTouch(action: ControlAction, pressed: boolean): void {
    this.onAnyGesture?.();
    if (pressed) {
      this.setDevice('touch');
      this.touchHeld.add(action);
    } else {
      this.touchHeld.delete(action);
    }
  }

  /** Samples every device into the players' masks, and updates the locks, once per tick. */
  poll(): void {
    const pads = this.pollPads();
    const held = this.codesHeld;
    const anyHeld = (codes: readonly number[]) => codes.some((c) => held.has(c));

    let masks = this.keys.map((keys, pid) => {
      let mask = 0;
      for (const a of PLAYER_ACTIONS) {
        if (anyHeld(keys[a]) || pads[pid].actions.has(a)) mask |= ACTION_BITS[a];
      }
      return mask;
    });
    // The game's keys, from every device, and player 1's touch buttons
    let game = 0;
    for (const [a, codes] of GAME_KEYS) if (anyHeld(codes)) game |= ACTION_BITS[a];
    if (SUICIDE_KEYS.every((c) => held.has(c))) game |= ACTION_BITS.suicide;
    for (const a of this.touchHeld) game |= ACTION_BITS[a];
    for (const pad of pads) {
      for (const a of pad.actions) if (!isPlayerAction(a)) game |= ACTION_BITS[a];
    }
    masks[0] |= game;

    if (this.player) {
      const replayed = this.player.next();
      masks = masks.map((_, pid) => replayed[pid] ?? 0);
      if (this.player.done) this.player = null; // replay over: back to live input
    }
    this.masks = masks;
    this.recorder?.push(masks);
    this.codesSampled =
      this.devKeys && !this.recorder && !this.player ? new Set(this.codesHeld) : new Set();

    // Menu moves: live input, never a replay's. The keyboard's are the default keys.
    this.menuSampled = new Set(this.padMenu);
    for (const [m, act] of MENU_OF) {
      const codes = isPlayerAction(act) ? DEFAULT_KEYS[act] : GAME_KEYS[0][1];
      if (anyHeld(codes) || this.touchHeld.has(act)) this.menuSampled.add(m);
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
   * Reads the players' controllers. While a dialog is open their presses go to `onDialogPad`
   * instead, and the game and menus see nothing until they are let go, so the press that
   * closed the dialog does not act again under it.
   */
  private pollPads() {
    let states = this.pads.read();
    const active = states.some((s) => s.active);
    states.forEach((s, pid) => {
      if (s.active) this.lastPadId = this.pads.idOf(pid);
    });
    if (active) this.setDevice('gamepad');
    const menu = new Set(states.flatMap((s) => [...s.menu]));
    const dialogOpen =
      typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
    if (dialogOpen) {
      if (this.padBlocked) {
        for (const m of menu) if (!this.padDialogHeld.has(m)) this.onDialogPad?.(m);
      }
      this.padBlocked = true;
      this.padDialogHeld = menu;
    } else if (this.padBlocked && !active) {
      this.padBlocked = false;
    }
    if (this.padBlocked) states = states.map(() => EMPTY_PAD);
    this.padMenu = this.padBlocked ? new Set() : menu;
    return states;
  }

  /**
   * Whether `action` is held at this tick's sample: by player `pid` for a move, in player 1's
   * mask for the game's keys.
   */
  isDown(action: ControlAction, pid = 0): boolean {
    const mask = isPlayerAction(action) ? (this.masks[pid] ?? 0) : this.masks[0];
    return (mask & ACTION_BITS[action]) !== 0;
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
    this.masks = this.masks.map(() => 0);
    this.locked.clear();
    this.menuLocked.clear();
    for (const l of this.ctrlLocked) l.clear();
  }

  /**
   * Edge-triggered press for the menus and the game's own keys (`GameMode.keyLock`): its lock
   * is released on the first poll the action is up. The players use `keyIsDown`.
   */
  consumePress(action: ControlAction): boolean {
    if (this.isDown(action) && !this.locked.has(action)) {
      this.locked.add(action);
      return true;
    }
    return false;
  }

  /**
   * Locks every action held at the last sample until it is let go, so the key that closed a
   * screen over the game (the sound panel) does not act in the game too.
   */
  lockHeld(): void {
    for (const act of Object.keys(ACTION_BITS) as ControlAction[]) {
      if (this.isDown(act)) this.locked.add(act);
    }
  }

  lock(action: ControlAction): void {
    this.locked.add(action);
  }

  /**
   * Edge-triggered menu move (the site screens, the loader): the keyboard's arrows, bomb key
   * (confirm) and pause key (back), or the controllers' D-pad and stick, A or Start (confirm)
   * and B (back). Locked until released, apart from the game's actions.
   */
  consumeMenu(action: MenuAction): boolean {
    if (this.menuSampled.has(action) && !this.menuLocked.has(action)) {
      this.menuLocked.add(action);
      return true;
    }
    return false;
  }

  /** `PlayerController.keyIsDown`: held by player `pid` and not locked by them; locks it. */
  keyIsDown(action: PlayerAction, pid = 0): boolean {
    const locks = this.ctrlLocked[pid];
    if (this.isDown(action, pid) && locks && !locks.has(action)) {
      locks.add(action);
      return true;
    }
    return false;
  }

  /** `PlayerController.lockKey` */
  lockKey(action: PlayerAction, pid = 0): void {
    this.ctrlLocked[pid]?.add(action);
  }

  /** The start of `PlayerController.getControls`: unlocks player `pid`'s keys no longer held. */
  releaseControllerLocks(pid = 0): void {
    const locks = this.ctrlLocked[pid];
    if (!locks) return;
    for (const act of [...locks]) {
      if (!this.isDown(act, pid)) locks.delete(act);
    }
  }
}
