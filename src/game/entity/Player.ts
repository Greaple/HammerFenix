import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { type AnimDef, Data } from '../Data';
import type { FxAnim } from '../FxManager';
import type { IGameContext } from '../GameContext';
import type { BadEntity } from './Bad';
import {
  BlackBomb,
  BlueBomb,
  type BombEntity,
  ClassicBomb,
  GreenBomb,
  type PlayerBomb,
  PoireBomb,
  RedBomb,
  RepelBomb,
} from './Bomb';
import { BaseEntity, PhysicsEntity } from './Entity';
import { type ItemEntity, ScoreItem, SpecialItem } from './Item';
import { PlayerArrowShoot, PlayerFireBallShoot, PlayerPearlShoot, type ShootEntity } from './Shoot';

const WEAPON_DURATION = Data.SECOND * 30;

/**
 * Port of `entity.Player` + `entity.PlayerController` + `SpecialManager`
 * (`class/hammer/entity/Player.mt`, `PlayerController.mt`, `SpecialManager.mt`).
 */
export class PlayerEntity extends PhysicsEntity {
  readonly pid = 0;

  baseWalkAnim: AnimDef = Data.ANIM_PLAYER_WALK;
  baseStopAnim: AnimDef = Data.ANIM_PLAYER_STOP;
  baseColor: number = Data.BASE_COLORS[0];
  darkColor: number = Data.DARK_COLORS[0];

  speedFactor = 1.0;
  fl_lockControls = false;
  fl_entering = false;

  score = 0;
  lives = 1;
  extraLifeCurrent = 0;

  // Read by the SWF frame scripts of the body parts (head frame, skin frame, carrot, tuft)
  fl_chourou = false;
  fl_carot = false;
  /** Quest rewards that light up dark levels (families 106 and 107). Used by the darkness (2.7). */
  fl_candle = false;
  fl_torch = false;
  defaultHead: number = Data.HEAD_NORMAL;
  head: number = this.defaultHead;
  skin = 1;

  currentWeapon: number = Data.WEAPON_B_CLASSIC;
  lastBomb: number = Data.WEAPON_B_CLASSIC;
  initialMaxBombs = 1;
  maxBombs = 1;
  coolDown = 0;

  fl_shield = false;
  fl_godMode = false;
  shieldTimer = 0;
  private shieldMC: FxAnim | null = null;
  oxygen = 100;

  fl_knock = false;
  knockTimer = 0;
  private lockTimer = 0;

  /** Down-kick of bombs: a quest reward in the original (family 101). */
  fl_upKick = false;
  private walkTimer = 0;
  private waterJump = 0;
  private edgeTimer = 0;
  private waitTimer = 0;

  extendList: boolean[] = [];
  extendOrder: number[] = [];

  /** Active special-item flags (`SpecialManager.actives`). */
  readonly actives: boolean[] = [];
  private permList: number[] = [];
  private tempList: { id: number; end: number }[] = [];
  private recurring: {
    timer: number;
    baseTimer: number;
    fl_repeat: boolean;
    func: () => void;
  }[] = [];

  private recentKicks: { t: number; bid: number }[] = [];

  constructor(game: IGameContext, mc: SwfMovieClip) {
    super(game, mc);
    this.fallFactor = 1.1;
    this.fl_teleport = true;
    this.fl_portal = true;
    this.fl_wind = true;
    this.fl_strictGravity = false;
    this.fl_bump = true;

    // Quest rewards (`GameManager.CONFIG.hasFamily`)
    if (game.hasFamily(100)) this.initialMaxBombs++;
    this.maxBombs = this.initialMaxBombs;
    if (game.hasFamily(102)) this.lives++; // heart 1
    if (game.hasFamily(103)) this.lives++; // heart 2
    if (game.hasFamily(104)) this.lives++; // heart 3
    if (game.hasFamily(105)) this.lives++; // ig'or
    if (game.hasFamily(108)) this.lives++; // carrot
    if (game.hasFamily(106)) this.fl_candle = true;
    if (game.hasFamily(107)) this.fl_torch = true;
    if (game.hasFamily(108)) this.fl_carot = true;
    this.fl_upKick = game.hasFamily(101);

    this.register(Data.PLAYER);
  }

  static attach(game: IGameContext, x: number, y: number): PlayerEntity {
    const mc = game.depthMan.attach('hammer_player', Data.DP_PLAYER);
    const p = new PlayerEntity(game, mc);
    p.initPlayer(x, y);
    return p;
  }

  initPlayer(x: number, y: number): void {
    this.moveTo(x, y);
    if (this.game.fl_nightmare) {
      this.speedFactor = 1.3;
    }
    this.endUpdate();
  }

  // --------------------------------------------------- Combat & Item Collisions

  override hit(e: BaseEntity): void {
    if (e.isType(Data.ITEM)) {
      const it = e as ItemEntity;
      it.execute(this);
    }
  }

  forceKill(dx: number | null): void {
    if (this.fl_godMode) return;
    this.fl_shield = false;
    this.killHit(dx);
  }

  override killHit(dx: number | null): void {
    if (this.fl_kill || this.fl_shield || this.fl_godMode) return;

    this.fl_knock = false;
    this.game.audio.playSound('sound_player_death', Data.CHAN_PLAYER);

    // `dx/Math.abs(dx)` is NaN for 0 or null: random side
    let sign = dx !== null && dx !== 0 ? Math.sign(dx) : this.game.rand.random(2) * 2 - 1;
    if (this.x >= 0.85 * Data.GAME_WIDTH) sign = -1;
    if (this.x <= 0.15 * Data.GAME_WIDTH) sign = 1;

    this.playAnim(Data.ANIM_PLAYER_DIE);
    super.killHit(sign * 20);
  }

  getScore(origin: BaseEntity | null, value: number): void {
    if (origin !== null) {
      const shown = this.actives[95] ? value * 2 : value;
      this.game.fxMan.attachScorePop(
        this.baseColor,
        this.darkColor,
        origin.x,
        origin.y,
        String(shown),
      );
    }
    this.getScoreHidden(value);
  }

