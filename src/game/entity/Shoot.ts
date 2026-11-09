import { Timer } from '../../engine/Timer';
import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { IGameContext } from '../GameContext';
import type { BadEntity } from './Bad';
import type { BombEntity } from './Bomb';
import { type BaseEntity, PhysicsEntity } from './Entity';
import type { PlayerEntity } from './Player';

/** What a Ball needs from its catchers (`entity.bad.walker.Fraise`). */
interface BallCatcher {
  catchBall(b: BallShoot): void;
  assignBall(): void;
}

/**
 * Port of `entity.Shoot` (`class/hammer/entity/Shoot.mt`): a projectile with no gravity, friction
 * or collisions, destroyed when it leaves the level (or bouncing on its borders).
 */
export class ShootEntity extends PhysicsEntity {
  shootSpeed = 0;
  shootY = 0;
  coolDown = 50;
  fl_borderBounce = false;
  fl_checkBounds = true;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_hitWall = false;
    this.fl_hitBorder = false;
    this.fl_hitGround = false;
    this.fl_gravity = false;
    this.fl_friction = false;
    this.fl_bump = false;
  }

  /** `init`: the clip is its own animation. */
  protected initShootEntity(): void {
    this.register(Data.SHOOT);
    this.setSub(this.mc);
    this.playAnim(Data.ANIM_SHOOT);
  }

  initShoot(x: number, y: number): void {
    this.initShootEntity();
    this.moveTo(x, y);
    this.endUpdate();
  }

  override endUpdate(): void {
    if (this.dy === 0) {
      if (this.dx < 0) {
        this.mc._xscale = -Math.abs(this.mc._xscale);
      } else {
        this.mc._xscale = Math.abs(this.mc._xscale);
      }
    }
    super.endUpdate();
  }

  onSideBorderBounce(): void {}

  onHorizontalBorderBounce(): void {}

  override update(): void {
    super.update();
    if (this.fl_checkBounds) {
      if (this.fl_borderBounce) {
        if (this.x < 0) {
          this.onSideBorderBounce();
          this.dx = Math.abs(this.dx);
        }
        if (this.x >= Data.GAME_WIDTH) {
          this.onSideBorderBounce();
          this.dx = -Math.abs(this.dx);
        }
        if (this.y < 0) {
          this.onHorizontalBorderBounce();
          this.dy = Math.abs(this.dy);
        }
        if (this.y >= Data.GAME_HEIGHT) {
          this.onHorizontalBorderBounce();
          this.dy = -Math.abs(this.dy);
        }
      } else if (!this.world.inBound(this.cx, this.cy)) {
        this.destroy();
      }
    }
  }
}

/** Port of `entity.shoot.Pepin`: Pomme's pip. It goes through the player. */
export class PepinShoot extends ShootEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 5;
    this._yOffset = -2;
  }

  static attach(game: IGameContext, x: number, y: number): PepinShoot {
    const s = new PepinShoot(game, game.depthMan.attach('hammer_shoot_pepin', Data.DP_SHOTS));
    s.initShoot(x, y);
    return s;
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      (e as PlayerEntity).killHit(this.dx);
    }
  }
}

/** Port of `entity.shoot.Zeste`: Citron's zest, shot up or down. */
export class ZesteShoot extends ShootEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 6;
  }

  static attach(game: IGameContext, x: number, y: number): ZesteShoot {
    const s = new ZesteShoot(game, game.depthMan.attach('hammer_shoot_zest', Data.DP_SHOTS));
    s.initShoot(x, y);
    return s;
  }

  override moveDown(speed: number): void {
    super.moveDown(speed);
    this.mc._yscale = -this.mc._yscale;
    this._yOffset = -Data.CASE_HEIGHT;
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      if (Math.abs(e.x - this.x) <= Data.CASE_WIDTH * 0.65) {
        (e as PlayerEntity).killHit((e.x - this.x) * 1.5);
        this.game.fxMan.attachExplodeZone(this.x, this.y, 15);
      }
    }
  }
}

