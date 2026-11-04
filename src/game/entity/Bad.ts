import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { type AnimDef, Data } from '../Data';
import type { IGameContext } from '../GameContext';
import { type BombEntity, MineBomb, PoireBomb } from './Bomb';
import { BaseEntity, MoverEntity, type PhysicsEntity } from './Entity';
import { ScoreItem } from './Item';
import type { PlayerEntity } from './Player';
import { BallShoot, EnemyFireBallShoot, PepinShoot, ZesteShoot } from './Shoot';

function adjustAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * Port of `entity.Bad` (`class/hammer/entity/Bad.mt`).
 */
export class BadEntity extends MoverEntity {
  badId = 0;
  player: PlayerEntity | null = null;
  fl_playerClose = false;
  closeDistance: number = Data.IA_CLOSE_DISTANCE;

  freezeTimer = 0;
  freezeTotal = 1;
  fl_freeze = false;

  fl_ninFriend = false;
  fl_ninFoe = false;

  knockTimer = 0;
  fl_knock = false;
  fl_showIA = false;

  deathTimer = 0;

  fl_trap = true;
  comboId: number | null = null;
  yTrigger: number | null = null;
  anger = 0;
  angerFactor = 0.7;
  speedFactor = 1.0;

  chaseFactor = 5.0;
  maxAnger: number = Data.MAX_ANGER;

  realRadius: number | null = Data.CASE_WIDTH;

  private iceMc: SwfMovieClip | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fl_strictGravity = false;
    this.fl_largeTrigger = true;
    this.register(Data.BAD);
    this.register(Data.BAD_CLEAR);
    this.calcSpeed();
  }

  initBad(x: number, y: number): void {
    this.moveTo(x + Data.CASE_WIDTH * 0.5, y + Data.CASE_HEIGHT);
    this.endUpdate();
  }

  override killHit(dx: number | null): void {
    if (this.fl_freeze) {
      this.game.fxMan.inGameParticles(0, this.x, this.y, this.game.rand.random(3) + 2);
      this.game.fxMan.attachExplosion(this.x, this.y - Data.CASE_HEIGHT * 0.5, Data.CASE_WIDTH * 2);
      this.melt();
    }
    if (this.fl_knock) {
      this.wakeUp();
    }
    const kdx = dx ?? (this.game.rand.random(200) / 10) * (this.game.rand.random(2) * 2 - 1);
    this.playAnim(Data.ANIM_BAD_DIE);
    super.killHit(kdx);
  }

  forceKill(dx: number | null): void {
    this.killHit(dx);
  }

  burn(): void {
    this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_burning');
    this.dropReward();
    this.onKill();
    this.destroy();
  }

  isHealthy(): boolean {
    return !this.fl_kill && !this.fl_freeze && !this.fl_knock;
  }

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      const et = e as PlayerEntity;
      let flHit = true;
      if (this.realRadius !== null && this.distance(et.x, et.y) > this.realRadius) {
        flHit = false;
      }
      if (flHit) {
        if (et.actives[86]) {
          this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT, 'hammer_fx_shine');
          et.getScore(this, 666);
          this.destroy();
        } else if (this.isHealthy()) {
          if (et.actives[114] && et.oldY <= this.y - Data.CASE_HEIGHT * 0.5 && et.dy > 0) {
            et.dy = -Data.PLAYER_AIR_JUMP * 2.5;
            this.freeze(Data.FREEZE_DURATION);
            this.setCombo(null);
            this.game.fxMan.attachExplodeZone(this.x, this.y - 5, 30);
            this.game.fxMan.inGameParticles(0, this.x, this.y - 5, 3 + this.game.rand.random(3));
          } else if (!et.fl_shield) {
            et.killHit(et.x < this.x ? -1 : 1);
          }
        }
      }
    }

    if (e.isType(Data.BAD)) {
      const et = e as BadEntity;
      if (this.fl_freeze && !et.fl_freeze) {
        const spd = this.evaluateSpeed();
        if (spd >= Data.ICE_HIT_MIN_SPEED) {
          et.setCombo(this.comboId);
          et.killHit(this.dx);
        } else if (spd >= Data.ICE_KNOCK_MIN_SPEED) {
          et.setCombo(this.comboId);
          et.knock(Data.KNOCK_DURATION);
        }
      }
    }
  }

  setCombo(id: number | null): void {
    if (!this.fl_kill) {
      this.comboId = id;
    }
  }

  override playAnim(o: AnimDef): void {
    if (o.id === Data.ANIM_BAD_WALK.id && this.anger > 0) {
      super.playAnim(Data.ANIM_BAD_ANGER);
    } else {
      super.playAnim(o);
    }
  }

  calcSpeed(): void {
    this.speedFactor = 1.0 + this.angerFactor * this.anger;
    if (this.game.globalActives[69]) this.speedFactor *= 0.6;
    if (this.game.globalActives[80]) this.speedFactor *= 0.3;
  }

  updateSpeed(): void {
    this.calcSpeed();
  }

  dropReward(): void {
    const itY = this.world.inBound(this.cx, this.cy) ? this.y : -30;
    if (this.comboId !== null) {
      const n = this.game.countCombo(this.comboId) - 1;
      ScoreItem.attach(this.game, this.x, itY, 0, n);
    } else {
      ScoreItem.attach(this.game, this.x, itY, Data.DIAMANT, null);
    }
  }

  evaluateSpeed(): number {
    return Math.hypot(this.dx, this.dy);
  }

  override destroy(): void {
    super.destroy();
    this.iceMc?.removeMovieClip();
    this.iceMc = null;
  }

  override needsPatch(): boolean {
    return this.fl_freeze || this.fl_knock;
  }

  override onDeathLine(): void {
    this.game.fxMan.attachFx(this.x, Data.GAME_HEIGHT * 0.5, 'hammer_fx_death');
    this.game.shake(10, 3);
    this.game.audio.playSound('sound_bad_death', Data.CHAN_BAD);
    this.deathTimer = 0;

    super.onDeathLine();

    if (!this.fl_kill) {
      this.onKill();
    }
    this.dropReward();
    this.destroy();
  }

  onMelt(): void {
    this.iceMc?.removeMovieClip();
    this.iceMc = null;
  }

  onWakeUp(): void {}

  onFreeze(): void {
    this.playAnim(Data.ANIM_BAD_FREEZE);
    if (!this.iceMc) {
      this.iceMc = this.game.depthMan.attach('hammer_bad_ice', Data.DP_BADS);
    }
  }

  onKnock(): void {
    this.playAnim(Data.ANIM_BAD_KNOCK);
  }

  onHurryUp(): void {
    this.angerMore();
  }

  override onKill(): void {
    super.onKill();

    if (this.fl_ninFriend) {
      const plist = this.game.getList(Data.PLAYER) as PlayerEntity[];
      for (const p of plist) {
        if (!p.fl_kill) {
          p.unshield();
          p.killHit(this.game.rand.random(20));
          this.game.fxMan.detachLastAlert();
          this.game.fxMan.attachAlert(this.game.dataStore.getStatic(44));
        }
      }
    }

    if (this.fl_ninFoe) {
      const blist = this.game.getList(Data.BAD_CLEAR) as BadEntity[];
      let n = 1;
      for (const b of blist) {
        b.fl_ninFriend = false;
        if (b.uniqId !== this.uniqId) {
          ScoreItem.attach(this.game, b.x, b.y, 0, n);
          b.destroy();
          n++;
        }
        b.unstick();
      }
      ScoreItem.attach(this.game, Data.GAME_WIDTH * 0.5, -20, 236, null);
      this.game.fxMan.detachLastAlert();
      this.game.fxMan.attachAlert(this.game.dataStore.getStatic(45));
    }

    this.deathTimer = Data.SECOND * 5;
    this.game.onKillBad(this);
  }

  override onHitGround(h: number): void {
    super.onHitGround(h);
    if (this.fl_freeze) {
      this.game.fxMan.inGameParticles(0, this.x, this.y, this.game.rand.random(3) + 2);
      if (h >= Data.DUST_FALL_HEIGHT) {
        this.game.fxMan.dust(this.cx, this.cy + 1);
      }
    }
  }

  freeze(timer: number): void {
    if (this.fl_kill) return;
    if (this.fl_knock) {
      this.wakeUp();
    }
    this.fallFactor = Data.FALL_FACTOR_FROZEN;
    this.fl_slide = true;
    this.freezeTimer = timer;
    this.freezeTotal = Math.max(1, timer);
    this.fl_freeze = true;
    this.onFreeze();
  }

  knock(timer: number): void {
    if (this.fl_freeze) {
      this.melt();
    }
    this.fallFactor = Data.FALL_FACTOR_KNOCK;
    this.knockTimer = timer;
    this.fl_knock = true;
    this.onKnock();
  }

  melt(): void {
    this.next = null;
    this.angerMore();
    this.freezeTimer = 0;
    this.fl_freeze = false;
    this.fl_slide = false;
    this.fallFactor = 1.0;
    this.onMelt();
  }

  wakeUp(): void {
    this.next = null;
    this.knockTimer = 0;
    this.fl_knock = false;
    this.fallFactor = 1.0;
    this.onWakeUp();
  }

  calmDown(): void {
    if (this.fl_kill) return;
    this.anger = 0;
    this.updateSpeed();
  }

  angerMore(): void {
    this.anger = Math.round(Math.min(this.anger + 1, this.maxAnger));
    this.updateSpeed();
  }

  hate(p: PlayerEntity | null): void {
    this.player = p;
  }

  override endUpdate(): void {
    if ((this.fl_ninFriend || this.fl_ninFoe) && this.isHealthy() && !this.hasSticker) {
      const icon = this.game.depthMan.attach('hammer_interf_ninjaIcon', Data.DP_BADS);
      icon.gotoAndStop(this.fl_ninFoe ? '1' : '2');
      this.stick(icon, 0, -Data.CASE_HEIGHT * 1.8);
    }

    const prevX = this.mc._x;
    const prevY = this.mc._y;

    if (this.fl_softRecal) {
      this.softRecalFactor += 0.1 * this.speedFactor;
    }

    super.endUpdate();

    // Ice shards (the original's "detail" option, on by default)
    const minSpeed = 2;
    if (this.fl_freeze && this.fl_stable && Math.abs(this.dx) > minSpeed) {
      const nb = this.game.rand.random(5) + 2;
      for (let i = 0; i < nb; i++) {
        const part = this.game.fxMan.attachFx(
          prevX + this.game.rand.random(12) * (this.game.rand.random(2) * 2 - 1),
          prevY - this.game.rand.random(5) + 2,
          'hammer_fx_partIce',
        );
        if (part) {
          part.mc.rotationDeg = this.game.rand.random(360);
          part.mc._xscale = this.game.rand.random(80) + 20;
          part.mc._yscale = part.mc._xscale;
          part.mc._alpha = Math.min(100, ((Math.abs(this.dx) - minSpeed) / 5) * 100);
        }
      }
    }

    if (this.iceMc) {
      this.iceMc._x = this.mc._x;
      this.iceMc._y = this.mc._y;
      this.iceMc._xscale = 0.85 * this.scaleFactor * 100;
      this.iceMc._yscale = 0.85 * this.scaleFactor * (this.freezeTimer / this.freezeTotal) * 100;
    }

    if (
      !this.fl_stable &&
      this.isHealthy() &&
      (this.animId === null ||
        this.animId === Data.ANIM_BAD_WALK.id ||
        this.animId === Data.ANIM_BAD_ANGER.id)
    ) {
      this.playAnim(Data.ANIM_BAD_JUMP);
    }
  }

  override update(): void {
    if (!this.player || this.player.fl_destroy) {
      this.hate(this.game.getOne(Data.PLAYER) as PlayerEntity | null);
    }

    this.fl_playerClose =
      this.isHealthy() &&
      this.player !== null &&
      this.distance(this.player.x, this.player.y) <= this.closeDistance * (this.anger + 1);

    if (this.fl_showIA) {
      if (this.fl_playerClose) {
        if (!this.hasSticker) {
          const mc = this.game.depthMan.attach('curse', Data.DP_FX);
          mc.gotoAndStop(String(Data.CURSE_TAUNT));
          this.stick(mc, 0, -Data.CASE_HEIGHT * 2.5);
        }
      } else {
        this.unstick();
      }
    }

    if (this.freezeTimer > 0) {
      this.freezeTimer -= 1;
      if (this.freezeTimer <= 0) {
        this.melt();
      }
    }

    if (this.deathTimer > 0) {
      this.deathTimer -= 1;
      if (this.deathTimer <= 0) {
        this.game.fxMan.attachExplosion(this.x, this.y, 80);
        this.y = 1000;
      }
    }

    if (this.knockTimer > 0) {
      this.knockTimer -= 1;
      if (this.knockTimer <= 0) {
        this.wakeUp();
      }
    }

    super.update();

    if (this.yTrigger !== null && !this.fl_kill) {
      if (this.y >= this.yTrigger) {
        this.fl_hitGround = true;
        this.yTrigger = null;
      }
    }

    if (this.comboId !== null && this.isHealthy()) {
      this.setCombo(null);
    }
  }
}

