import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAD } from '../src/engine/Gamepad';
import { Key, type PlayerKeys } from '../src/engine/Input';
import { ACTION_BITS } from '../src/engine/InputRecording';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import { Data } from '../src/game/Data';
import type { PlayerEntity } from '../src/game/entity/Player';
import type { GameSession } from '../src/game/GameSession';
import type { GameResult } from '../src/game/Loader';
import { Adventure } from '../src/game/mode/Adventure';
import { MultiCoop } from '../src/game/mode/MultiCoop';
import { MODE_OPTIONS } from '../src/game/Profile';
import { createHeadlessSession, runReplay, snapshotState } from './helpers/headless';

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
    return this;
  }
}

const keys = (j: number, d: number, l: number, r: number, a: number): PlayerKeys => ({
  jump: [j],
  down: [d],
  left: [l],
  right: [r],
  attack: [a],
});
/** `MultiCoop.initGame`: Igor on the arrows and Enter, Sandy on R F D G and A. */
const P1_KEYS = keys(Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, Key.ENTER);
const P2_KEYS = keys(82, 70, 68, 71, 65);
const NO_KEYS: PlayerKeys = { jump: [], down: [], left: [], right: [], attack: [] };

/** Roadmap 4.2 and G.3: the co-op mode (`mode.MultiCoop`) and how its players join. */
describe('co-op mode', () => {
  let session: GameSession;
  let results: GameResult[];
  let pads: (FakePad | null)[] = [];

  beforeAll(async () => {
    session = await createHeadlessSession();
    session.onGameResult = (r) => results.push(r);
  });

  beforeEach(() => {
    results = [];
    pads = [];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    for (const c of [...P1_KEYS.jump, 13, 37, 39, 40, 82, 70, 68, 71, 65, 80]) {
      session.input.setKeyCode(c, false);
    }
    session.setParameters('0,7,1000,18', '');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) session.gameLoop.stepSingleFrame();
  };
  const start = (options = '', families = '0,7,1000,18', level = 1) => {
    session.setParameters(families, options);
    session.startGame(level, 42, 'multicoop');
    run(60);
  };
  const players = () => session.game.getList(Data.PLAYER) as PlayerEntity[];
  const untilResult = () => {
    for (let i = 0; i < 400 && results.length === 0; i++) session.stepAnimation();
  };
  const hud = () =>
    session.game.hud as unknown as {
      fl_multi: boolean;
      scores: unknown[];
      lives: unknown[][];
      realScores: number[];
    };

  it('is the Adventure with Igor and Sandy', () => {
    start();
    const game = session.game;
    expect(game).toBeInstanceOf(MultiCoop);
    expect(game).toBeInstanceOf(Adventure);
    expect(game._name).toBe('$multi');
    expect(session.isMultiCoop()).toBe(true);
    expect(game.world.set.name).toBe('adventure');
    expect(game.fl_bullet).toBe(false);
    expect(game.fl_disguise).toBe(false);
    expect(game.fl_map).toBe(true);
    expect(game.fl_lock).toBe(false);

    const [p1, p2] = players();
    expect(players().length).toBe(2);
    expect([p1.pid, p2.pid]).toEqual([0, 1]);
    expect(game.player).toBe(p1);
    expect([p1.name, p2.name]).toEqual(['Igor', 'Sandy']);
    expect([p1.skin, p2.skin]).toEqual([1, 2]);
    expect(p2.defaultHead).toBe(Data.HEAD_SANDY);
    expect(p2.head).toBe(Data.HEAD_SANDY);
    expect(p1.head).toBe(Data.HEAD_NORMAL);
    expect([p1.baseColor, p2.baseColor]).toEqual([Data.BASE_COLORS[0], Data.BASE_COLORS[1]]);
    expect([p1.darkColor, p2.darkColor]).toEqual([Data.DARK_COLORS[0], Data.DARK_COLORS[1]]);
    // The level script's `$multi` test
    expect(game.countList(Data.PLAYER) > 1).toBe(true);
  });

  it('gives the original keys to each player', () => {
    start('', '0,7,1000,18', 0);
    expect(session.input.playerKeys(0)).toEqual(P1_KEYS);
    expect(session.input.playerKeys(1)).toEqual(P2_KEYS);
    expect(session.game.joining).toBe(false);

    // Each player moves with their own keys
    const [p1, p2] = players();
    run(40);
    const x1 = p1.x;
    const x2 = p2.x;
    session.input.setKeyCode(Key.LEFT, true);
    session.input.setKeyCode(71, true); // G
    run(10);
    session.input.setKeyCode(Key.LEFT, false);
    session.input.setKeyCode(71, false);
    expect(p1.x).toBeLessThan(x1);
    expect(p2.x).toBeGreaterThan(x2);
  });

  it('halves the lives, rounded up', () => {
    start();
    expect(players().map((p) => p.lives)).toEqual([1, 1]);
    // Two hearts: 3 lives in the Adventure
    start('', '0,7,1000,18,102,103');
    expect(players().map((p) => p.lives)).toEqual([2, 2]);
  });

  it('takes its own mirror and nightmare options', () => {
    start(`${Data.OPT_MIRROR},${Data.OPT_NIGHTMARE}`);
    expect(session.game.fl_mirror).toBe(false);
    expect(session.game.fl_nightmare).toBe(false);
    start(`${Data.OPT_MIRROR_MULTI},${Data.OPT_NIGHTMARE_MULTI}`);
    expect(session.game.fl_mirror).toBe(true);
    expect(session.game.fl_nightmare).toBe(true);
    expect(session.game.world.fl_mirror).toBe(true);
    expect(MODE_OPTIONS.multicoop).toEqual([
      Data.OPT_MIRROR_MULTI,
      Data.OPT_NIGHTMARE_MULTI,
      Data.OPT_LIFE_SHARING,
    ]);
  });

  it('shows the two-player interface: a score, lives and letters each', () => {
    start('', '0,7,1000,18,102,103');
    const h = hud();
    expect(h.fl_multi).toBe(true);
    expect(h.scores.length).toBe(2);
    expect(h.scores.every((f) => f !== null)).toBe(true);
    expect(h.lives.map((l) => l.length)).toEqual([2, 2]);
    // Frame 2 has no level field: the original shows no level number in this mode
    expect(session.game.hud.mc.getText('level')).toBeNull();

    const [p1, p2] = players();
    p2.getScore(null, 500);
    expect(h.realScores).toEqual([0, 500]);
    p1.lives++;
    session.game.hud.setLives(0, p1.lives);
    expect(h.lives.map((l) => l.length)).toEqual([3, 2]);
    // Player 2's lives go leftwards from the right
    const xs = (h.lives[1] as SwfMovieClip[]).map((mc) => mc._x);
    expect(xs).toEqual([300, 288]);
    const letter = session.game.hud.mc.getClip('letter1_3')!;
    expect(letter._visible).toBe(false);
    p2.getExtend(3);
    expect(letter._visible).toBe(true);
    expect(session.game.hud.mc.getClip('letter0_3')!._visible).toBe(false);
  });

  it('ends when a player has no life left, and sends each score', () => {
    start();
    const [p1, p2] = players();
    p1.getScore(null, 700);
    p2.getScore(null, 300);
    p2.killPlayer();
    expect(p2.lives).toBe(0);
    expect(session.game.fl_gameOver).toBe(false);
    p2.killPlayer();
    // Igor still has a life: the game is over all the same
    expect(p1.lives).toBe(1);
    expect(session.game.fl_gameOver).toBe(true);

    untilResult();
    const r = results[0];
    if (r?.kind !== 'gameOver') throw new Error('expected a game over');
    expect(r.score).toBe(-1);
    expect(r.stats.data).toEqual({ s0: 700, s1: 300 });
    expect(r.stats.reachedLevel).toBe(1);
  });

  it('shares lives with the option', () => {
    start(Data.OPT_LIFE_SHARING, '0,7,1000,18,102,103');
    const [p1, p2] = players();
    expect([p1.lives, p2.lives]).toEqual([2, 2]);
    p1.lives = 0;
    p1.killPlayer();
    // A life of Sandy's brings Igor back
    expect(session.game.fl_gameOver).toBe(false);
    expect([p1.lives, p2.lives]).toEqual([-1, 1]);
    expect(hud().lives.map((l) => l.length)).toEqual([0, 1]);
    expect(p1.fl_destroy).toBe(false);
    p1.killPlayer();
    expect([p1.lives, p2.lives]).toEqual([-2, 0]);
    expect(session.game.fl_gameOver).toBe(false);
    // Sandy has no spare life left to give
    p1.killPlayer();
    expect(session.game.fl_gameOver).toBe(true);
  });

  it('shows both players on the pause screen, with a second tip', () => {
    start();
    const game = session.game;
    const lang = (id: number) => session.dataStore.getLangText(id);
    game.onPause();
    const mc = (game as unknown as { pauseMC: SwfMovieClip }).pauseMC;
    expect(mc.getText('move')?.text).toBe(lang(29));
    expect(mc.getText('attack')?.text).toBe(lang(42));
    // `GameMode.onPause` drew tip 301, `MultiCoop.onPause` the next one
    expect(game.tipId).toBe(2);
    expect(mc.getText('tip')?.text).toBe(`${lang(300)}${lang(302)}`);
    game.onUnpause();
    expect(game.fl_pause).toBe(false);
  });

  it('has one player with the bomb control option', () => {
    start(Data.OPT_BOMB_CONTROL);
    expect(session.game.fl_bombControl).toBe(true);
    expect(players().length).toBe(1);
    expect(hud().fl_multi).toBe(false);
    expect(session.input.playerKeys(0).attack).toEqual([Key.ENTER, Key.CONTROL]);
  });

  it('records and replays both players', async () => {
    session.setParameters('0,7,1000,18', '');
    session.mode = 'multicoop';
    session.startRecording(0);
    expect(session.game).toBeInstanceOf(MultiCoop);
    let bombs = 0;
    const script: [number, number[]][] = [
      [110, []],
      [20, [Key.RIGHT, 68]],
      [4, [Key.ENTER]],
      [30, [Key.LEFT, 71, 82]],
      [4, [65]],
      [50, [Key.UP]],
    ];
    const live: unknown[] = [];
    for (const [ticks, held] of script) {
      for (const c of held) session.input.setKeyCode(c, true);
      for (let i = 0; i < ticks; i++) {
        session.gameLoop.stepSingleFrame();
        live.push(snapshotState(session));
        bombs = Math.max(bombs, session.game.getBombs().length);
      }
      for (const c of held) session.input.setKeyCode(c, false);
    }
    const replay = session.stopRecording()!;
    expect(replay.mode).toBe('multicoop');
    expect(replay.otherInputs?.length).toBe(1);
    // Igor's bomb (Enter) and Sandy's (A)
    expect(bombs).toBe(2);

    const replayed: unknown[] = [];
    await runReplay(session, replay, () => replayed.push(snapshotState(session)));
    expect(session.game).toBeInstanceOf(MultiCoop);
    expect(replayed).toEqual(live);
  });

  describe('joining (G.3)', () => {
    const join = () =>
      (session.game as unknown as { join: { devices: unknown[]; awaited: number | null } | null })
        .join;
    /** A game as the menu starts it: the players are asked to join. */
    const startAsked = () => {
      session.setParameters('0,7,1000,18', '');
      session.startGame(1, 42, 'multicoop');
      session.game.askJoin();
      run(60);
    };
    /** Lets go of everything, then waits for the join screen to close. */
    const finish = () => run(Data.SECOND);

    it('asks nothing in a game the menu did not start', () => {
      start();
      expect(session.game.joining).toBe(false);
      expect(session.input.playerDevice(0)).toBeNull();
    });

    it('pauses the game until each player has pressed a device', () => {
      startAsked();
      const game = session.game;
      expect(game.joining).toBe(true);
      expect(game.fl_pause).toBe(true);
      expect(game.fl_lock).toBe(true);
      expect(join()!.awaited).toBe(0);
      const cycle = game.cycle;
      run(30);
      expect(game.cycle).toBe(cycle);

      // The pause key and the page's pause do nothing here
      session.input.setKeyCode(80, true);
      run(2);
      session.input.setKeyCode(80, false);
      game.togglePause();
      session.requestPause();
      expect(game.joining).toBe(true);
      expect(game.fl_pause).toBe(true);

      // Player 1 takes the letters' side, player 2 the arrows'
      session.input.setKeyCode(70, true); // F
      run(2);
      expect(join()!.awaited).toBe(1);
      // The same side again is not player 2's
      session.input.setKeyCode(70, false);
      run(2);
      session.input.setKeyCode(65, true); // A
      run(2);
      session.input.setKeyCode(65, false);
      expect(join()!.awaited).toBe(1);
      session.input.setKeyCode(Key.ENTER, true);
      run(2);
      expect(join()!.awaited).toBeNull();
      // Still up while a key is held: the press must not drop a bomb
      run(Data.SECOND * 2);
      expect(game.joining).toBe(true);
      session.input.setKeyCode(Key.ENTER, false);
      finish();

      expect(game.joining).toBe(false);
      expect(game.fl_pause).toBe(false);
      expect(game.fl_lock).toBe(false);
      expect(session.input.playerDevice(0)).toEqual({ kind: 'keys', side: 1 });
      expect(session.input.playerDevice(1)).toEqual({ kind: 'keys', side: 0 });
      expect(session.input.playerKeys(0)).toEqual(P2_KEYS);
      expect(session.input.playerKeys(1)).toEqual(P1_KEYS);
      expect(game.getBombs().length).toBe(0);
      run(10);
      expect(game.cycle).toBeGreaterThan(cycle);
    });

    it('ignores what is held when the screen opens', () => {
      session.setParameters('0,7,1000,18', '');
      session.startGame(1, 42, 'multicoop');
      session.game.askJoin();
      session.input.setKeyCode(Key.ENTER, true);
      run(80);
      expect(session.game.joining).toBe(true);
      expect(join()!.awaited).toBe(0);
      session.input.setKeyCode(Key.ENTER, false);
      run(2);
      session.input.setKeyCode(Key.ENTER, true);
      run(2);
      session.input.setKeyCode(Key.ENTER, false);
      expect(join()!.awaited).toBe(1);
    });

    it('gives a controller to the player who pressed it, and no keys', () => {
      const a = new FakePad(0);
      const b = new FakePad(1);
      pads = [a, b];
      startAsked();
      // The second controller joins first: it is player 1's
      b.press(PAD.A);
      run(2);
      b.press(PAD.A, false);
      expect(join()!.awaited).toBe(1);
      session.input.setKeyCode(82, true); // R
      run(2);
      session.input.setKeyCode(82, false);
      finish();
      expect(session.game.joining).toBe(false);
      expect(session.input.playerDevice(0)).toEqual({ kind: 'pad', index: 1, id: 'Pad 1' });
      expect(session.input.playerDevice(1)).toEqual({ kind: 'keys', side: 1 });
      expect(session.input.playerKeys(0)).toEqual(NO_KEYS);
      expect(session.input.playerKeys(1)).toEqual(P2_KEYS);

      // Each controller acts for its player only; the one left over for nobody
      b.press(PAD.LEFT);
      a.press(PAD.RIGHT);
      session.input.setKeyCode(Key.RIGHT, true);
      run(1);
      expect(session.input.isDown('left', 0)).toBe(true);
      expect(session.input.isDown('right', 0)).toBe(false);
      expect(session.input.isDown('right', 1)).toBe(false);
      b.press(PAD.LEFT, false);
      a.press(PAD.RIGHT, false);
      session.input.setKeyCode(Key.RIGHT, false);
      session.input.setKeyCode(71, true); // G
      run(1);
      expect(session.input.isDown('right', 1)).toBe(true);
      session.input.setKeyCode(71, false);
    });

    it('asks again for a player whose controller is unplugged', () => {
      const a = new FakePad(0);
      const b = new FakePad(1);
      pads = [a, b];
      startAsked();
      a.press(PAD.A);
      run(2);
      a.press(PAD.A, false);
      run(2);
      b.press(PAD.B);
      run(2);
      b.press(PAD.B, false);
      finish();
      const game = session.game;
      expect(game.joining).toBe(false);
      run(20);

      // Sandy's controller goes: the game stops and asks for her only
      b.connected = false;
      pads = [a, null];
      run(2);
      expect(game.joining).toBe(true);
      expect(game.fl_pause).toBe(true);
      expect(join()!.awaited).toBe(1);
      expect(join()!.devices[0]).toEqual({ kind: 'pad', index: 0, id: 'Pad 0' });
      // Igor's controller cannot take her place
      a.press(PAD.A);
      run(2);
      a.press(PAD.A, false);
      expect(join()!.awaited).toBe(1);
      run(Data.SECOND * 3);
      expect(game.joining).toBe(true);

      // Back in: a press and the game goes on
      const b2 = new FakePad(1);
      pads = [a, b2];
      run(2);
      expect(game.joining).toBe(true);
      b2.press(PAD.A);
      run(2);
      b2.press(PAD.A, false);
      finish();
      expect(game.joining).toBe(false);
      expect(game.fl_pause).toBe(false);
      expect(session.input.lostPlayers()).toEqual([]);
      b2.press(PAD.RIGHT);
      run(1);
      expect(session.input.isDown('right', 1)).toBe(true);
      b2.press(PAD.RIGHT, false);
    });

    it('lets the keyboard take the place of an unplugged controller', () => {
      const a = new FakePad(0);
      pads = [a];
      startAsked();
      session.input.setKeyCode(Key.LEFT, true);
      run(2);
      session.input.setKeyCode(Key.LEFT, false);
      a.press(PAD.A);
      run(2);
      a.press(PAD.A, false);
      finish();
      expect(session.input.playerDevice(1)).toEqual({ kind: 'pad', index: 0, id: 'Pad 0' });

      a.connected = false;
      pads = [];
      run(2);
      expect(session.game.joining).toBe(true);
      // Igor's side of the keyboard is taken; the other one is free
      session.input.setKeyCode(Key.LEFT, true);
      run(2);
      session.input.setKeyCode(Key.LEFT, false);
      expect(join()!.awaited).toBe(1);
      session.input.setKeyCode(68, true); // D
      run(2);
      session.input.setKeyCode(68, false);
      finish();
      expect(session.game.joining).toBe(false);
      expect(session.input.playerDevice(1)).toEqual({ kind: 'keys', side: 1 });
      expect(session.input.playerKeys(1)).toEqual(P2_KEYS);
    });

    it('a new game forgets the devices', () => {
      const a = new FakePad(0);
      pads = [a];
      startAsked();
      a.press(PAD.A);
      run(2);
      a.press(PAD.A, false);
      session.input.setKeyCode(Key.LEFT, true);
      run(2);
      session.input.setKeyCode(Key.LEFT, false);
      finish();
      expect(session.input.playerDevice(0)?.kind).toBe('pad');

      session.startGame(1, 42, 'solo');
      run(30);
      expect(session.input.playerDevice(0)).toBeNull();
      expect(session.game.joining).toBe(false);
      // The controller is player 1's again, with the keyboard
      a.press(PAD.LEFT);
      run(1);
      expect(session.input.isDown('left', 0)).toBe(true);
      a.press(PAD.LEFT, false);
      session.input.setKeyCode(Key.RIGHT, true);
      run(1);
      expect(session.input.isDown('right', 0)).toBe(true);
      session.input.setKeyCode(Key.RIGHT, false);
      expect(ACTION_BITS.left).toBe(1);
    });
  });
});
