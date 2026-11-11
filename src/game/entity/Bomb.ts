import { Timer } from '../../engine/Timer';
import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { type AnimDef, Data } from '../Data';
import { FxManager } from '../FxManager';
import type { IGameContext } from '../GameContext';
import { type BadEntity, createBad } from './Bad';
import { BaseEntity, MoverEntity } from './Entity';
import { ScoreItem } from './Item';
import type { PlayerEntity } from './Player';

/**
 * Port of `entity.Bomb` (`class/hammer/entity/Bomb.mt`).
 */
export class BombEntity extends MoverEntity {
  radius: number = Data.CASE_WIDTH * 3;
  power = 0;
  duration = 0;

  fl_explode = false;
  fl_airKick = false;
  fl_bumped = false;

  explodeSound: string | null = 'sound_bomb';

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_slide = false;
    this.fl_bounce = false;
    this.fl_teleport = true;
    this.fl_wind = true;
    this.fl_blink = false;
    this.fl_portal = true;
    this.fl_bump = true;
    this.fl_strictGravity = false;
    this.slideFriction = 0.98;
  }

  initBomb(x: number, y: number): void {
    this.register(Data.BOMB);
    this.moveTo(x, y);
    this.setLifeTimer(this.duration);
    this.updateCoords();
    this.playAnim(Data.ANIM_BOMB_DROP);
  }

  override needsPatch(): boolean {
    return true;
  }

  bombGetClose(type: number): BaseEntity[] {
    return this.game.getClose(type, this.x, this.y, this.radius, this.fl_stable);
  }

  onExplode(): void {
    this.playAnim(Data.ANIM_BOMB_EXPLODE);
    if (this.explodeSound !== null) {
      this.game.audio.playSound(this.explodeSound, Data.CHAN_BOMB);
    }
    this.rotation = 0;
    this.fl_physics = false;
    this.fl_explode = true;
  }

  override onEndAnim(id: number): void {
    super.onEndAnim(id);
    if (id === Data.ANIM_BOMB_DROP.id) {
      this.playAnim(Data.ANIM_BOMB_LOOP);
    }
    if (id === Data.ANIM_BOMB_EXPLODE.id) {
      this.destroy();
    }
  }

  override endUpdate(): void {
    if (!this.fl_stable) {
      const ang = 30;
      if (this.dx > 0) {
        this.rotation += 0.02 * (ang - this.rotation);
      } else {
        this.rotation -= 0.02 * (ang - this.rotation);
      }
      this.rotation = Math.max(-ang, Math.min(ang, this.rotation));
    }
    super.endUpdate();
  }

  override onLifeTimer(): void {
    this.stopBlink();
    this.onExplode();
  }

  override onDeathLine(): void {
    super.onDeathLine();
    this.destroy();
  }

  onKick(_p: PlayerEntity): void {
    // Overridden by subclasses
  }

  override onHitWall(): void {
    if (this.fl_bumped) {
      this.dx = -this.dx * 0.7;
    } else {
      super.onHitWall();
    }
  }

  override onPortal(pid: number | null): void {
    super.onPortal(pid);
    this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT * 0.5, 'hammer_fx_shine');
    this.destroy();
  }

  override onPortalRefusal(): void {
    super.onPortalRefusal();
    this.dx = -this.dx * 3;
    this.dy = -5;
    this.game.fxMan.inGameParticles(Data.PARTICLE_PORTAL, this.x, this.y, 5);
  }

  override onBump(): void {
    this.fl_bumped = true;
  }

  duplicate(): BombEntity | null {
    return null;
  }
}

/**
 * Port of `entity.bomb.PlayerBomb` (`class/hammer/entity/bomb/PlayerBomb.mt`).
 */
export class PlayerBomb extends BombEntity {
  static readonly UPGRADE_FACTOR = 1.5;
  static readonly MAX_UPGRADES = 1;

