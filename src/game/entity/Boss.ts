import type { SwfMaskClip, SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { IGameContext } from '../GameContext';
import type { BadEntity } from './Bad';
import { BossBomb, type PlayerBomb } from './Bomb';
import { BaseEntity, MoverEntity, type PhysicsEntity } from './Entity';
import { ScoreItem, SpecialItem } from './Item';
import type { PlayerEntity } from './Player';
import { BossFireBallShoot, EnemyFireBallShoot } from './Shoot';

/** What `GameSession` calls on the entity registered as `Data.BOSS`. */
export interface BossEntity extends BaseEntity {
  onPlayerDeath(): void;
  onKillBad?(): void;
  onExplode?(x: number, y: number, radius: number): void;
}

/**
 * Port of `entity.boss.Bat` (`class/hammer/entity/boss/Bat.mt`): the boss of level 100.
 *
 * A first bomb removes its shield and makes it angry (six fire balls spin around it); a second
 * one, before it calms down, costs it a life. It registers as `Data.BAD`, so everything that
 * acts on enemies reaches it: methods the original does not define are no-ops here, as calling
 * an undefined method is in AS2.
 */
export class BatBoss extends MoverEntity implements BossEntity {
  static readonly GLOW_BASE = 8;
  static readonly GLOW_RANGE = 4;
  static readonly RADIUS = Data.CASE_WIDTH * 1.5;
  static readonly SPEED = 6.5;
  static readonly SHOOT_SPEED = 8;
  static readonly LIVES = 3;
  static readonly WAIT_TIME = Data.SECOND * 3.5;
  static readonly FLOAT_X = 5;
  static readonly FLOAT_Y = 10;
  static readonly MAX_FALL_ROTATION = 80;

  lives: number;

  fl_trap = false; // entity.Bad compatibility (spikes)

  fl_shield = false;
  fl_immune = false;
  immuneTimer = 0;
  fl_move = false;
  fl_wait = false;
  fl_death = false;
  fl_deathUp = false;

  fl_anger = false;

  floatOffset = 0;
  tx = 0;
  ty = 0;

  fbList: BossFireBallShoot[] = [];

  /** `flash.filters.GlowFilter`, applied by `filters = [glow]`. */
  readonly glow = { quality: 1, color: 0xffffff, strength: 2, blurX: 6, blurY: 6, alpha: 1 };
  glowCpt = 0;

  // entity.Bad fields that other entities read (undefined in the original)
  fl_freeze = false;
  fl_knock = false;
  anger = 0;
  yTrigger: number | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_hitGround = false;
    this.fl_hitCeil = false;
    this.fl_hitWall = false;
    this.fl_hitBorder = true;
    this.fl_gravity = false;
    this.fl_friction = false;
    this.fl_moveable = false;
    this.fl_alphaBlink = false;

    this.dir = 1;
    this.lives = BatBoss.LIVES;

    // init
    this.register(Data.BAD);
    this.register(Data.BOSS);
  }

  static attach(game: IGameContext): BatBoss {
    const mc = new BatBoss(game, game.depthMan.attach('hammer_boss_bat', Data.DP_BADS));
    mc.initBoss();
    return mc;
  }

  initBoss(): void {
    this.moveTo(Data.GAME_WIDTH * 0.5, 30);
    this.playAnim(Data.ANIM_BAT_INTRO);
    this.mc._xscale = -this.scaleFactor * 100;
    this.endUpdate();
  }

  override destroy(): void {
    super.destroy();
    this.game.fl_clear = true;
    this.game.fxMan.attachExit();
  }

  /** Picks a new spot to fly to. */
  moveRandom(): void {
    if (this.fl_death) return;
    const rand = this.game.rand;
    const limit = 0.8;
    do {
      this.tx =
        Data.GAME_WIDTH * (1 - limit) * 0.5 + rand.random(Math.round(Data.GAME_WIDTH * limit));
      this.ty =
        Data.GAME_HEIGHT * (1 - limit) * 0.5 + rand.random(Math.round(Data.GAME_HEIGHT * limit));
    } while (
      this.distance(this.tx, this.ty) < Data.BOSS_BAT_MIN_DIST ||
      Math.abs(this.x - this.tx) < Data.BOSS_BAT_MIN_X_DIST
    );

    const sign = Math.round((this.tx - this.x) / Math.abs(this.tx - this.x));
    if (sign !== this.dir) {
      this.flip();
    } else {
      this.playAnim(Data.ANIM_BAT_MOVE);
      this.fl_move = true;
    }
  }

  /** Turns around. */
  flip(): void {
    this.halt();
    this.playAnim(Data.ANIM_BAT_SWITCH);
    this.dir = -this.dir;
    this.mc._xscale = this.dir * this.scaleFactor * 100;
  }

  halt(): void {
    this.fl_stopStepping = true;
    this.fl_move = false;
    this.dx = 0;
    this.dy = 0;
  }

  immune(): void {
    this.fl_immune = true;
    this.immuneTimer = Data.SECOND * 3;
  }

  removeImmunity(): void {
    this.fl_immune = false;
    this.stopBlink();
    this.shield();
  }

  wait(): void {
    this.fl_wait = true;
  }

  stopWait(): void {
    this.fl_wait = false;
    this.x = this.mc._x;
    this.y = this.mc._y;
  }

  shield(): void {
    if (this.fl_shield || this.fl_death) return;
    this.fl_shield = true;
    this.mc.clearGlow(); // filters = null
    this.glowCpt = 0;
  }

  removeShield(): void {
    this.fl_shield = false;
    const g = this.glow;
    g.quality = 1;
    g.color = 0xffd78c;
    g.strength = 180;
    g.blurX = BatBoss.GLOW_BASE;
    g.blurY = BatBoss.GLOW_BASE;
    g.alpha = 1.0;
    this.applyGlow();
  }

  /** `filters = [glow]` */
  private applyGlow(): void {
    const g = this.glow;
    this.mc.setGlow(g.color, g.alpha, g.blurX, g.blurY, g.strength);
  }

  /** Hit by a bomb. */
  freeze(_d: number): void {
    if (this.fl_immune || this.fl_death) return;

    if (this.fl_shield) {
      this.removeShield();
      this.bossAnger();
    } else {
      this.stopWait();
      this.immune();
      this.shield();
      this.bossCalmDown();
      this.loseLife();
    }
  }

  // Disabled behaviours
  knock(_d: number): void {}
  override killHit(_dx: number | null): void {}

  // entity.Bad methods the original Bat lacks (no-ops in AS2)
  setCombo(_id: number | null): void {}
  forceKill(_dx: number | null): void {}
  burn(): void {}
  calmDown(): void {}
  angerMore(): void {}
  onHurryUp(): void {}
  setJumpDown(_v: number | null): void {}

  onPlayerDeath(): void {
    this.bossCalmDown();
    this.shield();
  }

  override onEndAnim(id: number): void {
    super.onEndAnim(id);

    // Arrival
    if (id === Data.ANIM_BAT_INTRO.id) {
      this.mc._xscale = this.scaleFactor * 100;
      this.shield();
      this.moveRandom();
    }

    // Switch
    if (id === Data.ANIM_BAT_SWITCH.id) {
      this.playAnim(Data.ANIM_BAT_MOVE);
      this.fl_move = true;
    }
  }

  protected override prefix(): void {
    super.prefix();
    if (!this.fl_immune && !this.fl_death) {
      const l = this.game.getClose(
        Data.PLAYER,
        this.x,
        this.y + Data.CASE_HEIGHT * 0.5,
        BatBoss.RADIUS,
        false,
      );
      for (let i = 0; i < l.length; i++) {
        (l[i] as PlayerEntity).killHit(this.dx);
      }
    }
  }

  override onNext(): void {
    if (this.next?.action === Data.ACTION_MOVE) {
      if (this.fl_anger) {
        this.bossCalmDown();
        this.shield();
        return;
      }
      this.moveRandom();
      this.stopWait();
    }
    this.next = null;
  }

  loseLife(): void {
    if (this.fl_death) return;
    this.blinkColor = 0xff0000;
    this.blinkColorAlpha = 100;
    this.blink(Data.BLINK_DURATION);
    this.playAnim(Data.ANIM_BAT_KNOCK);
    this.game.fxMan.attachExplosion(this.x, this.y, 100);

    this.lives--;
    if (this.lives <= 0) {
      this.kill();
    } else {
      this.game.shake(Data.SECOND, 2);
    }
  }

  kill(): void {
    this.removeShield();
    this.game.shake(Data.SECOND * 5, 3);
    this.playAnim(Data.ANIM_BAT_MOVE);
    this.blinkColorAlpha = 50;
    this.halt();

    this.mc.clearGlow(); // filters = null
    this.fl_wait = false;
    this.fl_death = true;
    this.fl_deathUp = true;
    this.rotation = -30 * this.dir;
    this.dy = -1.5;
    if (this.y >= Data.GAME_HEIGHT * 0.5) {
      this.dy *= 2;
    }
    this.floatOffset = 0;
    // setNext(null, null, ...): the Bat's onNext ignores dx and dy
    this.setNext(0, 0, Data.SECOND * 9999, Data.ACTION_MOVE);
  }

  /** Attaches a fire ball spinning around the Bat. */
  attachFireBall(ang: number, distFactor: number): BossFireBallShoot {
    const s = BossFireBallShoot.attach(this.game, this.x, this.y);
    s.initBossShoot(this, ang);
    this.fbList.push(s);
    s.maxDist *= distFactor;
    s.distSpeed *= distFactor;
    return s;
  }

  /** Anger: the attack. */
  bossAnger(): void {
    this.stopWait();
    this.halt();
    this.playAnim(Data.ANIM_BAT_ANGER);
    this.game.fxMan.attachExplosion(this.x, this.y, 60);
    this.fl_anger = true;

    this.attachFireBall(0, 1.0);
    this.attachFireBall(180, 1.0);
    this.attachFireBall(0, 0.5);
    this.attachFireBall(180, 0.5);

    this.attachFireBall(90, 1.0);
    this.attachFireBall(270, 1.0);

    this.setNext(0, 0, Data.SECOND * 15, Data.ACTION_MOVE);
  }

  /** End of the anger. */
  bossCalmDown(): void {
    for (let i = 0; i < this.fbList.length; i++) {
      this.fbList[i].destroy();
    }
    if (this.fl_anger) {
      this.game.fxMan.attachExplosion(this.x, this.y, 50);
      this.playAnim(Data.ANIM_BAT_WAIT);
    }
    this.fbList = [];
    this.setNext(0, 0, Data.SECOND, Data.ACTION_MOVE);
    this.fl_anger = false;
  }

  override endUpdate(): void {
    super.endUpdate();
    const mc = this.mc;

    // Floating in place
    if (this.fl_wait) {
      this.floatOffset -= 0.1 * this.dir;
      mc._x = this.x + Math.sin(this.floatOffset) * BatBoss.FLOAT_X;
      mc._y = this.y + Math.cos(this.floatOffset) * BatBoss.FLOAT_Y;
    }

    // Death
    if (this.fl_death) {
      if (!this.fl_deathUp) {
        mc.rotationDeg = BatBoss.MAX_FALL_ROTATION + Math.sin(this.floatOffset) * 7;
        this.floatOffset -= 0.5 * this.dir;
        mc._x = this.x + Math.sin(this.floatOffset) * BatBoss.FLOAT_X * 1.7;
      } else {
        this.floatOffset -= 0.2 * this.dir;
        mc._x = this.x + Math.sin(this.floatOffset) * BatBoss.FLOAT_X * 3;
      }
    }
  }

  override update(): void {
    const game = this.game;
    const rand = game.rand;

    // No hurry up
    if (!this.fl_death) {
      game.huTimer = 0;
    } else {
      game.huTimer += 3;
    }

    super.update();

    // Immunity timer
    if (this.fl_immune) {
      this.immuneTimer -= 1;
      if (this.immuneTimer <= 0) {
        this.removeImmunity();
      }
    }

    // The original's dev mode kills the Bat with K

    // Moving
    if (this.fl_move) {
      this.moveToPoint(this.tx, this.ty, BatBoss.SPEED);
      this.glow.alpha = 0.5;
      if (this.distance(this.tx, this.ty) <= 10) {
        this.glow.alpha = 1.0;
        this.halt();
        this.wait();
        this.floatOffset = 0;
        this.playAnim(Data.ANIM_BAT_WAIT);
        this.setNext(0, 0, BatBoss.WAIT_TIME, Data.ACTION_MOVE);
      }
    }

    if (!this.fl_shield && !this.fl_death) {
      this.glowCpt += 0.3;
      this.glow.blurX = BatBoss.GLOW_BASE + BatBoss.GLOW_RANGE * Math.sin(this.glowCpt);
      this.glow.blurY = this.glow.blurX;
      this.applyGlow();
    }

    // Death
    if (this.fl_death) {
      // Rising
      if (this.fl_deathUp && rand.random(6) === 0) {
        game.fxMan.inGameParticles(
          Data.PARTICLE_STONE,
          rand.random(Data.GAME_WIDTH),
          0,
          rand.random(3) + 1,
        );
        game.shake(Data.SECOND, 1);
        game.fxMan.attachExplodeZone(
          this.x + rand.random(20) * (rand.random(2) * 2 - 1),
          this.y + rand.random(20) * (rand.random(2) * 2 - 1),
          rand.random(40) + 10,
        );
      }

      // Falling
      if (!this.fl_deathUp && rand.random(2) === 0) {
        const fx = game.fxMan.attachFx(
          this.x + rand.random(20) * (rand.random(2) * 2 - 1),
          this.y - rand.random(40),
          'hammer_fx_pop',
        );
        // AS2 evaluates the values even when there is no clip to set them on
        const r = rand.random(360);
        const s = rand.random(50) + 50;
        if (fx) {
          fx.mc.rotationDeg = r;
          fx.mc._xscale = s;
          fx.mc._yscale = fx.mc._xscale;
        }
      }

      if (this.y <= -50 && this.fl_deathUp) {
        this.mc._xscale = this.scaleFactor * 100;
        this.playAnim(Data.ANIM_BAT_FINAL_DIVE);
        this.dy = 5;
        this.fl_deathUp = false;
      }

      if (!this.fl_deathUp) {
        this.rotation = Math.min(BatBoss.MAX_FALL_ROTATION, this.rotation + 2.5);
        this.dy += 0.1;
        if (rand.random(2) === 0) {
          game.fxMan.inGameParticles(Data.PARTICLE_SPARK, this.x, this.y, rand.random(2) + 1);
        }
        if (this.y >= Data.DEATH_LINE + Data.GAME_HEIGHT * 1.5) {
          game.shake(Data.SECOND * 1.5, 5);
          this.destroy();
        }
      }
    }
  }
}