/** Port of `entity.shoot.FireBall`: Crawler's fire ball. */
export class EnemyFireBallShoot extends ShootEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_largeTrigger = true;
    this.shootSpeed = 7;
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.playAnim(Data.ANIM_SHOOT_LOOP);
  }

  static attach(game: IGameContext, x: number, y: number): EnemyFireBallShoot {
    const s = new EnemyFireBallShoot(
      game,
      game.depthMan.attach('hammer_shoot_fireball', Data.DP_SHOTS),
    );
    s.initShoot(x, y - 10);
    return s;
  }

  override destroy(): void {
    this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT / 2, 'hammer_fx_pop');
    super.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      const p = e as PlayerEntity;
      const dist = this.distance(p.x, p.y);
      if (dist <= Data.CASE_WIDTH * 1.2) {
        this.game.fxMan.attachExplosion(this.x, this.y, 25);
        p.killHit(this.dx);
      }
    }
  }
}

/** Port of `entity.shoot.Ball`: the ball Fraises pass to each other. */
export class BallShoot extends ShootEntity {
  targetCatcher: BaseEntity | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 8.5;
    this._yOffset = 0;
    this.setLifeTimer(Data.BALL_TIMEOUT);
    this.fl_alphaBlink = false;
    this.fl_borderBounce = true;
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.register(Data.BALL);
  }

  static attach(game: IGameContext, x: number, y: number): BallShoot {
    const s = new BallShoot(game, game.depthMan.attach('hammer_shoot_ball', Data.DP_SHOTS));
    s.initShoot(x, y);
    return s;
  }

  /** Not caught in time: a random Fraise gets it back. */
  override onLifeTimer(): void {
    this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT / 2, 'hammer_fx_pop');
    const bad = this.game.getOne(Data.CATCHER) as unknown as BallCatcher | null;
    bad?.assignBall();
    super.onLifeTimer();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      (e as PlayerEntity).killHit(this.dx);
    }
    if (e.isType(Data.CATCHER) && this.targetCatcher === e) {
      (e as unknown as BallCatcher).catchBall(this);
    }
  }
}

/** Port of `entity.shoot.PlayerArrow`. */
export class PlayerArrowShoot extends ShootEntity {
  private fl_livedOneTurn = false;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 4;
    this.coolDown = Data.SECOND * 2;
    this._yOffset = -15;
    this.fl_hitWall = true;
    this.fl_teleport = true;
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.register(Data.PLAYER_SHOOT);
    this.playAnim(Data.ANIM_SHOOT_LOOP);
  }

  static attach(game: IGameContext, x: number, y: number): PlayerArrowShoot {
    const s = new PlayerArrowShoot(game, game.depthMan.attach('hammer_shoot_arrow', Data.DP_SHOTS));
    s.initShoot(x, y);
    return s;
  }

  override onHitWall(): void {
    if (this.fl_livedOneTurn) {
      const fx = this.game.fxMan.attachFx(this.x, this.y + this._yOffset, 'hammer_fx_arrowPouf');
      if (fx && this.dx < 0) {
        fx.mc._xscale = -fx.mc._xscale;
      }
    } else {
      this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT * 0.5, 'hammer_fx_pop');
    }
    this.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BAD)) {
      const et = e as BadEntity;
      et.setCombo(this.uniqId);
      et.killHit(this.dx);
      this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT * 0.5, 'hammer_fx_pop');
      this.destroy();
    }
  }

  override update(): void {
    super.update();
    this.fl_livedOneTurn = true;
  }
}

/** Port of `entity.shoot.PlayerFireBall`: burns every enemy it crosses. */
export class PlayerFireBallShoot extends ShootEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 8;
    this.coolDown = Data.SECOND * 2;
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.register(Data.PLAYER_SHOOT);
  }

  static attach(game: IGameContext, x: number, y: number): PlayerFireBallShoot {
    const s = new PlayerFireBallShoot(
      game,
      game.depthMan.attach('hammer_shoot_player_fireball', Data.DP_SHOTS),
    );
    s.initShoot(x, y);
    return s;
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BAD_CLEAR)) {
      const et = e as BadEntity;
      et.setCombo(this.uniqId);
      et.burn();
    }
  }

  override destroy(): void {
    this.game.fxMan.inGameParticles(Data.PARTICLE_SPARK, this.x, this.y, 3);
    this.game.fxMan.inGameParticles(Data.PARTICLE_STONE, this.x, this.y, 4);
    super.destroy();
  }

  override update(): void {
    super.update();
    if (this.game.rand.random(3) === 0) {
      this.game.fxMan.inGameParticles(
        Data.PARTICLE_SPARK,
        this.x,
        this.y,
        this.game.rand.random(3),
      );
    }
  }
}