/**
 * Port of `entity.bad.Walker` (`class/hammer/entity/bad/Walker.mt`).
 */
export class WalkerBad extends BadEntity {
  speed = 2;
  override dir: number = this.game.rand.random(2) * 2 - 1;

  fl_fall = false;
  fl_willFallDown = false;
  chanceFall = 0;
  private recentParticles = 0;

  halt(): void {
    if (!this.fl_freeze && !this.fl_knock) {
      this.dx = 0;
    }
    this.dy = 0;
  }

  walk(): void {
    if (!this.isReady()) return;
    let base = this.speedFactor * this.speed * this.game.speedFactor;
    if (this.dir === -1) base = -base;
    if (this.fl_stable) {
      this.playAnim(Data.ANIM_BAD_WALK);
    }
    this.setNext(base, 0, 0, Data.ACTION_MOVE);
  }

  fallBack(): void {
    this.dx = -this.dx;
    if (!this.fl_freeze && !this.fl_knock) {
      this.dir = -this.dir;
    }
  }

  protected override infix(): void {
    if (this.fl_stable && this.world.checkFlag(this.cx, this.cy, Data.IA_FALL_SPOT)) {
      this.onFall();
      this.fl_stopStepping = true;
      return;
    }
    super.infix();
  }

  protected override postfix(): void {
    super.postfix();
    this.fl_friction = !this.isReady();
  }

  override isReady(): boolean {
    return super.isReady() && this.isHealthy();
  }

  setFall(chance: number | null): void {
    if (chance === null) {
      this.fl_fall = false;
    } else {
      this.fl_fall = true;
      this.chanceFall = chance * 10;
    }
  }

  override calmDown(): void {
    super.calmDown();
    if (this.animId === Data.ANIM_BAD_ANGER.id) {
      this.playAnim(Data.ANIM_BAD_WALK);
    }
    if (this.isReady()) {
      this.halt();
      this.walk();
    }
  }

  override angerMore(): void {
    super.angerMore();
    if (this.isReady()) {
      this.halt();
      this.walk();
    }
  }

  override updateSpeed(): void {
    super.updateSpeed();
    this.walk();
  }

  decideFall(): boolean {
    if (!this.player) return this.game.rand.random(1000) < this.chanceFall;
    const d = this.player.cy - this.cy;
    const fall = this.world.fallMap[this.cx]?.[this.cy] ?? -1;
    const flGood = fall > 0 && d > 0 && fall <= d + 3;
    return this.fl_playerClose ? flGood : this.game.rand.random(1000) < this.chanceFall;
  }

  override onNext(): void {
    if (!this.next) return;
    if (this.next.action === Data.ACTION_WALK) {
      this.next = null;
      this.walk();
    } else if (this.next.action === Data.ACTION_FALLBACK) {
      this.next = null;
      this.walk();
      const nextMove = this.next as {
        dx: number;
        dy: number;
        delay: number;
        action: number;
      } | null;
      if (nextMove) nextMove.dx = -nextMove.dx;
    } else if (this.next.action === Data.ACTION_MOVE && this.next.dy === 0) {
      this.playAnim(Data.ANIM_BAD_WALK);
    }
    super.onNext();
  }

  override onHitWall(): void {
    if (!this.fl_stopStepping) {
      if (this.world.getCase(this.cx, this.cy) !== Data.WALL) {
        if (!this.isHealthy() || this.fl_stable) {
          this.fallBack();
        }
      }
    }
    if (this.fl_freeze && Math.abs(this.dx) >= 4) {
      if (this.recentParticles <= 0) {
        this.game.shake(Math.round(Data.SECOND * 0.2), 2);
        this.game.fxMan.inGameParticles(0, this.x, this.y, this.game.rand.random(4) + 1);
        this.recentParticles = 10;
      }
      if (this.fl_stable) {
        this.game.fxMan.dust(this.cx, this.cy + 1);
      }
    }
  }

  override onHitGround(h: number): void {
    super.onHitGround(h);
    this.halt();
    this.walk();
  }

  onFall(): void {
    if (!this.isReady()) return;

    const oldCell = BaseEntity.rtc(this.oldX, this.oldY);
    if (
      this.world.checkFlag(oldCell.x, oldCell.y, Data.IA_SMALL_SPOT) &&
      this.world.checkFlag(this.cx, this.cy, Data.IA_ALLOW_FALL)
    ) {
      this.halt();
      return;
    }

    if (this.fl_fall) {
      if (this.decideFall() && this.world.checkFlag(this.cx, this.cy, Data.IA_ALLOW_FALL)) {
        this.fl_willFallDown = true;
      }
      if (this.fl_willFallDown) {
        this.fl_willFallDown = false;
        this.halt();
        return;
      }
    }

    this.x = this.oldX;
    this.y = this.oldY;
    this.fallBack();
  }

  override onFreeze(): void {
    super.onFreeze();
    this.next = null;
  }

  override onMelt(): void {
    super.onMelt();
    this.walk();
    if (!this.fl_stable) {
      this.playAnim(Data.ANIM_BAD_JUMP);
    }
  }

  override onKnock(): void {
    super.onKnock();
    this.next = null;
  }

  override onWakeUp(): void {
    super.onWakeUp();
    this.walk();
    if (!this.fl_stable) {
      this.playAnim(Data.ANIM_BAD_JUMP);
    }
  }

  override endUpdate(): void {
    super.endUpdate();
    if (!this.fl_freeze && !this.fl_knock) {
      if (this.dx < 0) this.dir = -1;
      if (this.dx > 0) this.dir = 1;
      this.mc._xscale = this.dir * Math.abs(this.mc._xscale);
    }
  }

  override update(): void {
    this.fl_willFallDown = false;
    if (this.recentParticles > 0) this.recentParticles -= 1;
    super.update();
  }
}

/**
 * Port of `entity.bad.Jumper` (`class/hammer/entity/bad/Jumper.mt`).
 */
export class JumperBad extends WalkerBad {
  fl_jUp = false;
  fl_jDown = false;
  fl_jH = false;
  fl_jumper = false;
  fl_climb = false;

  protected chanceJumpH = 0;
  protected chanceJumpUp = 0;
  protected chanceJumpDown = 0;
  protected chanceClimb = 0;
  maxClimb = 0;