  owner: PlayerEntity | null = null;
  upgrades = 0;
  fl_unstable = false;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_airKick = true;
    this.register(Data.PLAYER_BOMB);
  }

  setOwner(p: PlayerEntity | null): void {
    this.owner = p;
  }

  override hit(e: BaseEntity): void {
    super.hit(e);
    if (this.fl_unstable && e.isType(Data.BAD)) {
      this.onExplode();
    }
  }

  override onHitGround(h: number): void {
    super.onHitGround(h);
    if (this.fl_unstable && this.fl_bounce) {
      this.onExplode();
    }
  }

  override onKick(p: PlayerEntity): void {
    if (this.upgrades < PlayerBomb.MAX_UPGRADES && this.owner && p.pid !== this.owner.pid) {
      this.upgradeBomb(p);
    }
    super.onKick(p);
    if (!this.fl_stable) {
      this.fl_airKick = false;
    }
  }

  upgradeBomb(p: PlayerEntity): void {
    this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_pop');
    this.radius *= PlayerBomb.UPGRADE_FACTOR;
    this.power *= PlayerBomb.UPGRADE_FACTOR;
    this.setLifeTimer(this.duration * 0.7);
    this.dx *= 1.5;
    this.fl_blink = true;
    this.fl_alphaBlink = false;
    this.blinkColor = 0xff0000;
    this.scale(this.scaleFactor * PlayerBomb.UPGRADE_FACTOR * 100);
    this.owner = p;
    this.upgrades++;
  }

  override onExplode(): void {
    super.onExplode();

    if (this.upgrades > 0) {
      this.game.fxMan.attachExplosion(this.x, this.y, this.radius);
    }

    if (this.game.fl_bombExpert) {
      const players = this.game.getList(Data.PLAYER) as PlayerEntity[];
      for (const p of players) {
        const dist = this.distance(p.x, p.y);
        if (dist <= this.radius) {
          const ratio = (this.radius - dist) / this.radius;
          p.knock(Data.SECOND + 2 * Data.SECOND * ratio);
          const ang = Math.atan2(p.y - this.y, p.x - this.x);
          p.dx = Math.cos(ang) * this.power * 0.7 * ratio;
          p.dy = Math.sin(ang) * this.power * 0.7 * ratio;
        }
      }
    }

    this.game.onExplode(this.x, this.y, this.radius);

    if (this.owner) {
      if (this.owner.actives[14]) ScoreItem.attach(this.game, this.x, this.y, 47, 0);
      if (this.owner.actives[15]) ScoreItem.attach(this.game, this.x, this.y, 48, 0);
      if (this.owner.actives[16]) ScoreItem.attach(this.game, this.x, this.y, 49, 0);
      if (this.owner.actives[17]) ScoreItem.attach(this.game, this.x, this.y, 50, 0);
    }
  }

  override update(): void {
    super.update();
    if (!this.fl_blinking && this.upgrades > 0) {
      this.blink(Data.BLINK_DURATION_FAST);
    }
  }
}

/** Igor's signature ice bomb (`entity.bomb.player.Classic`). */
export class ClassicBomb extends PlayerBomb {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.duration = 45;
    this.power = 30;
  }

  static attach(game: IGameContext, x: number, y: number): ClassicBomb {
    const mc = game.depthMan.attach('hammer_bomb_classic', Data.DP_BOMBS);
    const b = new ClassicBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): ClassicBomb {
    return ClassicBomb.attach(this.game, this.x, this.y);
  }

  override onExplode(): void {
    super.onExplode();

    if (this.game.config.fl_shaky) {
      this.game.shake(Data.SECOND * 0.35, 1.5);
    }

    const bads = this.bombGetClose(Data.BAD) as BadEntity[];
    for (const e of bads) {
      e.setCombo(this.uniqId);
      e.freeze(Data.FREEZE_DURATION);
      this.shockWave(e, this.radius, this.power);
    }
    this.game.fxMan.inGameParticles(
      Data.PARTICLE_ICE,
      this.x,
      this.y,
      this.game.rand.random(2) + 2,
    );

    const badBombs = this.bombGetClose(Data.BAD_BOMB) as BadBomb[];
    for (const bb of badBombs) {
      if (!bb.fl_explode) {
        const bf = bb.getFrozen(this.uniqId);
        if (bf) {
          this.shockWave(bf, this.radius, this.power);
          bb.destroy();
        }
      }
    }
  }
}