/** The life bar of Tuberculoz (`hammer_interf_boss_bar`); `bar` is the mask of the fill. */
interface LifeBar {
  mc: SwfMovieClip;
  bar: SwfMaskClip | null;
  barFade: SwfMovieClip | null;
}

/**
 * Port of `entity.boss.Tuberculoz` (`class/hammer/entity/boss/Tuberculoz.mt`): the final boss,
 * level 101. 100 lives: each player bomb in range costs one, a frozen enemy thrown at him ten.
 * He walks, jumps, drops boss bombs that hatch oranges, and cycles three special attacks (fire,
 * tornado, dash). Unlike the Bat he is not a `Data.BAD`.
 */
export class TuberculozBoss extends MoverEntity implements BossEntity {
  // Action codes
  static readonly WALK = 1;
  static readonly JUMP = 2;
  static readonly DASH = 3;
  static readonly BOMB = 4;
  static readonly HIT = 5;
  static readonly BURN = 6;
  static readonly TORNADO = 7;
  static readonly TORNADO_END = 8;
  static readonly DIE = 9;

  // Attack sequences
  static readonly SEQ_BURN = 0;
  static readonly SEQ_TORNADO = 1;
  static readonly SEQ_DASH = 2;
  static readonly LAST_SEQ = 2;
  static readonly SEQ_DURATION = Data.SECOND * 9;

