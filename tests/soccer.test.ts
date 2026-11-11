import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Key } from '../src/engine/Input';
import { Timer } from '../src/engine/Timer';
import { Data } from '../src/game/Data';
import { BaseEntity } from '../src/game/entity/Entity';
import type { PlayerEntity } from '../src/game/entity/Player';
import type { GameSession } from '../src/game/GameSession';
import { SoccerHud } from '../src/game/gui/SoccerHud';
import type { GameResult } from '../src/game/Loader';
import { MultiCoop } from '../src/game/mode/MultiCoop';
import { Soccer } from '../src/game/mode/Soccer';
import { MODE_OPTIONS, Profile } from '../src/game/Profile';
import { newProfile, QuestEngine } from '../src/game/Quests';
import { createHeadlessSession } from './helpers/headless';

/** Roadmap 4.4: SoccerFest (`mode.Soccer`, `gui.SoccerInterface`). */
describe('soccer mode', () => {
  let session: GameSession;
  let results: GameResult[];
  /** A fake `Std.getTimer()`: 1/32 s per logic tick. */
  let clock = 0;

  beforeAll(async () => {
    session = await createHeadlessSession();
    session.onGameResult = (r) => results.push(r);
    session.getTimer = () => clock;
  });

  beforeEach(() => {
    results = [];
    clock = 100000;
    for (const c of [Key.ENTER, Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT, 65, 68, 70, 71, 80, 82]) {
      session.input.setKeyCode(c, false);
    }
    session.fl_debug = false;
  });

  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      clock += 1000 / 32;
      session.gameLoop.stepSingleFrame();
    }
  };
  const game = () => session.game as Soccer;
  const players = () => session.game.getList(Data.PLAYER) as PlayerEntity[];
  const hudText = (name: string) => session.game.hud.mc.getText(name)?.text;
  const pauseMC = () =>
    (
      session.game as unknown as {
        pauseMC: { _currentframe: number; getText(n: string): { text: string } | null } | null;
      }
    ).pauseMC;
  /** Starts a game and runs it to its instructions. */
  const start = (options = 'set_soc_0') => {
    session.setParameters('0,7,1000,18', options);
    session.startGame(0, 42, 'soccer');
    for (let i = 0; i < 200 && !game().fl_pause; i++) run(1);
  };
  /** Closes the instructions and runs to the kick-off. */
  const kickOff = () => {
    game().onUnpause();
    for (let i = 0; i < 200 && !game().ballIn; i++) run(1);
  };
  const untilResult = () => {
    for (let i = 0; i < 400 && results.length === 0; i++) session.stepAnimation();
  };
  const lang = (id: number) => session.dataStore.getLangText(id);
  const spyAlerts = () => vi.spyOn(session.game.fxMan, 'attachAlert');
  /**
   * Drops the ball, last kicked by `p`, from just above the goal case (cx, cy): a goal counts
   * when the ball enters the case (`SoccerBall.infix`).
   */
  const shoot = (p: PlayerEntity | null, cx: number, cy: number) => {
    const ball = game().ball!;
    ball.lastPlayer = p;
    ball.moveTo(BaseEntity.x_ctr(cx), BaseEntity.y_ctr(cy - 1));
    ball.dx = 0;
    ball.dy = 0;
    for (let i = 0; i < 30 && game().ballIn; i++) run(1);
  };

  it('plays a field of the set soccer with the co-op mode’s two players', () => {
    start();
    const g = game();
    expect(g).toBeInstanceOf(Soccer);
    expect(g).toBeInstanceOf(MultiCoop);
    expect(session.isSoccer()).toBe(true);
    expect(g._name).toBe('$soccer');
    expect(g.world.set.name).toBe('soccer');
    expect(g.dimensions.length).toBe(1);
    expect(g.world.currentId).toBe(0);
    expect(g.fl_disguise).toBe(false);
    expect(g.fl_map).toBe(false);
    expect(g.fl_nightmare).toBe(false);
    // No item, no exit arrow
    expect(g.getItems().length).toBe(0);
    expect(g.fxMan.mc_exitArrow).toBeFalsy();

    const [p1, p2] = players();
    expect(players().length).toBe(2);
    expect(g.teams.map((t) => t.map((p) => p.pid))).toEqual([[0], [1]]);
    expect([g.getTeam(p1), g.getTeam(p2)]).toEqual([0, 1]);
    // Their team's colors and soccer kits; Sandy's head
    expect([p1.skin, p2.skin]).toEqual([3, 4]);
    expect([p1.head, p2.head]).toEqual([Data.HEAD_NORMAL, Data.HEAD_SANDY]);
    expect([p1.baseColor, p2.baseColor]).toEqual([Data.BASE_COLORS[1], Data.BASE_COLORS[2]]);
    expect([p1.lives, p2.lives]).toEqual([0, 0]);
    expect([p1.currentWeapon, p2.currentWeapon]).toEqual([Data.WEAPON_NONE, Data.WEAPON_NONE]);
    expect([p1.fl_upKick, p2.fl_upKick]).toEqual([true, true]);
    expect(p1.fl_powerControl).toBe(false);
    // Each on their side of the field, facing the other
    const lv = g.world.current;
    expect(p1.x).toBe(BaseEntity.x_ctr(lv.playerX));
    expect(p2.x).toBe(BaseEntity.x_ctr(Data.LEVEL_WIDTH - lv.playerX - 1));
    expect(p1.cy).toBe(lv.playerY);
    expect(p2.y).toBe(p1.y);
  });

  it('plays the field the site chose (set_soc_N), and needs one', () => {
    for (const n of [1, 2, 3]) {
      start(`set_soc_${n}`);
      expect(game().world.currentId).toBe(n);
    }
    session.setParameters('0,7,1000,18', '');
    expect(() => session.startGame(0, 42, 'soccer')).toThrow('unknown soccermap ID');
  });

  it('gives the third field’s players the volleyball helmet from its script', () => {
    start('set_soc_2');
    kickOff();
    expect(players().map((p) => p.actives[115])).toEqual([true, true]);
  });

  it('has the kick control and soccer bomb options', () => {
    start('set_soc_0,kickcontrol,soccerbomb');
    for (const p of players()) {
      expect(p.fl_powerControl).toBe(true);
      expect(p.currentWeapon).toBe(Data.WEAPON_B_REPEL);
    }
  });

  it('starts paused on the soccer instructions, which a click closes', () => {
    start();
    const g = game();
    expect(g.fl_pause).toBe(true);
    expect(g.fl_lock).toBe(true);
    const mc = pauseMC()!;
    expect(mc._currentframe).toBe(2);
    expect(mc.getText('move')?.text).toBe(lang(29));
    expect(mc.getText('attack')?.text).toBe(lang(30));
    expect(mc.getText('up')?.text).toBe(lang(31));
    expect(mc.getText('tip')?.text).toBe(lang(32));
    expect(mc.getText('click')?.text).toBe(lang(6));
    // No level name
    expect(g.fxMan.levelName).toBeNull();

    // Nothing moves meanwhile
    run(Data.SECOND * 5);
    expect(g.ballIn).toBe(false);

    const alerts = spyAlerts();
    session.clickStart();
    expect(g.fl_pause).toBe(false);
    expect(alerts).toHaveBeenCalledWith(lang(21));

    // P brings the instructions back, with no "click to continue": a click does nothing there
    g.onPause();
    expect(pauseMC()!._currentframe).toBe(2);
    expect(pauseMC()!.getText('click')?.text).toBe('');
    session.clickStart();
    expect(g.fl_pause).toBe(true);
    // "Get ready" only once
    alerts.mockClear();
    g.onUnpause();
    expect(alerts).not.toHaveBeenCalled();
  });

  it('shows the goals and the time left in the soccer interface', () => {
    start();
    const hud = game().hud;
    expect(hud).toBeInstanceOf(SoccerHud);
    expect(hud.mc._currentframe).toBe(3);
    expect(hud.mc.getText('level')).toBeNull();
    expect(hudText('score0')).toBe('0');
    expect(hudText('score1')).toBe('0');
    expect(hudText('time')).toBe(`05" 00`);
  });

  it('drops the ball on a special slot three seconds after the instructions', () => {
    start();
    const g = game();
    const alerts = spyAlerts();
    g.onUnpause();
    run(Data.SECOND * 3 - 2);
    expect(g.ballIn).toBe(false);
    expect(g.fl_match).toBe(false);
    run(2);
    expect(g.ballIn).toBe(true);
    expect(g.fl_match).toBe(true);
    expect(alerts).toHaveBeenCalledWith(lang(24));
    expect(g.getList(Data.SOCCERBALL)).toEqual([g.ball]);
    // Dropped straight down from a slot
    const slotsX = g.world.current.specialSlots.map((s) => BaseEntity.x_ctr(s.x));
    expect(slotsX).toContain(g.ball!.x);
    // The soccer walk from then on (`Adventure.startLevel` gave the normal one at the start)
    for (const p of players()) expect(p.baseWalkAnim).toBe(Data.ANIM_PLAYER_SOCCER);

    // The chrono runs from the kick-off, and stops in pause
    run(Data.SECOND * 10);
    expect(hudText('time')).toBe(`04" 50`);
    g.onPause();
    run(Data.SECOND * 10);
    expect(hudText('time')).toBe(`04" 50`);
    g.onUnpause();
    run(Data.SECOND * 10);
    expect(hudText('time')).toBe(`04" 40`);
  });

  it('speeds up the players far from the ball', () => {
    start();
    kickOff();
    const g = game();
    const [p1, p2] = players();
    const ball = g.ball!;
    p1.moveTo(ball.x + 50, ball.y);
    p2.moveTo(ball.x - 150, ball.y + 150);
    // Read before the tick moves anyone, as `Soccer.main` does
    const d = p2.distance(ball.x, ball.y);
    expect(d).toBeGreaterThan(Soccer.BOOST_DISTANCE);
    run(1);
    expect(p1.speedFactor).toBe(1);
    expect(p2.speedFactor).toBeCloseTo(Math.min(1.5, d / 180), 5);
    // At most 1.5
    p2.moveTo(ball.x - 150, ball.y + 300);
    run(1);
    expect(p2.speedFactor).toBe(1.5);
  });

  it('counts a goal for the team whose goal the ball is not in', () => {
    start();
    kickOff();
    const g = game();
    const [igor, sandy] = players();
    const alerts = spyAlerts();
    // FIELD_GOAL_1 (left) is team 1's to score in
    shoot(sandy, 1, 13);
    expect(g.scores).toEqual([0, 1]);
    expect(hudText('score1')).toBe('1');
    expect(hudText('score0')).toBe('0');
    expect(g.ballIn).toBe(false);
    expect(alerts).toHaveBeenCalledWith(`${lang(22)} (0 - 1)`);
    expect(sandy.head).toBe(Data.HEAD_SANDY_CROWN);
    expect(igor.head).toBe(Data.HEAD_NORMAL);
    expect(sandy.baseWalkAnim).toBe(Data.ANIM_PLAYER_WALK_V);
    expect(igor.baseWalkAnim).toBe(Data.ANIM_PLAYER_SOCCER);

    // Five seconds off, then a new ball
    run(Data.SECOND * 5 - 2);
    expect(g.ballIn).toBe(false);
    run(2);
    expect(g.ballIn).toBe(true);
    expect(sandy.baseWalkAnim).toBe(Data.ANIM_PLAYER_SOCCER);
  });

  it('calls an own goal when the last kick was the other team’s', () => {
    start();
    kickOff();
    const g = game();
    const [igor] = players();
    const alerts = spyAlerts();
    shoot(igor, 1, 13);
    expect(g.scores).toEqual([0, 1]);
    expect(alerts).toHaveBeenCalledWith(lang(23));
    expect(igor.head).toBe(Data.HEAD_LOSE);
    run(Data.SECOND * 5);
    // A ball no one kicked into the right goal: team 0's, counted as a goal of no one
    shoot(null, 18, 13);
    expect(g.scores).toEqual([1, 1]);
    expect(alerts).toHaveBeenLastCalledWith(`${lang(22)} (1 - 1)`);
  });

  it('kicks as strong as the player runs with the kick control option', () => {
    start('set_soc_0,kickcontrol');
    kickOff();
    const g = game();
    const [igor, sandy] = players();
    sandy.moveTo(20, 20);
    const ball = g.ball!;
    // Let the ball land
    for (let i = 0; i < 200 && !ball.fl_stable; i++) run(1);
    igor.moveTo(ball.x - 10, ball.y);
    igor.dir = 1;
    run(5);
    expect(igor.fl_stable).toBe(true);
    const spy = vi.spyOn(igor, 'kickBomb');
    session.input.setKeyCode(Key.ENTER, true);
    run(1);
    session.input.setKeyCode(Key.ENTER, false);
    expect(spy).toHaveBeenCalledTimes(1);
    // Standing still: half the strength
    expect(spy.mock.calls[0][1]).toBeCloseTo(0.5, 5);
  });

  it('ends the match after five minutes, shows the winner, then leaves for $out', () => {
    start();
    kickOff();
    const g = game();
    const [igor, sandy] = players();
    shoot(igor, 18, 13);
    run(Data.SECOND * 5);
    expect(g.scores).toEqual([1, 0]);

    const alerts = spyAlerts();
    // The last minute blinks: to 10 seconds before the end
    clock += Soccer.MATCH_DURATION - g.chrono.get() - 10000;
    run(1);
    expect(hudText('time')).toBe(`00" 10`);
    const time = (g.hud as SoccerHud).time!;
    const colors = new Set<number>();
    for (let i = 0; i < 20; i++) {
      run(1);
      colors.add(time.textColor);
    }
    expect(colors).toEqual(new Set([0xffffff, Soccer.BLINK_COLOR]));

    clock += 20 * 1000;
    run(1);
    expect(g.fl_end).toBe(true);
    expect(g.ball!.fl_destroy).toBe(true);
    expect(g.winners).toBe(0);
    expect(alerts).toHaveBeenCalledWith(lang(25));
    expect(hudText('time')).toBe(`00" 00`);

    // The result three seconds later
    run(Data.SECOND * 3);
    expect(alerts).toHaveBeenLastCalledWith(lang(26));
    expect(igor.baseWalkAnim).toBe(Data.ANIM_PLAYER_WALK_V);
    expect(sandy.baseWalkAnim).toBe(Data.ANIM_PLAYER_WALK_L);
    expect(sandy.speedFactor).toBe(0.3);
    expect(g.endModeTimer).toBeGreaterThan(0);

    // 13 seconds later the game leaves, with no score
    run(Data.SECOND * 13);
    untilResult();
    expect(results).toEqual([{ kind: 'exitGame', url: session.out, params: null }]);
  });

  it('calls a draw', () => {
    start();
    kickOff();
    const alerts = spyAlerts();
    clock += Soccer.MATCH_DURATION;
    run(Data.SECOND * 3 + 1);
    expect(game().winners).toBeNull();
    expect(alerts).toHaveBeenLastCalledWith(lang(28));
    for (const p of players()) expect(p.baseWalkAnim).toBe(Data.ANIM_PLAYER_WALK_L);
  });

  it('leaves for $out when a player gives up', () => {
    start();
    kickOff();
    session.input.setKeyCode(Key.CONTROL, true);
    session.input.setKeyCode(Key.SHIFT, true);
    session.input.setKeyCode(75, true);
    run(1);
    for (const c of [Key.CONTROL, Key.SHIFT, 75]) session.input.setKeyCode(c, false);
    untilResult();
    expect(results).toEqual([{ kind: 'exitGame', url: session.out, params: null }]);
  });

  it('turns the dev keys off, but Shift still runs the match in dev mode', () => {
    session.fl_debug = true;
    start();
    kickOff();
    const g = game();
    expect(g.fl_debug).toBe(false);
    session.input.setKeyCode(Key.SHIFT, true);
    run(1);
    // No debug controls: Shift does not slow the game down
    expect(Timer.tmod).toBe(1);
    // Ten frames, ten seconds of match more: a second a frame
    const before = g.chrono.get();
    run(10);
    session.input.setKeyCode(Key.SHIFT, false);
    expect(g.chrono.get() - before).toBeGreaterThanOrEqual(10312);
    expect(g.chrono.get() - before).toBeLessThanOrEqual(10313);
  });

  it('asks the menu’s players for their devices first, on the soccer’s screen', () => {
    session.setParameters('0,7,1000,18', 'set_soc_0');
    session.startGame(0, 42, 'soccer');
    session.game.askJoin();
    run(60);
    const g = game();
    expect(g.joining).toBe(true);
    const join = (
      g as unknown as {
        join: { mc: { _currentframe: number; getText(n: string): { text: string } | null } };
      }
    ).join;
    expect(join.mc._currentframe).toBe(2);
    expect(join.mc.getText('attack')?.text).toBe(lang(30));
    expect(join.mc.getText('up')?.text).toBe(lang(31));
    // Player 1 on the letters, player 2 on the arrows
    session.input.setKeyCode(70, true);
    run(2);
    session.input.setKeyCode(70, false);
    session.input.setKeyCode(Key.ENTER, true);
    run(2);
    session.input.setKeyCode(Key.ENTER, false);
    run(Data.SECOND);
    expect(g.joining).toBe(false);
    // Then the instructions
    expect(g.fl_pause).toBe(true);
    expect(pauseMC()!._currentframe).toBe(2);
    expect(pauseMC()!.getText('click')?.text).toBe(lang(6));
    session.clickStart();
    expect(g.fl_pause).toBe(false);
    run(Data.SECOND * 3);
    expect(g.ballIn).toBe(true);
  });
});