/** Port of `entity.shoot.PlayerPearl`: freezes every enemy it crosses, once each. */
export class PlayerPearlShoot extends ShootEntity {
  private readonly shotList: number[] = [];
  fl_bounceBorders = false;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 8.5;
    this.coolDown = Data.SECOND * 2;
    this._yOffset = -16;
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.register(Data.PLAYER_SHOOT);
  }

  static attach(game: IGameContext, x: number, y: number): PlayerPearlShoot {
    const s = new PlayerPearlShoot(
      game,
      game.depthMan.attach('hammer_shoot_player_pearl', Data.DP_SHOTS),
    );
    s.initShoot(x, y);
    return s;
  }

  hasBeenShot(id: number): boolean {
    return this.shotList.includes(id);
  }

  hitWallAnim(): void {
    this.game.fxMan.inGameParticles(Data.PARTICLE_ICE, this.x, this.y, 2);
    this.game.fxMan.inGameParticles(Data.PARTICLE_STONE, this.x, this.y, 3);
    if (this.dx < 0) {
      this.game.fxMan.attachFx(
        this.x + Data.CASE_WIDTH * 0.5,
        this.y + this._yOffset,
        'hammer_fx_icePouf',
      );
    } else {
      this.game.fxMan.attachFx(
        this.x - Data.CASE_WIDTH * 0.5,
        this.y + this._yOffset,
        'hammer_fx_icePouf',
      );
    }
  }

  override onSideBorderBounce(): void {
    super.onSideBorderBounce();
    this.hitWallAnim();
  }

  override onLifeTimer(): void {
    this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_pop');
    super.onLifeTimer();
  }

  override endUpdate(): void {
    if (this.dy !== 0) {
      this.rotation = (Math.atan2(this.dy, this.dx) * 180) / Math.PI;
    }
    super.endUpdate();
  }

  override destroy(): void {
    if (!this.fl_bounceBorders) {
      this.hitWallAnim();
    }
    super.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BAD)) {
      const et = e as BadEntity;
      if (!this.hasBeenShot(et.uniqId)) {
        et.setCombo(this.uniqId);
        et.freeze(Data.FREEZE_DURATION);
        et.dx = this.dx * 2;
        et.dy -= 3;
        this.shotList.push(et.uniqId);
      }
    }
  }
}

/** Port of `entity.shoot.FireRain`: a drop of the fire rain (item 84), burning the enemies it hits. */
export class FireRainShoot extends ShootEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 10 + game.rand.random(5);
    this.fl_checkBounds = false;
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.playAnim(Data.ANIM_SHOOT_LOOP);
  }

  static attach(game: IGameContext, x: number, y: number): FireRainShoot {
    const s = new FireRainShoot(game, game.depthMan.attach('hammer_shoot_firerain', Data.DP_SHOTS));
    s.initShoot(x, y - 10);
    return s;
  }

  override onDeathLine(): void {
    this.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BAD_CLEAR)) {
      const et = e as BadEntity;
      this.game.fxMan.inGameParticles(
        Data.PARTICLE_SPARK,
        this.x,
        this.y,
        this.game.rand.random(5) + 1,
      );
      et.burn();
      this.destroy();
    }
  }

  // Never called: shots have fl_hitWall and fl_hitGround off (the original has them commented out)
  override onHitWall(): void {
    this.hitLevel();
  }

  override onHitGround(_h: number): void {
    this.hitLevel();
  }

  /** Hits the level. */
  hitLevel(): void {
    this.game.fxMan.attachExplodeZone(this.x, this.y, 30);
    this.game.fxMan.inGameParticles(Data.PARTICLE_STONE, this.x, this.y, this.game.rand.random(4));
    this.destroy();
  }

  override update(): void {
    super.update();
    if (this.x < 0) {
      this.hitLevel();
    }
  }
}