  static readonly LIVES = 100;
  static readonly GROUND_Y = 446;
  static readonly CENTER_OFFSET = -28;
  static readonly HEAD_OFFSET_X = 10;
  static readonly HEAD_OFFSET_Y = -54;
  static readonly RADIUS = Data.CASE_WIDTH * 1.7;
  static readonly HEAD_RADIUS = Data.CASE_WIDTH * 0.9;
  static readonly MAX_BADS = 3; // one more, as bads spawn in pairs

  /** Distance to the border under which a bomb is kicked back rather than forward (unused). */
  static readonly INVERT_KICK_X = 150;

  static readonly WALK_SPEED = 3;
  static readonly DASH_SPEED = 16;
  static readonly FIREBALL_SPEED = 3;

  static readonly TORNADO_INTRO = Data.SECOND * 2;
  static readonly TORNADO_DURATION = Data.SECOND * 7;

  static readonly JUMP_Y = 15;
  static readonly JUMP_EST_X = 80;
  static readonly JUMP_EST_Y = -145;

  static readonly A_STEP = 5; // bads killed before items A and B spawn
  static readonly B_STEP = 10;
  static readonly EXTRA_LIFE_STEP = 30;

  // Chances out of 1000
  static readonly CHANCE_PLAYER_JUMP = 22;
  static readonly CHANCE_BOMB_JUMP = 15;
  static readonly CHANCE_DASH = 1;
  static readonly CHANCE_SPAWN = 25;
  static readonly CHANCE_BURN = 5;
  static readonly CHANCE_FINAL_ANGER = 35;

