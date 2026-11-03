import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { type AnimDef, Data } from '../Data';
import type { IGameContext } from '../GameContext';
import type { LevelWorld, TeleporterData } from '../levels/LevelWorld';

export interface NextMove {
  dx: number;
  dy: number;
  delay: number;
  action: number;
}

/**
 * Port of `Entity` + `entity.Trigger` (`class/hammer/Entity.mt`, `class/hammer/entity/Trigger.mt`).
 *
 * Wraps an `SwfMovieClip` instance and maintains both real playfield coordinates
 * (`x` in `0..400`, `y` in `0..500`) and grid cell coordinates (`cx`, `cy`, `fcx`, `fcy`),
 * plus spatial trigger registration in `world.triggers[cx][cy]`.
 */
export class BaseEntity {
  readonly game: IGameContext;
  readonly mc: SwfMovieClip;
  world: LevelWorld;

  x = 0;
  y = 0;
  oldX = 0;
  oldY = 0;
  cx = 0;
  cy = 0;
  fcx = 0;
  fcy = 0;

  _xOffset = 0;
  _yOffset = 0;
  rotation = 0;
  alpha = 100;
  minAlpha = 35;
  scaleFactor = 1.0;

  types = 0;
  scriptId: number | null = null;
  uniqId: number;
  parent: BaseEntity | null = null;

  lifeTimer = -1;
  totalLife: number | null = null;

  fl_kill = false;
  fl_destroy = false;
  fl_largeTrigger = false;