  setJumpUp(chance: number | null): void {
    if (chance === null) {
      this.fl_jUp = false;
    } else {
      this.fl_jUp = true;
      this.chanceJumpUp = chance * 10;
    }
    this.updateJumperFlag();
  }

  setJumpDown(chance: number | null): void {
    if (chance === null) {
      this.fl_jDown = false;
    } else {
      this.fl_jDown = true;
      this.chanceJumpDown = chance * 10;
    }
    this.updateJumperFlag();
  }

  setJumpH(chance: number | null): void {
    if (chance === null) {
      this.fl_jH = false;
    } else {
      this.fl_jH = true;
      this.chanceJumpH = chance * 10;
    }
    this.updateJumperFlag();
  }

  setClimb(chance: number | null, max = 0): void {
    if (chance === null) {
      this.fl_climb = false;
      this.maxClimb = 0;
    } else {
      this.fl_climb = true;
      this.maxClimb = max;
      this.chanceClimb = chance * 10;
    }
    this.updateJumperFlag();
  }

  private updateJumperFlag(): void {
    this.fl_jumper = this.fl_jUp || this.fl_jDown || this.fl_jH;
  }

  decideJumpUp(): boolean {
    if (this.fl_playerClose && this.player) {
      return (
        this.player.cy < this.cy &&
        this.game.rand.random(1000) < this.chanceJumpUp * this.chaseFactor &&
        this.isReady()
      );
    }
    return this.game.rand.random(1000) < this.chanceJumpUp && this.isReady();
  }

  decideJumpDown(): boolean {
    if (this.fl_playerClose && this.player) {
      return (
        this.player.cy > this.cy &&
        this.game.rand.random(1000) < this.chanceJumpDown * this.chaseFactor &&
        this.isReady()
      );
    }
    return this.game.rand.random(1000) < this.chanceJumpDown && this.isReady();
  }

  decideClimb(): boolean {
    const flStairway =
      (this.world.checkFlag(this.cx, this.cy, Data.IA_CLIMB_LEFT) ||
        this.world.checkFlag(this.cx, this.cy, Data.IA_CLIMB_RIGHT)) &&
      this.world.checkFlag(this.cx, this.cy, Data.IA_SMALL_SPOT);

    if (this.fl_playerClose && this.player) {
      const d = Math.abs(this.player.cy - this.cy);
      const flGood =
        d >= 3 ||
        (d < 3 &&
          ((this.player.cx < this.cx && this.dx < 0) || (this.player.cx > this.cx && this.dx > 0)));
      return (
        this.isReady() &&
        (flStairway ||
          (flGood && this.game.rand.random(1000) < this.chanceClimb * this.chaseFactor))
      );
    }
    return this.isReady() && (flStairway || this.game.rand.random(1000) < this.chanceClimb);
  }

  jump(dx: number, dy: number, delay: number): void {
    this.halt();
    this.setNext(dx, dy, delay, Data.ACTION_MOVE);
    if (delay > 0) {
      this.playAnim(Data.ANIM_BAD_THINK);
    }
  }

  checkClimb(): void {
    if (!this.decideClimb()) return;

    if (this.dx < 0 && this.world.checkFlag(this.cx, this.cy, Data.IA_CLIMB_LEFT)) {
      const h = this.world.checkFlag(this.cx, this.cy, Data.IA_TILE_TOP)
        ? this.world.getWallHeight(this.cx - 1, this.cy, Data.IA_CLIMB)
        : this.world.getStepHeight(this.cx, this.cy, Data.IA_CLIMB);
      if (h !== null && h >= 1 && h <= this.maxClimb) {
        const wait = h > 1 ? Data.SECOND : 0;
        const vy = Data.BAD_VJUMP_Y_LIST[h - 1] ?? Data.BAD_VJUMP_Y;
        if (this.world.checkFlag(this.cx, this.cy, Data.IA_TILE_TOP)) {
          this.jump(-Data.BAD_VJUMP_X_CLIFF, -vy, wait);
        } else {
          this.jump(-Data.BAD_VJUMP_X, -vy, wait);
          this.x = this.oldX;
        }
        this.fl_stopStepping = true;
      }
    }

    if (this.dx > 0 && this.world.checkFlag(this.cx, this.cy, Data.IA_CLIMB_RIGHT)) {
      const h = this.world.checkFlag(this.cx, this.cy, Data.IA_TILE_TOP)
        ? this.world.getWallHeight(this.cx + 1, this.cy, Data.IA_CLIMB)
        : this.world.getStepHeight(this.cx, this.cy, Data.IA_CLIMB);
      if (h !== null && h >= 1 && h <= this.maxClimb) {
        const wait = h > 1 ? Data.SECOND : 0;
        const vy = Data.BAD_VJUMP_Y_LIST[h - 1] ?? Data.BAD_VJUMP_Y;
        if (this.world.checkFlag(this.cx, this.cy, Data.IA_TILE_TOP)) {
          this.jump(Data.BAD_VJUMP_X_CLIFF, -vy, wait);
        } else {
          this.jump(Data.BAD_VJUMP_X, -vy, wait);
          this.x = this.oldX;
        }
        this.fl_stopStepping = true;
      }
    }
  }

  override onNext(): void {
    if (this.next?.action === Data.ACTION_MOVE && this.next.dy !== 0) {
      this.playAnim(Data.ANIM_BAD_JUMP);
    }
    super.onNext();
  }

  override onFall(): void {
    if (this.fl_jumper && this.isReady() && this.fl_jH) {
      if (
        this.fl_fall &&
        this.decideFall() &&
        this.world.checkFlag(this.cx, this.cy, Data.IA_ALLOW_FALL)
      ) {
        this.fl_willFallDown = true;
      }
      if (
        this.fl_fall &&
        this.fl_climb &&
        (this.world.checkFlag(this.cx, this.cy + 1, Data.IA_CLIMB_LEFT) ||
          this.world.checkFlag(this.cx, this.cy + 1, Data.IA_CLIMB_RIGHT))
      ) {
        this.fl_willFallDown = true;
      }

      if (!this.fl_willFallDown) {
        if (this.dx < 0 && this.world.checkFlag(this.cx, this.cy, Data.IA_JUMP_LEFT)) {
          this.jump(-Data.BAD_HJUMP_X, -Data.BAD_HJUMP_Y, 0);
          this.adjustToRight();
        } else if (this.dx > 0 && this.world.checkFlag(this.cx, this.cy, Data.IA_JUMP_RIGHT)) {
          this.jump(Data.BAD_HJUMP_X, -Data.BAD_HJUMP_Y, 0);
          this.adjustToLeft();
        } else if (this.fl_climb) {
          this.checkClimb();
        }
      }
    }
    super.onFall();
  }

  override onHitWall(): void {
    if (this.fl_climb) {
      this.checkClimb();
    }
    super.onHitWall();
  }

  override onFreeze(): void {
    super.onFreeze();
    this.fl_skipNextGround = false;
  }

  override onKnock(): void {
    super.onKnock();
    this.fl_skipNextGround = false;
  }

  protected override infix(): void {
    super.infix();
    // Runs even when Walker.infix handled a ledge, as in the original
    if (this.fl_jumper) {
      this.updateCoords();
      if (
        this.fl_jUp &&
        this.decideJumpUp() &&
        this.world.checkFlag(this.cx, this.cy, Data.IA_JUMP_UP)
      ) {
        this.jump(0, -Data.BAD_VJUMP_Y, Data.SECOND);
        this.fl_stopStepping = true;
      }
      if (
        this.fl_jDown &&
        this.decideJumpDown() &&
        this.world.checkFlag(this.cx, this.cy, Data.IA_JUMP_DOWN)
      ) {
        this.jump(0, -Data.BAD_VDJUMP_Y, Data.SECOND);
        this.fl_skipNextGround = true;
        this.fl_stopStepping = true;
      }
    }
  }
}

/**
 * Port of `entity.bad.Shooter` (`class/hammer/entity/bad/Shooter.mt`).
 */
export class ShooterBad extends JumperBad {
  fl_shooter = false;
  shootCD: number = Data.PEACE_COOLDOWN;
  shootDuration = 12;
  shootPreparation = 20;
  chanceShoot = 0;

  initShooter(prepa: number, duration: number): void {
    this.shootPreparation = prepa;
    this.shootDuration = duration;
  }

  enableShooter(): void {
    this.fl_shooter = true;
  }

  disableShooter(): void {
    this.fl_shooter = false;
  }

  setShoot(chance: number | null): void {
    if (chance === null) {
      this.fl_shooter = false;
    } else {
      this.fl_shooter = true;
      this.chanceShoot = chance * 10;
    }
  }

  override onNext(): void {
    const action = this.next?.action;
    super.onNext();
    if (action === Data.ACTION_SHOOT) {
      this.setNext(0, 0, this.shootDuration, Data.ACTION_WALK);
      this.halt();
      this.playAnim(Data.ANIM_BAD_SHOOT_END);
      this.onShoot();
    }
  }

  startShoot(): void {
    this.setNext(this.dx, this.dy, this.shootPreparation, Data.ACTION_SHOOT);
    this.halt();
    this.playAnim(Data.ANIM_BAD_SHOOT_START);
  }

  override onEndAnim(id: number): void {
    super.onEndAnim(id);
    if (id === Data.ANIM_BAD_SHOOT_START.id) {
      this.playAnim(Data.ANIM_BAD_SHOOT_LOOP);
    }
  }

  onShoot(): void {}

  override update(): void {
    if (this.shootCD > 0) this.shootCD -= 1;
    if (this.fl_shooter && this.shootCD <= 0) {
      if (this.isReady() && this.game.rand.random(1000) < this.chanceShoot) {
        this.startShoot();
      }
    }
    super.update();
  }
}