  private _firstUniq: number;
  lives: number;

  fl_trap = false; // entity.Bad compatibility (spikes)

  fl_shield = false;
  fl_immune = false;
  immuneTimer = 0;
  fl_death = false;
  fl_defeated = false;

  private recents = new Set<number>();
  badKills = 0;
  totalKills = 0;

  action: number | null = null;
  dashCount = 0;
  seq = 0;
  seqTimer: number = TuberculozBoss.SEQ_DURATION;
  fl_twister = false;

  lifeBar: LifeBar | null = null;
  itemA: SpecialItem | null = null;
  itemB: SpecialItem | null = null;

  fbCoolDown = 0;
  defeatTimeOut = 0;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_hitGround = false;
    this.fl_hitCeil = false;
    this.fl_hitWall = false;
    this.fl_hitBorder = true;
    this.fl_physics = true;
    this.fl_gravity = false;
    this.fl_friction = false;
    this.fl_moveable = false;
    this.fl_blink = true;
    this.fl_alphaBlink = false;
    this.blinkColorAlpha = 60;
    this.blinkColor = 0xff6600;

    this.x = Data.GAME_WIDTH * 0.5;
    this.y = TuberculozBoss.GROUND_Y;
    this.dir = game.rand.random(2) * 2 - 1;

    this.lives = TuberculozBoss.LIVES;

