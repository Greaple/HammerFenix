import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAD } from '../src/engine/Gamepad';
import {
  DEFAULT_KEYS,
  InputController,
  Key,
  type PlayerKeys,
  flashKeyCode,
} from '../src/engine/Input';
import { InputPlayer, InputRecorder } from '../src/engine/InputRecording';
import { Data } from '../src/game/Data';
import type { GameSession } from '../src/game/GameSession';
import type { PlayerEntity } from '../src/game/entity/Player';
import { createHeadlessSession } from './helpers/headless';

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

let pads: (FakePad | null)[] = [];

beforeEach(() => {
  pads = [];
  vi.stubGlobal('navigator', { getGamepads: () => pads });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `MultiCoop.initGame`'s keys: player 1 on the arrows and Enter, player 2 on R F D G and A. */
const keys = (j: number, d: number, l: number, r: number, a: number): PlayerKeys => ({
  jump: [j],
  down: [d],
  left: [l],
  right: [r],
  attack: [a],
});
const P1_KEYS = keys(Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, Key.ENTER);
const P2_KEYS = keys(82, 70, 68, 71, 65);

function twoPlayers(): InputController {
  const input = new InputController();
  input.setPlayerCount(2);
  input.setPlayerKeys(0, P1_KEYS);
  input.setPlayerKeys(1, P2_KEYS);
  return input;
}

describe('Flash key codes (G.2)', () => {
  it('a letter is the letter of the layout, as Flash read it', () => {
    expect(flashKeyCode('KeyQ', 'a')).toBe(65); // AZERTY's A
    expect(flashKeyCode('KeyW', 'z')).toBe(90);
    expect(flashKeyCode('KeyQ', 'Q')).toBe(81); // Shift held
    expect(flashKeyCode('KeyQ', 'й')).toBe(81); // no Latin letter: its QWERTY place
    expect(flashKeyCode('KeyA')).toBe(65);
    expect(flashKeyCode('ArrowUp', 'ArrowUp')).toBe(Key.UP);
    expect(flashKeyCode('Enter', 'Enter')).toBe(Key.ENTER);
  });
});

describe('one input per player (G.2)', () => {
  it('each player reads their own keys', () => {
    const input = twoPlayers();
    input.setKeyCode(68, true); // D: player 2's left
    input.poll();
    expect(input.isDown('left', 1)).toBe(true);
    expect(input.isDown('left', 0)).toBe(false);
    expect(input.isDown('right', 0)).toBe(false); // D is no longer player 1's right
    input.setKeyCode(68, false);
    input.setKeyCode(Key.ENTER, true);
    input.poll();
    expect(input.isDown('attack', 0)).toBe(true);
    expect(input.isDown('attack', 1)).toBe(false);
  });

  it('a player starts with the default keys, and a new game resets them', () => {
    const input = twoPlayers();
    expect(input.playerKeys(1)).toBe(P2_KEYS);
    input.resetKeys();
    expect(input.playerKeys(0)).toBe(DEFAULT_KEYS);
    expect(input.playerKeys(1)).toBe(DEFAULT_KEYS);
  });

  it('the key locks are each player’s own', () => {
    const input = twoPlayers();
    input.setKeyCode(Key.ENTER, true);
    input.setKeyCode(65, true);
    input.poll();
    expect(input.keyIsDown('attack', 0)).toBe(true);
    expect(input.keyIsDown('attack', 0)).toBe(false);
    expect(input.keyIsDown('attack', 1)).toBe(true);
    // Player 2 lets go: only their lock goes
    input.setKeyCode(65, false);
    input.poll();
    input.releaseControllerLocks(1);
    input.releaseControllerLocks(0);
    input.setKeyCode(65, true);
    input.poll();
    expect(input.keyIsDown('attack', 1)).toBe(true);
    expect(input.keyIsDown('attack', 0)).toBe(false);
  });

  it('the game keys count from any player, in player 1’s mask', () => {
    const input = twoPlayers();
    const p1 = new FakePad(0);
    const p2 = new FakePad(1);
    pads = [p1, p2];
    p2.press(PAD.START).press(PAD.LEFT);
    input.poll();
    expect(input.isDown('pause')).toBe(true);
    expect(input.isDown('left', 1)).toBe(true);
    expect(input.isDown('left', 0)).toBe(false);
  });

  it('controllers are given to the players in connection order', () => {
    const input = twoPlayers();
    const events: string[] = [];
    input.onPadConnect = (id, pid) => events.push(`+${id}>${pid}`);
    input.onPadDisconnect = (id, pid) => events.push(`-${id}>${pid}`);
    const [a, b, c] = [new FakePad(0), new FakePad(1), new FakePad(2)];
    pads = [a, b, c];
    input.poll();
    expect(events).toEqual(['+Pad 0>0', '+Pad 1>1']); // the third waits
    c.press(PAD.B);
    input.poll();
    expect(input.isDown('attack', 0) || input.isDown('attack', 1)).toBe(false);
    // Player 1's is unplugged: the waiting one takes its place, player 2 keeps theirs
    pads = [null, b, c];
    input.poll();
    expect(events.slice(2)).toEqual(['-Pad 0>0', '+Pad 2>0']);
    expect(input.isDown('attack', 0)).toBe(true);
    // Plugged in again: it waits, as both players have one
    pads = [a, b, c];
    b.press(PAD.X);
    input.poll();
    expect(events.length).toBe(4);
    expect(input.isDown('attack', 1)).toBe(true);
    // Back to one player: player 2's controller waits, first in line
    input.setPlayerCount(1);
    pads = [a, b, null];
    input.poll();
    expect(events.slice(4)).toEqual(['-Pad 2>0', '+Pad 1>0']);
  });

  it('records one mask per player, and plays them back', () => {
    const rec = new InputRecorder();
    rec.push([1]);
    rec.push([1, 4]); // player 2 joins
    rec.push([0, 4]);
    const replay = rec.toReplay('adventure', 1, 0);
    expect(replay.input).toEqual([
      [1, 2],
      [0, 1],
    ]);
    expect(replay.otherInputs).toEqual([
      [
        [0, 1],
        [4, 2],
      ],
    ]);
    const player = new InputPlayer(replay.input, replay.otherInputs);
    expect(player.ticks).toBe(3);
    expect([player.next(), player.next(), player.next()]).toEqual([
      [1, 0],
      [1, 4],
      [0, 4],
    ]);
    expect(player.done).toBe(true);
    // One player: no other inputs, as in the replays before G.2
    const solo = new InputRecorder();
    solo.push([3]);
    expect(solo.toReplay('adventure', 1, 0).otherInputs).toBeUndefined();
  });
});

describe('two players in a game (G.2)', () => {
  let session: GameSession;

  beforeAll(async () => {
    session = await createHeadlessSession();
  });

  afterEach(() => {
    for (const c of [Key.ENTER, Key.CONTROL, 65, 68, 71, 82]) session.input.setKeyCode(c, false);
  });

  function step(n = 1): void {
    for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
  }

  /** `MultiCoop.initGame`, after a level 1 game started: player 2 next to player 1. */
  function addPlayer2(): [PlayerEntity, PlayerEntity] {
    const p1 = session.player!;
    p1.ctrl.setKeys(Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, Key.ENTER);
    const w = session.world.current;
    const p2 = session.insertPlayer(w.playerX, w.playerY);
    p2.ctrl.setKeys(82, 70, 68, 71, 65);
    p2.show();
    return [p1, p2];
  }

  it('gives pids in order, and a new game is back to one player', () => {
    session.initGame(1, 1234);
    step(30);
    const [p1, p2] = addPlayer2();
    expect([p1.pid, p2.pid]).toEqual([0, 1]);
    expect(session.input.playerCount).toBe(2);
    session.initGame(1, 1234);
    expect(session.input.playerCount).toBe(1);
    expect(session.input.playerKeys(0)).toBe(DEFAULT_KEYS);
  });

  it('each player moves and drops bombs with their own keys', () => {
    session.initGame(1, 1234);
    step(30);
    const [p1, p2] = addPlayer2();
    const x1 = p1.x;
    const x2 = p2.x;
    session.input.setKeyCode(68, true); // D: player 2 left
    step(8);
    session.input.setKeyCode(68, false);
    expect(p2.x).toBeLessThan(x2);
    expect(p1.x).toBe(x1);
    step(4);
    session.input.setKeyCode(65, true); // A: player 2's bomb
    step();
    session.input.setKeyCode(65, false);
    const bombs = () => session.getBombs().map((b) => (b.parent as PlayerEntity | null)?.pid);
    expect(bombs()).toEqual([1]);
    session.input.setKeyCode(Key.ENTER, true); // player 1's bomb
    step();
    session.input.setKeyCode(Key.ENTER, false);
    expect(bombs().sort()).toEqual([0, 1]);
    // Ctrl is no longer player 1's bomb, until a mode gives it back (`setAlt`)
    session.destroyList(Data.BOMB);
    step(20);
    session.input.setKeyCode(Key.CONTROL, true);
    step();
    session.input.setKeyCode(Key.CONTROL, false);
    expect(bombs()).toEqual([]);
    p1.ctrl.setAlt(p1.ctrl.attack, Key.CONTROL);
    session.input.setKeyCode(Key.CONTROL, true);
    step();
    expect(bombs()).toEqual([0]);
  });

  it('a two-player recording plays back the same', async () => {
    session.startRecording(1);
    const plan: [number, number, boolean][] = [
      [30, 0, false],
      [31, 68, true],
      [45, 68, false],
      [46, Key.RIGHT, true],
      [50, 65, true],
      [52, 65, false],
      [60, Key.RIGHT, false],
      [61, 82, true],
      [75, 82, false],
      [76, Key.ENTER, true],
      [78, Key.ENTER, false],
    ];
    let players: [PlayerEntity, PlayerEntity] | null = null;
    const trace: number[][] = [];
    for (let t = 0; t < 120; t++) {
      for (const [at, code, down] of plan) {
        if (at !== t) continue;
        if (code === 0) players = addPlayer2();
        else session.input.setKeyCode(code, down);
      }
      step();
      if (players) trace.push(players.flatMap((p) => [p.x, p.y]));
    }
    const replay = session.stopRecording()!;
    expect(replay.otherInputs).toHaveLength(1);
    expect(replay.otherInputs![0].some(([m]) => m !== 0)).toBe(true);

    await session.playReplay(replay);
    const again: number[][] = [];
    players = null;
    for (let t = 0; t < 120; t++) {
      if (t === 30) {
        // The replay's game makes the same second player; its keys do not matter
        const w = session.world.current;
        const p2 = session.insertPlayer(w.playerX, w.playerY);
        p2.show();
        players = [session.player!, p2];
      }
      step();
      if (players) again.push(players.flatMap((p) => [p.x, p.y]));
    }
    expect(again).toEqual(trace);
    // Both moved
    expect(new Set(trace.map((r) => r[0])).size).toBeGreaterThan(1);
    expect(new Set(trace.map((r) => r[2])).size).toBeGreaterThan(1);
  });
});
