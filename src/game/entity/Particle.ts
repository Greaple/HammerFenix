import { Timer } from '../../engine/Timer';
import { Data } from '../Data';
import type { IGameContext } from '../GameContext';
import { type BaseEntity, MoverEntity } from './Entity';
import type { PlayerEntity } from './Player';

/**
 * Port of `entity.fx.Particle` (`class/hammer/entity/fx/Particle.mt`): a small debris that jumps,
 * bounces and rolls (ice, stones, sparks, metal, blobs...), one frame of `hammer_fx_particle` per
 * `PARTICLE_*` type. Rain drops fall straight and shrink the players they touch (Guu doll);
 * bubbles float up (water levels). Created by `FxManager.inGameParticles`.
 */
export class Particle extends MoverEntity {
  bounce = 0;
  subFrame = 0;
  skipWallsY = 0;
  pid = 0;

  constructor(game: IGameContext, mc: BaseEntity['mc']) {
    super(game, mc);
    this.setLifeTimer(Data.SECOND * 2 + (Data.SECOND * 2 * game.rand.random(100)) / 100);
    this.disableAnimator();
  }

  initParticle(frame: number, x: number, y: number): void {
    this.register(Data.FX);
    const rand = this.game.rand;
    this.pid = frame;

    if (this.pid !== Data.PARTICLE_RAIN) {
      this.bounce = rand.random(65) / 10 + 1.5;
      this.setNext(
        (1 + rand.random(50) / 10) * (rand.random(2) * 2 - 1),
        -this.bounce,
        0,
        Data.ACTION_MOVE,
      );
    }

    this.mc.gotoAndStop(String(this.pid));
    // Most frames have no `sub`: `Std.random(undefined)` is 0 here, without a draw
    const sub = this.sub;
    this.subFrame = rand.random(sub ? sub._totalframes : 0) + 1;
    sub?.gotoAndStop(String(this.subFrame));

    this.scale(rand.random(50) + 50);
    this.rotation = rand.random(360);

    this.moveTo(x, y);
    this.skipWallsY = y;
    this.bounceFactor = 0.6;

    switch (this.pid) {
      case Data.PARTICLE_SPARK:
        this.scale(this.scaleFactor * 100 * 2);
        this.updateLifeTimer(Data.SECOND);
        break;
      case Data.PARTICLE_STONE:
        this.scale(this.scaleFactor * 150);
        break;
      case Data.PARTICLE_RAIN:
        this.mc._yscale = 10;
        this.rotation = 5;
        this.alpha = rand.random(70) + 30;
        break;
      case Data.PARTICLE_METAL:
        this.scale(rand.random(40) + 80);
        this.bounceFactor = 0.3;
        break;
      case Data.PARTICLE_LITCHI:
        this.bounceFactor = 0.4;
        break;
      case Data.PARTICLE_BUBBLE:
        this.fl_gravity = false;
        this.fl_hitCeil = true;
        this.fl_blink = false;
        this.mc._alpha = rand.random(80) + 20;
        this.moveUp(0.3 + rand.random(10) / 10);
        this.scale(rand.random(40) + 30);
        this.next = null;
        this.updateLifeTimer(Data.SECOND + rand.random(Data.SECOND * 20) / 10);
        break;
      case Data.PARTICLE_ICE_BAD:
        this.bounceFactor = 0.5;
        if (this.next) {
          this.next.dx *= 0.3;
          this.next.dy = -Math.abs(this.next.dy);
        }
        break;
      case Data.PARTICLE_BLOB:
        this.gravityFactor = 0.6;
        this.fallFactor = this.gravityFactor;
        this.updateLifeTimer(Data.SECOND * 3);
        this.fl_blink = false;
        break;
    }

    this.endUpdate();
  }

  /** Rain drops shrink the players they touch. */
  override hit(e: BaseEntity): void {
    if (this.pid !== Data.PARTICLE_RAIN) {
      return;
    }
    if ((e.types & Data.PLAYER) > 0) {
      if (!(e as PlayerEntity).fl_shield) {
        e.scale(100 * e.scaleFactor - 1);
        this.destroy();
      }
    }
  }

  /** Walls only stop a particle once it is below where it started (or has bounced). */
  protected override prefix(): void {
    this.fl_hitWall = this.y > this.skipWallsY;
    super.prefix();
  }

  protected override postfix(): void {
    this.fl_friction = false;
  }

  override onHitGround(h: number): void {
    if (this.pid === Data.PARTICLE_BLOB) {
      this.recal();
      this.dx = 0;
      this.dy = 0;
      this.fl_gravity = false;
    }
    if (this.pid === Data.PARTICLE_RAIN) {
      this.recal();
      const fx = this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_water_drop');
      // Drawn even when the attach fails, as the original's assignments to a null clip are
      const alpha = this.game.rand.random(50) + 10;
      const xscale = 100 * (this.game.rand.random(2) * 2 - 1);
      if (fx) {
        fx.mc._alpha = alpha;
        fx.mc._xscale = xscale;
      }
      this.destroy();
      return;
    }

    this.skipWallsY = 0;
    this.fl_hitWall = true;

    this.setNext(this.dx, -this.dy * this.bounceFactor, 0, Data.ACTION_MOVE);
    if (this.next && Math.abs(this.next.dy) <= 1.5) {
      this.next.dx *= this.game.gFriction;
    }
    this.fl_skipNextGravity = true;
    super.onHitGround(h);
  }

  override onHitCeil(): void {
    this.destroy();
  }

  override onHitWall(): void {
    if (this.fl_hitWall) {
      if (this.pid === Data.PARTICLE_BLOB) {
        this.dx = 0;
      } else {
        this.dx = -this.dx * 0.5;
      }
    }
  }

  override onDeathLine(): void {
    this.destroy();
  }

  static attach(game: IGameContext, frame: number, x: number, y: number): Particle {
    const mc = new Particle(game, game.depthMan.attach('hammer_fx_particle', Data.DP_BADS));
    mc.initParticle(frame, x, y);
    return mc;
  }

  override endUpdate(): void {
    if (this.pid === Data.PARTICLE_RAIN) {
      this.mc._yscale = Math.min(100, this.mc._yscale + Timer.tmod * 4);
      this.rotation *= 0.93;
    } else {
      this.rotation += this.dx * 2;
    }

    super.endUpdate();

    if (this.pid === Data.PARTICLE_BUBBLE && this.totalLife !== null && this.totalLife > 0) {
      this.mc._alpha = Math.min(100, (150 * this.lifeTimer) / this.totalLife);
    }

    if (this.pid === Data.PARTICLE_BLOB && this.totalLife !== null && this.totalLife > 0) {
      this.mc._xscale =
        100 * this.scaleFactor * Math.min(1, (1.5 * this.lifeTimer) / this.totalLife);
      this.mc._yscale = this.mc._xscale;
    }
  }

  /** A particle at rest runs out twice as fast (this and `Entity.update`); blobs only once. */
  override update(): void {
    if (Math.abs(this.dx) <= 0.5 && this.pid !== Data.PARTICLE_BLOB) {
      this.lifeTimer -= Timer.tmod;
      if (this.lifeTimer <= 0) {
        this.onLifeTimer();
      }
    }
    super.update();
  }
}
