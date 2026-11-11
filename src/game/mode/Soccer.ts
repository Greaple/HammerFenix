import { Key } from '../../engine/Input';
import { Timer } from '../../engine/Timer';
import { SwfTextField } from '../../engine/swf/SwfMovieClip';
import { Chrono } from '../Chrono';
import { Data } from '../Data';
import { SoccerBall } from '../entity/Bomb';
import { BaseEntity } from '../entity/Entity';
import type { PlayerEntity } from '../entity/Player';
import { FxManager } from '../FxManager';
import type { GameSession } from '../GameSession';
import type { JoinFrame } from '../gui/JoinScreen';
import { SoccerHud } from '../gui/SoccerHud';
import { MultiCoop } from './MultiCoop';

/** `Soccer.onPause`'s screen (frame 2): move, kick and up kick. */
const SOCCER_SCREEN: JoinFrame = { frame: '2', texts: { move: 29, attack: 30, up: 31 } };

/**
 * Port of `mode.Soccer` (`class/hammer/mode/Soccer.mt`): SoccerFest, the site's `$mode` `soccer`,
 * free for everyone. Igor and Sandy on one of the four fields of the set `soccer` (`set_soc_N`),
 * with the co-op mode's keys: a five-minute match in real time (`Chrono`), the ball dropped on
 * one of the field's special slots after a three-second wait, and five seconds off after each
 * goal. A player far from the ball runs faster (up to 1.5 times). Everyone kicks the ball up
 * with the down key; the `kickcontrol` option (quest 66) makes a kick on the ground as strong as
 * the player runs, and `soccerbomb` (which no quest gives) gives each player repel bombs. No item,
 * no hurry up, no disguise, no map, no dev keys (`manager.fl_debug = false`, here for this game
 * only: the original page was reloaded for the next one). The level starts paused on the soccer
 * instructions; the match's end shows the winner for 13 seconds, then the game leaves for the
 * site's `$out`, with no score.
 *
 * Port addition (G.3): a game started from the menu first asks each player to pick their
 * controller or keyboard side, on the soccer's pause screen, then shows the instructions.
 *
 * Not ported: `onEndMode`, which nothing calls, and `darknessManager`, which overrides nothing.
 * `SoccerSelector.mt` (the four fields side by side, a click starts one) is not ported either:
 * nothing in the game starts it (a commented out line of `GameManager`), and this constructor
 * drops the field it would pass, reading `set_soc_N` instead. The menu chooses the field, as the
 * site's did.
 */
export class Soccer extends MultiCoop {
  static readonly BOOST_DISTANCE = 180;
  static readonly MAX_BOOST = 1.5;
  /** In milliseconds. */
  static readonly MATCH_DURATION = 5 * (1000 * 60);
  static readonly WARNING_TIME = 1 * (1000 * 60);
  static readonly BLINK_COLOR = 0xffbbaa;
  static readonly BLINK_GLOWCOLOR = 0x990000;

  static readonly GOAL_OFFTIME = 5 * Data.SECOND;
  static readonly START_OFFTIME = 3 * Data.SECOND;
  static readonly END_TIMER = 13 * Data.SECOND;

  /** Four players (never set in the original). */
  fl_party: boolean;
  /** The first kick-off has happened: the chrono runs. */
  fl_match: boolean;
  fl_end: boolean;
  /** "Get ready..." is still to show, at the first unpause. */
  fl_help: boolean;
  /** Goals, by team. */
  scores: number[];
  teams: PlayerEntity[][];

  ball: SoccerBall | null = null;
  blinkTimer: number;

  chrono: Chrono;
  /** Frames before the next kick-off. */
  offPlayTimer = 0;
  /** Frames from the end of the match to its result. */
  finalTimer = 0;
  /** The winning team, null for a draw. */
  winners: number | null = null;

  /** Port addition (G.3): the instructions wait for the players to choose their devices. */
  private fl_helpAfterJoin = false;

  constructor(m: GameSession, _id: number) {
    super(m, Soccer.fieldId(m));

    this._name = '$soccer';
    this.fl_disguise = false;
    this.fl_map = false;

    this.fl_help = true;
    this.fl_party = false;
    this.fl_match = false;
    this.fl_end = false;
    this.fl_nightmare = false;

    this.blinkTimer = 0;

    this.chrono = new Chrono(m.getTimer);
    this.scores = [];
    this.teams = [];

    this.joinScreen = SOCCER_SCREEN;
  }