/** Lethal black bomb (`entity.bomb.player.Black`). */
export class BlackBomb extends PlayerBomb {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.duration = 100;
    this.power = 20;
    this.explodeSound = 'sound_bomb_black';
  }

  static attach(game: IGameContext, x: number, y: number): BlackBomb {
    const mc = game.depthMan.attach('hammer_bomb_black', Data.DP_BOMBS);
    const b = new BlackBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): BlackBomb {
    return BlackBomb.attach(this.game, this.x, this.y);
  }

  override onExplode(): void {
    super.onExplode();

    const bads = this.bombGetClose(Data.BAD) as BadEntity[];
    this.game.shake(10, 4);
    this.game.fxMan.attachExplodeZone(this.x, this.y, this.radius);

    for (const e of bads) {
      e.setCombo(this.uniqId);
      e.killHit(0);
      this.shockWave(e, this.radius, this.power);
      e.dy = -10 - this.game.rand.random(20);
    }
  }
}

/** Platform-drop knock bomb (`entity.bomb.player.Blue`). */
export class BlueBomb extends PlayerBomb {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.duration = 45;
    this.power = 20;
    this.explodeSound = 'sound_bomb_blue';
  }

  static attach(game: IGameContext, x: number, y: number): BlueBomb {
    const mc = game.depthMan.attach('hammer_bomb_blue', Data.DP_BOMBS);
    const b = new BlueBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): BlueBomb {
    return BlueBomb.attach(this.game, this.x, this.y);
  }

  override onExplode(): void {
    super.onExplode();

    const bads = this.bombGetClose(Data.BAD) as BadEntity[];
    for (const e of bads) {
      e.setCombo(this.uniqId);
      e.knock(Data.KNOCK_DURATION * 0.75);
      this.shockWave(e, this.radius, this.power);
      e.dx *= 0.3;
      e.dy = -6;
      e.yTrigger = e.y + Data.CASE_HEIGHT * 1.5;
      e.fl_hitGround = false;
    }
  }
}

/** Contact-triggered green ice mine (`entity.bomb.player.Green`). */
export class GreenBomb extends PlayerBomb {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.duration = 200;
    this.power = 25;
    this.fl_blink = true;
    this.fl_alphaBlink = false;
    this.fl_unstable = true;
    this.explodeSound = 'sound_bomb_green';
  }

  static attach(game: IGameContext, x: number, y: number): GreenBomb {
    const mc = game.depthMan.attach('hammer_bomb_green', Data.DP_BOMBS);
    const b = new GreenBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): GreenBomb {
    return GreenBomb.attach(this.game, this.x, this.y);
  }

  override endUpdate(): void {
    super.endUpdate();
    this.rotation = 0;
    this.mc.rotationDeg = 0;
  }

  override onExplode(): void {
    if (this.fl_explode) return;
    this.game.audio.playSound('sound_bomb', Data.CHAN_BOMB);
    super.onExplode();

    const bads = this.bombGetClose(Data.BAD) as BadEntity[];
    for (const e of bads) {
      e.setCombo(this.uniqId);
      e.freeze(Data.FREEZE_DURATION);
      this.shockWave(e, this.radius, this.power);
    }
    this.game.fxMan.inGameParticles(
      Data.PARTICLE_ICE,
      this.x,
      this.y,
      this.game.rand.random(2) + 2,
    );

    const badBombs = this.bombGetClose(Data.BAD_BOMB) as BadBomb[];
    for (const bb of badBombs) {
      if (!bb.fl_explode) {
        const bf = bb.getFrozen(this.uniqId);
        if (bf) {
          this.shockWave(bf, this.radius, this.power);
          bb.destroy();
        }
      }
    }
  }
}