/**
 * Port of `entity.bad.Flyer` (`class/hammer/entity/bad/Flyer.mt`).
 */
export class FlyerBad extends BadEntity {
  xSpeed: number;
  ySpeed: number;
  fl_fly = false;
  speed = 4;
  override dir: number = this.game.rand.random(2) * 2 - 1;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.angerFactor = 0.5;
    this.xSpeed = Math.cos(Math.PI * 0.25) * this.speed;
    this.ySpeed = Math.sin(Math.PI * 0.25) * this.speed;
    this.fly();
  }

  fly(): void {
    if (!this.isHealthy()) return;
    this.playAnim(this.anger > 0 ? Data.ANIM_BAD_ANGER : Data.ANIM_BAD_WALK);
    this.dx = this.dir * this.xSpeed * this.speedFactor;
    this.dy = -this.ySpeed * this.speedFactor;
    this.fl_fly = true;
    this.fl_intercept = false;
    this.fl_gravity = false;
    this.fl_friction = false;
    this.fl_hitCeil = true;
  }

  land(): void {
    this.fl_fly = false;
    this.fl_gravity = true;
    this.fl_friction = true;
    this.fl_hitCeil = false;
  }

  override killHit(dx: number | null): void {
    super.killHit(dx);
    this.land();
  }

  protected override infix(): void {
    super.infix();
    if (this.fl_fly && this.y >= Data.GAME_HEIGHT) {
      this.y = Data.GAME_HEIGHT;
      this.dy = -this.ySpeed * this.speedFactor;
    }
  }

  protected override postfix(): void {
    super.postfix();
    if (this.fl_fly) {
      this.fl_friction = false;
    }
  }

  override playAnim(a: AnimDef): void {
    if (a.id !== Data.ANIM_BAD_JUMP.id) {
      super.playAnim(a);
    }
  }

  override updateSpeed(): void {
    super.updateSpeed();
    if (this.fl_fly) {
      this.dx = this.dir * this.xSpeed * this.speedFactor;
      this.dy = (this.dy < 0 ? -1 : 1) * this.ySpeed * this.speedFactor;
    }
  }

  override onNext(): void {
    if (!this.fl_fly) super.onNext();
  }

  override onHitGround(h: number): void {
    if (!this.fl_fly) {
      this.fl_intercept = false;
      super.onHitGround(h);
      return;
    }
    this.fl_stopStepping = true;
    this.dy = -this.ySpeed * this.speedFactor;
  }

  override onHitCeil(): void {
    if (!this.fl_fly) {
      super.onHitCeil();
      return;
    }
    this.fl_stopStepping = true;
    this.dy = this.ySpeed * this.speedFactor;
  }

  override onHitWall(): void {
    if (!this.fl_fly) {
      if (this.world.getCase(this.cx, this.cy) !== Data.WALL) {
        this.dx = -this.dx;
      }
      return;
    }
    this.fl_stopStepping = true;
    this.dir = -this.dir;
    this.dx = this.dir * this.xSpeed * this.speedFactor;
  }

  override onFreeze(): void {
    super.onFreeze();
    if (this.fl_fly) this.fl_intercept = true;
    this.land();
  }

  override onKnock(): void {
    super.onKnock();
    this.land();
  }

  override onMelt(): void {
    super.onMelt();
    this.fly();
  }

  override onWakeUp(): void {
    super.onWakeUp();
    this.fly();
  }

  override update(): void {
    super.update();
    if (this.fl_fly && this.dy < 0 && this.y <= Data.CASE_HEIGHT) {
      this.dy = Math.abs(this.dy);
    }
  }

  override endUpdate(): void {
    super.endUpdate();
    this.mc._xscale = this.dir * Math.abs(this.mc._xscale);
  }
}

/**
 * Port of `entity.bad.WallWalker` (`class/hammer/entity/bad/WallWalker.mt`).
 */
export class WallWalkerBad extends BadEntity {
  static readonly SUB_RECAL = 0.2;

  fl_wallWalk = false;
  fl_lost = false;
  cp = { x: 0, y: 1 };
  speed = 3;
  xSpeed = 0;
  ySpeed = 0;

  protected xSub = 0;
  protected ySub = 0;
  protected xSubBase = 0;
  protected ySubBase = 0;
  protected subOffset = 8;

  private lastSafe: {
    x: number;
    y: number;
    xSpeed: number;
    ySpeed: number;
    cp: { x: number; y: number };
  } | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.angerFactor = 0.4;
    this.fl_largeTrigger = true;
  }

  override initBad(x: number, y: number): void {
    super.initBad(x, y);
    this.xSub = this.sub?._x ?? 0;
    this.ySub = this.sub?._y ?? 0;
    this.xSubBase = this.xSub;
    this.ySubBase = this.ySub;
    this.wallWalk();
  }

  wallWalk(): void {
    if (!this.isHealthy() || !this.isReady()) return;
    this.fl_wallWalk = true;
    this.fl_gravity = false;
    this.fl_friction = false;
    this.fl_hitWall = false;
    this.fl_hitGround = false;
    this.fl_hitBorder = false;

    const choices = [
      { x: 1, y: 0, cpx: 0, cpy: 1 },
      { x: -1, y: 0, cpx: 0, cpy: 1 },
      { x: 1, y: 0, cpx: 0, cpy: -1 },
      { x: -1, y: 0, cpx: 0, cpy: -1 },
      { x: 0, y: 1, cpx: 1, cpy: 0 },
      { x: 0, y: -1, cpx: 1, cpy: 0 },
      { x: 0, y: 1, cpx: -1, cpy: 0 },
      { x: 0, y: -1, cpx: -1, cpy: 0 },
    ].filter(
      (ch) =>
        this.world.getCase(this.cx + ch.x, this.cy + ch.y) <= 0 &&
        this.world.getCase(this.cx + ch.cpx, this.cy + ch.cpy) > 0,
    );

    const choice = choices[this.game.rand.random(choices.length)];
    if (choice) {
      this.setDir(choice.x, choice.y);
      this.setCP(choice.cpx, choice.cpy);
      this.playAnim(Data.ANIM_BAD_WALK);
    } else {
      this.suicide();
    }
    this.fl_softRecal = false;
  }

  land(): void {
    this.fl_wallWalk = false;
    this.fl_gravity = true;
    this.fl_friction = true;
    this.fl_hitWall = true;
    this.fl_hitGround = true;
    this.fl_hitBorder = true;
  }

  setDir(xoff: number, yoff: number): void {
    this.xSpeed = this.speed * xoff;
    this.ySpeed = this.speed * yoff;
    this.updateSpeed();
    this.x = BaseEntity.x_ctr(this.cx);
    this.y = BaseEntity.y_ctr(this.cy);
    this.activateSoftRecal();
    this.setNext(this.dx, this.dy, 0, Data.ACTION_MOVE);
  }

  setCP(xoff: number, yoff: number): void {
    this.cp = { x: xoff, y: yoff };
  }

  override updateSpeed(): void {
    super.updateSpeed();
    if (this.fl_wallWalk && this.isReady()) {
      this.dx = this.xSpeed * this.speedFactor;
      this.dy = this.ySpeed * this.speedFactor;
    }
  }

  protected override infix(): void {
    super.infix();
    if (this.fl_wallWalk) {
      this.wallWalkIA();
    }
  }

  private wallWalkIA(): void {
    if (this.deathTimer > 0) return;

    let dirX = this.dx === 0 ? 0 : Math.sign(this.dx);
    let dirY = this.dy === 0 ? 0 : Math.sign(this.dy);

    if (this.cy === 0) {
      if (this.dy < 0) {
        this.setDir(-this.cp.x, 0);
        this.setCP(0, -1);
      } else if (this.world.getCase(this.cx + dirX, this.cy) > 0) {
        this.setDir(0, 1);
        this.setCP(dirX, 0);
      }
    } else if (this.world.getCase(this.cx + this.cp.x, this.cy + this.cp.y) <= 0) {
      const oldCp = this.cp;
      this.setDir(oldCp.x, oldCp.y);
      this.setCP(-dirX, -dirY);
    } else if (this.world.getCase(this.cx + dirX, this.cy + dirY) > 0) {
      const oldCp = this.cp;
      this.setDir(-oldCp.x, -oldCp.y);
      this.setCP(dirX, dirY);
    }

    let flDeadEnd = true;
    let tries = 0;
    while (flDeadEnd && tries < 4) {
      dirX = this.dx === 0 ? 0 : Math.sign(this.dx);
      dirY = this.dy === 0 ? 0 : Math.sign(this.dy);
      if (
        this.world.getCase(this.cx + dirX, this.cy + dirY) > 0 &&
        this.world.getCase(this.cx + this.cp.x, this.cy + this.cp.y) > 0
      ) {
        const oldCp = this.cp;
        this.setDir(-oldCp.x, -oldCp.y);
        this.setCP(dirX, dirY);
      } else {
        flDeadEnd = false;
      }
      tries++;
    }

    if (flDeadEnd && this.deathTimer <= 0) {
      this.suicide();
    }
  }

  override killHit(dx: number | null): void {
    super.killHit(dx);
    this.land();
    this.fl_hitGround = false;
    this.fl_hitWall = false;
  }

  suicide(): void {
    if (this.deathTimer > 0) return;
    this.dx = 0;
    this.dy = 0;
    this.land();
    this.fl_lost = true;
    this.deathTimer = Data.SECOND * 3;
  }

  moveToSafePos(): void {
    if (!this.lastSafe) return;
    if (this.x !== this.lastSafe.x || this.y !== this.lastSafe.y) {
      this.x = this.lastSafe.x;
      this.y = this.lastSafe.y;
      this.cp = { ...this.lastSafe.cp };
      this.xSpeed = this.lastSafe.xSpeed;
      this.ySpeed = this.lastSafe.ySpeed;
      this.updateCoords();
    }
  }

  override isReady(): boolean {
    return this.isHealthy() && !this.fl_lost;
  }

  override onFreeze(): void {
    super.onFreeze();
    if (this.fl_wallWalk) this.fl_intercept = true;
    this.land();
  }

  override onKnock(): void {
    super.onKnock();
    this.land();
  }

  override onMelt(): void {
    super.onMelt();
    this.wallWalk();
  }

  override onWakeUp(): void {
    super.onWakeUp();
    this.wallWalk();
  }

  override onHitWall(): void {
    if (!this.fl_wallWalk && this.world.getCase(this.cx, this.cy) !== Data.WALL) {
      this.dx = -this.dx;
    }
  }

  override onHitGround(h: number): void {
    super.onHitGround(h);
    this.fl_intercept = false;
    if (this.fl_lost) {
      this.fl_lost = false;
      this.deathTimer = 0;
      this.wallWalk();
    }
  }

  override endUpdate(): void {
    super.endUpdate();
    if (this.isHealthy()) {
      this.xSub = this.xSubBase + this.cp.x * this.subOffset;
      this.ySub =
        this.ySubBase + (this.cp.y > 0 ? this.subOffset * 0.5 : this.cp.y * this.subOffset);
    } else {
      this.xSub = this.xSubBase;
      this.ySub = this.fl_freeze ? this.ySubBase : this.ySubBase + this.subOffset * 0.5;
    }
    const s = this.sub;
    if (s) {
      s._x += WallWalkerBad.SUB_RECAL * (this.xSub - s._x) * this.speedFactor;
      s._y += WallWalkerBad.SUB_RECAL * (this.ySub - s._y) * this.speedFactor;
    }
  }

  override update(): void {
    const p = this.game.getOne(Data.PLAYER);
    this.realRadius = p && p.y > this.y ? Data.CASE_WIDTH * 1.4 : Data.CASE_WIDTH;

    super.update();

    if (
      this.lastSafe !== null &&
      this.world.getCase(
        BaseEntity.x_rtc(this.lastSafe.x) + this.lastSafe.cp.x,
        BaseEntity.y_rtc(this.lastSafe.y) + this.lastSafe.cp.y,
      ) <= 0
    ) {
      this.lastSafe = null;
      this.fl_gravity = true;
      this.fl_wallWalk = false;
      this.fl_hitGround = true;
      this.fl_friction = true;
      this.fl_lost = true;
    }

    if (this.world.getCase(this.cx + this.cp.x, this.cy + this.cp.y) > 0) {
      this.lastSafe = {
        x: this.x,
        y: this.y,
        xSpeed: this.xSpeed,
        ySpeed: this.ySpeed,
        cp: { x: this.cp.x, y: this.cp.y },
      };
    }
  }
}