describe('soccer on the menu (profile)', () => {
  let session: GameSession;
  beforeAll(async () => {
    session = await createHeadlessSession();
  });
  const quests = () => new QuestEngine(session.dataStore.quests, session.dataStore.items);
  const mem = () => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  };

  it('is free for everyone, also with a profile saved before it', () => {
    const p = new Profile(quests(), mem());
    expect(p.hasMode('soccer')).toBe(true);
    p.data.modes = ['solo', 'tutorial'];
    expect(p.hasMode('soccer')).toBe(true);
    expect(newProfile().modes).toContain('soccer');
  });

  it('offers the kick control option and the four fields', () => {
    const p = new Profile(quests(), mem());
    expect(MODE_OPTIONS.soccer).toEqual([Data.OPT_KICK_CONTROL]);
    expect(p.runChoices('soccer')).toEqual(['set_soc_0', 'set_soc_1', 'set_soc_2', 'set_soc_3']);
    expect(p.runChoices('timeattack')).toEqual([]);
    expect(p.optionsParam('soccer')).toBe('set_soc_0');

    p.chooseRun('soccer', 'set_soc_2');
    expect(p.runOption('soccer')).toBe('set_soc_2');
    p.chooseRun('soccer', 'set_soc_3');
    expect(p.data.chosen.filter((o) => o.startsWith('set_soc'))).toEqual(['set_soc_3']);
    // Not a run of the mode
    p.chooseRun('soccer', 'set_ta_0');
    expect(p.runOption('soccer')).toBe('set_soc_3');

    // Quest 66's option, once ticked
    p.data.options.push(Data.OPT_KICK_CONTROL);
    p.toggleOption(Data.OPT_KICK_CONTROL);
    expect(p.optionsParam('soccer')).toBe('kickcontrol,set_soc_3');
  });
});