/** What a Hammer needs from its carrier (`entity.Player` and its `SpecialManager`). */
interface HammerCarrier {
  x: number;
  y: number;
  dir: number;
  fl_kill: boolean;
  actives: boolean[];
  /** `specialMan.interrupt` */
  interruptSpecial(id: number): void;
}

/** Port of `entity.shoot.Hammer` (item 85): a hammer held in front of the player, killing enemies. */
export class HammerShoot extends ShootEntity {
  player!: HammerCarrier;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.shootSpeed = 0;
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.playAnim(Data.ANIM_SHOOT_LOOP);
  }

  static attach(game: IGameContext, x: number, y: number): HammerShoot {
    const s = new HammerShoot(game, game.depthMan.attach('hammer_shoot_hammer', Data.DP_SPEAR));
    s.initShoot(x, y - 10);
    return s;
  }

  override destroy(): void {
    this.player.interruptSpecial(85);
    this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT / 2, 'hammer_fx_pop');
    super.destroy();
  }

  setOwner(p: HammerCarrier): void {
    this.player = p;
  }

  override endUpdate(): void {
    super.endUpdate();
    // No owner yet on the first call (from `initShoot`): AS2 compares undefined, always false
    const dir = this.player?.dir ?? 0;
    if (dir > 0 && this.mc._xscale < 0) {
      this.mc._xscale = Math.abs(this.mc._xscale);
    }
    if (dir < 0 && this.mc._xscale > 0) {
      this.mc._xscale = -Math.abs(this.mc._xscale);
    }
  }

  override update(): void {
    let hx = this.player.x + this.player.dir * Data.CASE_WIDTH * 0.7;
    hx = Math.min(Data.GAME_WIDTH - 1, hx);
    hx = Math.max(1, hx);
    let hy = this.player.y - Data.CASE_HEIGHT * 0.7;
    hx = Math.max(1, Math.min(Data.GAME_WIDTH - 1, hx));
    hy = Math.max(20, Math.min(Data.GAME_HEIGHT - 1, hy));
    this.moveTo(hx, hy);
    super.update();

    // Contact
    const l = this.game.getClose(Data.BAD, this.x, this.y, Data.CASE_WIDTH * 2, false);
    for (let i = 0; i < l.length; i++) {
      (l[i] as BadEntity).killHit(this.player.dir * 9);
    }

    if (this.player.fl_kill || this.game.fl_clear || !this.player.actives[85]) {
      this.destroy();
    }
  }
}

/** Port of `entity.shoot.BossFireBall`: a fire ball spiralling out of the Bat boss (task 2.8). */
export class BossFireBallShoot extends ShootEntity {
  maxDist: number;
  bat!: { x: number; y: number };
  ang = 0; // radians
  dist: number;
  distSpeed: number;
  turnSpeed: number;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_checkBounds = false;
    this.fl_largeTrigger = true;
    this.turnSpeed = 0.025;
    this.distSpeed = 2;
    this.dist = Data.CASE_WIDTH * 0.2;
    this.maxDist = Data.CASE_WIDTH * 5;
    this.disablePhysics();
  }

  protected override initShootEntity(): void {
    super.initShootEntity();
    this.playAnim(Data.ANIM_SHOOT_LOOP);
  }

  /** `a` in degrees. */
  initBossShoot(b: { x: number; y: number }, a: number): void {
    this.bat = b;
    this.ang = (a * Math.PI) / 180;
    this.center();
  }

  /** Places the fire ball around the boss. */
  center(): void {
    this.moveTo(
      this.bat.x + Math.cos(this.ang) * this.dist,
      this.bat.y + Math.sin(this.ang) * this.dist,
    );
  }

  static attach(game: IGameContext, x: number, y: number): BossFireBallShoot {
    const s = new BossFireBallShoot(
      game,
      game.depthMan.attach('hammer_shoot_boss_fireball', Data.DP_SHOTS),
    );
    s.initShoot(x, y - 10);
    return s;
  }

  override destroy(): void {
    this.game.fxMan.attachExplodeZone(this.x, this.y, Data.CASE_WIDTH * 2);
    super.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BOMB)) {
      const et = e as BombEntity;
      if (!et.fl_explode) {
        this.game.fxMan.attachFx(et.x, et.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
        et.destroy();
        this.game.fxMan.inGameParticles(Data.PARTICLE_CLASSIC_BOMB, this.x, this.y, 6);
        this.destroy();
        return;
      }
    }
    if (e.isType(Data.PLAYER)) {
      (e as PlayerEntity).killHit(this.dx);
    }
  }

  override update(): void {
    super.update();

    const ocx = this.cx;
    const ocy = this.cy;
    this.ang += Timer.tmod * this.turnSpeed;
    this.dist += Timer.tmod * this.distSpeed;
    this.dist = Math.min(this.dist, this.maxDist);
    this.center();
    if (ocx !== this.cx || ocy !== this.cy) {
      this.checkHits();
    }
  }
}