/**
 * Port of `entity.bad.Spear` (`class/hammer/entity/bad/Spear.mt`).
 */
export class SpearBad extends BadEntity {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.disablePhysics();
    this.disableAnimator();
    this.realRadius = Data.CASE_WIDTH * 0.7;
    this.unregister(Data.BAD_CLEAR);
    this.register(Data.SPEAR);
  }

  override initBad(x: number, y: number): void {
    super.initBad(x, y);
    if (this.world.getCase(this.cx, this.cy + 1) > 0) {
      this.mc.gotoAndStop('1');
    } else if (this.world.getCase(this.cx, this.cy - 1) > 0) {
      this.mc.gotoAndStop('3');
    } else if (this.world.getCase(this.cx - 1, this.cy) > 0) {
      this.mc.gotoAndStop('2');
    } else if (this.world.getCase(this.cx + 1, this.cy) > 0) {
      this.mc.gotoAndStop('4');
    }

    const ss = this.game.getDynamicVar('$SPEAR_SKIN');
    this.sub?.gotoAndStop(ss ?? '1');
  }

  override freeze(_d: number): void {}
  override knock(_d: number): void {}
  override killHit(_dx: number | null): void {}
  override burn(): void {
    this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_pop');
  }

  override hit(e: BaseEntity): void {
    super.hit(e);
    if (e.isType(Data.BAD_CLEAR)) {
      const b = e as BadEntity;
      if (b.fl_physics && b.fl_trap) {
        b.killHit(null);
      }
    }
  }
}

/**
 * Port of `entity.bad.FireBall` (`class/hammer/entity/bad/FireBall.mt`):
 * the unstoppable Hurry-Up homing spirit!
 */
export class FireBallBad extends BadEntity {
  private ang = 270;
  private speed = 2.5;
  private angSpeed = 1.5;
  private angerTimer = 0;
  private summonTimer = 85;
  fl_summon = true;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.disableAnimator();
    this.fl_hitGround = false;
    this.fl_hitWall = false;
    this.fl_gravity = false;
    this.fl_hitBorder = false;
    this.fl_largeTrigger = true;
    this.fl_alphaBlink = true;
    this.blink(Data.BLINK_DURATION);

    this.angerFactor = 0.05;
    this.maxAnger = 9999;

    this.register(Data.HU_BAD);
    this.unregister(Data.BAD_CLEAR);
  }

  static attach(game: IGameContext, p: PlayerEntity): FireBallBad {
    const mc = game.depthMan.attach(Data.BAD_LINKAGES[Data.BAD_FIREBALL], Data.DP_BADS);
    const fb = new FireBallBad(game, mc);
    fb.badId = Data.BAD_FIREBALL;
    const n = game.countList(Data.PLAYER);
    const offs = n === 1 ? 0 : -30 + p.pid * 60;
    fb.initBad(Data.GAME_WIDTH * 0.5 + offs, Data.GAME_HEIGHT + 10);
    fb.hate(p);
    return fb;
  }

  override playAnim(_o: AnimDef): void {}
  override freeze(_d: number): void {}
  override knock(_d: number): void {}
  override killHit(_dx: number | null): void {}
  override onHurryUp(): void {}
  override onDeathLine(): void {}

  override angerMore(): void {
    super.angerMore();
    this.angSpeed *= 1.15;
  }

  override endUpdate(): void {
    super.endUpdate();
    const body = this.mc.getClip('body');
    if (body) body.rotationDeg = this.ang;
    const eyes = this.mc.getClip('eyes');
    if (eyes && eyes._totalframes > 0) {
      const f = Math.round((this.ang / 360) * eyes._totalframes) + 1; // past the end: last frame
      eyes.gotoAndStop(String(f));
    }
  }

  override hit(e: BaseEntity): void {
    if (this.fl_summon) return;
    if (e.isType(Data.PLAYER)) {
      const et = e as PlayerEntity;
      if (et.animId !== Data.ANIM_PLAYER_DIE.id) {
        et.fl_shield = false;
        et.killHit(this.dx);
      }
    }
    if (e.isType(Data.BOMB)) {
      const b = e as BombEntity;
      if (!b.fl_kill && !b.fl_explode) {
        b.onExplode();
      }
    }
  }

  override update(): void {
    if (this.fl_summon) {
      this.summonTimer -= 1;
      if (this.summonTimer <= 0) {
        this.fl_summon = false;
        this.stopBlink();
      }
    }

    if (!this.player || this.player.fl_kill || this.player.fl_destroy) {
      this.game.fxMan.attachShine(this.x, this.y);
      this.game.fxMan.attachExplodeZone(this.x, this.y, 4 * Data.CASE_WIDTH);
      this.game.shake(Data.SECOND, 5);
      this.destroy();
      return;
    }

    this.angerTimer += this.game.diffFactor;
    if (this.angerTimer >= Data.AUTO_ANGER) {
      this.angerTimer = 0;
      this.angerMore();
    }

    let tang = adjustAngle(
      (Math.atan2(this.player.y - this.y, this.player.x - this.x) * 180) / Math.PI,
    );
    if (this.ang - tang > 180) this.ang -= 360;
    if (tang - this.ang > 180) this.ang += 360;

    if (this.ang < tang) {
      this.ang += this.angSpeed * this.speedFactor;
      if (this.ang > tang) this.ang = tang;
    } else if (this.ang > tang) {
      this.ang -= this.angSpeed * this.speedFactor;
      if (this.ang < tang) this.ang = tang;
    }

    this.ang = adjustAngle(this.ang);
    this.moveToAng(this.ang, this.speed * this.speedFactor);

    super.update();
  }
}

// ============================================================ Species Classes

class PommeBad extends ShooterBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpUp(3);
    this.setJumpH(100);
    this.setClimb(100, 1);
    this.setFall(20);
    this.setShoot(2);
    this.initShooter(20, 12);
  }

  override onShoot(): void {
    const s = PepinShoot.attach(this.game, this.x, this.y);
    if (this.dir < 0) s.moveLeft(s.shootSpeed);
    else s.moveRight(s.shootSpeed);
  }
}

class CeriseBad extends WalkerBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.animFactor = 0.65;
  }
}

class BananeBad extends JumperBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpUp(5);
    this.setJumpDown(5);
    this.setJumpH(100);
    this.setClimb(100, Data.IA_CLIMB);
    this.setFall(5);
  }
}