  getScoreHidden(rawValue: number): void {
    const value = this.actives[95] ? rawValue * 2 : rawValue;
    const step = Data.EXTRA_LIFE_STEPS[this.extraLifeCurrent];
    if (step !== undefined && this.score < step && this.score + value >= step) {
      this.lives++;
      this.game.hud.setLives(this.lives);
      this.extraLifeCurrent++;
    }
    this.score += value;
    this.game.hud.setScore(this.score);
  }

  getExtend(id: number): void {
    if (id < 0 || id >= Data.EXTENDS.length) return;
    if (!this.extendList[id]) {
      this.game.hud.getExtend(id);
      this.extendOrder.push(id);
    }
    this.extendList[id] = true;

    let complete = true;
    for (let i = 0; i < Data.EXTENDS.length; i++) {
      if (!this.extendList[i]) {
        complete = false;
        break;
      }
    }

    if (complete) {
      let flPerfect = this.extendOrder.length === Data.EXTENDS.length;
      for (let i = 0; i < this.extendOrder.length; i++) {
        if (this.extendOrder[i] !== i) flPerfect = false;
      }
      this.game.hud.clearExtends();
      this.extendList = [];
      this.extendOrder = [];
      this.executeExtend(flPerfect);
    }
  }

  private executeExtend(flPerfect: boolean): void {
    const a = this.game.fxMan.attachFx(
      Data.GAME_WIDTH * 0.5,
      Data.GAME_HEIGHT * 0.5,
      'extendSequence',
    );
    if (a) a.lifeTimer = 9999;

    this.game.destroyList(Data.BAD);
    this.game.destroyList(Data.BAD_BOMB);
    this.game.destroyList(Data.SHOOT);

    this.lives++;
    this.game.hud.setLives(this.lives);

    if (flPerfect) {
      const mc = this.game.depthMan.attach('hammer_fx_perfect', Data.DP_INTERF);
      mc._x = Data.GAME_WIDTH * 0.5;
      mc._y = Data.GAME_HEIGHT * 0.2;
      const lbl = mc.getText('label');
      if (lbl) lbl.text = this.game.dataStore.getStatic(11) || 'PERFECT!';
      const bon = mc.getText('bonus');
      if (bon) bon.text = this.actives[95] ? '300000' : '150000';
      this.getScoreHidden(150000);
    }
  }

  // ------------------------------------------------ Physics Hooks & Teleporters

  protected override infix(): void {
    super.infix();

    const id = this.world.getCase(this.cx, this.cy);
    if (id > Data.FIELD_TELEPORT && id < 0) {
      const w = Math.abs(id);
      if (this.currentWeapon !== w) {
        const fx = this.game.fxMan.attachShine(this.x, this.y - Data.CASE_HEIGHT * 0.5);
        if (fx) {
          fx.mc._xscale = 65;
          fx.mc._yscale = 65;
        }
        this.game.audio.playSound('sound_field', Data.CHAN_FIELD);
      }
      this.changeWeapon(w);
    }

    if (id === Data.FIELD_PEACE) {
      // The original compares with abs(FIELD_PEACE), not WEAPON_NONE: the shine plays on each entry
      if (this.currentWeapon !== Math.abs(id)) {
        const fx = this.game.fxMan.attachShine(this.x, this.y - Data.CASE_HEIGHT * 0.5);
        if (fx) {
          fx.mc._xscale = 65;
          fx.mc._yscale = 65;
        }
        this.game.audio.playSound('sound_field', Data.CHAN_FIELD);
      }
      this.changeWeapon(Data.WEAPON_NONE);
    }

    if (!this.fl_kill && !this.fl_destroy) {
      this.game.onEnterCase(this.cx, this.cy);
    }

    this.showTeleporters();
  }

  protected override postfix(): void {
    super.postfix();
    if (!this.fl_kill && !this.fl_destroy) {
      this.checkHits();
    }
  }

  override needsPatch(): boolean {
    return true;
  }

  showTeleporters(): void {
    const tl = this.world.teleporterList;
    for (const td of tl) {
      this.world.hideField(td);
    }
    for (const td of tl) {
      let close = false;
      if (td.dir === Data.VERTICAL) {
        if (
          Math.abs(td.centerX - this.x) <= Data.TELEPORTER_DISTANCE &&
          this.y >= td.startY - Data.CASE_HEIGHT * 0.5 &&
          this.y <= td.endY + Data.CASE_HEIGHT * 0.5
        ) {
          close = true;
        }
      } else if (
        Math.abs(td.centerY - this.y) <= Data.TELEPORTER_DISTANCE &&
        this.x >= td.startX - Data.CASE_WIDTH &&
        this.x <= td.endX + Data.CASE_WIDTH
      ) {
        close = true;
      }

      if (close) {
        this.world.showField(td);
        const next = this.world.getNextTeleporter(td, this.game.rand);
        if (next && !next.fl_rand) {
          this.world.showField(next.td);
        }
      }
    }
  }

  // --------------------------------------------------- Life, Shield & Knockback

  killPlayer(): void {
    this.game.fxMan.attachFx(this.x, Data.GAME_HEIGHT, 'hammer_fx_death_player');
    this.lives--;
    this.game.hud.setLives(this.lives);
    if (this.lives >= 0) {
      this.resurrect();
    } else {
      this.game.onGameOver();
      this.destroy();
    }
  }

  override resurrect(): void {
    super.resurrect();
    const sx = this.game.flipCoordCase(this.world.current.playerX);
    this.moveTo(BaseEntity.x_ctr(sx), BaseEntity.y_ctr(this.world.current.playerY));
    this.dx = 0;
    this.dy = 0;
    this.shield(null);
    this.changeWeapon(Data.WEAPON_B_CLASSIC);
    this.oxygen = 100;
    this.fl_knock = false;

    this.clearTemp();
    this.clearPerm();
    this.clearRec();

    this.playAnim(Data.ANIM_PLAYER_RESURRECT);
    this.stickAnim();
    this.fl_lockControls = true;

    if (this.game.fl_nightmare) {
      this.speedFactor = 1.3;
    }
    this.game.onResurrect();
  }