/** Rocket-jump red ice bomb (`entity.bomb.player.Red`). */
export class RedBomb extends PlayerBomb {
  readonly jumpPower = 32;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.duration = 38;
    this.power = 30;
  }

  static attach(game: IGameContext, x: number, y: number): RedBomb {
    const mc = game.depthMan.attach('hammer_bomb_red', Data.DP_BOMBS);
    const b = new RedBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): RedBomb {
    return RedBomb.attach(this.game, this.x, this.y);
  }

  override onExplode(): void {
    super.onExplode();

    const bads = this.bombGetClose(Data.BAD) as BadEntity[];
    for (const e of bads) {
      e.setCombo(this.uniqId);
      e.freeze(Data.FREEZE_DURATION);
      this.shockWave(e, this.radius, this.power);
      if (e.dy < 0) {
        e.dy *= 3;
        if (this.distance(e.x, e.y) <= this.radius * 0.5) {
          e.dx *= 0.5;
          e.dy *= 2;
        }
      }
    }

    this.game.fxMan.inGameParticles(
      Data.PARTICLE_ICE,
      this.x,
      this.y,
      this.game.rand.random(2) + 2,
    );
    this.game.fxMan.attachExplodeZone(this.x, this.y, this.radius);

    const players = this.game.getList(Data.PLAYER) as PlayerEntity[];
    for (const e of players) {
      let distX = e.x - this.x;
      let distY = e.y - this.y;
      if (this.fl_stable) {
        distX *= 1.5;
        distY *= 0.5;
      } else {
        distX *= 0.9;
        distY *= 0.35;
      }
      const dist = Math.hypot(distX, distY);
      if (dist <= 40) {
        if (e.dy > 0) e.dy = 0;
        e.dy -= this.jumpPower;
        if (e.dy <= -35) {
          this.game.shake(10, 3);
          this.game.fxMan.attachExplodeZone(e.x, e.y - 40, 50);
          this.game.fxMan.attachExplodeZone(e.x, e.y - 80, 40);
          this.game.fxMan.attachExplodeZone(e.x, e.y - 120, 30);
        }
      } else if (e.distance(this.x, this.y) <= this.radius) {
        this.shockWave(e, this.radius, this.power);
      }
    }
  }
}

/** Soccer/repel bomb (`entity.bomb.player.RepelBomb`). */
export class RepelBomb extends PlayerBomb {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.duration = 38;
    this.power = 20;
    this.radius = Data.CASE_WIDTH * 3;
  }

  static attach(game: IGameContext, x: number, y: number): RepelBomb {
    const mc = game.depthMan.attach('hammer_bomb_repel', Data.DP_BOMBS);
    const b = new RepelBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): RepelBomb {
    return RepelBomb.attach(this.game, this.x, this.y);
  }

  override onKick(p: PlayerEntity): void {
    super.onKick(p);
    this.dx *= 2.5;
  }

  override onExplode(): void {
    super.onExplode();

    this.game.fxMan.inGameParticles(
      Data.PARTICLE_ICE,
      this.x,
      this.y,
      this.game.rand.random(2) + 2,
    );
    this.game.fxMan.attachExplodeZone(this.x, this.y, this.radius);

    const players = this.game.getList(Data.PLAYER) as PlayerEntity[];
    for (const p of players) {
      const dist = this.distance(p.x, p.y);
      if (dist <= this.radius) {
        const ratio = (this.radius - dist) / this.radius;
        p.knock(Data.SECOND + Data.SECOND * ratio);
        const ang = Math.atan2(p.y - this.y, p.x - this.x);
        p.dx = Math.cos(ang) * this.power * ratio;
        p.dy = Math.sin(ang) * this.power * ratio;
      }
    }

    // Ball
    const l = this.game.getList(Data.SOCCERBALL) as SoccerBall[];
    for (let i = 0; i < l.length; i++) {
      const ball = l[i];
      const dist = this.distance(ball.x, ball.y);
      if (dist <= this.radius) {
        ball.lastPlayer = this.owner;
        const ratio = (this.radius - dist) / this.radius;
        const ang = Math.atan2(ball.y - this.y, ball.x - this.x);
        ball.dx = Math.cos(ang) * this.power * ratio * 1.5;
        ball.dy = Math.sin(ang) * this.power * ratio * 1.5;
        if (ball.dy < 4 && ball.dy > -8) {
          ball.dy = -8;
        }
        ball.burn();
        if (ball.fl_stable) {
          ball.dx *= 2;
        } else {
          ball.dx *= 1.5;
        }
      }
    }
  }
}