  /** The constructor's start: the field the site chose, whatever id it was given. */
  private static fieldId(m: GameSession): number {
    let id: number | null = null;
    if (m.config.hasOption(Data.OPT_SET_SOC_0)) id = 0;
    if (m.config.hasOption(Data.OPT_SET_SOC_1)) id = 1;
    if (m.config.hasOption(Data.OPT_SET_SOC_2)) id = 2;
    if (m.config.hasOption(Data.OPT_SET_SOC_3)) id = 3;
    if (id === null) {
      m.fatal('unknown soccermap ID');
    }
    return id;
  }

  /** `manager.fl_debug = false` (constructor): no dev keys in this game. */
  override get fl_debug(): boolean {
    return false;
  }

  /** The interface, as `gi` is `SoccerInterface` in this mode. */
  private get gi(): SoccerHud {
    return this.hud as SoccerHud;
  }

  /** `Soccer.initGame`: the co-op's two players, in two teams, and the help line. */
  protected override initGame(): void {
    super.initGame();

    if (this.fl_party) {
      const p1 = this.insertPlayer(6, 10);
      p1.ctrl.setKeys(79, 76, 75, 77, 73); // OKLM
      const p2 = this.insertPlayer(14, 10);
      p2.ctrl.setKeys(101 /*Z*/, 98 /*S*/, 97 /*A*/, 99 /*D*/, 100 /*A*/);
    }

    // Teams
    const pl = this.getList(Data.PLAYER) as PlayerEntity[];
    this.teams = [[], []];
    for (let i = 0; i < pl.length; i++) {
      if (i < pl.length / 2) {
        this.teams[0].push(pl[i]);
      } else {
        this.teams[1].push(pl[i]);
      }
    }

    this.scores = [0, 0];

    // `Std.createTextField`: Flash's default format (Times New Roman, 12) in a 300 x 50 box, with
    // its 2 px gutter, centered by the `<P ALIGN>`
    const mc = this.depthMan.empty(Data.DP_INTERF);
    const t = new SwfTextField(
      {
        kind: 'text',
        bounds: [2, 2, 298, 48],
        font: '"Times New Roman", Times, serif',
        size: 12,
        color: '#000000',
        align: 'center',
        text: '',
      },
      this.lib.headless,
    );
    mc.addChild(t);
    t._x = Data.GAME_WIDTH * 0.5 - 300 * 0.5;
    t._y = Data.GAME_HEIGHT - 20;
    t.textColor = 0xffffff;
    t.htmlText = `<P ALIGN="CENTER"><FONT COLOR="#FFFFFF">${this.dataStore.getLangText(33)}</FONT></P>`;
  }

  /** `Soccer.initInterface` */
  protected override initInterface(): void {
    this.hud?.destroy();
    this.hud = new SoccerHud(this);
  }

  // ----------------------------------------------------------------- chrono

  override unlock(): void {
    super.unlock();
    this.chrono.start();
  }

  override lock(): void {
    super.lock();
    this.chrono.stop();
  }

  // ------------------------------------------------------------------ level