  shield(duration: number | null): void {
    const dur = duration ?? Data.SHIELD_DURATION;
    this.shieldMC?.destroy();
    this.shieldMC = this.game.fxMan.attachFx(this.x, this.y, 'hammer_player_shield');
    if (this.shieldMC) {
      this.shieldMC.fl_loop = true;
      this.shieldMC.stopBlink();
      this.shieldMC.lifeTimer = dur;
    }
    this.shieldTimer = dur;
    this.fl_shield = true;
  }

  unshield(): void {
    this.fl_shield = false;
    this.shieldTimer = 0;
    this.onShieldOut();
  }

  private onShieldOut(): void {
    this.game.fxMan.attachFx(this.x, this.y, 'popShield');
    this.shieldMC?.destroy();
    this.shieldMC = null;
    this.checkHits();
  }

  knock(d: number): void {
    if (this.fl_knock) return;
    this.fl_lockControls = true;
    this.fl_knock = true;
    this.knockTimer = d;
  }

  override hide(): void {
    super.hide();
    if (this.shieldMC) this.shieldMC.mc._visible = false;
  }

  override show(): void {
    super.show();
    if (this.shieldMC) this.shieldMC.mc._visible = true;
  }

  override scale(n: number): void {
    super.scale(n);
    const d = this.dir || 1;
    this.mc._xscale *= d;
  }

  override destroy(): void {
    this.shieldMC?.destroy();
    this.shieldMC = null;
    this.clearPerm();
    this.clearTemp();
    this.clearRec();
    super.destroy();
  }

  curse(id: number): void {
    const c = this.game.depthMan.attach('curse', Data.DP_FX);
    c._alpha = 70;
    c.gotoAndStop(String(id));
    this.stick(c, 0, -Data.CASE_HEIGHT * 2.5);
    this.setElaStick(0.25);
  }

  lockControls(d: number): void {
    this.lockTimer = d;
    this.playAnim(this.baseStopAnim);
    this.fl_lockControls = true;
  }

  override playAnim(a: AnimDef): void {
    let target = a;
    if (target.id === this.baseWalkAnim.id && this.speedFactor > 1) {
      target = Data.ANIM_PLAYER_RUN;
    }
    if (
      target.id === Data.ANIM_PLAYER_JUMP_DOWN.id &&
      (this.animId === Data.ANIM_PLAYER_AIRKICK.id || this.animId === Data.ANIM_PLAYER_KICK.id)
    ) {
      return;
    }
    if (this.fl_knock) {
      if (target.id !== Data.ANIM_PLAYER_DIE.id && target.id !== Data.ANIM_PLAYER_KNOCK_IN.id) {
        return;
      }
    }
    if (this.animId === Data.ANIM_PLAYER_CARROT.id) {
      return;
    }
    super.playAnim(target);
  }

  // ---------------------------------------------------------- Weapons & Kicking

  private isRecentKick(b: BombEntity): boolean {
    return this.recentKicks.some((rk) => rk.bid === b.uniqId);
  }

  isBombWeapon(id: number): boolean {
    return (
      id === Data.WEAPON_B_CLASSIC ||
      id === Data.WEAPON_B_BLACK ||
      id === Data.WEAPON_B_BLUE ||
      id === Data.WEAPON_B_GREEN ||
      id === Data.WEAPON_B_RED ||
      id === Data.WEAPON_B_REPEL
    );
  }

  isShootWeapon(id: number): boolean {
    return id === Data.WEAPON_S_ARROW || id === Data.WEAPON_S_FIRE || id === Data.WEAPON_S_ICE;
  }

  attack(): BaseEntity | null {
    if (this.actives[91] || this.actives[85]) return null;

    switch (this.currentWeapon) {
      case Data.WEAPON_B_CLASSIC:
        return this.drop(ClassicBomb.attach(this.game, this.x, this.y));
      case Data.WEAPON_B_BLACK:
        return this.drop(BlackBomb.attach(this.game, this.x, this.y));
      case Data.WEAPON_B_BLUE:
        return this.drop(BlueBomb.attach(this.game, this.x, this.y));
      case Data.WEAPON_B_GREEN:
        return this.drop(GreenBomb.attach(this.game, this.x, this.y));
      case Data.WEAPON_B_RED:
        return this.drop(RedBomb.attach(this.game, this.x, this.y));
      case Data.WEAPON_B_REPEL:
        return this.drop(RepelBomb.attach(this.game, this.x, this.y));
      case Data.WEAPON_S_ARROW:
        return this.shoot(PlayerArrowShoot.attach(this.game, this.x, this.y));
      case Data.WEAPON_S_FIRE:
        return this.shoot(PlayerFireBallShoot.attach(this.game, this.x, this.y));
      case Data.WEAPON_S_ICE:
        return this.shoot(PlayerPearlShoot.attach(this.game, this.x, this.y));
      default:
        return null;
    }
  }

  private drop(b: PlayerBomb): PlayerBomb {
    if (!this.fl_stable) {
      this.airJump();
    }
    b.setOwner(this);
    this.game.audio.playSound('sound_bomb_drop', Data.CHAN_PLAYER);
    if (!this.fl_stable) {
      this.kickBomb([b], 1.0);
    }
    return b;
  }

  airJump(): void {
    this.playAnim(Data.ANIM_PLAYER_JUMP_UP);
    if (this.dy > 0 || Math.abs(this.dy) < Data.PLAYER_AIR_JUMP) {
      this.dy = -Data.PLAYER_AIR_JUMP;
    }
  }

  private shoot(s: ShootEntity): ShootEntity {
    this.coolDown = s.coolDown;
    if (this.dir < 0) s.moveLeft(s.shootSpeed);
    else s.moveRight(s.shootSpeed);
    return s;
  }