class AnanasBad extends JumperBad {
  static readonly CHANCE_DASH = 6;
  fl_attack = false;
  dashRadius: number;
  dashPower = 30;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpH(100);
    this.speed *= 0.8;
    this.dashRadius = game.fl_bombExpert ? 200 : 100;
    this.slideFriction = 0.9;
    this.shockResistance = 2.0;
  }

  override freeze(d: number): void {
    super.freeze(d);
    this.fallFactor *= 1.5;
    this.fl_attack = false;
    this.unstick();
  }

  override knock(d: number): void {
    super.knock(d);
    this.fallFactor *= 1.5;
    this.fl_attack = false;
    this.unstick();
  }

  override killHit(dx: number | null): void {
    super.killHit(dx);
    this.fl_attack = false;
  }

  override isReady(): boolean {
    return !this.fl_attack && super.isReady();
  }

  private repel(type: number, powerFactor: number): void {
    const l = this.game.getClose(type, this.x, this.y, this.dashRadius, false) as PhysicsEntity[];
    for (const e of l) {
      this.shockWave(e, this.dashRadius, this.dashPower * powerFactor);
      e.dy -= 8;
      if (e.isType(Data.PLAYER)) {
        (e as PlayerEntity).knock(Data.SECOND * 1.5);
      }
    }
  }

  private vaporize(type: number): void {
    const l = this.game.getClose(type, this.x, this.y, this.dashRadius, false);
    for (const e of l) {
      this.game.fxMan.attachFx(e.x, e.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
      e.destroy();
    }
  }

  private startAttack(): void {
    const pl = this.game.getList(Data.PLAYER) as PlayerEntity[];
    if (pl.every((p) => p.fl_knock)) return;
    this.halt();
    this.playAnim(Data.ANIM_BAD_THINK);
    this.fl_loop = true;
    this.setNext(0, -10, Data.SECOND * 0.9, Data.ACTION_MOVE);
    this.fl_attack = true;
    const mc = this.game.depthMan.attach('curse', Data.DP_FX);
    mc.gotoAndStop(String(Data.CURSE_TAUNT));
    this.stick(mc, 0, -Data.CASE_HEIGHT * 2.5);
  }

  private attack(): void {
    const fx = this.game.fxMan.attachExplodeZone(this.x, this.y, this.dashRadius);
    if (fx) fx.mc._alpha = 20;
    this.game.shake(Data.SECOND * 0.5, 5);

    const pl = this.game.getList(Data.PLAYER) as PlayerEntity[];
    for (const p of pl) {
      if (p.fl_stable) {
        if (p.fl_shield) p.dy = -8;
        else p.knock(Data.PLAYER_KNOCK_DURATION);
      }
    }

    this.repel(Data.BOMB, 1);
    this.repel(Data.PLAYER, 2);
    this.vaporize(Data.PLAYER_SHOOT);

    this.fl_attack = false;
    this.unstick();
  }

  override onHitGround(h: number): void {
    super.onHitGround(h);
    if (this.fl_attack && this.isHealthy()) {
      this.attack();
      this.playAnim(Data.ANIM_BAD_SHOOT_END);
      this.halt();
    } else {
      this.game.shake(Data.SECOND * 0.2, 2);
    }
  }

  override onHitWall(): void {
    if (!this.isHealthy()) this.game.shake(5, 3);
    super.onHitWall();
  }

  override onEndAnim(id: number): void {
    super.onEndAnim(id);
    if (id === Data.ANIM_BAD_SHOOT_END.id) {
      this.walk();
    }
  }

  protected override prefix(): void {
    if (this.isReady()) {
      if (this.fl_playerClose && this.game.rand.random(1000) <= AnanasBad.CHANCE_DASH * 2) {
        this.startAttack();
      }
      if (!this.fl_playerClose && this.game.rand.random(1000) <= AnanasBad.CHANCE_DASH) {
        this.startAttack();
      }
    }
    super.prefix();
  }
}

class AbricotBad extends JumperBad {
  readonly fl_spawner: boolean;

  constructor(game: IGameContext, mc: SwfMovieClip, spawner: boolean) {
    super(game, mc);
    this.fl_spawner = spawner;
    this.animFactor = 0.65;
    this.setJumpUp(5);
    this.setJumpH(100);
    this.setClimb(100, 3);
    this.setFall(20);
    this.dir = -1;
    if (!spawner) {
      this.scale(75);
    }
  }

  override onDeathLine(): void {
    if (this.fl_spawner) {
      this.game.attachBad(Data.BAD_ABRICOT2, this.x - Data.CASE_WIDTH, -30);
      this.game.attachBad(Data.BAD_ABRICOT2, this.x + Data.CASE_WIDTH, -30);
    }
    super.onDeathLine();
  }
}

class PoireBad extends ShooterBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpH(100);
    this.setClimb(100, 1);
    this.setShoot(4);
    this.initShooter(50, 8);
  }

  override onShoot(): void {
    const s = PoireBomb.attach(this.game, this.x, this.y);
    const spd = 10;
    s.moveToAng(this.dir < 0 ? -135 : -45, spd);
    this.setNext(0, 0, this.shootDuration, Data.ACTION_FALLBACK);
  }
}

class BombeBad extends JumperBad {
  readonly radius: number;
  readonly power = 30;
  fl_overheat = false;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpUp(10);
    this.setJumpDown(6);
    this.setJumpH(100);
    this.setClimb(100, 3);
    this.fl_alphaBlink = false;
    this.blinkColor = 0xff9e5e;
    this.blinkColorAlpha = 50;
    this.radius = game.fl_bombExpert ? Data.CASE_WIDTH * 8 : Data.CASE_WIDTH * 5;
  }

  override playAnim(obj: AnimDef): void {
    if (this.fl_overheat) return;
    super.playAnim(obj);
    if (obj.id === Data.ANIM_BAD_THINK.id) this.fl_loop = true;
    if (obj.id === Data.ANIM_BAD_JUMP.id) this.fl_loop = false;
  }

  private trigger(): void {
    if (this.fl_overheat) return;
    this.halt();
    this.playAnim(Data.ANIM_BAD_DIE);
    this.fl_loop = false;
    this.fl_freeze = false;
    // The original computes an unused random duration here
    void (
      Data.SECOND *
      (0.25 + (this.game.rand.random(10) / 100) * (this.game.rand.random(2) * 2 - 1))
    );
    this.setLifeTimer(Data.SECOND * 3);
    this.updateLifeTimer(Data.SECOND);
    this.setNext(0, 0, Data.SECOND * 3, Data.ACTION_WALK);
    this.fl_overheat = true;
  }

  private selfDestruct(): void {
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
    this.game.audio.playSound('sound_bomb_black', Data.CHAN_BOMB);
    this.dropReward();
    this.game.fxMan.inGameParticles(0, this.x, this.y, this.game.rand.random(4) + 5);
    this.onKill();
    this.destroy();
  }

  override killHit(_dx: number | null): void {
    this.trigger();
  }

  override onFreeze(): void {
    this.trigger();
  }

  override isHealthy(): boolean {
    return !this.fl_overheat && super.isHealthy();
  }

  override onLifeTimer(): void {
    this.selfDestruct();
  }

  protected override prefix(): void {
    if (!this.fl_stable && this.fl_overheat) {
      this.dx = 0;
    }
    super.prefix();
  }
}

class OrangeBad extends JumperBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpH(100);
  }
}

class FraiseBad extends ShooterBad {
  fl_ball = false;
  private ballTarget: BaseEntity | null = null;
  private catchCD = 0;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setShoot(4);
    this.initShooter(0, 10);

    const existingCatchers = game.getList(Data.CATCHER) as FraiseBad[];
    const someoneHasBall = existingCatchers.some((b) => b.fl_ball) || game.countList(Data.BALL) > 0;
    if (!someoneHasBall) {
      this.assignBall();
    }
    this.register(Data.CATCHER);
  }

  assignBall(): void {
    this.fl_ball = true;
    this.catchCD = Data.SECOND * 1.5;
  }

  override onShoot(): void {
    super.onShoot();
    if (!this.ballTarget) return;
    this.fl_ball = false;

    if (this.ballTarget.isType(Data.BAD)) {
      const bad = this.ballTarget as WalkerBad;
      bad.setNext(0, 0, Data.BALL_TIMEOUT + 5, Data.ACTION_WALK);
      bad.halt();
      bad.playAnim(Data.ANIM_BAD_THINK);
    }

    const s = BallShoot.attach(this.game, this.x, this.y);
    s.moveToTarget(this.ballTarget, s.shootSpeed);
    s.targetCatcher = this.ballTarget;
  }

  /** The ball reached this Fraise. */
  catchBall(b: BallShoot): void {
    if (!this.isHealthy()) return;
    this.next = null;
    this.walk();
    this.assignBall();
    b.destroy();
    this.ballTarget = null;
  }

  override onEndAnim(id: number): void {
    super.onEndAnim(id);
    this.ballTarget = null;
  }

  override startShoot(): void {
    if (!this.fl_ball || this.catchCD > 0) return;

    // Draw catchers at random until one is ready, as the original does
    const l = [...this.game.getList(Data.CATCHER)] as WalkerBad[];
    let bad: WalkerBad | undefined;
    do {
      const i = this.game.rand.random(l.length);
      bad = l[i];
      l.splice(i, 1);
    } while (bad !== undefined && (bad === this || !bad.isReady()));
    if (bad !== undefined) {
      this.ballTarget = bad;
    } else if (this.game.countList(Data.CATCHER) === 1) {
      this.ballTarget = this.game.getOne(Data.PLAYER);
      if (!this.ballTarget) return;
    } else {
      return;
    }
    super.startShoot();
  }

  override destroy(): void {
    if (this.fl_ball) {
      const other = this.game.getAnotherOne(Data.CATCHER, this) as FraiseBad | null;
      other?.assignBall();
    }
    super.destroy();
  }

  override endUpdate(): void {
    super.endUpdate();
    const balle = this.sub?.getClip('balle');
    if (balle) balle._visible = this.fl_ball;

    if (this.dx === 0 && this.ballTarget && !this.ballTarget.fl_destroy) {
      if (this.ballTarget.x > this.x) this.mc._xscale = Math.abs(this.mc._xscale);
      if (this.ballTarget.x < this.x) this.mc._xscale = -Math.abs(this.mc._xscale);
    }
  }

  override update(): void {
    super.update();
    if (this.catchCD > 0) this.catchCD = Math.max(0, this.catchCD - 1);

    if (this.game.countList(Data.BALL) === 0) {
      const catchers = this.game.getList(Data.CATCHER) as FraiseBad[];
      if (catchers.length > 0 && !catchers.some((c) => c.fl_ball)) {
        this.assignBall();
      }
    }
  }
}

