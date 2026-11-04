import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { IGameContext } from '../GameContext';
import type { BadEntity } from './Bad';
import { MoverEntity } from './Entity';
import type { PlayerEntity } from './Player';

/**
 * Port of `entity.Supa` (`class/hammer/entity/Supa.mt`): a large screen-wide effect from an item
 * (or the super item of a perfect clear). No collisions, gravity, friction or trigger cells; its
 * clip plays on its own.
 */
export class SupaEntity extends MoverEntity {
  radius: number;
  speed: number;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_hitGround = false;
    this.fl_hitWall = false;
    this.fl_gravity = false;
    this.fl_friction = false;
    this.fl_hitBorder = false;
    this.fl_alphaBlink = false;
    this.blinkColorAlpha = 80;

    this.minAlpha = 0;

    this.speed = 0;
    this.radius = 0;
  }

  /** `init` */
  protected initSupaEntity(): void {
    this.register(Data.SUPA);
    this.disableAnimator();
  }

  initSupa(x: number, y: number): void {
    this.initSupaEntity();
    this.moveTo(x, y);
    this.endUpdate();
  }

  protected override infix(): void {
    // no super
  }

  /** Not managed by trigger cells. */
  protected override tAdd(_cx: number, _cy: number): void {}

  protected override tRem(_cx: number, _cy: number): void {}
}

/** Port of `entity.supa.Arrow` (item 38, totem): an arrow crossing the screen that kills enemies. */
export class ArrowSupa extends SupaEntity {
  static attach(game: IGameContext): ArrowSupa {
    const mc = new ArrowSupa(game, game.depthMan.attach('hammer_supa_arrow', Data.DP_SUPA));
    mc.initSupa(Data.GAME_WIDTH, -50);
    return mc;
  }

  override initSupa(x: number, y: number): void {
    super.initSupa(x, y);
    this.speed = 10;
    this.radius = 50;
    this.moveLeft(this.speed);
  }

  protected override prefix(): void {
    super.prefix();
    const l = this.game.getClose(Data.BAD, this.x, this.y, this.radius, false);
    for (let i = 0; i < l.length; i++) {
      const e = l[i] as BadEntity;
      if (e.y >= this.y - Data.CASE_HEIGHT && e.y <= this.y + Data.CASE_HEIGHT * 2) {
        if (!e.fl_kill) {
          e.killHit(-this.speed * 1.5);
        }
      }
    }
  }

  protected override postfix(): void {
    super.postfix();
    if (!this.world.shapeInBound(this)) {
      this.moveTo(Data.GAME_WIDTH, this.game.rand.random(Math.trunc(Data.GAME_HEIGHT * 0.7)) + 40);
    }
  }
}

/** Port of `entity.supa.Ball` (item 3, beach ball): a big bouncing ball that knocks enemies. */
export class BallSupa extends SupaEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_gravity = true;
  }

  static attach(game: IGameContext): BallSupa {
    const mc = new BallSupa(game, game.depthMan.attach('hammer_supa_ball', Data.DP_SUPA));
    mc.initSupa(Data.GAME_WIDTH, 0);
    return mc;
  }

  override initSupa(x: number, y: number): void {
    super.initSupa(x, y);
    this.speed = 2;
    this.radius = 40;
    this.fallFactor = 0.8;
    this.gravityFactor = 0.8;
    this.dx = this.speed;
    this.moveTo(0, -50);
    this.scale(220);
  }

  protected override prefix(): void {
    super.prefix();
    const l = this.game.getClose(Data.BAD, this.x, this.y, this.radius, false);
    for (let i = 0; i < l.length; i++) {
      const e = l[i] as BadEntity;
      if (!e.fl_knock) {
        e.knock(Data.KNOCK_DURATION * 3);
        e.dx = this.dx * 2;
        e.dy = -5;
      }
    }
  }

  protected override postfix(): void {
    super.postfix();
    if (this.dy > 0 && this.y >= Data.GAME_HEIGHT) {
      this.dy = -Math.abs(this.dy);
      this.game.shake(Data.SECOND * 0.5, 3);
    }
    if (this.x >= Data.GAME_WIDTH + 50) {
      this.destroy();
    }
  }
}