/**
 * Port of `entity.bomb.BadBomb` (`class/hammer/entity/bomb/BadBomb.mt`).
 */
export class BadBomb extends BombEntity {
  owner: BadEntity | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_airKick = true;
    this.register(Data.BAD_BOMB);
  }

  override initBomb(x: number, y: number): void {
    super.initBomb(x, y);
    if (this.game.fl_bombExpert) {
      this.radius *= 1.4;
    }
  }

  setOwner(b: BadEntity | null): void {
    this.owner = b;
  }

  getFrozen(_uid: number): BombEntity | null {
    return null;
  }

  override onExplode(): void {
    super.onExplode();
    if (this.game.getDynamicVar('$BAD_BOMB_TRIGGER') !== undefined) {
      this.game.onExplode(this.x, this.y, this.radius);
    }
  }

  override onKick(p: PlayerEntity): void {
    super.onKick(p);
    this.dx *= 3;
  }
}

/** Pear enemy bomb (`entity.bomb.bad.PoireBomb`). */
export class PoireBomb extends BadBomb {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.duration = 45;
    this.power = 30;
    this.radius = Data.CASE_WIDTH * 4;
  }

  static attach(game: IGameContext, x: number, y: number): PoireBomb {
    const mc = game.depthMan.attach('hammer_bomb_poire', Data.DP_BOMBS);
    const b = new PoireBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): PoireBomb {
    return PoireBomb.attach(this.game, this.x, this.y);
  }

  override onExplode(): void {
    super.onExplode();

    this.game.fxMan.attachExplodeZone(this.x, this.y, this.radius);

    const players = this.game.getClose(
      Data.PLAYER,
      this.x,
      this.y,
      this.radius,
      false,
    ) as PlayerEntity[];
    for (const e of players) {
      e.killHit(0);
      this.shockWave(e, this.radius, this.power);
      if (!e.fl_shield) {
        e.dy = -10 - this.game.rand.random(20);
      }
    }
  }

  override onKick(p: PlayerEntity): void {
    super.onKick(p);
    this.setLifeTimer(this.lifeTimer + Data.SECOND * 0.5);
  }
}

/** Kiwi proximity mine (`entity.bomb.bad.Mine`). */
export class MineBomb extends BadBomb {
  static readonly SUDDEN_DEATH = Data.SECOND * 1.1;
  static readonly HIDE_SPEED = 3;
  static readonly DETECT_RADIUS = Data.CASE_WIDTH * 2.5;