class CitronBad extends ShooterBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpH(50);
    this.setShoot(3);
    this.initShooter(50, 20);
  }

  override onShoot(): void {
    const s = ZesteShoot.attach(this.game, this.x, this.y);
    const target = this.game.getOne(Data.PLAYER);
    if (target && target.y < this.y) s.moveUp(s.shootSpeed);
    else s.moveDown(s.shootSpeed);
  }
}

class TzongreBad extends FlyerBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.unregister(Data.BAD_CLEAR);
    this.setLifeTimer(Data.SECOND * 60);
  }

  override freeze(_d: number): void {}
  override knock(_d: number): void {}
  override killHit(_dx: number | null): void {}

  override hit(e: BaseEntity): void {
    if (e.isType(Data.PLAYER)) {
      const et = e as PlayerEntity;
      this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT, 'hammer_fx_shine');
      et.getScore(this, 50000);
      this.destroy();
    } else if (e.isType(Data.BAD)) {
      (e as BadEntity).knock(Data.KNOCK_DURATION);
    }
  }
}

class CrawlerBad extends WallWalkerBad {
  static readonly SCALE_RECAL = 0.2;
  static readonly CRAWL_STRETCH = 1.8;
  static readonly COLOR = 0xff9146;
  static readonly COLOR_ALPHA = 40;
  static readonly SHOOT_SPEED = 6;
  static readonly CHANCE_ATTACK = 10;
  static readonly COOLDOWN = Data.SECOND * 2;
  static readonly ATTACK_TIMER = Data.SECOND * 0.5;

  private fl_attack = false;
  private attackCD: number = Data.PEACE_COOLDOWN;
  private attackTimer = 0;
  private colorAlpha = 0;
  private blobCpt = 0;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.speed = 2;
    this.angerFactor = 0.5;
  }

  override initBad(x: number, y: number): void {
    super.initBad(x, y);
    this.scale(90);
  }

  override killHit(dx: number | null): void {
    super.killHit(dx);
    this.fl_attack = false;
  }

  override isReady(): boolean {
    return super.isReady() && !this.fl_attack;
  }

  private prepareAttack(): void {
    this.dx = 0;
    this.dy = 0;
    this.fl_attack = true;
    this.fl_wallWalk = false;
    this.attackTimer = CrawlerBad.ATTACK_TIMER;
    this.playAnim(Data.ANIM_BAD_SHOOT_START);
  }

  private attack(): void {
    const s = EnemyFireBallShoot.attach(this.game, this.x, this.y);
    s.moveTo(this.x, this.y);
    s.dx = -this.cp.x * CrawlerBad.SHOOT_SPEED;
    s.dy = -this.cp.y * CrawlerBad.SHOOT_SPEED;
    s.scale(70);
    this.game.fxMan.attachExplosion(this.x, this.y, 20);

    if (this.sub) {
      this.sub._xscale = 150 + Math.abs(this.cp.x) * 150;
      this.sub._yscale = 150 + Math.abs(this.cp.y) * 150;
    }
    this.colorAlpha = CrawlerBad.COLOR_ALPHA;
    this.mc.setColorHex(Math.round(this.colorAlpha), CrawlerBad.COLOR);

    this.attackCD = CrawlerBad.COOLDOWN;
    this.playAnim(Data.ANIM_BAD_SHOOT_END);
  }

  private decideAttack(): boolean {
    if (this.fl_attack || !this.player) return false;
    let inSight = false;
    let factor = 1.0;

    if (this.cp.y !== 0 && Math.abs(this.player.x - this.x) <= Data.CASE_WIDTH * 2) {
      if ((this.cp.y > 0 && this.player.y < this.y) || (this.cp.y < 0 && this.player.y > this.y)) {
        inSight = true;
      }
    }
    if (this.cp.x !== 0 && Math.abs(this.player.y - this.y) <= Data.CASE_HEIGHT * 2) {
      if ((this.cp.x > 0 && this.player.x < this.x) || (this.cp.x < 0 && this.player.x > this.x)) {
        inSight = true;
      }
    }

    if (inSight) {
      this.attackCD -= 4;
      factor = 8;
    }

    return (
      this.isReady() &&
      this.isHealthy() &&
      this.attackCD <= 0 &&
      this.game.rand.random(1000) < CrawlerBad.CHANCE_ATTACK * factor
    );
  }

  override onEndAnim(id: number): void {
    super.onEndAnim(id);
    if (id === Data.ANIM_BAD_SHOOT_END.id) {
      this.fl_attack = false;
      this.fl_wallWalk = true;
      this.moveToSafePos();
      this.updateSpeed();
      if (this.dx === 0 && this.dy === 0) {
        this.wallWalk();
      }
    }
  }

  override onFreeze(): void {
    super.onFreeze();
    this.fl_attack = false;
  }

  override onKnock(): void {
    super.onKnock();
    this.fl_attack = false;
  }

  override endUpdate(): void {
    super.endUpdate();
    let xscale = this.scaleFactor * 100;
    let yscale = this.scaleFactor * 100;

    if (this.fl_attack) {
      this.mc._x += (this.game.rand.random(15) / 10) * (this.game.rand.random(2) * 2 - 1);
      this.mc._y += (this.game.rand.random(15) / 10) * (this.game.rand.random(2) * 2 - 1);
      xscale += this.game.rand.random(20) * (this.game.rand.random(2) * 2 - 1);
      yscale += this.game.rand.random(20) * (this.game.rand.random(2) * 2 - 1);
    }

    if (this.fl_wallWalk) {
      if (this.dx !== 0) xscale = 100 * this.scaleFactor * CrawlerBad.CRAWL_STRETCH;
      if (this.dy !== 0) yscale = 100 * this.scaleFactor * CrawlerBad.CRAWL_STRETCH;
    }

    if (this.isHealthy()) {
      xscale += 10 * Math.sin(this.blobCpt);
      yscale += 10 * Math.cos(this.blobCpt);
      this.blobCpt += 0.1;
    }

    if (this.sub) {
      this.sub._xscale += CrawlerBad.SCALE_RECAL * (xscale - this.sub._xscale);
      this.sub._yscale += CrawlerBad.SCALE_RECAL * (yscale - this.sub._yscale);
    }

    if (this.colorAlpha > 0) {
      this.colorAlpha -= 3;
      if (this.colorAlpha <= 0) this.mc.resetColor();
      else this.mc.setColorHex(Math.round(this.colorAlpha), CrawlerBad.COLOR);
    }
  }

  override update(): void {
    if (this.fl_attack) {
      this.dx = 0;
      this.dy = 0;
    }
    super.update();
    if (this.attackCD > 0) this.attackCD -= 1;

    if (this.decideAttack() && this.world.getCase(this.cx + this.cp.x, this.cy + this.cp.y) > 0) {
      this.prepareAttack();
    }

    if (this.fl_attack && this.attackTimer > 0) {
      this.attackTimer -= 1;
      if (this.attackTimer <= 0) {
        this.attack();
      }
    }
  }
}

class SawBad extends WallWalkerBad {
  static readonly ROTATION_RECAL = 0.3;
  static readonly STUN_DURATION = Data.SECOND * 3;
  static readonly BASE_SPEED = 3;
  static readonly ROTATION_SPEED = 10;

