import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { type AnimDef, Data } from '../Data';
import type { IGameContext } from '../GameContext';
import type { BadEntity } from './Bad';
import { BaseEntity, PhysicsEntity } from './Entity';
import type { PlayerEntity } from './Player';

const ANIM_SHOOT: AnimDef = { id: 0, loop: true };

/**
 * Port of `entity.Shoot` (`class/hammer/entity/Shoot.mt`) and projectile subclasses.
 */
export class ShootEntity extends PhysicsEntity {
  shootSpeed = 6;
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
    this.register(Data.SHOOT);
    this.setSub(mc);
    this.playAnim(ANIM_SHOOT);
  }

  initShoot(x: number, y: number): void {
    this.moveTo(x, y);
    this.endUpdate();
  }

  moveUp(speed: number): void {
    this.moveToAng(-90, speed);
  }

  moveDown(speed: number): void {
    this.moveToAng(90, speed);
  }

  override endUpdate(): void {
    if (this.dy === 0) {
      this.mc._xscale = this.dx < 0 ? -Math.abs(this.mc._xscale) : Math.abs(this.mc._xscale);
    }
    super.endUpdate();
  }

  override update(): void {
    super.update();
    if (!this.fl_checkBounds) return;

    if (this.fl_borderBounce) {
      if (this.x < 0) this.dx = Math.abs(this.dx);
      if (this.x >= Data.GAME_WIDTH) this.dx = -Math.abs(this.dx);
      if (this.y < 0) this.dy = Math.abs(this.dy);
      if (this.y >= Data.GAME_HEIGHT) this.dy = -Math.abs(this.dy);
    } else if (!this.world.inBound(this.cx, this.cy)) {
      this.destroy();
    }
  }
}

/** Apple seed horizontal projectile (`entity.shoot.Pepin`). */
export class PepinShoot extends ShootEntity {
  static attach(game: IGameContext, x: number, y: number): PepinShoot {
    const mc = game.depthMan.attach('hammer_shoot_pepin', Data.DP_SHOTS);
    const s = new PepinShoot(game, mc);
    s.shootSpeed = 5;
    s.fl_hitWall = true;
    s.initShoot(x, y - 6);
    return s;
  }

  override onHitWall(): void {
    this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_pop');
    this.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      const p = e as PlayerEntity;
      if (!p.fl_shield) {
        p.killHit(this.dx);
      }
      this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_pop');
      this.destroy();
    }
  }
}

/** Lemon zest vertical projectile (`entity.shoot.Zeste`). */
export class ZesteShoot extends ShootEntity {
  static attach(game: IGameContext, x: number, y: number): ZesteShoot {
    const mc = game.depthMan.attach('hammer_shoot_zest', Data.DP_SHOTS);
    const s = new ZesteShoot(game, mc);
    s.shootSpeed = 4.5;
    s.initShoot(x, y - 8);
    return s;
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      const p = e as PlayerEntity;
      if (!p.fl_shield) {
        p.killHit(this.dx || 1);
      }
      this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_pop');
      this.destroy();
    }
  }
}

/** Crawler fireball projectile (`entity.shoot.FireBall`). */
export class EnemyFireBallShoot extends ShootEntity {
  static attach(game: IGameContext, x: number, y: number): EnemyFireBallShoot {
    const mc = game.depthMan.attach('hammer_shoot_fireball', Data.DP_SHOTS);
    const s = new EnemyFireBallShoot(game, mc);
    s.shootSpeed = 6;
    s.fl_hitWall = true;
    s.fl_hitGround = true;
    s.initShoot(x, y);
    return s;
  }

  override onHitWall(): void {
    this.game.fxMan.attachExplosion(this.x, this.y, 20);
    this.destroy();
  }

  override onHitGround(_h: number): void {
    this.game.fxMan.attachExplosion(this.x, this.y, 20);
    this.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      const p = e as PlayerEntity;
      if (!p.fl_shield) {
        p.killHit(this.dx || 1);
      }
      this.game.fxMan.attachExplosion(this.x, this.y, 24);
      this.destroy();
    }
  }
}

/** Strawberry pass-ball projectile (`entity.shoot.Ball`). */
export class BallShoot extends ShootEntity {
  targetCatcher: BaseEntity | null = null;
  onCatch?: (catcher: BaseEntity) => void;

  static attach(game: IGameContext, x: number, y: number): BallShoot {
    const mc = game.depthMan.attach('hammer_shoot_ball', Data.DP_SHOTS);
    const s = new BallShoot(game, mc);
    s.register(Data.BALL);
    s.shootSpeed = 6.5;
    s.fl_borderBounce = true;
    s.setLifeTimer(Data.SECOND * 4);
    s.initShoot(x, y - 6);
    return s;
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      const p = e as PlayerEntity;
      if (!p.fl_shield) {
        p.killHit(this.dx || 1);
      }
      this.destroy();
      return;
    }
    if (this.targetCatcher && e === this.targetCatcher) {
      this.onCatch?.(e);
      this.destroy();
    }
  }
}

/** Player arrow weapon (`Data.WEAPON_S_ARROW`). */
export class PlayerArrowShoot extends ShootEntity {
  static attach(game: IGameContext, x: number, y: number): PlayerArrowShoot {
    const mc = game.depthMan.attach('hammer_shoot_arrow', Data.DP_SHOTS);
    const s = new PlayerArrowShoot(game, mc);
    s.register(Data.PLAYER_SHOOT);
    s.shootSpeed = 12;
    s.coolDown = 14;
    s.fl_hitWall = true;
    s.initShoot(x, y - 10);
    return s;
  }

  override onHitWall(): void {
    this.dx = 0;
    this.setLifeTimer(Data.SECOND * 2);
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BAD) && this.dx !== 0) {
      const b = e as BadEntity;
      b.killHit(this.dx);
      this.destroy();
    }
  }
}

/** Player fireball weapon (`Data.WEAPON_S_FIRE`). */
export class PlayerFireBallShoot extends ShootEntity {
  static attach(game: IGameContext, x: number, y: number): PlayerFireBallShoot {
    const mc = game.depthMan.attach('hammer_shoot_player_fireball', Data.DP_SHOTS);
    const s = new PlayerFireBallShoot(game, mc);
    s.register(Data.PLAYER_SHOOT);
    s.shootSpeed = 9;
    s.coolDown = 20;
    s.fl_hitWall = true;
    s.initShoot(x, y - 10);
    return s;
  }

  override onHitWall(): void {
    this.game.fxMan.attachExplosion(this.x, this.y, 25);
    this.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BAD)) {
      const b = e as BadEntity;
      b.burn();
      this.game.fxMan.attachExplosion(this.x, this.y, 30);
      this.destroy();
    }
  }
}

/** Player ice pearl weapon (`Data.WEAPON_S_ICE`). */
export class PlayerPearlShoot extends ShootEntity {
  static attach(game: IGameContext, x: number, y: number): PlayerPearlShoot {
    const mc = game.depthMan.attach('hammer_shoot_player_pearl', Data.DP_SHOTS);
    const s = new PlayerPearlShoot(game, mc);
    s.register(Data.PLAYER_SHOOT);
    s.shootSpeed = 9;
    s.coolDown = 18;
    s.fl_hitWall = true;
    s.initShoot(x, y - 10);
    return s;
  }

  override onHitWall(): void {
    this.game.fxMan.inGameParticles(0, this.x, this.y, 3);
    this.destroy();
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.BAD)) {
      const b = e as BadEntity;
      b.freeze(Data.FREEZE_DURATION);
      this.shockWave(b, 50, 18);
      this.destroy();
    }
  }
}
