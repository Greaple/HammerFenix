import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import { Data } from '../src/game/Data';
import { SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import type { GameResult } from '../src/game/Loader';
import { Adventure } from '../src/game/mode/Adventure';
import { Shareware } from '../src/game/mode/Shareware';
import { Tutorial } from '../src/game/mode/Tutorial';
import { createHeadlessSession, snapshotState } from './helpers/headless';

/** Roadmap 4.6: the Learning mode (`mode.Tutorial`) and the demo it leads to (`mode.Shareware`). */
describe('tutorial and shareware modes', () => {
  let session: GameSession;
  let results: GameResult[];

  beforeAll(async () => {
    session = await createHeadlessSession();
    session.onGameResult = (r) => results.push(r);
  });

  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) session.gameLoop.stepSingleFrame();
  };
  const lang = (id: number) => session.dataStore.getLangText(id);
  const pauseText = (name: string) =>
    (session.game as unknown as { pauseMC: SwfMovieClip | null }).pauseMC?.getText(name)?.text;
  /** Runs the Loader's fade until it hands the result over. */
  const untilResult = () => {
    for (let i = 0; i < 400 && results.length === 0; i++) session.stepAnimation();
  };

  beforeEach(() => {
    results = [];
    // What a player with more families and options would send: the tutorial ignores the families
    session.setParameters('0,1,2,7,1000,1001,18', '');
    session.startGame(0, 42, 'tutorial');
    run(60);
  });

  it('starts on the lessons, with nothing to lose', () => {
    const game = session.game;
    expect(game).toBeInstanceOf(Tutorial);
    expect(game._name).toBe('$tutorial');
    expect(session.isTutorial()).toBe(true);
    expect(game.world.set.name).toBe('tutorial');
    expect(game.world.levelCount).toBe(24);
    expect(game.world.currentId).toBe(0);
    expect(game.world.fl_shadow).toBe(false);
    expect(game.fl_lock).toBe(false);
    expect(game.player!.lives).toBe(99999);
    // `GameManager`: the system families, whatever the site sent
    expect(session.config.families.join(',')).toBe(SYSTEM_FAMILIES);
    // No music and no map in this mode
    expect(game.fl_music).toBe(false);
    expect(game.fl_map).toBe(false);
    // The banner of level 0, without the "level" label
    expect(game.fxMan.levelName?.getText('field')?.text).toBe(lang(16));
    expect(game.fxMan.levelName?.getText('label')?.text).toBe('');
  });

  it('shows the light interface: no score, no lives', () => {
    const hud = session.game.hud as unknown as {
      fl_light: boolean;
      lives: unknown[][];
      scores: ({ visible: boolean } | null)[];
    };
    expect(hud.fl_light).toBe(true);
    expect(hud.lives[0]).toEqual([]);
    expect(hud.scores[0]?.visible).toBe(false);
  });

  it('has no hurry up', () => {
    const game = session.game;
    game.huTimer = Data.HU_STEPS[Data.HU_STEPS.length - 1] * 2;
    run(30);
    expect(game.huState).toBe(0);
    expect(game.countList(Data.HU_BAD)).toBe(0);
    expect(game.onHurryUp()).toBeNull();
  });

  it('never shows the exit arrow', () => {
    const game = session.game;
    // Level 0 has no enemy: it is clear from the start
    expect(game.fl_clear).toBe(true);
    expect(game.fxMan.mc_exitArrow).toBeNull();
    game.fxMan.attachExit();
    run(1);
    expect(game.fxMan.mc_exitArrow).toBeNull();
  });

  it('names itself on the pause screen', () => {
    session.game.onPause();
    expect(session.game.fl_pause).toBe(true);
    expect(pauseText('sector')).toBe(`${lang(14)} «${lang(16)}»`);
    session.game.onUnpause();
  });

  it('a death costs nothing', () => {
    const game = session.game;
    const p = game.player!;
    p.killHit(0);
    run(200);
    expect(game.fl_gameOver).toBe(false);
    expect(game.player).toBe(p);
    expect(p.lives).toBe(99998);
    expect(results).toEqual([]);
  });

  it('giving up leaves for the site, with no score', () => {
    const game = session.game;
    game.destroyList(Data.PLAYER);
    game.onGameOver();
    expect(game.fl_gameOver).toBe(true);
    expect(game.fl_lock).toBe(true);
    untilResult();
    expect(results).toEqual([{ kind: 'exitGame', url: session.out, params: null }]);
  });

  describe('the end of the lessons', () => {
    beforeEach(() => {
      // Level 18's door, and the door of level 0 that skips the lessons: `$e_goto` 999
      const tutorial = session.game;
      tutorial.forcedGoto(999);
      expect(tutorial.mc.parent).toBeNull();
      run(60);
    });

    it('starts the demo levels', () => {
      const game = session.game;
      expect(game).toBeInstanceOf(Shareware);
      expect(game).toBeInstanceOf(Adventure);
      expect(game._name).toBe('$shareware');
      expect(session.gameRoot.children).toEqual([game.mc]);
      expect(game.world.set.name).toBe('shareware');
      expect(game.world.levelCount).toBe(7);
      expect(game.dimensions.length).toBe(1);
      expect(game.world.currentId).toBe(0);
      expect(game.fl_lock).toBe(false);
      expect(game.player!.lives).toBe(2);
      expect(game.player!.pid).toBe(0);
      // The Adventure's music and map
      expect(game.fl_music).toBe(session.config.hasMusic());
      expect(game.fl_map).toBe(true);
      expect(game.fxMan.levelName?.getText('field')?.text).toBe(lang(17));
      expect(game.fxMan.levelName?.getText('label')?.text).toBe(session.dataStore.getStatic(13));
      // The site's `$mode` is still the tutorial's: no exit arrow here either
      expect(session.mode).toBe('tutorial');
      game.fxMan.attachExit();
      run(1);
      expect(game.fxMan.mc_exitArrow).toBeNull();
    });

    it('shows its lives and score, and names itself on the pause screen', () => {
      const hud = session.game.hud as unknown as { fl_light: boolean; lives: unknown[][] };
      expect(hud.fl_light).toBe(false);
      expect(hud.lives[0].length).toBe(2);
      session.game.onPause();
      expect(pauseText('sector')).toBe(`${lang(14)} «${lang(17)}»`);
      session.game.onUnpause();
    });

    it('its game over leaves for the site, with no score', () => {
      const game = session.game;
      game.destroyList(Data.PLAYER);
      game.onGameOver();
      expect(game.fl_lock).toBe(true);
      expect(session.loader.fl_gameOver).toBe(false); // no score sent
      untilResult();
      expect(results).toEqual([{ kind: 'exitGame', url: session.out, params: null }]);
    });

    it('its last level leaves for the site too', () => {
      session.game.forcedGoto(999);
      expect(session.game).toBeInstanceOf(Shareware);
      untilResult();
      expect(results).toEqual([{ kind: 'exitGame', url: session.out, params: null }]);
    });
  });

  it('a recording keeps the mode and replays the same', async () => {
    session.startRecording(0);
    expect(session.game).toBeInstanceOf(Tutorial);
    const script: [number, string[]][] = [
      [70, []],
      [40, ['right']],
      [12, ['right', 'jump']],
      [30, []],
      [4, ['attack']],
      [50, ['left']],
      [60, []],
    ];
    for (const [ticks, held] of script) {
      for (const act of ['left', 'right', 'jump', 'down', 'attack'] as const) {
        session.input.setTouch(act, held.includes(act));
      }
      run(ticks);
    }
    const live = snapshotState(session);
    const replay = session.stopRecording()!;
    expect(replay.mode).toBe('tutorial');
    expect(replay.families).toBe(SYSTEM_FAMILIES);

    const player = await session.playReplay(replay);
    expect(session.game).toBeInstanceOf(Tutorial);
    run(player.ticks);
    expect(snapshotState(session)).toEqual(live);
    session.input.stopReplay();
  });

  it('the menu starts it, and the Adventure after it', () => {
    session.setParameters('0,1,2,7,1000,1001,18', '');
    session.startNow('tutorial');
    expect(session.game).toBeInstanceOf(Tutorial);
    expect(session.siteMode).toBe('tutorial');

    session.setParameters('0,1,2,7,1000,1001,18', '');
    session.startNow('solo');
    expect(session.game).toBeInstanceOf(Adventure);
    expect(session.game).not.toBeInstanceOf(Shareware);
    expect(session.mode).toBe('solo');
    expect(session.siteMode).toBe('solo');
    expect(session.config.families.join(',')).toBe('0,1,2,7,1000,1001,18');
    expect(session.game.world.set.name).toBe('adventure');
  });

  it('the debug restart keeps the mode, a set change goes back to the Adventure', async () => {
    session.restartLevel();
    expect(session.game).toBeInstanceOf(Tutorial);
    await session.changeSet('adventure', 3);
    expect(session.game).toBeInstanceOf(Adventure);
    expect(session.mode).toBe('solo');
    expect(session.game.world.currentId).toBe(3);
  });
});