  private fl_stun = false;
  private fl_stop = false;
  private fl_updateSpeed = false;
  private stunTimer = 0;
  private rotSpeed = 0;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.speed = SawBad.BASE_SPEED;
    this.angerFactor = 0;
    this.subOffset = 2;
    this.unregister(Data.BAD_CLEAR);
  }

  override initBad(x: number, y: number): void {
    super.initBad(x, y);
    this.scale(80);
  }

  private stun(): void {
    if (this.fl_stop) return;
    this.game.fxMan.attachExplosion(this.x, this.y - Data.CASE_HEIGHT * 0.5, 30);
    this.fl_stun = true;
    this.fl_wallWalk = false;
    this.stunTimer = SawBad.STUN_DURATION;
    this.dx = 0;
    this.dy = 0;
  }

  private haltSaw(): void {
    if (this.fl_stop) return;
    this.fl_stop = true;
    this.fl_wallWalk = false;
    this.dx = 0;
    this.dy = 0;
  }

  private runSaw(): void {
    if (!this.fl_stop) return;
    this.fl_stop = false;
    this.fl_wallWalk = true;
    this.updateSpeed();
  }

  override isHealthy(): boolean {
    return !this.fl_kill && !this.fl_stun && !this.fl_stop;
  }

  override hit(e: BaseEntity): void {
    super.hit(e);
    if (this.isHealthy() && e.isType(Data.BOMB) && !e.isType(Data.BAD_BOMB)) {
      const b = e as BombEntity;
      b.setLifeTimer(Data.SECOND * 0.6);
      b.dx = this.dx !== 0 ? -this.dx : -this.cp.x * 4;
      b.dy = this.cp.y !== 0 ? -this.cp.y * 13 : -8;
    }
  }

  override land(): void {}
  override killHit(_dx: number | null): void {
    this.stun();
  }
  override knock(_d: number): void {
    this.stun();
  }
  override freeze(_d: number): void {
    this.stun();
  }

  override onWakeUp(): void {
    this.fl_wallWalk = true;
    this.moveToSafePos();
    this.updateSpeed();
  }

  override endUpdate(): void {
    super.endUpdate();
    if (this.fl_stun) {
      const f = 1 - this.stunTimer / SawBad.STUN_DURATION;
      this.mc._x =
        this.x + f * (this.game.rand.random(20) / 10) * (this.game.rand.random(2) * 2 - 1);
      this.mc._y =
        this.y + f * (this.game.rand.random(20) / 10) * (this.game.rand.random(2) * 2 - 1);
    }
    const s = this.sub;
    if (s) {
      if (this.fl_wallWalk || this.fl_stop) {
        const angDeg = (180 * Math.atan2(this.cp.y, this.cp.x)) / Math.PI - 90;
        let delta = angDeg - s.rotationDeg;
        if (delta < -180) delta += 360;
        if (delta > 180) delta -= 360;
        s.rotationDeg += delta * SawBad.ROTATION_RECAL;
      } else if (this.fl_kill) {
        s.rotationDeg += 14.5;
      } else if (this.isHealthy()) {
        s.rotationDeg += (0 - s.rotationDeg) * (SawBad.ROTATION_RECAL * 0.25);
      }

      if (this.fl_stop || this.fl_stun) {
        this.rotSpeed *= 0.9;
      } else {
        this.rotSpeed = Math.min(SawBad.ROTATION_SPEED, this.rotSpeed + 1);
      }
      const blade = s.getClip('sub');
      if (blade) blade.rotationDeg += this.rotSpeed;
    }
  }

  override update(): void {
    const rawSp = this.game.getDynamicVar('$SAW_SPEED');
    const dynSp = rawSp !== undefined ? Number(rawSp) : NaN;
    const old = this.speed;
    if (Number.isNaN(dynSp) || dynSp < 0) {
      this.speed = SawBad.BASE_SPEED;
      this.runSaw();
    } else if (dynSp === 0) {
      this.haltSaw();
    } else {
      this.speed = dynSp;
      this.runSaw();
    }
    if (old !== this.speed) this.fl_updateSpeed = true;
    if (this.fl_updateSpeed && this.isHealthy()) {
      this.fl_updateSpeed = false;
      this.updateSpeed();
    }

    if (this.fl_stop || this.fl_stun) {
      this.dx = 0;
      this.dy = 0;
    }

    if (this.fl_stun) {
      this.stunTimer -= 1;
      if (this.stunTimer <= 0) {
        this.fl_stun = false;
        this.onWakeUp();
      }
    }
    super.update();
  }
}

class LitchiWeakBad extends JumperBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpH(100);
    this.setJumpUp(10);
    this.setJumpDown(6);
    this.setClimb(25, 3);
    this.setFall(25);
  }

  override onEndAnim(id: number): void {
    super.onEndAnim(id);
    if (id === Data.ANIM_BAD_SHOOT_START.id) {
      this.playAnim(Data.ANIM_BAD_WALK);
      this.walk();
    }
  }

  override walk(): void {
    if (this.animId !== Data.ANIM_BAD_SHOOT_START.id) {
      super.walk();
    }
  }
}

class LitchiBad extends JumperBad {
  private child: LitchiWeakBad | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.speed *= 0.8;
    this.setJumpH(100);
    this.setJumpUp(10);
    this.setJumpDown(6);
    this.setClimb(25, 3);
    this.setFall(25);
  }

  override freeze(_d: number): void {
    this.weaken();
  }

  override killHit(_dx: number | null): void {
    if (!this.fl_knock) {
      this.knock(Data.KNOCK_DURATION);
    }
  }

  override forceKill(dx: number | null): void {
    super.killHit(dx);
  }

  private weaken(): void {
    if (this.child) return;
    const mc = this.game.depthMan.attach(Data.BAD_LINKAGES[Data.BAD_LITCHI_WEAK], Data.DP_BADS);
    const child = new LitchiWeakBad(this.game, mc);
    child.badId = Data.BAD_LITCHI_WEAK;
    child.initBad(this.x, this.y - Data.CASE_HEIGHT);
    child.angerMore();
    child.updateSpeed();
    child.halt();
    child.dir = this.dir;
    child.fl_ninFoe = this.fl_ninFoe;
    child.fl_ninFriend = this.fl_ninFriend;
    this.game.fxMan.inGameParticles(0, this.x, this.y - 10, 6);
    child.playAnim(Data.ANIM_BAD_SHOOT_START);
    this.child = child;
  }

  override update(): void {
    super.update();
    if (!this.fl_kill && this.fl_knock && !this.child && this.dy <= -Data.BAD_VJUMP_Y * 0.6) {
      this.dy = -Data.BAD_VJUMP_Y * 0.6;
    }
  }

  override endUpdate(): void {
    if (this.child) {
      this.child.dy = -7;
      this.destroy();
    } else {
      super.endUpdate();
    }
  }
}

class KiwiBad extends ShooterBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpUp(10);
    this.setJumpDown(20);
    this.setJumpH(50);
    this.setClimb(100, 3);
    this.setShoot(3);
    this.initShooter(Data.SECOND, Data.SECOND * 0.6);
    this.speed *= 0.7;
    this.angerFactor *= 2.5;
    this.calcSpeed();
    this.shootCD = 0;
  }

  override onShoot(): void {
    MineBomb.attach(this.game, this.x + this.dir * Data.CASE_WIDTH * 1.1, this.y);
  }
}

class FramboiseBad extends ShooterBad {
  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.setJumpUp(3);
    this.setJumpDown(6);
    this.setJumpH(100);
    this.setClimb(100, 3);
    this.setFall(20);
    this.setShoot(0.7);
    this.initShooter(20, 12);
  }

  override onShoot(): void {
    let tries = 0;
    let ctx = this.cx;
    let cty = this.cy;
    let invalid = true;
    while (tries < 600 && invalid) {
      invalid = false;
      ctx = this.game.rand.random(Data.LEVEL_WIDTH);
      cty = this.game.rand.random(Data.LEVEL_HEIGHT);
      tries++;
      if (this.distanceCase(ctx, cty) <= 7) invalid = true;
      if (!this.world.checkFlag(ctx, cty, Data.IA_TILE_TOP)) invalid = true;
      if (this.world.checkFlag(ctx, cty, Data.IA_SMALL_SPOT)) invalid = true;
      if (this.game.getListAt(Data.SPEAR, ctx, cty).length > 0) invalid = true;
    }
    if (invalid) return;

    this.game.fxMan.attachExplosion(this.x, this.y, 40);
    this.game.fxMan.inGameParticles(0, this.x, this.y, 4);
    this.moveTo(BaseEntity.x_ctr(ctx), BaseEntity.y_ctr(cty));
    this.game.fxMan.attachExplosion(this.x, this.y, 40);
    this.shootCD = Data.SECOND * 1.5;
  }

  override update(): void {
    const bombs = this.game.getClose(Data.PLAYER_BOMB, this.x, this.y, 90, false);
    if (this.isReady() && this.shootCD <= 0 && bombs.length >= 1) {
      this.startShoot();
    }
    super.update();
  }
}

/**
 * Factory creating any of the 21 Hammerfest enemy species (`Data.BAD_POMME` .. `Data.BAD_FRAMBOISE`).
 */
export function createBad(game: IGameContext, id: number, x: number, y: number): BadEntity {
  const safeId = id >= 0 && id < Data.BAD_LINKAGES.length ? id : Data.BAD_POMME;
  const link = Data.BAD_LINKAGES[safeId];
  const plane = safeId === Data.BAD_SPEAR ? Data.DP_SPEAR : Data.DP_BADS;
  const mc = game.depthMan.attach(link, plane);

  let bad: BadEntity;
  switch (safeId) {
    case Data.BAD_POMME:
      bad = new PommeBad(game, mc);
      break;
    case Data.BAD_CERISE:
      bad = new CeriseBad(game, mc);
      break;
    case Data.BAD_BANANE:
      bad = new BananeBad(game, mc);
      break;
    case Data.BAD_FIREBALL:
      bad = new FireBallBad(game, mc);
      break;
    case Data.BAD_ANANAS:
      bad = new AnanasBad(game, mc);
      break;
    case Data.BAD_ABRICOT:
      bad = new AbricotBad(game, mc, true);
      break;
    case Data.BAD_ABRICOT2:
      bad = new AbricotBad(game, mc, false);
      break;
    case Data.BAD_POIRE:
      bad = new PoireBad(game, mc);
      break;
    case Data.BAD_BOMBE:
      bad = new BombeBad(game, mc);
      break;
    case Data.BAD_ORANGE:
      bad = new OrangeBad(game, mc);
      break;
    case Data.BAD_FRAISE:
      bad = new FraiseBad(game, mc);
      break;
    case Data.BAD_CITRON:
      bad = new CitronBad(game, mc);
      break;
    case Data.BAD_BALEINE:
      bad = new FlyerBad(game, mc);
      break;
    case Data.BAD_SPEAR:
      bad = new SpearBad(game, mc);
      break;
    case Data.BAD_CRAWLER:
      bad = new CrawlerBad(game, mc);
      break;
    case Data.BAD_TZONGRE:
      bad = new TzongreBad(game, mc);
      break;
    case Data.BAD_SAW:
      bad = new SawBad(game, mc);
      break;
    case Data.BAD_LITCHI:
      bad = new LitchiBad(game, mc);
      break;
    case Data.BAD_KIWI:
      bad = new KiwiBad(game, mc);
      break;
    case Data.BAD_LITCHI_WEAK:
      bad = new LitchiWeakBad(game, mc);
      break;
    case Data.BAD_FRAMBOISE:
      bad = new FramboiseBad(game, mc);
      break;
    default:
      bad = new PommeBad(game, mc);
      break;
  }

  bad.badId = safeId;
  bad.initBad(x, y);
  return bad;
}
