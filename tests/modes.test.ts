import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { GameSession } from '../src/game/GameSession';
import { Adventure } from '../src/game/mode/Adventure';
import { GameMode } from '../src/game/mode/GameMode';
import { createHeadlessSession, snapshotState } from './helpers/headless';

/** Roadmap 4.0: `GameSession` (the manager) starts a new `GameMode` object for each game. */
describe('game modes (GameManager.startGameMode)', () => {
  let session: GameSession;

  beforeAll(async () => {
    session = await createHeadlessSession();
  });

  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) session.gameLoop.stepSingleFrame();
  };

  it('the default game is an Adventure, with its five worlds', () => {
    session.startGame(0, 1);
    expect(session.game).toBeInstanceOf(Adventure);
    expect(session.game._name).toBe('$adventure');
    expect(session.game.fl_map).toBe(true);
    expect(session.game.dimensions.map((d) => d.fl_mainWorld)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(session.game.world).toBe(session.game.dimensions[0]);
  });

  it('each game is a new mode: nothing is left of the game before', () => {
    session.startGame(3, 1);
    run(60);
    const first = session.game;
    first.giveKey(7);
    first.globalActives[94] = true;
    first.flipX(true);
    first.registerMapEvent(Data.EVENT_DEATH, null);
    expect(first.getBads().length).toBeGreaterThan(0);

    session.startGame(3, 1);
    const second = session.game;
    expect(second).not.toBe(first);
    // The old mode is locked and its clip gone: the root holds the new mode's only
    expect(first.fl_lock).toBe(true);
    expect(first.mc.parent).toBeNull();
    expect(session.gameRoot.children).toEqual([second.mc]);
    expect(first.getList(Data.ENTITY).filter((e) => !e.fl_destroy)).toEqual([]);

    expect(second.hasKey(7)).toBe(false);
    expect(second.globalActives[94]).toBe(false);
    expect(second.fl_flipX).toBe(false);
    expect(second.mc._xscale).toBe(100);
    expect(second.mapEvents).toEqual([]);
    expect(second.player).not.toBe(first.player);
    expect(second.player!.pid).toBe(0);
  });

  it('two games with the same seed play the same, whatever came before', () => {
    session.startGame(5, 99);
    run(120);
    const a = snapshotState(session);
    // Another game in between, on another level and seed
    session.startGame(12, 7);
    run(200);
    session.startGame(5, 99);
    run(120);
    expect(snapshotState(session)).toEqual(a);
  });

  it('the options are read when the mode is built', () => {
    session.setParameters('0,7,1000,18', Data.OPT_MIRROR);
    session.startGame(1, 1);
    expect(session.game.fl_mirror).toBe(true);
    expect(session.game.dimensions.every((d) => d.fl_mirror)).toBe(true);
    session.setParameters('0,7,1000,18', '');
    expect(session.game.fl_mirror).toBe(true); // the running game keeps its options
    session.startGame(1, 1);
    expect(session.game.fl_mirror).toBe(false);
    expect(session.game.dimensions.some((d) => d.fl_mirror)).toBe(false);
  });

  it('a mode overrides the hooks of GameMode as the original modes do', () => {
    const log: string[] = [];
    /** A minimal mode: one world, one player, and its own rules for bosses and the end. */
    class TestMode extends GameMode {
      constructor(m: GameSession) {
        super(m);
        this._name = '$test';
      }
      override init(): void {
        super.init();
        this.initGame();
        this.initInterface();
      }
      protected override initWorld(): void {
        super.initWorld();
        this.addWorld('adventure');
      }
      protected override initGame(): void {
        super.initGame();
        this.gotoFirstLevel(2);
        this.insertPlayer(this.world.current.playerX, this.world.current.playerY);
      }
      override isBossLevel(id: number): boolean {
        return id === 2;
      }
      override onLevelReady(): void {
        super.onLevelReady();
        log.push(`ready ${this.world.currentId}`);
      }
      override onGameOver(): void {
        super.onGameOver();
        log.push('over');
      }
    }

    const before = session.game;
    session.startGameMode(new TestMode(session));
    const mode = session.game;
    expect(mode).toBeInstanceOf(TestMode);
    expect(before.mc.parent).toBeNull(); // the manager destroyed the mode it replaced
    expect(session.gameRoot.children).toEqual([mode.mc]);
    expect(mode.dimensions.length).toBe(1);
    expect(mode.fl_map).toBe(false); // only Adventure turns the map on
    run(60);
    expect(log).toEqual(['ready 2']);
    expect(mode.world.currentId).toBe(2);
    expect(mode.fl_lock).toBe(false);
    expect(mode.player).not.toBeNull();
    // GameMode's own rules: no level items, no super item order, no score sent
    expect(mode.getItems()).toEqual([]);
    mode.onGameOver();
    expect(log).toEqual(['ready 2', 'over']);
    expect(mode.fl_gameOver).toBe(true);
    expect(session.loader.fl_gameOver).toBe(false);

    // Back to a normal game for whoever comes next
    session.startGame(0, 1);
    expect(session.game).toBeInstanceOf(Adventure);
  });
});