/** Port of `entity.supa.Bubble` (item 8, star): a bubble bouncing around the screen for 10 s. */
export class BubbleSupa extends SupaEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_alphaBlink = true;
    this.blinkAlpha = 25;
  }

  static attach(game: IGameContext): BubbleSupa {
    const mc = new BubbleSupa(game, game.depthMan.attach('hammer_supa_bubble', Data.DP_SUPA));
    mc.initSupa(Data.GAME_WIDTH, 0);
    return mc;
  }

  override initSupa(x: number, y: number): void {
    super.initSupa(x, y);
    this.speed = 8;
    this.radius = 80;
    this.moveTo(Data.GAME_WIDTH / 2, Data.GAME_HEIGHT / 2);
    const rand = this.game.rand;
    // Same draw order as the original's argument evaluation
    const ang = 45 + rand.random(30) * (rand.random(2) * 2 - 1) + (rand.random(4) + 1) * 90;
    this.moveToAng(ang, this.speed + rand.random(5));
    this.setLifeTimer(Data.SECOND * 10);
  }

  protected override prefix(): void {
    super.prefix();
    const l = this.game.getClose(Data.BAD, this.x, this.y, this.radius, false);
    for (let i = 0; i < l.length; i++) {
      const e = l[i] as BadEntity;
      if (!e.fl_knock) {
        e.knock(Data.KNOCK_DURATION * 2);
        e.dx = this.dx * 2;
        e.dy = -5;
        this.game.fxMan.inGameParticles(
          Data.PARTICLE_ICE,
          e.x,
          e.y - Data.CASE_HEIGHT,
          this.game.rand.random(5),
        );
      }
    }
  }

  protected override postfix(): void {
    super.postfix();

    // Bounces
    if (this.y <= 0) {
      this.dy = Math.abs(this.dy);
    }
    if (this.y >= Data.GAME_HEIGHT) {
      this.dy = -Math.abs(this.dy);
    }
    if (this.x <= 0) {
      this.dx = Math.abs(this.dx);
    }
    if (this.x >= Data.GAME_WIDTH) {
      this.dx = -Math.abs(this.dx);
    }
  }
}

/** Port of `entity.supa.IceMeteor` (item 24, snow crystal): a spinning meteor that freezes enemies. */
export class IceMeteorSupa extends SupaEntity {
  static attach(game: IGameContext): IceMeteorSupa {
    const mc = new IceMeteorSupa(game, game.depthMan.attach('hammer_supa_icemeteor', Data.DP_SUPA));
    mc.initSupa(Data.GAME_WIDTH, 0);
    return mc;
  }

  override initSupa(x: number, y: number): void {
    super.initSupa(x, y);
    this.speed = 10;
    this.radius = 50;
    this.moveToAng(130, this.speed);
    this.setLifeTimer(Data.SUPA_DURATION);
  }

  protected override prefix(): void {
    super.prefix();
    const l = this.game.getClose(Data.BAD, this.x, this.y, this.radius, false);
    for (let i = 0; i < l.length; i++) {
      const e = l[i] as BadEntity;
      if (!e.fl_freeze) {
        e.freeze(Data.FREEZE_DURATION);
        e.dx = this.dx * 2;
        e.dy = -5;
      }
    }
  }

  protected override postfix(): void {
    super.postfix();
    this.rotation -= 7;
    if (!this.world.shapeInBound(this)) {
      this.moveTo(Data.GAME_WIDTH, 0);
    }
  }
}

/** Port of `entity.supa.Smoke` (item 19, sunflower): a cloud of smoke over the screen for 3 s. */
export class SmokeSupa extends SupaEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_blink = false;
  }

  override initSupa(x: number, y: number): void {
    super.initSupa(x, y);
    this.scale(265);
    this.setLifeTimer(Data.SECOND * 3);
  }

  static attach(game: IGameContext): SmokeSupa {
    const mc = new SmokeSupa(game, game.depthMan.attach('hammer_supa_smoke', Data.DP_SUPA));
    mc.initSupa(Data.GAME_WIDTH / 2, Data.GAME_HEIGHT / 2);
    return mc;
  }
}

/**
 * Port of `entity.supa.SupaItem`: the big item that falls after a level is cleared with the enemies
 * killed in their order of appearance (`Adventure.onLevelClear`).
 */