    // init
    this.register(Data.BOSS);
    this._firstUniq = game.getUniqId();
  }

  static attach(game: IGameContext): TuberculozBoss {
    const mc = new TuberculozBoss(game, game.depthMan.attach('hammer_boss_human', Data.DP_BADS));
    mc.initBoss();
    return mc;
  }

  initBoss(): void {
    this.playAnim(Data.ANIM_BOSS_BAT_FORM);
    this.endUpdate();

    const mc = this.game.depthMan.attach('hammer_interf_boss_bar', Data.DP_INTERF);
    this.lifeBar = { mc, bar: mc.getMask('bar'), barFade: mc.getClip('barFade') };
    mc.rotationDeg = -90;
    mc._x = 0;
    mc._y = Data.GAME_HEIGHT * 0.5;
  }

  private removeLifeBar(): void {
    this.lifeBar?.mc.removeMovieClip();
    this.lifeBar = null;
  }

  override destroy(): void {
    this.removeLifeBar();
    super.destroy();
  }

  /** Entities of type `t` touching the body (and the head while walking). */
  getHitList(t: number): BaseEntity[] {
    const T = TuberculozBoss;
    const l = this.game.getClose(t, this.x, this.y + T.CENTER_OFFSET, T.RADIUS, false);
    if (this.action === T.WALK) {
      const lh = this.game.getClose(
        t,
        this.x + T.HEAD_OFFSET_X * this.dir,
        this.y + T.HEAD_OFFSET_Y,
        T.HEAD_RADIUS,
        false,
      );
      for (let i = 0; i < lh.length; i++) {
        l.push(lh[i]);
      }
    }
    return l;
  }

  /** Contacts with other entities. Also run by the physics at each cell change (`infix`). */
  override checkHits(): void {
    if (this.fl_death) return;
    const T = TuberculozBoss;
    const game = this.game;

    // Bombs
    let l = this.getHitList(Data.PLAYER_BOMB);
    for (let i = 0; i < l.length; i++) {
      const b = l[i] as PlayerBomb;
      if (!b.fl_explode && this.action === T.DASH && this.dx !== 0) {
        b.onExplode();
      }
      if (!b.fl_explode && !this.checkFlag(b.uniqId)) {
        this.kickBomb(b);
        this.flag(b.uniqId);
      }
    }

    // Players
    if (!this.fl_immune) {
      l = this.getHitList(Data.PLAYER);
      for (let i = 0; i < l.length; i++) {
        const p = l[i] as PlayerEntity;
        if (!p.fl_kill) {
          p.killHit(this.dx);
          if (this.action === T.DASH && this.dx !== 0) {
            game.fxMan.attachExplodeZone(p.x, p.y - Data.CASE_HEIGHT * 0.5, Data.CASE_WIDTH * 2);
          }
          game.shake(Data.SECOND, 3);
        }
      }
    }

    // Bads
    l = this.getHitList(Data.BAD);
    for (let i = 0; i < l.length; i++) {
      const b = l[i] as BadEntity;
      if (b.uniqId !== this.uniqId && !b.fl_kill && b.fl_trap) {
        if (!this.fl_immune && b.fl_freeze && b.evaluateSpeed() >= Data.ICE_HIT_MIN_SPEED) {
          game.fxMan.inGameParticles(Data.PARTICLE_CLASSIC_BOMB, this.x, this.y, 4);
          game.fxMan.attachExplodeZone(b.x, b.y - Data.CASE_HEIGHT * 0.5, Data.CASE_WIDTH * 2);
          this.loseLife(10);
          this.onKillBad();
          b.destroy();
        } else {
          b.killHit(this.dx);
          if (this.action === T.DASH && this.dx !== 0) {
            game.fxMan.attachExplodeZone(b.x, b.y - Data.CASE_HEIGHT * 0.5, Data.CASE_WIDTH * 2);
          }
        }
      }
    }
  }

  flag(uid: number): void {
    this.recents.add(uid - this._firstUniq);
  }

  checkFlag(uid: number): boolean {
    return this.recents.has(uid - this._firstUniq);
  }

  updateBar(): void {
    const lb = this.lifeBar;
    if (!lb) return;
    if (lb.barFade && lb.bar) lb.barFade._xscale = lb.bar._xscale;
    lb.barFade?.gotoAndPlay('1');
    if (lb.bar) lb.bar._xscale = (this.lives / TuberculozBoss.LIVES) * 100;
  }

  loseLife(n: number): void {
    if (this.fl_immune) return;
    const game = this.game;

    this.lives -= n;
    this.updateBar();
    if (this.lives <= 0) {
      this.die();
    } else {
      game.killPointer();
      this.immune();

      // Heavy damage
      if (n > 1) {
        this.fl_gravity = true;
        this.fl_hitBorder = true;
        this.dy = -9;
        this.next = null;
        this.action = TuberculozBoss.HIT;
        this.playAnim(Data.ANIM_BOSS_HIT);
        game.shake(Data.SECOND, 4);
        // A short break
        game.destroyList(Data.SHOOT);
        const lp = game.getList(Data.PLAYER) as PlayerEntity[];
        for (let i = 0; i < lp.length; i++) {
          lp[i].knock(Data.SECOND);
        }
        const l = game.getList(Data.BAD) as BadEntity[];
        for (let i = 0; i < l.length; i++) {
          const b = l[i];
          // The original tests the boss's fl_stable, not the bad's
          if (this.fl_stable) {
            b.dx = 0;
          }
          b.knock(Data.KNOCK_DURATION);
        }
      }
    }
  }

  immune(): void {
    this.fl_immune = true;
    this.immuneTimer = Data.SECOND * 3;
    this.blink(Data.BLINK_DURATION_FAST);
  }

  /** Spawns `n` boss bombs, at least 6 cases apart. */
  spawnBombs(n: number): void {
    const rand = this.game.rand;
    const bList: BossBomb[] = [];
    let fl_tooClose = false;

    for (let i = 0; i < n; i++) {
      const b = BossBomb.attach(this.game, 0, 0);
      do {
        b.moveTo(
          rand.random(Math.round(Data.GAME_WIDTH * 0.8)) + Data.GAME_WIDTH * 0.1,
          rand.random(150) + 100,
        );
        fl_tooClose = false;
        for (let j = 0; j < bList.length; j++) {
          if (bList[j].distance(b.x, b.y) <= Data.CASE_WIDTH * 6) {
            fl_tooClose = true;
          }
        }
      } while (fl_tooClose);
      this.game.fxMan.attachFx(b.x, b.y - Data.CASE_HEIGHT * 0.5, 'hammer_fx_pop');
      bList.push(b);
    }
  }

  kickBomb(b: PlayerBomb): void {
    if (this.dx === 0) {
      b.dx = this.dir * 15;
    } else {
      b.dx = this.dx * 5;
    }
    b.dy = -7;
    b.setLifeTimer(Data.SECOND * 0.7);
    if ((b.x < this.x && this.dir > 0) || (b.x > this.x && this.dir < 0)) {
      b.dx *= -1;
    }
  }

  /** Whether the tornado's wind pushes this entity. */
  isWindCompatible(e: PhysicsEntity): boolean {
    if (!this.fl_twister && (e.types & Data.FX) === 0) return false;
    if (e.fl_kill) return false;
    if (e.uniqId === this.uniqId) return false;
    if ((e.types & Data.SHOOT) > 0 || (e.types & Data.ITEM) > 0) return false;
    if ((e.types & Data.BAD) > 0 && (e as BadEntity).fl_freeze) return false;
    if (e.y < 30) return false;
    return true;
  }

  updateDash(): void {
    const game = this.game;
    // Particles where he goes through a side
    if ((this.oldX < 0 && this.x >= 0) || (this.oldX > 0 && this.x <= 0)) {
      game.fxMan.inGameParticles(Data.PARTICLE_STONE, 10, this.y - 30, 6);
    }
    if (
      (this.oldX > Data.GAME_WIDTH && this.x <= Data.GAME_WIDTH) ||
      (this.oldX < Data.GAME_WIDTH && this.x >= Data.GAME_WIDTH)
    ) {
      game.fxMan.inGameParticles(Data.PARTICLE_STONE, Data.GAME_WIDTH - 10, this.y - 30, 6);
    }
    // Turn around, off screen
    if (
      (this.dx < 0 && this.x <= -Data.GAME_WIDTH) ||
      (this.dx > 0 && this.x >= Data.GAME_WIDTH * 2)
    ) {
      const p = game.getOne(Data.PLAYER) as PlayerEntity | null;
      // AS2: with no player, p.y and p.cy are undefined (NaN)
      const py = p ? p.y : NaN;
      const pcx = p ? p.cx : NaN;
      const pcy = p ? p.cy : NaN;
      this.dx = -this.dx;
      this.y = py;
      this.dir = -this.dir;
      this.mc._xscale = -this.mc._xscale;
      if (this.x < 0) {
        game.attachPointer(0, pcy - 2, pcx, pcy - 2);
      } else {
        game.attachPointer(Data.LEVEL_WIDTH, pcy - 2, pcx, pcy - 2);
      }
      this.dashCount++;
      // End
      if (this.dashCount > 2) {
        if (this.dir < 0) {
          this.x = Data.GAME_WIDTH + 80;
        } else {
          this.x = -80;
        }
        this.y = TuberculozBoss.GROUND_Y;
        game.killPointer();
        this.fl_hitBorder = true;
        this.jump(TuberculozBoss.JUMP_Y * 0.6);
      }
    }
  }

  updateTornado(): void {
    const game = this.game;
    const rand = game.rand;
    if (rand.random(3) > 0) {
      // Particles
      if (this.fl_twister || rand.random(5) === 0) {
        game.fxMan.inGameParticles(
          Data.PARTICLE_DUST,
          rand.random(Data.GAME_WIDTH),
          rand.random(Data.GAME_HEIGHT),
          rand.random(3),
        );
      }

      // Wind
      const l = game.getList(Data.PHYSICS) as PhysicsEntity[];
      for (let i = 0; i < l.length; i++) {
        const e = l[i];
        if (this.isWindCompatible(e)) {
          const wind = rand.random(22) / 10 + 0.5;
          if (e.fl_stable) {
            if (wind > Data.GRAVITY) {
              e.dy -= wind + 3;
              e.dx += rand.random(2) * (rand.random(2) * 2 - 1);
            }
          } else {
            e.dy -= wind;
            e.dx += rand.random(2) * (rand.random(2) * 2 - 1);
          }
        }
      }
    }
  }

  updateDeath(): void {
    const T = TuberculozBoss;
    const game = this.game;
    const rand = game.rand;

    // Rocks
    if ((this.dx !== 0 || this.dy !== 0 || this.next?.action === T.DIE) && rand.random(3) === 0) {
      if (rand.random(2) === 0) {
        game.fxMan.inGameParticles(
          Data.PARTICLE_STONE,
          rand.random(Data.GAME_WIDTH),
          0,
          rand.random(2),
        );
      } else {
        game.fxMan.inGameParticles(
          Data.PARTICLE_STONE,
          rand.random(Data.GAME_WIDTH),
          rand.random(Math.round(Data.GAME_HEIGHT * 0.6)),
          rand.random(2),
        );
      }
      game.shake(Data.SECOND, 1);
    }

    // Landing
    if (this.dy > 0 && this.y >= T.GROUND_Y - 8) {
      game.shake(Data.SECOND, 5);
      this.land();
      this.y = T.GROUND_Y - 8;
    }

    // Strikes
    if (this.next?.action === T.DIE) {
      this.dx *= game.xFriction;
      if (rand.random(3) === 0) {
        // The original attaches it at depth plan `Data.FX` (a type flag): above everything
        const s = game.depthMan.attach('hammer_fx_strike', Data.FX);
        this.playAnim(Data.ANIM_BOSS_HIT);
        this.replayAnim();
        s._y = this.y - rand.random(60);
        s._x = Data.GAME_WIDTH * 0.5;
        const d = rand.random(2) * 2 - 1;
        s._xscale = 100 * d;
        if (this.dx < 0) {
          this.dx = rand.random(4) + 2;
        } else {
          this.dx = -(rand.random(4) + 2);
        }
      }
    }

    // Flying away
    if (this.animId !== Data.ANIM_BOSS_DEATH.id) {
      if (rand.random(3) === 0) {
        game.fxMan.attachExplodeZone(
          rand.random(20) * (rand.random(2) * 2 - 1) + this.x,
          this.y - rand.random(70),
          rand.random(20) + 8,
        );
      }
    }
  }

  // ---------------------------------------------------------------- Actions

  ia(): void {
    const T = TuberculozBoss;
    const game = this.game;
    const rand = game.rand;
    if (this.action !== T.WALK) return;

    this.seqTimer -= 1;

    // Turn at the borders
    if (
      (this.x >= Data.GAME_WIDTH - T.RADIUS && this.dir > 0) ||
      (this.x <= T.RADIUS && this.dir < 0)
    ) {
      this.dir = -this.dir;
      this.walk();
      return;
    }

    // Jumps at the player
    if (rand.random(1000) < T.CHANCE_PLAYER_JUMP) {
      if (
        game.getClose(
          Data.PLAYER,
          this.x + T.JUMP_EST_X * this.dir,
          this.y + T.JUMP_EST_Y,
          T.RADIUS,
          false,
        ).length > 0
      ) {
        this.jump(T.JUMP_Y);
        return;
      }
    }

    // Jumps at a player bomb
    if (rand.random(1000) < T.CHANCE_BOMB_JUMP) {
      if (
        game.getClose(
          Data.PLAYER_BOMB,
          this.x + T.JUMP_EST_X * this.dir,
          this.y + T.JUMP_EST_Y,
          T.RADIUS,
          false,
        ).length > 0
      ) {
        this.jump(T.JUMP_Y);
        return;
      }
    }

    // Special attacks
    if (this.seqTimer <= 0 && !this.fl_death) {
      this.seqTimer = T.SEQ_DURATION;
      switch (this.seq) {
        case T.SEQ_BURN:
          this.burn();
          break;
        case T.SEQ_DASH:
          this.dash();
          break;
        case T.SEQ_TORNADO:
          this.tornado();
          break;
      }
      this.seq++;
      if (this.seq > T.LAST_SEQ) {
        this.seq = 0;
      }
    }

    // Spawns enemies
    if (rand.random(1000) < T.CHANCE_SPAWN) {
      if (game.getList(Data.BAD).length + game.getList(Data.BAD_BOMB).length < T.MAX_BADS) {
        this.dropBombs();
        return;
      }
    }
  }

  halt(): void {
    this.dx = 0;
  }

  walk(): void {
    if (this.fl_death) {
      this.setNext(0, 0, Data.SECOND * 3, TuberculozBoss.DIE);
      return;
    }

    if (this.mc._xscale * this.dir < 0) {
      this.playAnim(Data.ANIM_BOSS_SWITCH);
      this.halt();
    } else {
      this.playAnim(Data.ANIM_BOSS_WAIT);
      this.mc._xscale = this.dir * Math.abs(this.mc._xscale);
      this.dx = TuberculozBoss.WALK_SPEED * this.dir;
      this.action = TuberculozBoss.WALK;
    }
  }

  jump(jumpY: number): void {
    this.action = TuberculozBoss.JUMP;
    this.fl_gravity = true;
    this.dx = this.dir * TuberculozBoss.WALK_SPEED * 1.6;
    this.dy = -jumpY;
    this.playAnim(Data.ANIM_BOSS_JUMP_UP);
  }

  land(): void {
    this.action = null;
    this.fl_gravity = false;
    this.y = TuberculozBoss.GROUND_Y;
    this.dy = 0;
    this.playAnim(Data.ANIM_BOSS_JUMP_LAND);
  }

  /** Fire ball dash across the screen. */
  dash(): void {
    this.action = TuberculozBoss.DASH;
    this.halt();
    this.dashCount = 0;
    this.playAnim(Data.ANIM_BOSS_DASH_START);
  }

  dropBombs(): void {
    this.action = TuberculozBoss.BOMB;
    this.halt();
    this.playAnim(Data.ANIM_BOSS_BOMB);
  }

  /** Bursts into flames: a row of fire balls rises from the bottom. */
  burn(): void {
    this.halt();
    this.playAnim(Data.ANIM_BOSS_BURN_START);
    this.setNext(0, 0, Data.SECOND * 3.5, TuberculozBoss.BURN);
    this.action = TuberculozBoss.BURN;
  }

  tornado(): void {
    this.halt();
    this.playAnim(Data.ANIM_BOSS_TORNADO_START);
    this.setNext(0, 0, TuberculozBoss.TORNADO_INTRO, TuberculozBoss.TORNADO);
    this.fl_twister = false;
    this.action = TuberculozBoss.TORNADO;
  }

  die(): void {
    const game = this.game;
    const rand = game.rand;
    this.halt();
    this.action = null;
    this.defeatTimeOut = Data.SECOND * 15;
    this.fl_death = true;
    this.fl_gravity = true;
    const dist = Data.GAME_WIDTH * 0.5 - this.x;
    this.dx = dist * 0.025;
    this.dy = -13;
    this.dir = this.dx > 0 ? -1 : 1;
    this.mc._xscale = this.scaleFactor * 100 * this.dir;
    this.removeLifeBar();

    game.bulletTime(Data.SECOND * 2);
    game.shake(Data.SECOND, 5);
    this.playAnim(Data.ANIM_BOSS_HIT);

    // Bads
    const bl = game.getList(Data.BAD) as BadEntity[];
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      // `b.dropReward = null`: calling a null method does nothing in AS2
      b.dropReward = () => {};
      b.killHit(rand.random(50) * (rand.random(2) * 2 - 1));
      b.dy -= rand.random(10);
      game.fxMan.inGameParticles(Data.PARTICLE_SPARK, b.x, b.y, rand.random(3) + 1);
    }

    // Bombs
    const l = game.getList(Data.BOMB);
    for (let i = 0; i < l.length; i++) {
      l[i].destroy();
      game.fxMan.inGameParticles(Data.PARTICLE_CLASSIC_BOMB, l[i].x, l[i].y, rand.random(3) + 1);
    }

    // Other entities
    game.destroyList(Data.SHOOT);
    game.destroyList(Data.BOMB);
  }

  /** Final clean-up, and the exit opens. */
  final(): void {
    if (this.fl_defeated) return;
    const game = this.game;
    const T = TuberculozBoss;
    this.halt();
    this.openExit();
    game.fxMan.attachExplodeZone(this.x, this.y + T.CENTER_OFFSET, 150);
    game.fxMan.inGameParticles(
      Data.PARTICLE_TUBERCULOZ,
      this.x,
      this.y + T.CENTER_OFFSET,
      Data.MAX_FX,
    );
    game.shake(Data.SECOND, 5);
    this.playAnim(Data.ANIM_BOSS_DEATH);
    game.destroyList(Data.BAD);
    game.fl_clear = true;
    this.fl_defeated = true;
  }

  /** After the boss's death: the cloak, the key, the door and the life bonus. */
  openExit(): void {
    if (this.fl_defeated) return;
    const game = this.game;
    const rand = game.rand;
    game.depthMan.swap(this.mc, Data.DP_SPRITE_BACK_LAYER);
    const cloak = SpecialItem.attach(game, Data.GAME_WIDTH * 0.5, Data.GAME_HEIGHT - 40, 113, null);
    if (cloak) cloak.dy = -20;

    const tubkey = ScoreItem.attach(
      game,
      Data.GAME_WIDTH * 0.5 - 40,
      Data.GAME_HEIGHT - 40,
      199,
      null,
    );
    tubkey.dy = -25;

    const door = game.view.attachSprite(
      '$door',
      game.flipCoordReal(BaseEntity.x_ctr(5)),
      BaseEntity.y_ctr(6),
      true,
    );
    game.fxMan.inGameParticles(
      Data.PARTICLE_STONE,
      door._x + Data.CASE_WIDTH,
      door._y,
      3 + rand.random(10),
    );
    game.fxMan.attachExplodeZone(door._x + Data.CASE_WIDTH, door._y - Data.CASE_HEIGHT, 40);
    game.playMusicTrack(0);

    // Life bonus
    const pl = game.getList(Data.PLAYER) as PlayerEntity[];
    for (let i = 0; i < pl.length; i++) {
      const p = pl[i];
      const bonus = p.lives * 20000;
      p.getScore(p, bonus);
      // `Lang.get(35) + ...`: AS2 writes "null" for a missing text
      game.fxMan.attachAlert(
        `${game.dataStore.getLangText(35)}${p.lives} x ${Data.formatNumber(20000)}`,
      );
    }
  }

  // ----------------------------------------------------------------- Events

  override onEndAnim(id: number): void {
    super.onEndAnim(id);
    const T = TuberculozBoss;

    // Turned around
    if (id === Data.ANIM_BOSS_SWITCH.id) {
      this.walk();
    }

    // Start
    if (id === Data.ANIM_BOSS_BAT_FORM.id) {
      this.walk();
    }

    // Landed
    if (id === Data.ANIM_BOSS_JUMP_LAND.id) {
      this.walk();
    }

    // Dash
    if (id === Data.ANIM_BOSS_DASH_START.id) {
      this.playAnim(Data.ANIM_BOSS_DASH_BUILD);
      this.setNext(0, 0, Data.SECOND * 2, T.DASH);
    }

    // Dash
    if (id === Data.ANIM_BOSS_DASH.id) {
      this.playAnim(Data.ANIM_BOSS_DASH_LOOP);
    }

    // Bombs
    if (id === Data.ANIM_BOSS_BOMB.id) {
      this.spawnBombs(2);
      this.walk();
    }

    // Hit
    if (id === Data.ANIM_BOSS_HIT.id) {
      this.playAnim(Data.ANIM_BOSS_WAIT);
    }

    // In flames
    if (id === Data.ANIM_BOSS_BURN_START.id) {
      this.playAnim(Data.ANIM_BOSS_BURN_LOOP);
    }

    // Tornado
    if (id === Data.ANIM_BOSS_TORNADO_START.id) {
      this.playAnim(Data.ANIM_BOSS_TORNADO_LOOP);
    }

    // End of the tornado
    if (id === Data.ANIM_BOSS_TORNADO_END.id) {
      this.walk();
    }
  }

  override onNext(): void {
    const T = TuberculozBoss;
    const game = this.game;
    const action = this.next?.action;

    // Dash
    if (action === T.DASH) {
      this.playAnim(Data.ANIM_BOSS_DASH);
      this.dx = this.dir * T.DASH_SPEED;
      this.fl_hitBorder = false;
    }

    // Burn
    if (action === T.BURN) {
      this.playAnim(Data.ANIM_BOSS_TORNADO_END);
      const n = 10;
      for (let i = 0; i < n; i++) {
        const bx = (i * Data.GAME_WIDTH) / n + Data.CASE_WIDTH;
        if (Math.abs(bx - this.x) > 60) {
          const s = EnemyFireBallShoot.attach(game, bx, Data.GAME_HEIGHT);
          s.moveUp(T.FIREBALL_SPEED);
        }
      }
    }

    // Tornado
    if (action === T.TORNADO) {
      if (!this.fl_twister) {
        this.fl_twister = true;
        this.setNext(0, 0, T.TORNADO_DURATION, T.TORNADO);
        return;
      } else {
        this.playAnim(Data.ANIM_BOSS_TORNADO_END);
      }
    }

    // Death
    if (action === T.DIE) {
      this.final();
    }

    this.next = null;
  }

  onPlayerDeath(): void {
    // do nothing
  }

  onKillBad(): void {
    const T = TuberculozBoss;
    const game = this.game;
    this.badKills++;
    this.totalKills++;

    // Multi-bomb items
    if (this.badKills >= T.B_STEP) {
      this.itemB?.destroy();
      this.itemB = SpecialItem.attach(game, Data.GAME_WIDTH - 31, 0, 5, null);
      this.itemB?.setLifeTimer(0);
      this.badKills = 0;
    } else {
      if (this.badKills === T.A_STEP) {
        this.itemA?.destroy();
        this.itemA = SpecialItem.attach(game, 31, 0, 4, null);
        this.itemA?.setLifeTimer(0);
      }
    }

    // Extra life
    if (this.totalKills === T.EXTRA_LIFE_STEP) {
      const it = SpecialItem.attach(game, 214, 340, 36, null);
      it?.setLifeTimer(0);
    }
  }

  /** A player bomb exploded in the level. */
  onExplode(x: number, y: number, radius: number): void {
    if (this.fl_death) return;
    const d = Math.sqrt(
      Math.pow(this.x - x, 2) + Math.pow(this.y + TuberculozBoss.CENTER_OFFSET - y, 2),
    );
    if (d <= radius && this.action !== TuberculozBoss.DASH) {
      this.loseLife(1);
    }
  }

  override endUpdate(): void {
    super.endUpdate();

    if (this.dir < 0) {
      this.mc._xscale = -Math.abs(this.mc._xscale);
    } else {
      this.mc._xscale = Math.abs(this.mc._xscale);
    }

    // Tornado
    if (this.action === TuberculozBoss.TORNADO) {
      this.updateTornado();
    }

    // The life bar follows the screen shake
    if (this.lifeBar) {
      this.lifeBar.mc._x = this.game.gameRoot._x - this.game.xOffset;
      this.lifeBar.mc._y = this.game.gameRoot._y + Data.GAME_HEIGHT * 0.5;
    }
  }

  override update(): void {
    const T = TuberculozBoss;
    const game = this.game;

    // No hurry up
    if (!this.fl_death) {
      game.huTimer = 0;
    } else {
      game.huTimer += 3;
    }

    this.ia();

    // Immunity
    if (this.fl_immune) {
      this.immuneTimer -= 1;
      if (this.immuneTimer <= 0) {
        this.fl_immune = false;
        this.stopBlink();
      }
    }

    // Jump phases
    if (this.action === T.JUMP) {
      if (this.dy >= 0 && this.animId === Data.ANIM_BOSS_JUMP_UP.id) {
        this.playAnim(Data.ANIM_BOSS_JUMP_DOWN);
      }
      if (this.dy > 0 && this.y >= T.GROUND_Y) {
        this.land();
      }
    }

    // Last-resort fire balls
    if (!this.fl_death && this.lives <= 50) {
      this.fbCoolDown -= 1;
      if (
        this.action === T.WALK &&
        this.fbCoolDown <= 0 &&
        game.countList(Data.SHOOT) < 2 &&
        game.rand.random(1000) <= T.CHANCE_FINAL_ANGER
      ) {
        this.fbCoolDown = Data.SECOND * 0.5;
        const s = EnemyFireBallShoot.attach(game, this.x, this.y);
        const target = game.getOne(Data.PLAYER);
        // AS2: aiming at no target gives NaN speeds
        if (target) s.moveToTarget(target, T.FIREBALL_SPEED * 2);
        else s.dx = s.dy = NaN;
      }
    }

    // Hit phases
    if (this.action === T.HIT) {
      if (this.dy > 0 && this.y >= T.GROUND_Y) {
        this.land();
      }
    }

    // Fix for a Tuberculoz that never dies
    if (this.defeatTimeOut > 0 && !this.fl_defeated) {
      this.defeatTimeOut -= 1;
      if (this.defeatTimeOut <= 0) {
        this.final();
      }
    }

    // Death
    if (this.fl_death) {
      this.updateDeath();
    }

    super.update();

    // Dash
    if (this.action === T.DASH) {
      this.updateDash();
    }

    // The original's dev mode kills him with Enter and removes lives with Shift

    this.checkHits();
  }
}