  /** `Soccer.forcedGoto`: the players back on their side. */
  override forcedGoto(id: number): void {
    super.forcedGoto(id);
    this.cleanKills();
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      this.initPlayer(p);
    }
  }

  /** `Soccer.initPlayer`: the team's color and side, the soccer moves, no life and no weapon. */
  protected override initPlayer(p: PlayerEntity): void {
    super.initPlayer(p);

    p.baseColor = Data.BASE_COLORS[this.getTeam(p) + 1];
    p.skin = p.pid + 3;
    if (p.skin === 4) {
      p.defaultHead = Data.HEAD_SANDY;
      p.head = p.defaultHead;
    }
    p.baseWalkAnim = Data.ANIM_PLAYER_SOCCER;
    p.fl_upKick = true;
    p.fl_powerControl = this.config.hasOption(Data.OPT_KICK_CONTROL);
    p.lives = 0;
    p.dx = 0;
    p.dy = 0;
    p.unshield();
    if (p.fl_knock) {
      p.onWakeUp();
    }

    if (this.getTeam(p) === 0) {
      p.moveTo(
        BaseEntity.x_ctr(this.world.current.playerX + this.getTeamPos(p)),
        BaseEntity.y_ctr(this.world.current.playerY),
      );
    } else {
      p.moveTo(
        BaseEntity.x_ctr(Data.LEVEL_WIDTH - this.world.current.playerX - 1 - this.getTeamPos(p)),
        BaseEntity.y_ctr(this.world.current.playerY),
      );
    }

    if (this.config.hasOption(Data.OPT_SOCCER_BOMBS)) {
      p.changeWeapon(Data.WEAPON_B_REPEL);
    } else {
      p.changeWeapon(Data.WEAPON_NONE);
    }
  }

  /** `getTeam`: a player's team, 0 or 1 (0 for no player, as AS2 read `null.pid`). */
  getTeam(p: PlayerEntity | null): number {
    let tid = 0;
    for (const o of this.teams[1]) {
      if (o.pid === p?.pid) {
        tid = 1;
      }
    }
    return tid;
  }

  /** `getTeamPos`: a player's place in their team. */
  getTeamPos(p: PlayerEntity): number {
    const tid = this.getTeam(p);
    let pos = 0;
    for (let i = 0; i < this.teams[tid].length; i++) {
      if (p.pid === this.teams[tid][i].pid) {
        pos = i;
      }
    }
    return pos;
  }

  getTeamScore(tid: number): number {
    return this.scores[tid];
  }

  /** `Soccer.initWorld` (`xml_soccer`) */
  protected override initWorld(): void {
    this.addWorld('soccer');
  }

  // Switched off
  override onHurryUp(): null {
    return null;
  }
  protected override getDebugControls(): void {}
  protected override addLevelItems(): void {}

  // ------------------------------------------------------------------ match

  /** `Soccer.goal`: team `tid` scores (`SoccerBall.infix`). */
  goal(tid: number): void {
    // The ball the mode dropped, whichever ball scored (a level script can drop others)
    const ball = this.ball;
    const shooter = ball?.lastPlayer ?? null;
    const pl = this.getList(Data.PLAYER) as PlayerEntity[];
    this.scores[tid]++;
    pl[tid]?.getScoreHidden(1);

    for (const p of pl) {
      p.head = p.defaultHead;
      p.speedFactor = 1;
      if (this.getTeam(p) === tid) {
        p.setBaseAnims(Data.ANIM_PLAYER_WALK_V, Data.ANIM_PLAYER_STOP_V);
      } else {
        p.setBaseAnims(Data.ANIM_PLAYER_SOCCER, Data.ANIM_PLAYER_STOP);
      }
    }

    // AS2 ignores what is done to a missing shooter (a ball no one kicked)
    if (tid === this.getTeam(shooter)) {
      // Goal
      this.audio.playSound('sound_item_score', Data.CHAN_FIELD);
      this.fxMan.attachAlert(
        `${this.lang(22)} (${this.getTeamScore(0)} - ${this.getTeamScore(1)})`,
      );
      if (shooter) {
        shooter.head = shooter.skin === 4 ? Data.HEAD_SANDY_CROWN : Data.HEAD_CROWN;
      }
    } else {
      // Own goal
      this.audio.playSound('sound_player_death', Data.CHAN_FIELD);
      this.fxMan.attachAlert(`${this.lang(23)}`);
      if (shooter) {
        shooter.head = shooter.skin === 4 ? Data.HEAD_SANDY_LOSE : Data.HEAD_LOSE;
      }
    }
    shooter?.replayAnim();
    if (ball) {
      this.fxMan.inGameParticlesDir(Data.PARTICLE_CLASSIC_BOMB, ball.x, ball.y, 10, -ball.dx);
      this.fxMan.attachFx(ball.x, ball.y - Data.CASE_HEIGHT, 'hammer_fx_shine');
    }

    this.offPlayTimer = Soccer.GOAL_OFFTIME;
  }

  /** `Soccer.endMatch`: the time is up. */
  endMatch(): void {
    this.fxMan.clear();
    // Deviation: after a goal the ball's clip is gone, and the original draws these particles at
    // its undefined position, where they do not show
    if (this.ballIn) {
      const ball = this.ball as SoccerBall;
      this.fxMan.inGameParticles(Data.PARTICLE_CLASSIC_BOMB, ball.x, ball.y, 10);
      ball.destroy();
    }
    this.fxMan.attachAlert(`${this.lang(25)}`);

    this.offPlayTimer = 99999;
    this.fl_end = true;

    // The winning team
    if (this.getTeamScore(0) > this.getTeamScore(1)) {
      this.winners = 0;
    }
    if (this.getTeamScore(0) < this.getTeamScore(1)) {
      this.winners = 1;
    }
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.speedFactor = 1;
      p.setBaseAnims(Data.ANIM_PLAYER_SOCCER, Data.ANIM_PLAYER_STOP);
    }
  }

  /** `Soccer.showResults`: the winner, or a draw. */
  showResults(): void {
    if (this.winners === 0) {
      this.fxMan.attachAlert(`${this.lang(26)}`);
    }
    if (this.winners === 1) {
      this.fxMan.attachAlert(`${this.lang(27)}`);
    }
    if (this.winners === null) {
      this.fxMan.attachAlert(`${this.lang(28)}`);
    }

    this.shake(Data.SECOND, 5);

    // The players' end moves
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      if (this.winners !== null && this.getTeam(p) === this.winners) {
        p.speedFactor = 1;
        p.setBaseAnims(Data.ANIM_PLAYER_WALK_V, Data.ANIM_PLAYER_STOP_V);
      } else {
        p.speedFactor = 0.3;
        p.setBaseAnims(Data.ANIM_PLAYER_WALK_L, Data.ANIM_PLAYER_STOP_L);
      }
    }
  }

  // ----------------------------------------------------------------- events

  /** `Soccer.onLevelReady`: the instructions, then the kick-off three seconds after them. */
  override onLevelReady(): void {
    super.onLevelReady();
    this.fl_match = false;
    this.offPlayTimer = Soccer.START_OFFTIME;

    // Port addition (G.3): when the players have their devices to choose, it comes first
    if (this.joinAsked) {
      this.fl_helpAfterJoin = true;
    } else {
      this.showHelp();
    }
    this.fxMan.levelName?.removeMovieClip();
    this.fxMan.levelName = null;
  }

  /** The end of `Soccer.onLevelReady`: the pause screen, which a click also closes. */
  private showHelp(): void {
    this.onPause();
    if (!this.pauseMC) return;
    this.pauseRelease = () => this.onUnpause();
    const click = this.pauseMC.getText('click');
    if (click) click.text = `${this.lang(6)}`;
  }

  /** Port addition (G.3): once the players have their devices, the instructions show. */
  protected override updateJoin(): void {
    super.updateJoin();
    if (!this.join && this.fl_helpAfterJoin) {
      this.fl_helpAfterJoin = false;
      this.showHelp();
    }
  }

  /** `Soccer.onPause`: the soccer's instructions (frame 2). */
  override onPause(): void {
    super.onPause();
    const mc = this.pauseMC;
    if (!this.fl_pause || !mc) return;

    mc.gotoAndStop('2');
    const setText = (name: string, text: string) => {
      const field = mc.getText(name);
      if (field) field.text = text;
    };
    setText('move', `${this.lang(29)}`);
    setText('attack', `${this.lang(30)}`);
    setText('up', `${this.lang(31)}`);
    setText('tip', `${this.lang(32)}`);
    setText('click', '');

    this.pausePrompts = 'frame2';
    this.showPausePrompts();
  }

  /**
   * Port addition (G.3): frame 2 shows each player's device, as the co-op's frame 3 does.
   * `MultiCoop.onPause` calls it on frame 3, before this mode's `onPause` goes to frame 2.
   */
  protected override showPausePrompts(): void {
    if (this.pauseMC?._currentframe !== 2) return;
    super.showPausePrompts();
  }

  /** `Soccer.onUnpause`: "Get ready..." the first time. */
  override onUnpause(): void {
    super.onUnpause();
    if (this.fl_help) {
      this.fxMan.attachAlert(`${this.lang(21)}`);
      this.fl_help = false;
    }
  }

  /** `Soccer.endMode`: back to the site's `$out`. */
  override endMode(): void {
    this.manager.redirect(this.manager.out, null);
  }

  /** `Soccer.onGameOver`: no score. */
  override onGameOver(): void {
    this.endMode();
  }

  /** `Soccer.insertBall`: the ball drops on one of the field's special slots. */
  insertBall(): void {
    const slots = this.world.current.specialSlots;
    const s = slots[this.rand.random(slots.length)];
    const ball = SoccerBall.attach(this, BaseEntity.x_ctr(s.x), BaseEntity.y_ctr(s.y));
    this.ball = ball;

    this.fxMan.inGameParticles(Data.PARTICLE_CLASSIC_BOMB, ball.x, ball.y, 9);
    this.fxMan.inGameParticles(Data.PARTICLE_ICE, ball.x, ball.y, 5);

    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.setBaseAnims(Data.ANIM_PLAYER_SOCCER, Data.ANIM_PLAYER_STOP);
    }

    this.audio.playSound('sound_pop', Data.CHAN_FIELD);
  }

  /** `ball._name != null`: the ball is on the field (its clip goes at the end of a goal's tick). */
  get ballIn(): boolean {
    return this.ball !== null && Boolean(this.ball.mc._name);
  }

  /** `Lang.get` (AS2 writes "null" for a missing text). */
  private lang(id: number): string {
    return `${this.dataStore.getLangText(id)}`;
  }

  /** `Soccer.main`: the match chrono, the kick-offs, the speed boost and the match's end. */
  override main(): void {
    this.chrono.update();
    if (!this.fl_match) {
      this.chrono.reset();
    }

    // Dev mode: Shift runs the match a second a frame (`isDev`, which this mode leaves on)
    if (this.manager.fl_debug && this.input.isKeyDown(Key.SHIFT)) {
      this.chrono.timeShift(-1);
    }

    let t: number;
    if (this.chrono.fl_stop) {
      // AS2 reads a null `suspendTimer` as 0
      t = Soccer.MATCH_DURATION - ((this.chrono.suspendTimer ?? 0) - this.chrono.gameTimer);
    } else {
      t = Soccer.MATCH_DURATION - this.chrono.get();
    }
    t = Math.trunc(Math.max(0, t));
    this.gi.setTime(this.chrono.formatTimeShort(t));

    // Blink chrono
    if (t < Soccer.WARNING_TIME) {
      this.blinkTimer -= Timer.tmod;
      if (this.blinkTimer <= 0) {
        const tf = this.gi.time;
        if (tf) {
          if (tf.textColor === Soccer.BLINK_COLOR || t === 0) {
            tf.textColor = 0xffffff;
            FxManager.addGlow(tf, SoccerHud.GLOW_COLOR, 2);
          } else {
            tf.textColor = Soccer.BLINK_COLOR;
            FxManager.addGlow(tf, Soccer.BLINK_GLOWCOLOR, 2);
          }
        }
        this.blinkTimer = 15 * (t / Soccer.WARNING_TIME);
      }
    }

    if (!this.fl_lock) {
      // Off play
      if (this.offPlayTimer > 0) {
        this.offPlayTimer -= Timer.tmod;
      }

      // Kick-off
      if (!this.ballIn && this.offPlayTimer <= 0) {
        this.fl_match = true;
        this.fxMan.attachAlert(`${this.lang(24)}`);
        this.insertBall();
        this.chrono.start();
      }

      // Speed boost
      const ball = this.ball;
      if (ball && this.ballIn) {
        for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
          const dist = p.distance(ball.x, ball.y);
          if (dist > Soccer.BOOST_DISTANCE) {
            const ratio = Math.min(Soccer.MAX_BOOST, dist / Soccer.BOOST_DISTANCE);
            p.speedFactor = ratio;
          } else {
            p.speedFactor = 1;
          }
        }
      }
    }

    super.main();

    this.fxMan.detachExit();

    // End of the match
    if (!this.fl_lock) {
      if (this.chrono.get() >= Soccer.MATCH_DURATION && !this.fl_end) {
        this.endMatch();
        this.finalTimer = Data.SECOND * 3;
      }

      // The result
      if (this.finalTimer > 0) {
        this.finalTimer -= Timer.tmod;
        if (this.finalTimer <= 0) {
          this.showResults();
          this.endModeTimer = Soccer.END_TIMER;
        }
      }

      // Sparks for the winners
      if (this.endModeTimer > 0) {
        for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
          if (this.getTeam(p) === this.winners) {
            if (p.dx !== 0) {
              this.fxMan.inGameParticlesDir(
                Data.PARTICLE_SPARK,
                p.x,
                p.y - this.rand.random(40),
                this.rand.random(3),
                -p.dir,
              );
            } else {
              this.fxMan.inGameParticles(
                Data.PARTICLE_SPARK,
                p.x,
                p.y - this.rand.random(40),
                this.rand.random(2),
              );
            }
          }
        }
      }
    }
  }
}