/** What a FramBall needs from its owner (`entity.bad.walker.Framboise`, `FramboiseBad` in `Bad.ts`). */
export interface FramBallOwner {
  tx: number;
  ty: number;
  anger: number;
  onArrived(fb: FramBallShoot): void;
}

/**
 * Port of `entity.shoot.FramBall`: a fragment of a Framboise flying to the spot where it
 * reassembles.
 */
export class FramBallShoot extends ShootEntity {
  turnSpeed: number;
  owner!: FramBallOwner;
  ang: number;
  fl_arrived: boolean;
  white: number;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    const rand = game.rand;
    this.shootSpeed = 5 + rand.random(3);
    this.turnSpeed = 0.03 + rand.random(10) / 100 + this.shootSpeed * 0.02;
    this._yOffset = -2;
    this.setLifeTimer(Data.SECOND * 4);
    this.fl_checkBounds = false;
    this.fl_blink = false;
    this.fl_arrived = false;
    this.fl_anim = false;
    this.mc.gotoAndStop('1');
    this.ang = rand.random(314);
    this.white = 0;
  }

  setOwner(b: FramBallOwner): void {
    this.owner = b;
    const tang = Math.atan2(this.owner.ty - this.y, this.owner.tx - this.x);
    const rand = this.game.rand;
    this.ang = -tang + (rand.random(168) / 100) * (rand.random(2) * 2 - 1);
    if (this.owner.anger > 0) {
      this.shootSpeed *= 1 + this.owner.anger * 0.5;
    }
  }

  static attach(game: IGameContext, x: number, y: number): FramBallShoot {
    const s = new FramBallShoot(
      game,
      game.depthMan.attach('hammer_shoot_framBall2', Data.DP_SHOTS),
    );
    s.initShoot(x, y);
    return s;
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      (e as PlayerEntity).killHit(this.dx);
    }
  }

  adjustAngRad(a: number): number {
    if (a < -Math.PI) return a + Math.PI * 2;
    if (a > Math.PI) return a - Math.PI * 2;
    return a;
  }

  override onLifeTimer(): void {
    this.onArrived();
    super.onLifeTimer();
  }

  onArrived(): void {
    if (this.fl_arrived) {
      return;
    }
    this.fl_arrived = true;
    this.owner.onArrived(this);
  }

  // endUpdate: the original's white glow is commented out

  protected override infix(): void {
    super.infix();
    // slow down if close
    const d = this.distance(this.owner.tx, this.owner.ty);
    if (d < 40) {
      this.turnSpeed *= 1.1;
    }
    if (d < 20) {
      this.shootSpeed *= 0.9;
      if (this.shootSpeed <= 5.8 || this.owner.anger > 0) {
        this.onArrived();
      }
      this.white += 0.1 * Timer.tmod;
      this.white = Math.min(1, this.white);
    }
    this.turnSpeed = Math.min(1, this.turnSpeed);
    this.shootSpeed = Math.max(2, this.shootSpeed);
  }

  override update(): void {
    // targetting
    const tang = Math.atan2(this.owner.ty - this.y, this.owner.tx - this.x);
    if (this.adjustAngRad(tang - this.ang) > 0) {
      this.ang += this.turnSpeed * Timer.tmod;
    }
    if (this.adjustAngRad(tang - this.ang) < 0) {
      this.ang -= this.turnSpeed * Timer.tmod;
    }

    this.dx = Math.cos(this.ang) * this.shootSpeed * Timer.tmod;
    this.dy = Math.sin(this.ang) * this.shootSpeed * Timer.tmod;
    super.update();
  }
}