  changeWeapon(id: number | null): void {
    const nextId = id ?? this.lastBomb;
    if (nextId > 0 && !this.isBombWeapon(nextId) && !this.isShootWeapon(nextId)) {
      return;
    }
    if (this.isBombWeapon(this.currentWeapon) && !this.isBombWeapon(nextId)) {
      this.lastBomb = this.currentWeapon;
    }
    if (this.isBombWeapon(nextId)) {
      this.lastBomb = nextId;
    }
    this.currentWeapon = nextId;
    this.replayAnim();
  }

  kickBomb(list: BombEntity[], powerFactor: number): void {
    for (const b of list) {
      if (this.isRecentKick(b)) continue;
      if ((b.fl_airKick || b.fl_stable) && !b.fl_explode) {
        b.dx = b.isType(Data.SOCCERBALL)
          ? this.dir * Data.PLAYER_HKICK_X * powerFactor
          : this.dir * Data.PLAYER_HKICK_X;

        if (this.dir < 0 && this.world.checkFlag(this.cx, this.cy, Data.IA_CLIMB_LEFT)) {
          const h = this.world.getWallHeight(this.cx - 1, this.cy, Data.IA_CLIMB);
          // AS2: a null height (wall too high) still passes `h <= 1`
          if ((h ?? 0) <= 1) b.moveTo(b.x, b.y - Data.CASE_HEIGHT * 0.5);
        }
        if (this.dir > 0 && this.world.checkFlag(this.cx, this.cy, Data.IA_CLIMB_RIGHT)) {
          const h = this.world.getWallHeight(this.cx + 1, this.cy, Data.IA_CLIMB);
          if ((h ?? 0) <= 1) b.moveTo(b.x, b.y - Data.CASE_HEIGHT * 0.5);
        }

        if (this.actives[13]) b.dx *= 2;
        if (this.game.fl_bombExpert && this.dx !== 0 && this.dx / b.dx > 0) b.dx *= 2.5;
        if (this.actives[115]) b.dx *= 1.5;

        b.dy = -Data.PLAYER_HKICK_Y;
        b.onKick(this);
        b.next = null;
        b.fl_bounce = true;
        this.recentKicks.push({ t: this.game.cycle, bid: b.uniqId });

        this.playAnim(Data.ANIM_PLAYER_KICK);
        this.game.audio.playSound('sound_kick', Data.CHAN_PLAYER);

        if (this.actives[92] && b.lifeTimer > 0) {
          const b2 = b.duplicate();
          if (b2) {
            if (b2.isType(Data.PLAYER_BOMB)) {
              (b2 as PlayerBomb).setOwner(this);
            }
            b2.lifeTimer = b.lifeTimer;
            b2.dx = -b.dx;
            b2.dy = b.dy;
            b2.fl_bounce = true;
          }
        }
        if (this.actives[70]) {
          this.getScore(this, 10);
        }
      }
    }
  }

  upKickBomb(list: BombEntity[]): void {
    for (const b of list) {
      if (this.isRecentKick(b)) continue;
      if ((b.fl_airKick || b.fl_stable) && !b.fl_explode) {
        b.dx *= 2;
        if (Math.abs(b.dx) <= 1.5) {
          b.dx = 0.5 * this.dir;
        }
        b.dy = -Data.PLAYER_VKICK;
        if (this.actives[13]) b.dy *= 2;
        if (this.actives[115]) {
          b.dy *= 2;
          b.dx *= 1.3;
        }
        b.next = null;
        b.onKick(this);
        b.fl_stable = false;
        b.fl_bounce = true;
        this.recentKicks.push({ t: this.game.cycle, bid: b.uniqId });
        this.playAnim(Data.ANIM_PLAYER_KICK);
        this.game.audio.playSound('sound_kick', Data.CHAN_PLAYER);
        if (this.actives[70]) {
          this.getScore(this, 10);
        }
      }
    }
  }

  countBombs(): number {
    let n = 0;
    const list = this.game.getList(Data.PLAYER_BOMB) as PlayerBomb[];
    for (const b of list) {
      if (!b.fl_explode && b.parent === this) n++;
    }
    return n;
  }

  // --------------------------------------------------------- Animation & Events

  override onEndAnim(id: number): void {
    super.onEndAnim(id);

    if (id === Data.ANIM_PLAYER_KNOCK_OUT.id || id === Data.ANIM_PLAYER_RESURRECT.id) {
      this.fl_lockControls = false;
      this.playAnim(this.baseStopAnim);
      return;
    }

    if (id === Data.ANIM_PLAYER_AIRKICK.id) {
      this.animId = null;
      this.playAnim(Data.ANIM_PLAYER_JUMP_DOWN);
      return;
    }

    if (id === Data.ANIM_PLAYER_KICK.id && !this.fl_stable) {
      this.animId = null;
      this.playAnim(Data.ANIM_PLAYER_JUMP_DOWN);
      return;
    }

    if (
      id === Data.ANIM_PLAYER_CARROT.id ||
      id === Data.ANIM_PLAYER_KICK.id ||
      id === Data.ANIM_PLAYER_ATTACK.id ||
      id === Data.ANIM_PLAYER_WAIT1.id ||
      id === Data.ANIM_PLAYER_WAIT2.id ||
      id === Data.ANIM_PLAYER_JUMP_LAND.id
    ) {
      this.playAnim(this.baseStopAnim);
    }
  }

  override onDeathLine(): void {
    super.onDeathLine();

    if (this.fl_kill) {
      this.killPlayer();
    } else if (this.game.checkLevelClear()) {
      this.dy = 0;
      this.game.nextLevel();
    } else {
      this.y = Data.LEVEL_HEIGHT * Data.CASE_HEIGHT - Data.CASE_HEIGHT - 1;
      this.dx = 0;
      this.forceKill(0);
    }
  }

  private onWakeUp(): void {
    this.fl_knock = false;
    if (this.fl_stable) {
      this.dx = 0;
      this.playAnim(Data.ANIM_PLAYER_KNOCK_OUT);
    } else {
      this.fl_lockControls = false;
      this.playAnim(Data.ANIM_PLAYER_JUMP_DOWN);
    }
  }