export class SupaItem extends SupaEntity {
  supaId = 0;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.radius = 50;
  }

  override initSupa(x: number, y: number): void {
    super.initSupa(x, y);
    this.scale(200);
    this.moveDown(5);
    this.mc.gotoAndStop(String(this.supaId + 1));
  }

  static attach(game: IGameContext, id: number): SupaItem {
    const mc = new SupaItem(game, game.depthMan.attach('hammer_supa_item', Data.DP_SUPA));
    mc.supaId = id;
    mc.initSupa(Data.GAME_WIDTH / 2, -50);
    return mc;
  }

  pick(pl: PlayerEntity): void {
    this.game.fxMan.inGameParticles(Data.PARTICLE_ICE, this.x, this.y, 15);
    this.game.fxMan.attachExplodeZone(this.x, this.y, 50);
    const score = Data.getCrystalValue(this.supaId) * 5;
    // game.manager.logAction("$SU"+supaId): server log, not ported
    pl.getScore(this, score);
    this.game.audio.playSound('sound_item_supa', Data.CHAN_ITEM);

    // Makes the other player cry
    const l = this.game.getList(Data.PLAYER) as PlayerEntity[];
    for (let i = 0; i < l.length; i++) {
      if (l[i].uniqId !== pl.uniqId) {
        l[i].setBaseAnims(Data.ANIM_PLAYER_WALK, Data.ANIM_PLAYER_STOP_L);
      }
    }

    this.destroy();
  }

  /** Fell off the bottom: missed. */
  override onDeathLine(): void {
    const pl = this.game.getList(Data.PLAYER) as PlayerEntity[];
    for (let i = 0; i < pl.length; i++) {
      pl[i].setBaseAnims(Data.ANIM_PLAYER_WALK, Data.ANIM_PLAYER_STOP_L);
    }
    this.destroy();
  }

  protected override prefix(): void {
    super.prefix();

    const l = this.game.getClose(
      Data.PLAYER,
      this.x,
      this.y + Data.CASE_HEIGHT * 1.5,
      this.radius,
      false,
    );
    let fl_break = false;
    for (let i = 0; i < l.length && !fl_break; i++) {
      const e = l[i] as PlayerEntity;
      if (!e.fl_kill) {
        this.pick(e);
        fl_break = true;
      }
    }

    if (this.y >= Data.GAME_HEIGHT + 50) {
      this.onDeathLine();
    }
  }
}

/** Port of `entity.supa.Tons` (item 9, Sauron's eye): a weight that falls again and again, killing anyone under it. */
export class TonsSupa extends SupaEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_gravity = true;
  }

  static attach(game: IGameContext): TonsSupa {
    const mc = new TonsSupa(game, game.depthMan.attach('hammer_supa_tons', Data.DP_SUPA));
    mc.initSupa(Data.GAME_WIDTH, 0);
    return mc;
  }

  override initSupa(x: number, y: number): void {
    super.initSupa(x, y);
    this.speed = 0;
    this.radius = 40;
    this.moveTo(this.game.rand.random(Data.GAME_WIDTH), -40);
    this.fallFactor = 0.3;
  }

  protected override prefix(): void {
    super.prefix();

    // Bads
    let l = this.game.getClose(Data.BAD, this.x, this.y, this.radius, false);
    for (let i = 0; i < l.length; i++) {
      const e = l[i] as BadEntity;
      if (!e.fl_kill) {
        const rand = this.game.rand;
        e.killHit((rand.random(2) * 2 - 1) * rand.random(5));
        e.dy = -25;
      }
    }

    // Player
    l = this.game.getClose(Data.PLAYER, this.x, this.y, this.radius, false);
    for (let i = 0; i < l.length; i++) {
      const e = l[i] as PlayerEntity;
      if (!e.fl_kill) {
        const rand = this.game.rand;
        e.killHit((rand.random(2) * 2 - 1) * rand.random(5));
        e.dy = -25;
      }
    }
  }

  protected override postfix(): void {
    super.postfix();
    if (this.y >= Data.GAME_HEIGHT * 2) {
      this.moveTo(this.game.rand.random(Data.GAME_WIDTH), -40);
      this.dy = 0;
    }
  }
}