  private sticker: SwfMovieClip | null = null;
  private stickerX = 0;
  private stickerY = 0;
  private elaStickFactor = 1;
  private stickTimer = 0;
  private fl_stick = false;
  private fl_elastick = false;
  dir = 1;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    this.game = game;
    this.mc = mc;
    // In the original the entity is its MovieClip: frame scripts read its fields.
    mc.scriptHost = this;
    this.world = game.world;
    this.uniqId = game.getUniqId();
    this.register(Data.ENTITY);
    this.scale(100);
    this.updateCoords();
  }

  // ------------------------------------------------ Static coordinate helpers

  static x_rtc(n: number): number {
    return Math.floor(n / Data.CASE_WIDTH);
  }

  static y_rtc(n: number): number {
    return Math.floor((n - Data.CASE_HEIGHT * 0.5) / Data.CASE_HEIGHT);
  }

  static rtc(x: number, y: number): { x: number; y: number } {
    return { x: BaseEntity.x_rtc(x), y: BaseEntity.y_rtc(y) };
  }

  static x_ctr(cx: number): number {
    return cx * Data.CASE_WIDTH + Data.CASE_WIDTH * 0.5;
  }

  static y_ctr(cy: number): number {
    return cy * Data.CASE_HEIGHT + Data.CASE_HEIGHT;
  }

  // ----------------------------------------------------- Registration & types

  register(type: number): void {
    if ((this.types & type) !== 0) return;
    this.game.addToList(type, this);
    this.types |= type;
  }

  unregister(type: number): void {
    if ((this.types & type) === 0) return;
    this.game.removeFromList(type, this);
    this.types &= ~type;
  }

  isType(t: number): boolean {
    return (this.types & t) !== 0;
  }

  setParent(e: BaseEntity | null): void {
    this.parent = e;
  }

  setLifeTimer(t: number): void {
    this.lifeTimer = t;
    this.totalLife = t;
  }

  updateLifeTimer(t: number): void {
    if (this.totalLife === null) this.setLifeTimer(t);
    else this.lifeTimer = t;
  }

  onLifeTimer(): void {
    this.destroy();
  }

  // --------------------------------------------------- Spatial trigger bucket

  private tAddSingle(cx: number, cy: number): void {
    if (cx < 0 || cx >= Data.LEVEL_WIDTH || cy < 0 || cy >= Data.LEVEL_HEIGHT) return;
    const cell = this.world.triggers[cx]?.[cy] as BaseEntity[] | undefined;
    if (cell && !cell.includes(this)) {
      cell.push(this);
    }
  }

  private tRemSingle(cx: number, cy: number): void {
    if (cx < 0 || cx >= Data.LEVEL_WIDTH || cy < 0 || cy >= Data.LEVEL_HEIGHT) return;
    const cell = this.world.triggers[cx]?.[cy] as BaseEntity[] | undefined;
    if (!cell) return;
    const idx = cell.indexOf(this);
    if (idx >= 0) cell.splice(idx, 1);
  }

  protected tAdd(cx: number, cy: number): void {
    this.tAddSingle(cx, cy);
    this.tAddSingle(cx - 1, cy);
    this.tAddSingle(cx + 1, cy);
    this.tAddSingle(cx, cy - 1);
    if (this.fl_largeTrigger) {
      this.tAddSingle(cx, cy + 1);
    }
  }

  protected tRem(cx: number, cy: number): void {
    this.tRemSingle(cx, cy);
    this.tRemSingle(cx - 1, cy);
    this.tRemSingle(cx + 1, cy);
    this.tRemSingle(cx, cy - 1);
    if (this.fl_largeTrigger) {
      this.tRemSingle(cx, cy + 1);
    }
  }

  /**
   * Teleports the entity to `(x, y)`.
   * Note the intentional `y - 1` from `Trigger.mt` so `Physics` detects ground landing on the next step.
   */
  moveTo(x: number, y: number): void {
    this.tRem(this.cx, this.cy);
    this.x = x;
    this.y = y - 1;
    this.updateCoords();
    this.tAdd(this.cx, this.cy);
  }

  moveToCase(cx: number, cy: number): void {
    this.moveTo(BaseEntity.x_ctr(cx), BaseEntity.y_ctr(cy));
  }

  getByType(type: number): BaseEntity[] {
    if (this.cx < 0 || this.cx >= Data.LEVEL_WIDTH || this.cy < 0 || this.cy >= Data.LEVEL_HEIGHT) {
      return [];
    }
    const cell = (this.world.triggers[this.cx]?.[this.cy] as BaseEntity[] | undefined) ?? [];
    return cell.filter((e) => (e.types & type) !== 0);
  }

  // ------------------------------------------------ Geometry & bounding boxes

  get hitWidth(): number {
    const w = Math.abs(this.mc._width);
    return w >= 8 && w <= 80 ? w : 20;
  }

  get hitHeight(): number {
    const h = Math.abs(this.mc._height);
    return h >= 8 && h <= 80 ? h : 20;
  }

  hitBound(e: BaseEntity): boolean {
    const hw1 = this.hitWidth * 0.5;
    const hh1 = this.hitHeight;
    const hw2 = e.hitWidth * 0.5;
    const hh2 = e.hitHeight;
    return (
      this.x + hw1 > e.x - hw2 &&
      this.y > e.y - hh2 &&
      this.x - hw1 < e.x + hw2 &&
      this.y - hh1 < e.y
    );
  }

  hit(_e: BaseEntity): void {
    // Overridden by subclasses
  }

  updateCoords(): void {
    this.cx = BaseEntity.x_rtc(this.x);
    this.cy = BaseEntity.y_rtc(this.y);
    this.fcx = BaseEntity.x_rtc(this.x);
    this.fcy = BaseEntity.y_rtc(this.y + Math.floor(Data.CASE_HEIGHT * 0.5));
  }

  adjustToLeft(): void {
    this.x = BaseEntity.x_ctr(this.cx) - (Data.CASE_WIDTH * 0.5 + 1);
    this.y = BaseEntity.y_ctr(this.cy);
  }

  adjustToRight(): void {
    this.x = BaseEntity.x_ctr(this.cx) + (Data.CASE_WIDTH * 0.5 - 1);
    this.y = BaseEntity.y_ctr(this.cy);
  }

  centerInCase(): void {
    this.x = BaseEntity.x_ctr(this.cx);
    this.y = BaseEntity.y_ctr(this.cy);
  }

  distanceCase(cx: number, cy: number): number {
    return Math.hypot(cx - this.cx, cy - this.cy);
  }

  distance(x: number, y: number): number {
    return Math.hypot(x - this.x, y - this.y);
  }

  // ----------------------------------------------------- Visual state helpers

  hide(): void {
    this.mc._visible = false;
    if (this.sticker) this.sticker._visible = false;
  }

  show(): void {
    this.mc._visible = true;
    if (this.sticker) this.sticker._visible = true;
  }

  scale(percent: number): void {
    this.scaleFactor = percent / 100;
    this.mc._xscale = percent;
    this.mc._yscale = percent;
  }

  stick(mc: SwfMovieClip, ox: number, oy: number): void {
    this.unstick();
    this.sticker = mc;
    this.stickerX = ox;
    this.stickerY = oy;
    this.fl_stick = true;
    this.fl_elastick = false;
  }

  setElaStick(factor: number): void {
    if (this.fl_elastick) return;
    this.elaStickFactor = factor;
    this.fl_elastick = true;
    this.stickerX *= factor;
    this.stickerY *= factor;
  }

  unstick(): void {
    this.fl_stick = false;
    this.sticker?.removeMovieClip();
    this.sticker = null;
  }

  destroy(): void {
    if (this.fl_destroy) return;
    this.fl_kill = true;
    this.fl_destroy = true;
    this.tRem(this.cx, this.cy);
    this.unstick();
    for (let i = 0; i < 24; i++) {
      const bit = 1 << i;
      if ((this.types & bit) !== 0) {
        this.game.queueUnregister(bit, this);
      }
    }
    this.game.queueKill(this);
  }

  // ------------------------------------------------------------------ Updates

  update(): void {
    if (this.lifeTimer > 0) {
      this.lifeTimer -= 1;
      if (this.lifeTimer <= 0) {
        this.onLifeTimer();
      }
    }
    if (this.stickTimer > 0) {
      this.stickTimer -= 1;
      if (this.stickTimer <= 0) {
        this.unstick();
      }
    }
  }

  endUpdate(): void {
    this.updateCoords();
    this.mc._x = this.x + this._xOffset;
    this.mc._y = this.y + this._yOffset;
    this.mc.rotationDeg = this.rotation;
    this.mc._alpha = Math.max(this.minAlpha, this.alpha);
    this.oldX = this.x;
    this.oldY = this.y;

    if (this.fl_stick && this.sticker) {
      if (this.fl_elastick) {
        this.sticker._x += (this.x - this.sticker._x) * this.elaStickFactor + this.stickerX;
        this.sticker._y += (this.y - this.sticker._y) * this.elaStickFactor + this.stickerY;
      } else {
        this.sticker._x = this.x + this.stickerX;
        this.sticker._y = this.y + this.stickerY;
      }
    }
  }
}

