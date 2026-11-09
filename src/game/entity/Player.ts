import { Timer } from '../../engine/Timer';
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
import {
  FireRainShoot,
  HammerShoot,
  PlayerArrowShoot,
  PlayerFireBallShoot,
  PlayerPearlShoot,
  type ShootEntity,
} from './Shoot';
import { Log } from '../Log';
import { ArrowSupa, BallSupa, BubbleSupa, IceMeteorSupa, SmokeSupa, TonsSupa } from './Supa';

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
  /** The dev keys' state (`getDebugControls`): the last key, the numpad input, the next grid. */
  dbg_lastKey = 0;
  debugInput = '';
  dbg_grid = 0;
  fl_entering = false;

  score = 0;
  /** `scoreCS`: the score hidden with `GameManager.KEY`, to catch a score changed from outside. */
  scoreCS = 0;
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
  lockTimer = 0;

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

  /** Storm clouds of the fire rain talisman (item 84). */
  private clouds: SwfMovieClip[] = [];

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
    game.logAction('$P:' + this.lives);
  }

  /**
   * `Player.getDebugControls`, the original's dev keys, read for player 1 when its controls are
   * free. Three numpad digits make a number n: with Ctrl, go to level n; with Alt, a score item
   * n; else a special item n. N next level, K every key, I a random special item, numpad / the
   * next hurry up, numpad + and - anger or calm every enemy, numpad * removes them, G shows a
   * flag of the case grid, W the next weapon.
   */
  getDebugControls(): void {
    const game = this.game;
    const key = (c: number) => game.input.isKeyDown(c);

    // Last key held
    if (this.dbg_lastKey > 0 && !key(this.dbg_lastKey)) {
      this.dbg_lastKey = 0;
    }

    // A number on the numpad
    for (let i = 0; i < 10; i++) {
      if (key(96 + i) && this.dbg_lastKey !== 96 + i) {
        this.debugInput += String(i);
        this.dbg_lastKey = 96 + i;
      }
    }
    if (this.debugInput.length >= 3) {
      const n = parseInt(this.debugInput, 10);
      if (key(17)) {
        game.forcedGoto(n);
      } else if (key(18)) {
        game.spawnScoreItem(this.x + this.dir * 30, this.y, n, null);
      } else {
        game.spawnSpecialItem(this.x + this.dir * 30, this.y, n, null);
      }
      this.debugInput = '';
    }
    if (key(8)) {
      this.debugInput = '';
    }

    if (this.debugInput.length > 0) {
      let str = this.debugInput;
      while (str.length < 3) {
        str += '_';
      }
      Log.print(`INPUT: ${str}`);
      Log.print('(backspace to clear)');
    }

    // Next level "n"
    if (key(78) && this.dbg_lastKey !== 78) {
      game.nextLevel();
      this.dbg_lastKey = 78;
    }

    // Every key "k"
    if (key(75) && this.dbg_lastKey !== 75) {
      for (let i = 0; i < 50; i++) {
        game.giveKey(i);
      }
      this.dbg_lastKey = 75;
    }

    // Item spawn "i"
    if (key(73) && this.dbg_lastKey !== 73) {
      game.spawnSpecialItem(
        game.rand.random(200) + 200,
        20,
        game.randMan.draw(Data.RAND_ITEMS_ID) ?? 0,
        0,
      );
      this.dbg_lastKey = 73;
    }

    // Next hurry up "/"
    if (key(111) && this.dbg_lastKey !== 111) {
      game.huTimer = 9999999;
      game.huState++;
      this.dbg_lastKey = 111;
    }

    // Anger more "+"
    if (key(107) && this.dbg_lastKey !== 107) {
      for (const b of game.getList(Data.BAD) as BadEntity[]) {
        b.angerMore();
      }
      this.dbg_lastKey = 107;
    }

    // Calm down "-"
    if (key(109) && this.dbg_lastKey !== 109) {
      for (const b of game.getList(Data.BAD) as BadEntity[]) {
        b.calmDown();
      }
      this.dbg_lastKey = 109;
    }

    // Case flag grid "g"
    if (key(71) && this.dbg_lastKey !== 71) {
      game.view.detachGrid();
      game.view.attachGrid(Math.round(Math.pow(2, this.dbg_grid)), true);
      Log.trace(`* WARNING * grid: ${Data.GRID_NAMES[this.dbg_grid]}`);
      this.dbg_grid++;
      if (Data.GRID_NAMES[this.dbg_grid] === undefined) {
        this.dbg_grid = 0;
      }
      this.dbg_lastKey = 71;
    }

    // Next weapon "w"
    if (key(87) && this.dbg_lastKey !== 87) {
      this.currentWeapon++;
      if (this.currentWeapon > 9) {
        this.currentWeapon = 1;
      }
      this.changeWeapon(this.currentWeapon);
      this.dbg_lastKey = 87;
    }

    // Removes every enemy "*"
    if (key(106) && this.dbg_lastKey !== 106) {
      for (const b of game.getList(Data.BAD)) {
        b.destroy();
      }
      this.dbg_lastKey = 106;
    }
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
    // The Tornade option, the game pads quest's gift
    if (this.game._name !== '$time' && this.game.hasOption(Data.OPT_BOOST)) {
      this.speedFactor = 1.3;
      if (this.game.fl_nightmare) {
        this.speedFactor = 1.6;
      }
    }
    this.endUpdate();
  }

  // --------------------------------------------------- Combat & Item Collisions

  override hit(e: BaseEntity): void {
    if (e.isType(Data.ITEM)) {
      const it = e as ItemEntity;
      it.execute(this);
      if (it.id === Data.CONVERT_DIAMANT) {
        // pearl
        this.onPickPerfectItem();
      }
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

    let power = 20;
    if (Timer.tmod <= 0.6) {
      power = 40;
    }

    super.killHit(sign * power);
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
      this.game.logAction('$EL' + this.extraLifeCurrent);
      this.extraLifeCurrent++;
    }
    if (this.score !== 0 && (this.scoreCS ^ this.game.scoreKey) !== this.score) {
      this.game.logIllegal('$SCS');
    }
    this.score += value;
    this.scoreCS = this.score ^ this.game.scoreKey;
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
    this.game.registerMapEvent(Data.EVENT_EXTEND, null);
    this.game.logAction('$ext');
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
      mc.setVariable('label', this.game.dataStore.getStatic(11));
      mc.setVariable('bonus', this.actives[95] ? '300000' : '150000');
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
    this.game.statsMan.inc(Data.STAT_DEATH, 1);
    this.lives--;
    this.game.hud.setLives(this.lives);
    if (this.lives >= 0) {
      this.resurrect();
    } else {
      // Single player: the other players' lives (and the life sharing option) never matter
      for (const p of this.game.getList(Data.PLAYER) as PlayerEntity[]) {
        this.game.registerScore(p.pid, p.score);
      }
      this.game.onGameOver();
      this.destroy();
    }
  }

  override resurrect(): void {
    super.resurrect();
    this.game.logAction('$R' + this.lives);
    this.moveTo(
      BaseEntity.x_ctr(this.world.current.playerX),
      BaseEntity.y_ctr(this.world.current.playerY),
    );
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
    // The Tornade option, the game pads quest's gift
    if (this.game._name !== '$time' && this.game.hasOption(Data.OPT_BOOST)) {
      this.speedFactor = 1.3;
      if (this.game.fl_nightmare) {
        this.speedFactor = 1.6;
      }
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
    this.game.registerScore(this.pid, this.score);
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

  /** Changes the base walk/stop animations (null keeps one), replaying them if active. */
  setBaseAnims(aWalk: AnimDef | null, aStop: AnimDef | null): void {
    let flWalk = false;
    let flStop = false;
    if (this.animId === this.baseWalkAnim.id) flWalk = true;
    if (this.animId === this.baseStopAnim.id) flStop = true;
    if (this.animId === Data.ANIM_PLAYER_WAIT1.id || this.animId === Data.ANIM_PLAYER_WAIT2.id) {
      flStop = true;
    }
    if (aWalk !== null) this.baseWalkAnim = aWalk;
    if (aStop !== null) this.baseStopAnim = aStop;
    if (flWalk) this.playAnim(this.baseWalkAnim);
    if (flStop) this.playAnim(this.baseStopAnim);
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
    this.game.statsMan.inc(Data.STAT_BOMB, 1);
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
    this.game.statsMan.inc(Data.STAT_SHOT, 1);
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
        this.game.statsMan.inc(Data.STAT_KICK, 1);

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
        this.game.statsMan.inc(Data.STAT_KICK, 1);
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
    this.game.logAction(this.world.currentId + ',' + Math.floor(this.score / 1000));
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
        const rand = this.game.rand;
        this.game.fxMan.inGameParticlesDir(
          Data.PARTICLE_STONE,
          this.x,
          this.y,
          1 + rand.random(3),
          this.dx,
        );
        this.game.fxMan.inGameParticlesDir(
          Data.PARTICLE_CLASSIC_BOMB,
          this.x,
          this.y,
          3 + rand.random(5),
          this.dx,
        );
      }
    } else {
      super.onHitWall();
    }
  }

  override onPortal(pid: number | null): void {
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
    this.game.fxMan.inGameParticles(
      Data.PARTICLE_PORTAL,
      this.x,
      this.y,
      this.game.rand.random(5) + 5,
    );
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

    // Last keys held: their locks go only here, so not while the controls are locked
    input.releaseControllerLocks();

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
      this.walkTimer -= Timer.tmod;
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
    if (this.game.fl_aqua && this.waterJump > 0 && !this.fl_stable && input.keyIsDown('jump')) {
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
      this.game.statsMan.inc(Data.STAT_JUMP, 1);
      input.lockKey('jump');
    }

    // Attack / bomb drop / bomb kick
    // The key is read (and locked) before the cooldown test, as in `keyIsDown(attack) && coolDown==0`
    if (input.keyIsDown('attack') && this.coolDown === 0) {
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
    } else if (input.keyIsDown('down') && this.fl_upKick) {
      let dist = this.fl_stable ? Data.KICK_DISTANCE : Data.AIR_KICK_DISTANCE;
      if (this.actives[115]) dist *= 1.2;
      const bombList = this.game.getClose(Data.BOMB, this.x, this.y, dist, false) as BombEntity[];
      if (bombList.length > 0) {
        this.upKickBomb(bombList);
      }
    }
  }

  // --------------------------------------------------- Special Item Execution
  // Port of `SpecialManager` (`class/hammer/SpecialManager.mt`).

  private permanent(id: number): void {
    if (!this.actives[id]) {
      this.actives[id] = true;
      this.permList.push(id);
    }
  }

  private temporary(id: number, duration: number | null): void {
    // null lasts until the end of the current level
    const dur = duration ?? 99999;
    if (!this.actives[id]) {
      this.actives[id] = true;
      this.tempList.push({ id, end: this.game.cycle + dur });
    }
  }

  /** `SpecialManager.global`: a game-wide effect, read by the enemies and the session. */
  private global(id: number): void {
    this.game.globalActives[id] = true;
  }

  /** `SpecialManager.interrupt` */
  interruptSpecial(id: number): void {
    if (!this.actives[id]) return;
    this.actives[id] = false;
    this.game.fxMan.clearBg();

    switch (id) {
      // *** 4. gold and black lamps
      case 4:
      case 5:
        this.maxBombs = this.initialMaxBombs;
        break;
      // *** 7. shoe
      case 7:
        this.speedFactor = 1.0;
        break;
      // *** 10. phone: its clip is never attached (the effect is commented out in the original)
      case 10:
        break;
      // *** 18. dandelion
      case 18:
        this.fallFactor = 1.1;
        break;
      // *** 22. rotten shoe
      case 22:
        this.speedFactor = 1.0;
        this.unstick();
        break;
      // *** 29. gold ring
      case 29:
        if (this.currentWeapon === Data.WEAPON_S_FIRE) this.changeWeapon(null);
        break;
      // *** 30. blue glasses
      case 30:
        this.game.flipX(false);
        break;
      // *** 31. red glasses
      case 31:
        this.game.flipY(false);
        break;
      // *** 37. crystal necklace
      case 37:
        if (this.currentWeapon === Data.WEAPON_S_ICE) this.changeWeapon(null);
        break;
      case 39:
        this.fallFactor = 1.1;
        break;
      // *** 67. emerald ring
      case 67:
        if (this.currentWeapon === Data.WEAPON_S_ARROW) this.changeWeapon(null);
        break;
      // *** 69. turtle
      case 69:
        this.game.globalActives[id] = false;
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor *= 1 / 0.6;
        }
        break;
      // *** 80. snail
      case 80:
        this.game.globalActives[id] = false;
        for (const b of this.game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor *= 1 / 0.3;
        }
        break;
      // *** 81. blue pearl
      case 81:
        this.game.destroyList(Data.PERFECT_ITEM);
        break;
      // *** 84. fire rain talisman
      case 84:
        this.clearRec();
        for (const c of this.clouds) {
          c.removeMovieClip();
        }
        this.clouds = [];
        break;
      // *** 86. ghost candy: the glow filters are not ported
      case 86:
        break;
      // *** 88. pokute
      case 88:
        this.unstick();
        this.scale(100);
        break;
      // *** 90. Goldorak curse
      case 90:
        this.unstick();
        break;
      // *** 91. Luffy hat
      case 91:
        this.unstick();
        break;
      // *** 94. Antok ring
      case 94:
        this.game.globalActives[id] = false;
        break;
      // *** 95. money bag
      case 95:
        this.unstick();
        break;
      // *** 96/97/98. pearls (see 81)
      case 96:
      case 97:
      case 98:
        this.game.destroyList(Data.PERFECT_ITEM);
        break;
      // *** 99. Chourou tuft
      case 99:
        this.fl_chourou = false;
        this.replayAnim();
        this.clearRec();
        break;
      // *** 100. Guu doll
      case 100:
        if (this.sticker) {
          this.game.fxMan.attachFx(this.sticker._x, this.sticker._y, 'hammer_fx_pop');
        }
        this.unstick();
        this.scale(100);
        break;
      // *** 114. Mario mode
      case 114:
        this.unstick();
        break;
    }
  }

  clearTemp(): void {
    while (this.tempList.length > 0) {
      this.interruptSpecial(this.tempList[0].id);
      this.tempList.splice(0, 1);
    }
  }

  clearPerm(): void {
    while (this.permList.length > 0) {
      this.interruptSpecial(this.permList[0]);
      this.permList.splice(0, 1);
    }
  }

  clearRec(): void {
    this.recurring = [];
  }

  private registerRecurring(func: () => void, t: number, fl_repeat: boolean): void {
    this.recurring.push({ timer: t * 1.0, baseTimer: t, func, fl_repeat });
  }

  /** `SpecialManager.main` (the phone screen clock is not needed: the phone is never shown). */
  private updateSpecials(): void {
    // Recurring special events of the level
    for (let n = 0; n < this.recurring.length; n++) {
      const e = this.recurring[n];
      e.timer -= Timer.tmod;
      if (e.timer <= 0) {
        e.func();
        if (e.fl_repeat) {
          e.timer = e.baseTimer + e.timer;
        } else {
          this.recurring.splice(n, 1);
          n--;
        }
      }
    }

    // Lifetime of the temporary effects
    for (let i = 0; i < this.tempList.length; i++) {
      if (this.game.cycle >= this.tempList[i].end) {
        this.interruptSpecial(this.tempList[i].id);
        this.tempList.splice(i, 1);
        i--;
      }
    }
  }

  /** `SpecialManager.levelConversion`: a pearl of the given kind above each floor tile. */
  private levelConversion(id: number, sid: number): void {
    const game = this.game;
    game.scriptRunner?.safeMode();
    game.killPop();
    let n = 0;
    for (let y = 0; y < Data.LEVEL_HEIGHT; y++) {
      for (let x = 0; x < Data.LEVEL_WIDTH; x++) {
        if (this.world.checkFlag(x, y, Data.IA_TILE_TOP)) {
          let t = n * 2;
          if (n < 4) t = 1;
          game.scriptRunner?.insertScoreItem(
            id,
            sid,
            game.flipCoordCase(x),
            y,
            t,
            null,
            true,
            false,
          );
          n++;
        }
      }
    }
    game.perfectItemCpt = n;
  }

  /** `SpecialManager.getZodiac`: a score item above each enemy. */
  private getZodiac(id: number): void {
    this.game.fxMan.attachBg(Data.BG_CONSTEL, id, Data.SECOND * 4);
    for (const b of this.game.getList(Data.BAD_CLEAR)) {
      ScoreItem.attach(this.game, b.x, b.y - Data.CASE_HEIGHT * 2, 169, 0);
    }
  }

  /** `SpecialManager.getZodiacPotion` */
  private getZodiacPotion(_id: number): void {
    for (const b of this.game.getList(Data.BAD_CLEAR)) {
      ScoreItem.attach(this.game, b.x, b.y - Data.CASE_HEIGHT * 2, 169, 0);
    }
  }

  /** `SpecialManager.onPerfect`: every pearl of a conversion was picked. */
  private onPerfect(): void {
    this.interruptSpecial(81);
    this.interruptSpecial(96);
    this.interruptSpecial(97);
    this.interruptSpecial(98);

    const bonus = 50000;
    const mc = this.game.depthMan.attach('hammer_fx_perfect', Data.DP_INTERF);
    mc._x = Data.GAME_WIDTH * 0.5;
    mc._y = Data.GAME_HEIGHT * 0.5;
    mc.setVariable('label', this.game.dataStore.getStatic(11));
    mc.setVariable('bonus', this.actives[95] ? String(bonus * 2) : String(bonus));
    const pl = this.game.getList(Data.PLAYER) as PlayerEntity[];
    for (const p of pl) {
      p.getScoreHidden(Math.floor(bonus / pl.length));
    }
  }

  /**
   * `SpecialManager.onPickPerfectItem`. The original calls it for any item whose id is
   * `CONVERT_DIAMANT` (17), so the gold mushroom counts too; the counter is unset (NaN) until
   * the first conversion, which keeps that harmless before it.
   */
  onPickPerfectItem(): void {
    this.game.perfectItemCpt--;
    if (this.game.perfectItemCpt <= 0) {
      this.onPerfect();
    }
  }

  /** `SpecialManager.warpZone`: jumps `w` levels ahead, stopping at a boss or an empty level. */
  private warpZone(w: number): void {
    const game = this.game;
    let arrival = this.world.currentId + w;
    game.logAction('$WZ>' + arrival);
    let i = this.world.currentId + 1;
    while (i <= arrival) {
      if (game.isBossLevel(i)) {
        arrival = i;
      }
      if (this.world.isEmptyLevel(i, (cx) => game.flipCoordCase(cx))) {
        arrival = i - 1;
      }
      i++;
    }

    // Warp impossible
    if (arrival === this.world.currentId) {
      game.fxMan.attachAlert(game.dataStore.getStatic(34));
      return;
    }

    game.view.detach();
    game.forcedGoto(arrival);
  }

  private onStrike(): void {
    const blist = this.game.getList(Data.BAD_CLEAR) as BadEntity[];
    if (blist.length === 0) return;
    const bad = blist.find((b) => !b.fl_kill);
    if (!bad) return;
    const s = this.game.fxMan.attachFx(
      Data.DOC_WIDTH * 0.5,
      bad.y - Data.CASE_HEIGHT * 0.5,
      'hammer_fx_strike',
    );
    const dir = this.game.rand.random(2) * 2 - 1;
    const yscale = this.game.rand.random(50) + 50;
    if (s) {
      s.mc._xscale *= dir;
      s.mc._yscale = yscale;
    }
    this.game.fxMan.attachShine(bad.x, bad.y);
    bad.forceKill(dir * (this.game.rand.random(10) + 15));
  }

  /** `SpecialManager.onFireRain`: one drop of the fire rain (item 84). */
  private onFireRain(): void {
    const x = this.game.rand.random(Math.round(Data.GAME_WIDTH)) + 50;
    const s = FireRainShoot.attach(this.game, x, -this.game.rand.random(50));
    s.moveToAng(95 + this.game.rand.random(30), s.shootSpeed);
  }

  /** `SpecialManager.onPoT`: points over time (item 99). */
  private onPoT(): void {
    this.getScore(this, 250);
  }

  /** `SpecialManager.execute` */
  executeSpecialItem(item: SpecialItem): void {
    const game = this.game;
    const id = item.id;
    const subId = item.subId;

    switch (id) {
      // *** 0. extends
      case 0:
        if (this.actives[27]) this.getScore(item, 25);
        this.getScoreHidden(5);
        this.getExtend(subId ?? 0);
        break;

      // *** 1. gold shield
      case 1:
        this.shield(Data.SECOND * 10);
        break;

      // *** 2. silver shield
      case 2:
        this.shield(Data.SECOND * 60);
        break;

      // *** 3. beach ball
      case 3:
        BallSupa.attach(game);
        break;

      // *** 4. gold lamp: multi bombs (2)
      case 4:
        if (!this.actives[5]) {
          this.maxBombs = this.initialMaxBombs + 1;
          this.permanent(id);
        }
        break;

      // *** 5. black lamp: multi bombs (5)
      case 5:
        this.maxBombs = this.initialMaxBombs + 4;
        this.permanent(id);
        break;

      // *** 6. yin yang: freeze all
      case 6:
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.freeze(Data.FREEZE_DURATION * 2);
        }
        break;

      // *** 7. shoe: speed up player
      case 7:
        this.speedFactor = 1.5;
        this.permanent(id);
        break;

      // *** 8. star: supa bubble
      case 8:
        BubbleSupa.attach(game);
        BubbleSupa.attach(game);
        break;

      // *** 9. Sauron's eye: supa weight
      case 9:
        TonsSupa.attach(game);
        break;

      // *** 10. phone: the Nokia effect is commented out in the original
      case 10:
        break;

      // *** 11. red umbrella: next level
      case 11:
        this.warpZone(1);
        break;

      // *** 12. blue umbrella: next level x 2
      case 12:
        this.warpZone(2);
        break;

      // *** 13. motorbike helmet: kicks bombs further
      case 13:
        this.permanent(id);
        break;

      // *** 14-17. blue, red, green and gold mushrooms
      case 14:
      case 15:
      case 16:
      case 17:
        this.permanent(id);
        for (const other of [14, 15, 16, 17]) {
          if (other !== id) this.interruptSpecial(other);
        }
        break;

      // *** 18. dandelion: slow fall
      case 18:
        this.permanent(id);
        this.fallFactor = 0.55;
        break;

      // *** 19. sunflower
      case 19:
        SmokeSupa.attach(game);
        game.fxMan.attachBg(Data.BG_ORANGE, null, Data.SECOND * 3);
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.forceKill(null);
        }
        break;

      // *** 20. treasure chest
      case 20:
        for (let i = 0; i < 5; i++) {
          const s = ScoreItem.attach(game, item.x, item.y, 0, game.rand.random(4));
          s.moveFrom(item, 8);
        }
        break;

      // *** 21. speaker
      case 21: {
        const bad = game.getOne(Data.BAD_CLEAR) as BadEntity | null;
        if (bad) {
          game.fxMan.attachFx(bad.x, bad.y - Data.CASE_HEIGHT, 'hammer_fx_pop');
          bad.forceKill(null);
          game.fxMan.attachBg(Data.BG_SINGER, null, Data.SECOND * 3);
        }
        break;
      }

      // *** 22. rotten shoe
      case 22:
        this.interruptSpecial(7);
        this.curse(Data.CURSE_SLOW);
        this.speedFactor = 0.6;
        this.temporary(id, Data.SECOND * 40);
        break;

      // *** 23. crystal ball
      case 23:
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          const s = PlayerPearlShoot.attach(game, this.x, this.y - Data.CASE_WIDTH);
          s.moveToTarget(b, s.shootSpeed);
          s.fl_borderBounce = true;
          s.setLifeTimer(Data.SECOND * 3 + game.rand.random(400) / 10);
          s._yOffset = 0;
          s.endUpdate();
        }
        break;

      // *** 24. snow crystal
      case 24:
        IceMeteorSupa.attach(game);
        break;

      // *** 25. ice flame: curtain of fireballs
      case 25:
        for (let i = 0; i < 4; i++) {
          const s = PlayerFireBallShoot.attach(
            game,
            Data.GAME_WIDTH * 0.125 + Data.GAME_WIDTH * 0.25 * i,
            10,
          );
          s.moveDown(s.shootSpeed);
        }
        for (let i = 0; i < 4; i++) {
          const s = PlayerFireBallShoot.attach(
            game,
            Data.GAME_WIDTH * 0.25 + Data.GAME_WIDTH * 0.25 * i,
            Data.GAME_HEIGHT - 10,
          );
          s.moveUp(s.shootSpeed);
        }
        break;

      // *** 26. light bulb
      case 26:
        this.permanent(id);
        game.updateDarkness();
        break;

      // *** 27. water lily: points for the extends
      case 27:
        this.permanent(id);
        break;

      // *** 28. silver cup
      case 28:
        game.fxMan.attachBg(Data.BG_STAR, null, Data.SECOND * 9);
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.knock(Data.SECOND * 10);
        }
        break;

      // *** 29. gold ring: fireball shots
      case 29:
        this.changeWeapon(Data.WEAPON_S_FIRE);
        this.temporary(id, Data.WEAPON_DURATION);
        break;

      // *** 30. blue glasses: the screen is mirrored
      case 30:
        game.flipX(true);
        this.temporary(id, Data.SECOND * 30);
        break;

      // *** 31. red glasses: the screen is upside down
      case 31:
        game.flipY(true);
        this.temporary(id, Data.SECOND * 30);
        break;

      // *** 32-34. ace of spades, clubs and diamonds: enemies turn into crystals
      case 32:
      case 33:
      case 34: {
        const sid = id === 32 ? 0 : id === 33 ? 2 : 5;
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.destroy();
          ScoreItem.attach(game, b.x, b.y - Data.CASE_HEIGHT, 0, sid);
        }
        break;
      }

      // *** 35. ace of hearts
      case 35:
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.destroy();
          ScoreItem.attach(game, b.x - Data.CASE_WIDTH, b.y - Data.CASE_HEIGHT, 0, 6);
          ScoreItem.attach(game, b.x + Data.CASE_WIDTH, b.y - Data.CASE_HEIGHT, 0, 6);
        }
        break;

      // *** 36. extra Igor
      case 36:
        this.lives++;
        game.hud.setLives(this.lives);
        game.fxMan.attachShine(item.x, item.y - Data.CASE_HEIGHT * 0.5);
        break;

      // *** 37. crystal necklace: pearl shots
      case 37:
        this.changeWeapon(Data.WEAPON_S_ICE);
        this.temporary(id, Data.WEAPON_DURATION);
        break;

      // *** 38. totem
      case 38: {
        const s = ArrowSupa.attach(game);
        s.setLifeTimer(Data.SUPA_DURATION);
        break;
      }

      // *** 39. stone head: Igor shakes the level when he lands
      case 39:
        this.fallFactor = 1.6;
        this.temporary(id, null);
        break;

      // *** 40-51. zodiac signs
      case 40:
      case 41:
      case 42:
      case 43:
      case 44:
      case 45:
      case 46:
      case 47:
      case 48:
      case 49:
      case 50:
      case 51:
        this.getZodiac(id - 40);
        break;

      // *** 52-63. zodiac potions
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
      case 58:
      case 59:
      case 60:
      case 61:
      case 62:
      case 63:
        this.getZodiacPotion(id - 40);
        break;

      // *** 64. rainbow: extends spawn
      case 64:
        for (let i = 0; i < 5; i++) {
          const px = game.rand.random(Data.LEVEL_WIDTH);
          const py = game.rand.random(Data.LEVEL_HEIGHT);
          const pt = this.world.getGround(px, py);
          SpecialItem.attach(
            game,
            pt.x * Data.CASE_WIDTH,
            pt.y * Data.CASE_HEIGHT,
            0,
            game.rand.random(7),
          );
        }
        break;

      // *** 65. duck float: points for each enemy
      case 65:
        for (const b of game.getList(Data.BAD)) {
          this.getScore(b, b.isType(Data.BAD_CLEAR) ? 2500 : 600);
        }
        break;

      // *** 66. cactus: jumps give points
      case 66:
        this.permanent(id);
        break;

      // *** 67. emerald ring: arrow shots
      case 67:
        this.changeWeapon(Data.WEAPON_S_ARROW);
        this.temporary(id, Data.WEAPON_DURATION);
        break;

      // *** 68. candle
      case 68:
        this.permanent(id);
        game.updateDarkness();
        break;

      // *** 69. turtle: slows the enemies
      case 69:
        this.global(id);
        this.temporary(id, Data.SECOND * 30);
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor *= 0.6;
        }
        break;

      // *** 70. clover: bomb kicks give points
      case 70:
        this.permanent(id);
        break;

      // *** 71. dragon head: two horizontal fireballs
      case 71: {
        const sL = PlayerFireBallShoot.attach(game, item.x, item.y);
        sL.moveLeft(sL.shootSpeed);
        const sR = PlayerFireBallShoot.attach(game, item.x, item.y);
        sR.moveRight(sR.shootSpeed);
        break;
      }

      // *** 72. magician hat: enemies turn into crystals of rising value
      case 72: {
        game.destroyList(Data.ITEM);
        game.destroyList(Data.BAD_BOMB);
        let n = 1;
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          ScoreItem.attach(game, b.x, b.y, 0, n);
          b.destroy();
          n++;
        }
        break;
      }

      // *** 73. tree leaf: points for walking
      case 73:
        this.permanent(id);
        break;

      // *** 74-76. orange, blue and green ghosts: candies spawn
      case 74:
      case 75:
      case 76: {
        const scoreId = id - 71;
        for (let i = 0; i < 7; i++) {
          const it = ScoreItem.attach(
            game,
            game.rand.random(Data.GAME_WIDTH),
            Data.GAME_HEIGHT,
            scoreId,
            null,
          );
          it.moveToAng(-20 - game.rand.random(160), game.rand.random(15) + 10);
        }
        break;
      }

      // *** 77-79. blue, red and yellow fish: crystals fall when the level is cleared
      case 77:
      case 78:
      case 79: {
        const sid = id === 77 ? 0 : id === 78 ? 2 : 3;
        game.endLevelStack.push(() => {
          for (let i = 0; i < 5; i++) {
            ScoreItem.attach(
              game,
              game.rand.random(Data.GAME_WIDTH),
              -30 - game.rand.random(50),
              0,
              sid,
            );
          }
        });
        break;
      }

      // *** 80. snail: slows the enemies
      case 80:
        this.global(id);
        this.temporary(id, Data.SECOND * 30);
        for (const b of game.getList(Data.BAD_CLEAR) as BadEntity[]) {
          b.updateSpeed();
          b.animFactor *= 0.3;
        }
        break;

      // *** 81. blue pearl
      case 81:
        game.destroyList(Data.BAD);
        game.destroyList(Data.ITEM);
        game.destroyList(Data.BAD_BOMB);
        this.levelConversion(Data.CONVERT_DIAMANT, 0);
        this.temporary(id, Data.SECOND * 19);
        break;

      // *** 82. gold pyramid: strike
      case 82:
        this.onStrike();
        break;

      // *** 83. black pyramid: series of strikes
      case 83:
        this.temporary(id, null);
        this.registerRecurring(() => this.onStrike(), Data.SECOND, true);
        this.onStrike();
        game.fxMan.attachBg(Data.BG_PYRAMID, null, 9999);
        break;

      // *** 84. fire rain talisman
      case 84: {
        let c = game.depthMan.attach('hammer_fx_clouds', Data.DP_SPRITE_BACK_LAYER);
        c.avmSet('speed', 0.5);
        c._y += 9;
        this.clouds.push(c);
        c.setBlur(4, 4);
        c = game.depthMan.attach('hammer_fx_clouds', Data.DP_SPRITE_TOP_LAYER);
        c.avmSet('speed', 1);
        this.clouds.push(c);
        this.temporary(id, null);
        this.registerRecurring(() => this.onFireRain(), Data.SECOND * 0.8, true);
        this.onFireRain();
        game.fxMan.attachBg(Data.BG_STORM, null, 9999);
        break;
      }

      // *** 85. hammer
      case 85: {
        const s = HammerShoot.attach(game, this.x, this.y);
        s.setOwner(this);
        this.temporary(id, null);
        break;
      }

      // *** 86. ghost candy: ghostbuster mode. The glow filters on the player and the enemies
      // are not ported.
      case 86:
        this.temporary(id, Data.SECOND * 60);
        game.fxMan.attachBg(Data.BG_GHOSTS, null, Data.SECOND * 57);
        break;

      // *** 87. blue larva: turns a random enemy into a blue larva
      case 87: {
        const bad = game.getOne(Data.BAD_CLEAR);
        if (bad) {
          if (game.getList(Data.BAD_CLEAR).length === 1) {
            ScoreItem.attach(game, bad.x, bad.y, Data.DIAMANT, null);
          } else {
            SpecialItem.attach(game, bad.x, bad.y, id, subId);
          }
          game.fxMan.attachShine(bad.x, bad.y - Data.CASE_HEIGHT * 0.5);
          bad.destroy();
        }
        break;
      }

      // *** 88. pokute: shrink curse
      case 88:
        this.curse(Data.CURSE_SHRINK);
        game.fxMan.attachShine(this.x, this.y);
        this.scale(50);
        this.temporary(id, Data.SECOND * 30);
        break;

      // *** 89. mutant egg: turns an enemy into a Tzongre
      case 89: {
        const e = game.getOne(Data.BAD_CLEAR);
        if (e) {
          game.attachBad(Data.BAD_TZONGRE, e.x, e.y - Data.CASE_HEIGHT);
          e.destroy();
        }
        break;
      }

      // *** 90. Goldorak horns: trips on the slightest fall
      case 90:
        this.temporary(id, Data.SECOND * 40);
        this.curse(Data.CURSE_FALL);
        break;

      // *** 91. Luffy hat: no attack curse
      case 91:
        this.curse(Data.CURSE_PEACE);
        game.fxMan.attachShine(this.x, this.y);
        this.temporary(id, Data.SECOND * 15);
        break;

      // *** 92. pink hat: bomb duplicator
      case 92:
        this.permanent(id);
        break;

      // *** 93. mailbox: parcels spawn
      case 93: {
        game.destroyList(Data.BAD);
        game.destroyList(Data.ITEM);
        game.destroyList(Data.BAD_BOMB);
        let n = 6;
        do {
          const ptx = game.rand.random(Data.GAME_WIDTH);
          const pty = game.rand.random(Data.GAME_HEIGHT);
          if (this.distance(ptx, pty) >= 100) {
            const e = SpecialItem.attach(game, ptx, pty, 101, null);
            e?.setLifeTimer(null);
            n--;
          }
        } while (n > 0);
        break;
      }

      // *** 94. Antok ring: one more score item per level
      case 94:
        this.global(id);
        this.permanent(id);
        break;

      // *** 95. money bag: multiplier
      case 95:
        this.curse(Data.CURSE_MULTIPLY);
        this.permanent(id);
        break;

      // *** 96-98. orange, green and pink pearls: conversion
      case 96:
      case 97:
      case 98:
        game.destroyList(Data.BAD);
        game.destroyList(Data.ITEM);
        game.destroyList(Data.BAD_BOMB);
        this.levelConversion(Data.CONVERT_DIAMANT, id - 95);
        this.temporary(id, Data.SECOND * 19);
        break;

      // *** 99. Chourou tuft: regular points until the end of the level
      case 99:
        this.registerRecurring(() => this.onPoT(), Data.SECOND * 2, true);
        this.fl_chourou = true;
        this.temporary(id, null);
        break;

      // *** 100. Guu doll
      case 100: {
        this.temporary(id, Data.SECOND * 30);
        game.fxMan.attachBg(Data.BG_GUU, null, Data.SECOND * 30);
        const mc = game.depthMan.attach('hammer_fx_cloud', Data.DP_PLAYER);
        this.stick(mc, 0, -80);
        this.setElaStick(0.4);
        break;
      }

      // *** 101. mystery parcel
      case 101:
        if (game.rand.random(2) === 0) {
          this.getScore(item, 5000);
        } else {
          const b = PoireBomb.attach(game, item.x, item.y);
          b.moveUp(10);
        }
        break;

      // *** 102. carrot!
      case 102:
        game.scriptRunner?.playById(100);
        game.huTimer = 0;
        this.getScore(item, 4 * 25000);
        this.fl_carot = true;
        break;

      // *** 103-105. hearts 1 to 3
      case 103:
      case 104:
      case 105:
        this.lives++;
        game.hud.setLives(this.lives);
        game.fxMan.attachShine(item.x, item.y - Data.CASE_HEIGHT * 0.5);
        game.randMan.remove(Data.RAND_ITEMS_ID, id);
        break;

      // *** 106. mushroom book
      case 106:
        for (let i = 0; i < 5; i++) {
          const s = ScoreItem.attach(game, item.x, item.y, 1047 + game.rand.random(4), null);
          s.moveFrom(item, 8);
        }
        break;

      // *** 107. star book (original todo: "star with points")
      case 107:
        for (let i = 0; i < 5; i++) {
          const s = ScoreItem.attach(game, item.x, item.y, 0, 0);
          s.moveFrom(item, 8);
        }
        break;

      // *** 108. green umbrella
      case 108:
        this.warpZone(3);
        break;

      // *** 109. snowflake 1
      case 109:
        game.fxMan.attachShine(item.x, item.y - Data.CASE_HEIGHT * 0.5);
        game.randMan.remove(Data.RAND_ITEMS_ID, id);
        break;

      // *** 110, 111. snowflakes 2 and 3
      case 110:
      case 111:
        game.fxMan.attachShine(item.x, item.y - Data.CASE_HEIGHT * 0.5);
        break;

      // *** 112. pioupiouz
      case 112:
        this.head = Data.HEAD_PIOU;
        this.replayAnim();
        break;

      // *** 113. Tuberculoz cape
      case 113:
        this.getScore(item, 75000);
        this.head = Data.HEAD_TUB;
        this.replayAnim();
        break;

      // *** 114. Mario item
      case 114:
        this.temporary(id, null);
        this.curse(Data.CURSE_MARIO);
        break;

      // *** 115. volleyfest
      case 115:
        this.permanent(id);
        break;

      // *** 116. Ankhel jewel
      case 116:
        this.lives++;
        game.hud.setLives(this.lives);
        this.getScore(item, 70000);
        break;

      // *** 117. Gordon's key
      case 117:
        game.giveKey(12);
        this.getScore(item, 10000);
        break;

      default:
        console.warn(`illegal item id=${id}`);
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

    // Guu doll: its cloud rains on the player, who grows back slowly and dies too small
    if (this.actives[100]) {
      const rand = this.game.rand;
      this.game.fxMan.inGameParticles(
        Data.PARTICLE_RAIN,
        this.x + rand.random(20) * (rand.random(2) * 2 - 1),
        this.y - 60 - rand.random(5),
        rand.random(2) + 1,
      );
      this.scale(Math.min(100, (this.scaleFactor + 0.002 * Timer.tmod) * 100));
      if (this.scaleFactor <= 0.6) {
        this.killHit(null);
        this.interruptSpecial(100);
      }
    }

    if (!this.fl_kill && this.game.fl_aqua) {
      this.oxygen -= Timer.tmod * 0.1;
      if (this.oxygen <= 0) {
        this.killHit(0);
      }
    }

    this.updateSpecials();

    if (!this.fl_kill && !this.fl_lockControls) {
      if (!this.fl_entering && this.mc._visible) {
        this.updateControls();
      }
      if (this.pid === 0 && this.game.fl_debug) {
        this.getDebugControls();
      }
    }
    if (this.fl_entering && this.cy >= 0) {
      this.fl_entering = false;
    }

    if (this.coolDown > 0) {
      this.coolDown -= Timer.tmod;
      if (this.coolDown <= 0) {
        this.coolDown = 0;
      }
    }

    if (this.fl_knock) {
      this.knockTimer -= Timer.tmod;
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
      this.lockTimer -= Timer.tmod;
      this.fl_lockControls = this.lockTimer > 0;
    }

    if (this.fl_shield) {
      this.shieldTimer -= Timer.tmod;
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
        this.waitTimer -= Timer.tmod;
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
          this.edgeTimer -= Timer.tmod;
          if (this.edgeTimer <= 0) {
            this.playAnim(Data.ANIM_PLAYER_EDGE);
          }
        }
      }
    }
  }
}