  fl_trigger = false;
  fl_defuse = false;
  fl_plant = false;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_blink = true;
    this.fl_alphaBlink = false;
    this.duration = Data.SECOND * 15;
    this.power = 50;
    this.radius = Data.CASE_WIDTH * 3;
  }

  override initBomb(x: number, y: number): void {
    super.initBomb(x, y);
    if (this.game.fl_bombExpert) {
      this.radius = Data.CASE_WIDTH * 3 * 1.3;
    }
  }

  static attach(game: IGameContext, x: number, y: number): MineBomb {
    const mc = game.depthMan.attach('hammer_bomb_mine', Data.DP_BOMBS);
    const b = new MineBomb(game, mc);
    b.initBomb(x, y);
    return b;
  }

  override duplicate(): MineBomb {
    return MineBomb.attach(this.game, this.x, this.y);
  }

  override onHitGround(h: number): void {
    super.onHitGround(h);
    if (!this.fl_trigger) {
      this.playAnim(Data.ANIM_BOMB_LOOP);
    }
    if (!this.fl_defuse) {
      this.rotation = 0;
    }
  }

  override onExplode(): void {
    if (!this.fl_trigger || this.fl_defuse) {
      this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
      this.destroy();
    } else {
      super.onExplode();
      this.game.fxMan.attachExplodeZone(this.x, this.y, this.radius);

      const players = this.game.getClose(
        Data.PLAYER,
        this.x,
        this.y,
        this.radius,
        false,
      ) as PlayerEntity[];
      for (const e of players) {
        e.killHit(0);
        this.shockWave(e, this.radius, this.power);
        if (!e.fl_shield) {
          e.dy = -10 - this.game.rand.random(20);
        }
      }
    }
  }

  override onKick(p: PlayerEntity): void {
    super.onKick(p);
    this.triggerMine();
    this.updateLifeTimer(Data.SECOND * 0.7);
    this.dx *= 0.8 + this.game.rand.random(10) / 10;
  }

  triggerMine(): void {
    if (this.fl_trigger) return;
    this.fl_trigger = true;
    this.playAnim(Data.ANIM_BOMB_DROP);
    this.dy = -7;
    this.show();
    this.alpha = 100;
    this.setLifeTimer(MineBomb.SUDDEN_DEATH * 3); // to force the blink
    this.updateLifeTimer(MineBomb.SUDDEN_DEATH);
    this.blinkLife();
  }

  override playAnim(a: AnimDef): void {
    super.playAnim(a);
    if (a.id === Data.ANIM_BOMB_DROP.id) {
      this.fl_loop = true;
    }
    if (a.id === Data.ANIM_BOMB_LOOP.id) {
      this.fl_loop = false;
    }
  }

  override update(): void {
    super.update();

    if (this.fl_stable && !this.fl_plant) {
      this.fl_plant = true;
    }

    if (this.fl_plant && !this.fl_trigger && this.alpha > 0) {
      this.alpha -= Timer.tmod * MineBomb.HIDE_SPEED;
      if (this.alpha <= 0) {
        this.hide();
      }
    }

    if (this.fl_plant && !this.fl_trigger) {
      const players = this.game.getClose(
        Data.PLAYER,
        this.x,
        this.y,
        MineBomb.DETECT_RADIUS,
        false,
      );
      for (const pl of players) {
        if (!pl.fl_kill) {
          this.triggerMine();
          break;
        }
      }
    }
  }
}

/**
 * Port of `entity.bomb.bad.BossBomb`: Tuberculoz's bomb (task 2.9). It hatches an Orange that
 * drops nothing, angrier as the boss loses lives.
 */
export class BossBomb extends BadBomb {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    const rand = game.rand;
    this.duration = Data.SECOND * 2 + (rand.random(50) / 10) * (rand.random(2) * 2 - 1);
    this.fl_blink = true;
    this.fl_alphaBlink = false;
    this.blinkColorAlpha = 50;
    this.explodeSound = null;
  }

  static attach(game: IGameContext, x: number, y: number): BossBomb {
    const mc = new BossBomb(game, game.depthMan.attach('hammer_bomb_boss', Data.DP_BOMBS));
    mc.initBomb(x, y);
    return mc;
  }

  override initBomb(x: number, y: number): void {
    super.initBomb(x, y);
    this.setLifeTimer(this.duration * 1.5);
    this.updateLifeTimer(this.duration);
  }

  override duplicate(): BossBomb {
    return BossBomb.attach(this.game, this.x, this.y);
  }

  override onExplode(): void {
    super.onExplode();
    // `entity.bad.walker.Orange.attach`: not through `game.attachBad`
    const b = createBad(
      this.game,
      Data.BAD_ORANGE,
      this.x - Data.CASE_WIDTH * 0.5,
      this.y - Data.CASE_HEIGHT * 0.5,
    );
    const boss = this.game.getOne(Data.BOSS) as { lives: number } | null;
    // AS2: with no boss, `undefined <= 70` is false
    const lives = boss?.lives ?? NaN;
    if (lives <= 70) {
      b.angerMore();
    }
    if (lives <= 50) {
      b.angerMore();
    }
    b.moveUp(10);
    b.knock(Data.SECOND);
    // `b.dropReward = null`: calling a null method does nothing in AS2
    b.dropReward = () => {};
    this.playAnim(Data.ANIM_BOMB_EXPLODE);
  }

  /** Easy to push back. */
  override onKick(p: PlayerEntity): void {
    super.onKick(p);
    this.setLifeTimer(this.lifeTimer + Data.SECOND * 0.5);
  }
}

