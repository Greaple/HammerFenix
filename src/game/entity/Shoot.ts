import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { IGameContext } from '../GameContext';
import type { BadEntity } from './Bad';
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
    this.game.fxMan.inGameParticles(0, this.x, this.y, 3); // PARTICLE_SPARK (task 2.5)
    this.game.fxMan.inGameParticles(0, this.x, this.y, 4); // PARTICLE_STONE
    super.destroy();
  }

  override update(): void {
    super.update();
    if (this.game.rand.random(3) === 0) {
      this.game.fxMan.inGameParticles(0, this.x, this.y, this.game.rand.random(3)); // SPARK
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
    this.game.fxMan.inGameParticles(0, this.x, this.y, 2); // PARTICLE_ICE (task 2.5)
    this.game.fxMan.inGameParticles(0, this.x, this.y, 3); // PARTICLE_STONE
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