  override onTeleport(): void {
    super.onTeleport();
    this.dx = 0;
    this.dy = 0;
    if (this.shieldMC) {
      this.shieldMC.mc._x = this.x;
      this.shieldMC.mc._y = this.y;
    }
  }

  onNextLevel(): void {
    this.changeWeapon(Data.WEAPON_B_CLASSIC);
    if (this.fl_shield) {
      this.shieldTimer = 1;
    }
    this.clearTemp();
    this.clearRec();
  }

  onStartLevel(isMainWorld = true): void {
    this.show();
    if (isMainWorld) {
      this.game.hud.setLevel(this.world.currentId);
    } else if (this.game.fakeLevelId === null) {
      this.game.hud.hideLevel();
    } else {
      this.game.hud.setLevel(this.game.fakeLevelId);
    }
    if (this.fl_shield && !this.shieldMC) {
      this.shield(this.shieldTimer);
    }
    this.fl_entering = true;
  }

  override onHitGround(h: number): void {
    if (this.actives[90] && !this.fl_knock && h >= Data.CASE_HEIGHT * 2) {
      this.knock(Data.SECOND);
    }

    super.onHitGround(h);

    if (h >= Data.DUST_FALL_HEIGHT) {
      this.game.fxMan.dust(this.cx, this.cy + 1);
    }
    this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_fall');
    this.game.audio.playSound('sound_land', Data.CHAN_PLAYER);

    if (this.actives[39]) {
      this.game.shake(10, 2);
      const bads = this.game.getList(Data.BAD_CLEAR) as BadEntity[];
      for (const b of bads) b.knock(Data.SECOND);
    }

    this.showTeleporters();
  }

  override onHitWall(): void {
    if (this.fl_knock) {
      this.dx = -this.dx * 0.5;
      if (Math.abs(this.dx) >= 10 && this.world.getCase(this.cx, this.cy) <= 0) {
        this.game.shake(Math.round(Data.SECOND * 0.7), 5);
        this.game.fxMan.inGameParticles(0, this.x, this.y, 4);
      }
    } else {
      super.onHitWall();
    }
  }

  override onPortal(pid: number): void {
    super.onPortal(pid);
    if (!this.game.usePortal(pid, this)) {
      this.onPortalRefusal();
    }
  }

  override onPortalRefusal(): void {
    super.onPortalRefusal();
    this.x = this.oldX;
    this.y = this.oldY;
    this.dx = -this.dx;
    this.knock(Data.SECOND * 0.5);
    this.game.fxMan.inGameParticles(0, this.x, this.y, this.game.rand.random(5) + 5);
    this.game.shake(Data.SECOND, 3);
    this.fl_stopStepping = true;
  }

  override onBump(): void {
    super.onBump();
    this.fl_knock = false;
    this.knock(Data.SECOND * 0.7);
  }

  // ------------------------------------------------ Input Controller (32 Hz)

  private updateControls(): void {
    const input = this.game.input;

    if (this.fl_stable) {
      this.waterJump = 3;
    }

    const leftDown = input.isDown('left');
    const rightDown = input.isDown('right');

    if (leftDown) {
      if (this.game.fl_ice || this.game.fl_aqua) {
        const frict = !this.fl_stable && this.game.fl_ice ? 0.35 : 0.1;
        this.dx -= frict * Data.PLAYER_SPEED * this.speedFactor;
        this.dx = Math.max(this.dx, -Data.PLAYER_SPEED * this.speedFactor);
      } else {
        this.dx = -Data.PLAYER_SPEED * this.speedFactor;
      }
      this.dir = -1;
      if (this.fl_stable) this.playAnim(this.baseWalkAnim);
    }

    if (rightDown) {
      if (this.game.fl_ice || this.game.fl_aqua) {
        const frict = !this.fl_stable && this.game.fl_ice ? 0.35 : 0.1;
        this.dx += frict * Data.PLAYER_SPEED * this.speedFactor;
        this.dx = Math.min(this.dx, Data.PLAYER_SPEED * this.speedFactor);
      } else {
        this.dx = Data.PLAYER_SPEED * this.speedFactor;
      }
      this.dir = 1;
      if (this.fl_stable) this.playAnim(this.baseWalkAnim);
    }

    if (this.actives[73] && this.fl_stable && this.dx !== 0) {
      this.walkTimer -= 1;
      if (this.walkTimer <= 0) {
        this.walkTimer = Data.SECOND;
        this.getScore(this, 10);
      }
    }

    if (!leftDown && !rightDown) {
      if (!this.game.fl_ice) {
        this.dx *= this.game.gFriction * 0.8;
      }
      if (this.animId === this.baseWalkAnim.id || this.animId === Data.ANIM_PLAYER_RUN.id) {
        this.playAnim(this.baseStopAnim);
      }
    }

    // Water air-jumps
    if (this.game.fl_aqua && this.waterJump > 0 && !this.fl_stable && input.consumePress('jump')) {
      this.airJump();
      this.waterJump--;
    }

    // Standard / continuous pogo jump on ground
    if (this.fl_stable && input.isDown('jump')) {
      this.dy = this.actives[88] ? -Data.PLAYER_JUMP * 0.5 : -Data.PLAYER_JUMP;
      this.game.audio.playSound('sound_jump', Data.CHAN_PLAYER);
      this.playAnim(Data.ANIM_PLAYER_JUMP_UP);
      const fx = this.game.fxMan.attachFx(this.x, this.y, 'hammer_fx_jump');
      if (fx) fx.mc._alpha = 50;
      if (this.actives[66]) {
        this.getScore(this, 10);
      }
      input.lock('jump');
    }

    // Attack / bomb drop / bomb kick
    // The key is read (and locked) before the cooldown test, as in `keyIsDown(attack) && coolDown==0`
    if (input.consumePress('attack') && this.coolDown === 0) {
      let dist = this.fl_stable ? Data.KICK_DISTANCE : Data.AIR_KICK_DISTANCE;
      if (this.actives[115]) dist *= 1.2;

      const bombList = this.game.getClose(Data.BOMB, this.x, this.y, dist, false) as BombEntity[];
      if (bombList.length === 0) {
        if (this.currentWeapon > 0 && this.countBombs() < this.maxBombs) {
          const e = this.attack();
          if (e) e.setParent(this);
          if (this.fl_stable) {
            this.playAnim(Data.ANIM_PLAYER_ATTACK);
          }
        }
      } else {
        this.kickBomb(bombList, 1.0);
      }
    } else if (input.consumePress('down') && this.fl_upKick) {
      let dist = this.fl_stable ? Data.KICK_DISTANCE : Data.AIR_KICK_DISTANCE;
      if (this.actives[115]) dist *= 1.2;
      const bombList = this.game.getClose(Data.BOMB, this.x, this.y, dist, false) as BombEntity[];
      if (bombList.length > 0) {
        this.upKickBomb(bombList);
      }
    }
  }