/** Port of `entity.bomb.player.SoccerBall`: the ball of the soccer mode (task 4.4) and of level scripts. */
export class SoccerBall extends PlayerBomb {
  static readonly TOP_SPEED = 4;

  speed = 0;
  burnTimer: number;
  lastPlayer: PlayerEntity | null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.lastPlayer = null;
    this.duration = 999999;
    this.burnTimer = 0;
    this.bounceFactor = 0.8;
    this.fl_bounce = true;
    this.slideFriction = Data.FRICTION_SLIDE * 0.9;
  }

  static attach(game: IGameContext, x: number, y: number): SoccerBall {
    const mc = new SoccerBall(game, game.depthMan.attach('hammer_bomb_soccer', Data.DP_BOMBS));
    mc.initBomb(x, y);
    return mc;
  }

  /** `init` runs before `initBomb` moves the ball, so the shine appears at (0, 0). */
  override initBomb(x: number, y: number): void {
    this.register(Data.SOCCERBALL);
    FxManager.addGlow(this.mc, 0x808080, 2);
    this.game.fxMan.attachShine(this.x, this.y - Data.CASE_HEIGHT * 0.5);
    super.initBomb(x, y);
  }

  override duplicate(): null {
    return null;
  }

  override upgradeBomb(_p: PlayerEntity): void {
    // do nothing
  }

  override onKick(p: PlayerEntity): void {
    super.onKick(p);
    this.lastPlayer = p;
    if (Math.abs(this.dx) < 10) {
      this.dx *= 3;
      this.dy *= 1.1;
    }
  }

  /** Sets the ball on fire. */
  burn(): void {
    this.burnTimer = Data.SECOND;
  }

  override onExplode(): void {
    // never explodes
  }

  protected override infix(): void {
    super.infix();
    const id = this.world.getCase(this.cx, this.cy);
    // `goal` exists only in the soccer mode: elsewhere the AS2 call does nothing
    const game = this.game as unknown as { goal?: (side: number) => void };
    if (id === Data.FIELD_GOAL_1) {
      game.goal?.(1);
      this.destroy();
    }
    if (id === Data.FIELD_GOAL_2) {
      game.goal?.(0);
      this.destroy();
    }
  }

  override endUpdate(): void {
    super.endUpdate();
    const sub = this.sub;
    if (sub) {
      sub.rotationDeg += this.dx * 5;
      if (this.dx > 0) {
        sub._xscale = -Math.abs(sub._xscale);
      }
      if (this.dx < 0) {
        sub._xscale = Math.abs(sub._xscale);
      }
    }
  }

  override onHitWall(): void {
    const ocx = BaseEntity.x_rtc(this.oldX);
    const ocy = BaseEntity.y_rtc(this.oldY);
    if (this.world.getCase(ocx, ocy) !== Data.GROUND) {
      this.dx = -this.dx;
      if (Math.abs(this.dx) > 7) {
        this.game.fxMan.inGameParticlesDir(
          Data.PARTICLE_DUST,
          this.x,
          this.y,
          this.game.rand.random(5) + 1,
          this.dx,
        );
      }
    }
  }

  override update(): void {
    this.speed = Math.sqrt(Math.pow(this.dx, 2) + Math.pow(this.dy, 2));
    this.animFactor = (0.5 * this.speed) / SoccerBall.TOP_SPEED;
    this.fl_airKick = true;

    if (this.burnTimer > 0) {
      const rand = this.game.rand;
      this.game.fxMan.inGameParticles(Data.PARTICLE_SPARK, this.x, this.y, rand.random(3));
      const fx = this.game.fxMan.attachFx(
        this.x + rand.random(5) * (rand.random(2) * 2 - 1),
        this.y - rand.random(20),
        'hammer_fx_ballBurn',
      );
      const ratio = Math.min(1, this.speed / SoccerBall.TOP_SPEED);
      if (fx) {
        fx.mc._xscale = 100 * ratio;
        fx.mc._yscale = fx.mc._xscale;
      }
      this.burnTimer -= Timer.tmod;
    }
    super.update();
  }
}