/**
 * Port of `entity.Animator` (`class/hammer/entity/Animator.mt`):
 * drives two-level SWF character timelines (`mc` outer state frame -> `sub` inner animation frames)
 * at 32 Hz and manages life/invulnerability blinking.
 */
export class AnimatorEntity extends BaseEntity {
  animId: number | null = null;
  private frame = 0;
  animFactor = 1.0;

  fl_anim = true;
  fl_loop = false;
  fl_blink = true;
  fl_alphaBlink = true;
  fl_stickyAnim = false;

  blinkColor = 0xffffff;
  blinkColorAlpha = 30;
  blinkAlpha = 20;

  private blinkTimer = 0;
  protected fl_blinking = false;
  private fl_blinked = true;
  private customSub: SwfMovieClip | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.enableAnimator();
    this.mc.gotoAndStop('1');
    this.sub?.stop();
  }

  get sub(): SwfMovieClip | null {
    return this.customSub ?? this.mc.getClip('sub');
  }

  setSub(mc: SwfMovieClip | null): void {
    this.customSub = mc;
  }

  enableAnimator(): void {
    this.fl_anim = true;
    this.mc.stop();
  }

  disableAnimator(): void {
    this.fl_anim = false;
  }

  blink(duration: number): void {
    if (!this.fl_blink) return;
    this.fl_blinking = true;
    this.blinkTimer = duration;
  }

  stopBlink(): void {
    this.fl_blinking = false;
    if (this.fl_alphaBlink) {
      this.alpha = 100;
    } else {
      this.mc.resetColor();
    }
  }

  private blinkLife(): void {
    if (!this.totalLife || this.totalLife <= 0) return;
    const ratio = this.lifeTimer / this.totalLife;
    if (ratio <= 0.1) {
      this.blink(Data.BLINK_DURATION_FAST);
    } else if (ratio <= 0.3) {
      this.blink(Data.BLINK_DURATION);
    }
  }

  stickAnim(): void {
    this.fl_stickyAnim = true;
  }

  unstickAnim(): void {
    this.fl_stickyAnim = false;
  }

  onEndAnim(_id: number): void {
    this.unstickAnim();
  }

  playAnim(anim: AnimDef): void {
    if (this.fl_stickyAnim || this.fl_kill || !this.fl_anim) return;
    if (this.animId === anim.id && this.fl_loop === anim.loop) return;

    this.animId = anim.id;
    this.mc.gotoAndStop(String(anim.id + 1));
    const s = this.sub;
    s?.gotoAndStop('1');
    this.fl_loop = anim.loop;
    this.frame = 0;
  }

  replayAnim(): void {
    if (this.animId === null) return;
    const id = this.animId;
    const fid = id === 1 ? 2 : 1;
    this.playAnim({ id: fid, loop: this.fl_loop });
    this.playAnim({ id, loop: this.fl_loop });
  }

  override update(): void {
    super.update();

    if (this.fl_blink) {
      if (!this.fl_blinking && this.lifeTimer > 0 && this.totalLife !== null) {
        this.blinkLife();
      }
      if (this.fl_blinking) {
        this.blinkTimer -= 1;
        if (this.blinkTimer <= 0) {
          if (this.fl_blinked) {
            if (this.fl_alphaBlink) this.alpha = 100;
            else this.mc.resetColor();
            this.fl_blinked = false;
          } else {
            if (this.fl_alphaBlink) this.alpha = this.blinkAlpha;
            else this.mc.setColorHex(this.blinkColorAlpha, this.blinkColor);
            this.fl_blinked = true;
          }
          this.blinkLife();
          if (this.blinkTimer <= 0) this.blinkTimer = Data.BLINK_DURATION_FAST;
        }
      }
    }

    if (!this.fl_anim) return;

    const sub = this.sub;
    if (!sub) return;
    sub.stop();

    if (this.frame >= 0) {
      let stopped = false;
      this.frame += this.animFactor;
      while (!stopped && this.frame >= 1) {
        if (sub._currentframe >= sub._totalframes) {
          if (this.fl_loop) {
            sub.gotoAndStop('1');
          } else {
            this.frame = -1;
            if (this.animId !== null) this.onEndAnim(this.animId);
            stopped = true;
          }
        }
        if (!stopped) {
          sub.nextFrame();
          this.frame -= 1;
        }
      }
    }
  }
}