  // --------------------------------------------------- Special Item Execution

  private permanent(id: number): void {
    if (!this.actives[id]) {
      this.actives[id] = true;
      this.permList.push(id);
    }
  }

  private temporary(id: number, duration: number | null): void {
    const dur = duration ?? 99999;
    if (!this.actives[id]) {
      this.actives[id] = true;
      this.tempList.push({ id, end: this.game.cycle + dur });
    }
  }

  private interruptSpecial(id: number): void {
    if (!this.actives[id]) return;
    this.actives[id] = false;

    switch (id) {
      case 4:
      case 5:
        this.maxBombs = this.initialMaxBombs;
        break;
      case 7:
      case 22:
        this.speedFactor = this.game.fl_nightmare ? 1.3 : 1.0;
        this.unstick();
        break;
      case 18:
      case 39:
        this.fallFactor = 1.1;
        break;
      case 29:
        if (this.currentWeapon === Data.WEAPON_S_FIRE) this.changeWeapon(null);
        break;
      case 37:
        if (this.currentWeapon === Data.WEAPON_S_ICE) this.changeWeapon(null);
        break;
      case 67:
        if (this.currentWeapon === Data.WEAPON_S_ARROW) this.changeWeapon(null);
        break;
      case 69:
        this.game.globalActives[id] = false;
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor /= 0.6;
        }
        break;
      case 80:
        this.game.globalActives[id] = false;
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor /= 0.3;
        }
        break;
      case 88:
        this.unstick();
        this.scale(100);
        break;
      case 90:
      case 91:
      case 95:
      case 114:
        this.unstick();
        break;
      case 99:
        this.fl_chourou = false;
        this.replayAnim();
        this.clearRec();
        break;
      default:
        break;
    }
  }

  clearTemp(): void {
    while (this.tempList.length > 0) {
      const entry = this.tempList.shift()!;
      this.interruptSpecial(entry.id);
    }
  }

  clearPerm(): void {
    while (this.permList.length > 0) {
      const id = this.permList.shift()!;
      this.interruptSpecial(id);
    }
  }

  clearRec(): void {
    this.recurring = [];
  }

  private updateSpecials(): void {
    for (let i = 0; i < this.recurring.length; i++) {
      const r = this.recurring[i];
      r.timer -= 1;
      if (r.timer <= 0) {
        r.func();
        if (r.fl_repeat) {
          r.timer += r.baseTimer;
        } else {
          this.recurring.splice(i, 1);
          i--;
        }
      }
    }

    for (let i = 0; i < this.tempList.length; i++) {
      if (this.game.cycle >= this.tempList[i].end) {
        this.interruptSpecial(this.tempList[i].id);
        this.tempList.splice(i, 1);
        i--;
      }
    }
  }

  private onStrike(): void {
    const blist = (this.game.getList(Data.BAD_CLEAR) as BadEntity[]).filter((b) => !b.fl_kill);
    if (blist.length === 0) return;
    const bad = blist[0];
    const s = this.game.fxMan.attachFx(
      Data.DOC_WIDTH * 0.5,
      bad.y - Data.CASE_HEIGHT * 0.5,
      'hammer_fx_strike',
    );
    const dir = this.game.rand.next() < 0.5 ? -1 : 1;
    if (s) {
      s.mc._xscale *= dir;
      s.mc._yscale = this.game.rand.random(50) + 50;
    }
    this.game.fxMan.attachShine(bad.x, bad.y);
    bad.forceKill(dir * (this.game.rand.random(10) + 15));
  }

  executeSpecialItem(item: SpecialItem): void {
    const id = item.id;
    const subId = item.subId ?? 0;

    switch (id) {
      case 0:
        if (this.actives[27]) this.getScore(item, 25);
        this.getScoreHidden(5);
        this.getExtend(subId);
        break;
      case 1:
        this.shield(Data.SECOND * 10);
        break;
      case 2:
        this.shield(Data.SECOND * 60);
        break;
      case 4:
        if (!this.actives[5]) {
          this.maxBombs = this.initialMaxBombs + 1;
          this.permanent(id);
        }
        break;
      case 5:
        this.maxBombs = this.initialMaxBombs + 4;
        this.permanent(id);
        break;
      case 6:
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.freeze(Data.FREEZE_DURATION * 2);
        }
        break;
      case 7:
        this.speedFactor = 1.5;
        this.permanent(id);
        break;
      case 11:
        if (this.world.currentId + 1 < this.world.levelCount) {
          this.game.forcedGoto(this.world.currentId + 1);
        }
        break;
      case 12:
        if (this.world.currentId + 2 < this.world.levelCount) {
          this.game.forcedGoto(this.world.currentId + 2);
        }
        break;
      case 13:
      case 26:
      case 27:
      case 66:
      case 68:
      case 70:
      case 73:
      case 92:
      case 94:
        this.permanent(id);
        break;
      case 14:
      case 15:
      case 16:
      case 17:
        for (const other of [14, 15, 16, 17]) {
          if (other !== id) this.interruptSpecial(other);
        }
        this.permanent(id);
        break;
      case 18:
        this.permanent(id);
        this.fallFactor = 0.55;
        break;
      case 19:
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.forceKill(null);
        }
        break;
      case 20:
        for (let i = 0; i < 5; i++) {
          const s = ScoreItem.attach(this.game, item.x, item.y, 0, this.game.rand.random(4));
          s.moveFrom(item, 8);
        }
        break;
      case 21: {
        const b = this.game.getOne(Data.BAD_CLEAR) as BadEntity | null;
        if (b) {
          this.game.fxMan.attachFx(b.x, b.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
          b.forceKill(null);
        }
        break;
      }
      case 22:
        this.interruptSpecial(7);
        this.curse(2);
        this.speedFactor = 0.6;
        this.temporary(id, Data.SECOND * 40);
        break;
      case 23:
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          const s = PlayerPearlShoot.attach(this.game, this.x, this.y - Data.CASE_WIDTH);
          s.moveToTarget(b, s.shootSpeed);
          s.fl_borderBounce = true;
          s.setLifeTimer(Data.SECOND * 3 + this.game.rand.random(40));
          s.endUpdate();
        }
        break;
      case 25:
        for (let i = 0; i < 4; i++) {
          const s1 = PlayerFireBallShoot.attach(
            this.game,
            Data.GAME_WIDTH * 0.125 + Data.GAME_WIDTH * 0.25 * i,
            10,
          );
          s1.moveDown(s1.shootSpeed);
          const s2 = PlayerFireBallShoot.attach(
            this.game,
            Data.GAME_WIDTH * 0.25 + Data.GAME_WIDTH * 0.25 * i,
            Data.GAME_HEIGHT - 10,
          );
          s2.moveUp(s2.shootSpeed);
        }
        break;
      case 28:
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.knock(Data.SECOND * 10);
        }
        break;
      case 29:
        this.changeWeapon(Data.WEAPON_S_FIRE);
        this.temporary(id, WEAPON_DURATION);
        break;
      case 32:
      case 33:
      case 34: {
        const subMap: Record<number, number> = { 32: 0, 33: 2, 34: 5 };
        for (const b of [...(this.game.getList(Data.BAD_CLEAR) as BadEntity[])]) {
          b.destroy();
          ScoreItem.attach(this.game, b.x, b.y - Data.CASE_HEIGHT, 0, subMap[id] ?? 0);
        }
        break;
      }
      case 35:
        for (const b of [...(this.game.getList(Data.BAD_CLEAR) as BadEntity[])]) {
          b.destroy();
          ScoreItem.attach(this.game, b.x - Data.CASE_WIDTH, b.y - Data.CASE_HEIGHT, 0, 6);
          ScoreItem.attach(this.game, b.x + Data.CASE_WIDTH, b.y - Data.CASE_HEIGHT, 0, 6);
        }
        break;
      case 36:
        this.lives++;
        this.game.hud.setLives(this.lives);
        this.game.fxMan.attachShine(item.x, item.y - Data.CASE_HEIGHT * 0.5);
        break;
      case 103:
      case 104:
      case 105:
        this.lives++;
        this.game.hud.setLives(this.lives);
        this.game.fxMan.attachShine(item.x, item.y - Data.CASE_HEIGHT * 0.5);
        this.game.randMan.remove(Data.RAND_ITEMS_ID, id);
        break;
      case 37:
        this.changeWeapon(Data.WEAPON_S_ICE);
        this.temporary(id, WEAPON_DURATION);
        break;
      case 39:
        this.fallFactor = 1.6;
        this.temporary(id, null);
        break;
      case 64:
        for (let i = 0; i < 5; i++) {
          const pt = this.world.getGround(
            this.game.rand.random(Data.LEVEL_WIDTH),
            this.game.rand.random(Data.LEVEL_HEIGHT),
          );
          SpecialItem.attach(
            this.game,
            pt.x * Data.CASE_WIDTH,
            pt.y * Data.CASE_HEIGHT,
            0,
            this.game.rand.random(7),
          );
        }
        break;
      case 65:
        for (const b of this.game.getList(Data.BAD)) {
          this.getScore(b, b.isType(Data.BAD_CLEAR) ? 2500 : 600);
        }
        break;
      case 67:
        this.changeWeapon(Data.WEAPON_S_ARROW);
        this.temporary(id, WEAPON_DURATION);
        break;
      case 69:
        this.game.globalActives[id] = true;
        this.temporary(id, Data.SECOND * 30);
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor *= 0.6;
        }
        break;
      case 71: {
        const sL = PlayerFireBallShoot.attach(this.game, item.x, item.y);
        sL.moveLeft(sL.shootSpeed);
        const sR = PlayerFireBallShoot.attach(this.game, item.x, item.y);
        sR.moveRight(sR.shootSpeed);
        break;
      }
      case 72: {
        this.game.destroyList(Data.ITEM);
        this.game.destroyList(Data.BAD_BOMB);
        let n = 1;
        for (const b of [...(this.game.getList(Data.BAD_CLEAR) as BadEntity[])]) {
          ScoreItem.attach(this.game, b.x, b.y, 0, n);
          b.destroy();
          n++;
        }
        break;
      }
      case 74:
      case 75:
      case 76: {
        const scoreId = id - 71;
        for (let i = 0; i < 7; i++) {
          const it = ScoreItem.attach(
            this.game,
            this.game.rand.random(Data.GAME_WIDTH),
            Data.GAME_HEIGHT,
            scoreId,
            null,
          );
          it.moveToAng(-20 - this.game.rand.random(160), this.game.rand.random(15) + 10);
        }
        break;
      }
      case 80:
        this.game.globalActives[id] = true;
        this.temporary(id, Data.SECOND * 30);
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor *= 0.3;
        }
        break;
      case 82:
        this.onStrike();
        break;
      case 83:
        this.temporary(id, null);
        this.recurring.push({
          timer: Data.SECOND,
          baseTimer: Data.SECOND,
          fl_repeat: true,
          func: () => this.onStrike(),
        });
        this.onStrike();
        break;
      case 86:
        this.temporary(id, Data.SECOND * 60);
        break;
      case 88:
        this.curse(4);
        this.game.fxMan.attachShine(this.x, this.y);
        this.scale(50);
        this.temporary(id, Data.SECOND * 30);
        break;
      case 89: {
        const e = this.game.getOne(Data.BAD_CLEAR);
        if (e) {
          this.game.attachBad(Data.BAD_TZONGRE, e.x, e.y - Data.CASE_HEIGHT);
          e.destroy();
        }
        break;
      }
      case 90:
        this.temporary(id, Data.SECOND * 40);
        this.curse(6);
        break;
      case 91:
        this.curse(3);
        this.game.fxMan.attachShine(this.x, this.y);
        this.temporary(id, Data.SECOND * 15);
        break;
      case 95:
        this.curse(5);
        this.permanent(id);
        break;
      case 99:
        this.recurring.push({
          timer: Data.SECOND * 2,
          baseTimer: Data.SECOND * 2,
          fl_repeat: true,
          func: () => this.getScore(this, 250),
        });
        this.fl_chourou = true;
        this.temporary(id, null);
        break;
      case 101:
        if (this.game.rand.next() < 0.5) {
          this.getScore(item, 5000);
        } else {
          const b = PoireBomb.attach(this.game, item.x, item.y);
          b.moveToAng(-90, 10);
        }
        break;
      case 102:
        this.game.huTimer = 0;
        this.getScore(item, 100000);
        this.fl_carot = true;
        break;
      case 114:
      case 115:
        this.permanent(id);
        break;
      default:
        if (id >= 40 && id <= 63) {
          for (const b of this.game.getList(Data.BAD_CLEAR)) {
            ScoreItem.attach(this.game, b.x, b.y - Data.CASE_HEIGHT * 2, 169, 0);
          }
        } else {
          this.game.fxMan.attachShine(item.x, item.y - Data.CASE_HEIGHT * 0.5);
          this.getScore(item, 2500);
        }
        break;
    }
  }

  // ------------------------------------------------------------------ Updates

  override endUpdate(): void {
    super.endUpdate();

    if (this.shieldMC) {
      if (this.shieldTimer <= Data.SECOND * 3) {
        this.shieldMC.blink();
      }
      this.shieldMC.mc._x += (this.x - this.shieldMC.mc._x) * 0.75;
      this.shieldMC.mc._y += (this.y - 20 - this.shieldMC.mc._y) * 0.75;
    }

    this.mc._xscale = this.dir * Math.abs(this.mc._xscale);
  }

  override update(): void {
    for (let i = 0; i < this.recentKicks.length; i++) {
      if (this.game.cycle - this.recentKicks[i].t > 2) {
        this.recentKicks.splice(i, 1);
        i--;
      }
    }

    if (!this.fl_kill && this.game.fl_aqua) {
      this.oxygen -= 0.1;
      if (this.oxygen <= 0) {
        this.killHit(0);
      }
    }

    this.updateSpecials();

    if (!this.fl_kill && !this.fl_lockControls) {
      if (!this.fl_entering && this.mc._visible) {
        this.updateControls();
      }
    }
    if (this.fl_entering && this.cy >= 0) {
      this.fl_entering = false;
    }

    if (this.coolDown > 0) {
      this.coolDown = Math.max(0, this.coolDown - 1);
    }

    if (this.fl_knock) {
      this.knockTimer -= 1;
      if (this.knockTimer <= 0) {
        this.onWakeUp();
      } else if (this.fl_stable && this.animId !== Data.ANIM_PLAYER_KNOCK_IN.id) {
        this.playAnim(Data.ANIM_PLAYER_KNOCK_IN);
      } else if (!this.fl_stable && this.animId !== Data.ANIM_PLAYER_DIE.id) {
        this.playAnim(Data.ANIM_PLAYER_DIE);
      }
    }

    if (this.fl_lockControls && this.fl_stable && this.animId === this.baseStopAnim.id) {
      this.fl_lockControls = false;
    }

    if (this.lockTimer > 0) {
      this.lockTimer -= 1;
      this.fl_lockControls = this.lockTimer > 0;
    }

    if (this.fl_shield) {
      this.shieldTimer -= 1;
      if (this.shieldTimer <= 0) {
        this.unshield();
      }
    }

    super.update();
    this.updateCoords();

    if (this.dx !== 0 || this.dy !== 0) {
      this.edgeTimer = 0;
      this.waitTimer = 0;
    }

    if (!this.fl_kill) {
      if (
        !this.fl_stable &&
        this.dy >= 0 &&
        this.animId !== Data.ANIM_PLAYER_JUMP_DOWN.id &&
        !this.fl_lockControls
      ) {
        this.playAnim(Data.ANIM_PLAYER_JUMP_DOWN);
      }
      if (this.animId === Data.ANIM_PLAYER_JUMP_DOWN.id && this.fl_stable) {
        this.playAnim(Data.ANIM_PLAYER_JUMP_LAND);
      }

      if (this.animId === Data.ANIM_PLAYER_STOP.id) {
        if (this.waitTimer <= 0) this.waitTimer = Data.WAIT_TIMER;
        this.waitTimer -= 1;
        if (this.waitTimer <= 0) {
          this.playAnim(
            this.game.rand.random(20) === 0 ? Data.ANIM_PLAYER_WAIT1 : Data.ANIM_PLAYER_WAIT2,
          );
        }
      }

      if (this.fl_stable && this.dx === 0 && this.animId === this.baseStopAnim.id) {
        const pt = BaseEntity.rtc(
          this.x + this.dir * Data.CASE_WIDTH * 0.3,
          this.y + Data.CASE_HEIGHT,
        );
        if (
          this.world.getCase(pt.x, pt.y) <= 0 &&
          this.world.getCase(this.cx + this.dir, this.cy) === 0
        ) {
          if (this.edgeTimer <= 0) this.edgeTimer = Data.EDGE_TIMER;
          this.edgeTimer -= 1;
          if (this.edgeTimer <= 0) {
            this.playAnim(Data.ANIM_PLAYER_EDGE);
          }
        }
      }
    }
  }
}