/**
 * Port of `entity.Physics` (`class/hammer/entity/Physics.mt`):
 * deterministic sub-stepped gravity, platform/wall/ceiling/border collision,
 * teleporters, portals, bumpers, shockwaves, and friction.
 */
export class PhysicsEntity extends AnimatorEntity {
  dx = 0;
  dy = 0;

  private fallStart: number | null = null;
  gravityFactor = 1.0;
  fallFactor = 1.0;
  slideFriction: number | null = null;
  shockResistance = 1.0;

  fl_stable = false;
  fl_physics = true;
  fl_friction = true;
  fl_gravity = true;
  fl_strictGravity = true;
  fl_hitGround = true;
  fl_hitCeil = false;
  fl_hitWall = true;
  fl_hitBorder = true;
  fl_slide = true;
  fl_teleport = false;
  fl_portal = false;
  fl_wind = false;
  fl_moveable = true;
  fl_bump = false;
  fl_intercept = false;

  protected fl_stopStepping = false;
  protected fl_skipNextGravity = true;
  protected fl_skipNextGround = false;

  lastTeleporter: TeleporterData | null = null;

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.register(Data.PHYSICS);
  }

  enablePhysics(): void {
    this.fl_physics = true;
  }

  disablePhysics(): void {
    this.fl_physics = false;
  }

  shockWave(e: PhysicsEntity, radius: number, power: number): void {
    if (!e.fl_moveable) return;
    const adjPower = power / e.shockResistance;
    const dist = e.distance(this.x, this.y);
    const ratio = Math.max(0, 1 - dist / radius);
    const ang = Math.atan2(e.y - this.y, e.x - this.x);
    e.dx = Math.cos(ang) * ratio * adjPower;
    if (e.fl_stable) {
      e.dy = -5;
    } else {
      if (e.fl_intercept) {
        e.dy = 0;
        e.dx *= 2;
      } else {
        e.dy += Math.sin(ang) * ratio * adjPower;
      }
      e.dy = Math.max(e.dy, -10);
    }
    e.fl_stable = false;
  }

  killHit(dx: number | null): void {
    if (this.fl_kill) return;
    this.dx = dx ?? this.game.rand.next() * 20 * (this.game.rand.next() < 0.5 ? -1 : 1);
    this.dy = -10;
    this.fl_hitGround = false;
    this.fl_hitWall = false;
    this.fl_kill = true;
    this.fallFactor = Data.FALL_FACTOR_DEAD;
    this.onKill();
  }

  resurrect(): void {
    this.fl_hitGround = true;
    this.fl_hitWall = true;
    this.fl_kill = false;
    this.fallFactor = 1.0;
    this.fl_stopStepping = true;
  }

  moveToAng(angDeg: number, speed: number): void {
    const rad = (Math.PI * angDeg) / 180;
    this.dx = Math.cos(rad) * speed;
    this.dy = Math.sin(rad) * speed;
  }

  moveToTarget(e: BaseEntity, speed: number): void {
    const rad = Math.atan2(e.y - this.y, e.x - this.x);
    this.dx = Math.cos(rad) * speed;
    this.dy = Math.sin(rad) * speed;
  }

  moveLeft(speed: number): void {
    this.moveToAng(180, speed);
  }

  moveRight(speed: number): void {
    this.moveToAng(0, speed);
  }

  moveFrom(e: BaseEntity, speed: number): void {
    const ang = -this.game.rand.next() * Math.PI;
    this.x = e.x + Math.cos(ang) * Data.CASE_WIDTH * 2;
    this.y = e.y + Math.sin(ang) * Data.CASE_HEIGHT * 2;
    this.moveToTarget(e, speed);
    this.dx = -this.dx;
    this.dy = -this.dy;
  }

  moveToGround(): void {
    if (this.fl_stable) return;
    const pt = this.world.getGround(this.cx, this.cy);
    this.moveToCase(pt.x, pt.y);
  }

  checkHits(): void {
    const list = this.getByType(Data.ENTITY);
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (!other.fl_kill && !this.fl_kill && other.uniqId !== this.uniqId && this.hitBound(other)) {
        this.hit(other);
        if (!other.fl_kill && !this.fl_kill) {
          other.hit(this);
        }
      }
    }
  }

  protected prefix(): void {
    // Hook
  }

  protected infix(): void {
    this.checkHits();

    const cid = this.world.getCase(this.cx, this.cy);

    // Teleporter field
    if (this.fl_teleport && !this.fl_kill) {
      if (cid === Data.FIELD_TELEPORT) {
        const start = this.world.getTeleporter(this.cx, this.cy);
        if (start && start !== this.lastTeleporter) {
          const target = this.world.getNextTeleporter(start, this.game.rand);
          if (target) {
            this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
            if (target.td.dir === Data.HORIZONTAL) {
              if (target.fl_rand) {
                this.moveTo(target.td.centerX - Data.CASE_WIDTH * 0.5, target.td.centerY);
              } else {
                this.moveTo(
                  target.td.centerX + BaseEntity.x_ctr(this.cx) - start.centerX,
                  target.td.centerY,
                );
              }
            } else {
              if (target.fl_rand) {
                this.moveTo(target.td.centerX, target.td.centerY);
              } else {
                this.moveTo(
                  target.td.centerX,
                  target.td.centerY + BaseEntity.y_ctr(this.cy) - start.centerY,
                );
              }
            }
            this.game.fxMan.attachFx(this.x, this.y - Data.CASE_HEIGHT, 'hammer_fx_shine');
            this.game.audio.playSound('sound_teleport', Data.CHAN_FIELD);
            this.fl_stopStepping = true;
            this.lastTeleporter = target.td;
            this.onTeleport();
          }
        }
      } else {
        this.lastTeleporter = null;
      }
    }

    // Portal field
    if (this.fl_portal && !this.fl_kill && cid === Data.FIELD_PORTAL) {
      if (this.game.fl_clear) {
        let px = this.cx;
        let py = this.cy;
        while (this.world.getCase(px - 1, py) === Data.FIELD_PORTAL) px--;
        while (this.world.getCase(px, py - 1) === Data.FIELD_PORTAL) py--;

        let pid: number | null = null;
        for (let i = 0; i < this.world.portalList.length; i++) {
          if (this.world.portalList[i].cx === px && this.world.portalList[i].cy === py) {
            pid = i;
          }
        }
        if (pid !== null) this.onPortal(pid);
      } else {
        this.onPortalRefusal();
      }
    }

    // Bumper field
    if (this.fl_bump && !this.fl_kill && cid === Data.FIELD_BUMPER) {
      let fdir: number = Data.VERTICAL;
      if (
        this.world.getCase(this.cx - 1, this.cy) === cid ||
        this.world.getCase(this.cx + 1, this.cy) === cid
      ) {
        fdir = Data.HORIZONTAL;
      }
      if (fdir === Data.HORIZONTAL && Math.abs(this.dy) < 20) {
        this.dx = 0;
        this.dy *= 5;
      }
      if (fdir === Data.VERTICAL && Math.abs(this.dx) < 20) {
        this.dx *= 7;
        this.dy = 0;
      }
      this.onBump();
    }
  }

  protected postfix(): void {
    // Hook
  }

  recal(): void {
    this.y = BaseEntity.y_ctr(BaseEntity.y_rtc(this.y));
    this.updateCoords();
    while (this.world.getCase(this.cx, this.cy) === Data.GROUND) {
      this.y -= Data.CASE_HEIGHT;
      this.updateCoords();
    }
  }

  calcSteps(dxStep: number, dyStep: number): { total: number; dx: number; dy: number } {
    const total = Math.max(
      1,
      Math.ceil(Math.abs(dxStep) / Data.STEP_MAX),
      Math.ceil(Math.abs(dyStep) / Data.STEP_MAX),
    );
    return {
      total,
      dx: dxStep / total,
      dy: dyStep / total,
    };
  }

  needsPatch(): boolean {
    return false;
  }

  // ------------------------------------------------------------------- Events

  onKill(): void {}
  onDeathLine(): void {}
  onHitWall(): void {
    this.dx = 0;
  }
  onHitGround(_height: number): void {
    this.fl_stable = true;
    this.dy = 0;
    this.recal();
  }
  onHitCeil(): void {
    this.dy = 0;
  }
  onTeleport(): void {}
  onPortal(_pid: number): void {}
  onPortalRefusal(): void {}
  onBump(): void {}

  // ------------------------------------------------------------------ Updates

  override endUpdate(): void {
    if (this.fl_hitBorder) {
      if (this.x < Data.BORDER_MARGIN) this.x = Data.BORDER_MARGIN;
      if (this.x >= Data.GAME_WIDTH - Data.BORDER_MARGIN) {
        this.x = Data.GAME_WIDTH - Data.BORDER_MARGIN - 1;
      }
    }
    super.endUpdate();
  }

  override update(): void {
    super.update();
    if (!this.fl_physics) return;

    this.updateCoords();

    if (this.fl_wind && this.fl_stable && this.game.fl_wind) {
      this.dx += this.game.windSpeed;
    }

    if (this.fl_stable) {
      if (this.dy !== 0 || this.world.getCase(this.fcx, this.fcy) !== Data.GROUND) {
        this.fl_stable = false;
      }
    }

    if (this.dx !== 0 || this.dy !== 0 || !this.fl_stable) {
      if (!this.fl_skipNextGravity && !this.fl_stable && this.fl_gravity) {
        if (this.dy < 0) {
          this.dy += this.gravityFactor * Data.GRAVITY;
        } else {
          if (this.fallStart === null) this.fallStart = this.y;
          if (this.game.fl_aqua && !this.fl_strictGravity) {
            this.dy += 0.3 * this.fallFactor * Data.FALL_SPEED;
          } else {
            this.dy += this.fallFactor * Data.FALL_SPEED;
          }
        }
      }
      this.fl_skipNextGravity = false;

      this.prefix();

      const stepInfos = this.calcSteps(this.dx, this.dy);
      let step = 0;

      while (!this.fl_stopStepping && step < stepInfos.total) {
        const ocx = this.cx;
        const ocy = this.cy;
        const ox = this.x;
        const oy = this.y;
        this.oldX = this.x;
        this.oldY = this.y;

        this.x += stepInfos.dx;
        this.y += stepInfos.dy;
        this.updateCoords();

        // Wall penetration guard
        if (this.fl_hitWall) {
          let hitW = false;
          if (
            this.dx > 0 &&
            this.world.getCase(BaseEntity.x_rtc(ox + Data.CASE_WIDTH * 0.5), BaseEntity.y_rtc(oy)) >
              0
          ) {
            hitW = true;
          }
          if (
            this.dx < 0 &&
            this.world.getCase(BaseEntity.x_rtc(ox - Data.CASE_WIDTH * 0.5), BaseEntity.y_rtc(oy)) >
              0
          ) {
            hitW = true;
          }
          if (hitW) {
            this.x = ox;
            stepInfos.dx = 0;
            this.updateCoords();
            this.onHitWall();
          }
        }

        // Horizontal border / wall collision
        if (
          (this.fl_hitBorder &&
            (this.x < Data.BORDER_MARGIN || this.x >= Data.GAME_WIDTH - Data.BORDER_MARGIN)) ||
          (this.fl_hitWall && this.world.getCase(this.cx, BaseEntity.y_rtc(oy)) > 0)
        ) {
          this.x = ox;
          stepInfos.dx = 0;
          this.updateCoords();
          this.onHitWall();
        }

        // Top-of-wall pass-through guard
        if (this.fl_hitWall && stepInfos.dy > 0 && !this.fl_kill) {
          const prevFoot = BaseEntity.rtc(ox, oy + Math.floor(Data.CASE_HEIGHT * 0.5));
          if (
            this.world.getCase(prevFoot.x, prevFoot.y) !== Data.WALL &&
            this.world.getCase(this.fcx, this.fcy) === Data.WALL
          ) {
            this.x = ox;
            stepInfos.dx = 0;
            this.updateCoords();
            this.onHitWall();
          }
        }

        // Ground landing
        if (this.fl_hitGround && stepInfos.dy >= 0) {
          const prevFoot = BaseEntity.rtc(ox, oy + Math.floor(Data.CASE_HEIGHT * 0.5));
          if (
            this.world.getCase(prevFoot.x, prevFoot.y) !== Data.GROUND &&
            this.world.getCase(this.fcx, this.fcy) === Data.GROUND
          ) {
            if (this.world.checkFlag(this.fcx, this.fcy, Data.IA_TILE)) {
              if (this.fl_skipNextGround) {
                this.fl_skipNextGround = false;
              } else {
                stepInfos.dy = 0;
                const fallH = this.fallStart !== null ? this.y - this.fallStart : 0;
                this.onHitGround(fallH);
                this.fallStart = null;
                this.updateCoords();
              }
            }
          }
        }

        // Ceiling collision
        if (this.fl_hitCeil && stepInfos.dy <= 0) {
          const prevHead = BaseEntity.rtc(ox, oy - Math.floor(Data.CASE_HEIGHT * 0.5));
          const curHead = BaseEntity.rtc(this.x, this.y - Math.floor(Data.CASE_HEIGHT * 0.5));
          if (
            this.world.getCase(prevHead.x, prevHead.y) <= 0 &&
            this.world.getCase(curHead.x, curHead.y) > 0
          ) {
            stepInfos.dy = 0;
            this.onHitCeil();
            this.updateCoords();
          }
        }

        // Cell transition (`infix` + corner patches)
        if (ocx !== this.cx || ocy !== this.cy) {
          let patched = false;

          if (this.fl_hitGround && ocy < this.cy && this.needsPatch()) {
            if (
              this.world.getCase(ocx, ocy) <= 0 &&
              this.dy > 0 &&
              this.world.getCase(this.cx, this.cy) > 0 &&
              this.cy < Data.LEVEL_HEIGHT
            ) {
              this.x = BaseEntity.x_ctr(ocx);
              this.y = BaseEntity.y_ctr(ocy);
              stepInfos.dy = 0;
              this.updateCoords();
              this.onHitGround(this.fallStart !== null ? this.y - this.fallStart : 0);
              this.fallStart = null;
              patched = true;
            }
          }

          if (!patched && this.fl_hitGround && this.dy >= 0 && ocx !== this.cx && ocy !== this.cy) {
            if (
              this.world.getCase(ocx, ocy) <= 0 &&
              this.world.getCase(this.cx, this.cy) === Data.GROUND
            ) {
              this.x = BaseEntity.x_ctr(ocx);
              this.y = BaseEntity.y_ctr(ocy);
              stepInfos.dx = 0;
              this.updateCoords();
              this.onHitWall();
              patched = true;
            }
          }

          if (!patched) {
            this.tRem(ocx, ocy);
            this.infix();
            this.updateCoords();
            this.tAdd(this.cx, this.cy);
          }
        }

        step++;
      }
    }

    this.fl_stopStepping = false;
    this.postfix();

    // Friction
    if (this.fl_friction) {
      if ((this.game.fl_ice || this.fl_slide) && this.fl_stable) {
        if (this.slideFriction === null) {
          this.dx *= this.game.sFriction;
        } else {
          this.dx *= this.slideFriction;
        }
      } else {
        this.dx *= this.game.xFriction;
        this.dy *= this.game.yFriction;
      }
    }
    if (Math.abs(this.dx) <= 0.2) this.dx = 0;
    if (Math.abs(this.dy) <= 0.2) this.dy = 0;

    if (this.y >= Data.DEATH_LINE) {
      this.onDeathLine();
    }
  }
}

/**
 * Port of `entity.Mover` (`class/hammer/entity/Mover.mt`).
 */
export class MoverEntity extends PhysicsEntity {
  next: NextMove | null = null;
  fl_bounce = false;
  bounceFactor = 0.5;

  setNext(dx: number, dy: number, delay: number, action: number): void {
    this.next = { dx, dy, delay, action };
  }

  onNext(): void {
    if (!this.next) return;
    if (this.next.action === Data.ACTION_MOVE) {
      this.dx = this.next.dx;
      this.dy = this.next.dy;
      if (this.dy !== 0) {
        this.fl_stable = false;
      }
      this.next = null;
    }
  }

  override onKill(): void {
    super.onKill();
    this.next = null;
  }

  override onHitGround(h: number): void {
    if (this.fl_bounce) {
      const b = this.bounceFactor * Math.abs(this.dy);
      if (b >= 2) {
        this.setNext(this.dx, -b, 0, Data.ACTION_MOVE);
        this.fl_skipNextGravity = true;
      }
    }
    super.onHitGround(h);
  }

  isReady(): boolean {
    return this.fl_stable && this.next === null;
  }

  override update(): void {
    if (this.next !== null) {
      this.next.delay -= 1;
      if (this.next.delay <= 0) {
        this.onNext();
      }
    }
    super.update();
  }
}
