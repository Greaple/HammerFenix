import { Application, Container } from 'pixi.js';
import { AudioEngine } from '../engine/Audio';
import { DepthManager } from '../engine/DepthManager';
import { FixedGameLoop } from '../engine/GameLoop';
import { InputController } from '../engine/Input';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import type { SwfMovieClip } from '../engine/swf/SwfMovieClip';
import { Data, GameDataStore } from './Data';
import type { LevelData, LevelSet, PortalLink } from './data/types';
import { BaseEntity } from './entity/Entity';
import { ItemEntity, ScoreItem, SpecialItem } from './entity/Item';
import { PlayerEntity } from './entity/Player';
import { BadEntity, createBad, FireBallBad } from './entity/Bad';
import { BombEntity } from './entity/Bomb';
import { FxManager } from './FxManager';
import { GameHud } from './gui/GameHud';
import type { IGameContext } from './GameContext';
import { LevelView } from './levels/LevelView';
import { LevelWorld } from './levels/LevelWorld';
import { ScriptRunner } from './levels/ScriptRunner';

const SAVE_KEY = 'hammerfenix_save_v1';

export interface GameSaveData {
  highScore: number;
  highestLevel: Record<string, number>;
  preferredLang: string;
  muted: boolean;
}

export class GameSession implements IGameContext {
  readonly app: Application;
  readonly lib: SwfLibrary;
  readonly depthMan: DepthManager;
  readonly audio: AudioEngine;
  readonly input: InputController;
  readonly dataStore: GameDataStore;

  readonly gameRoot: SwfMovieClip;
  readonly gameLoop: FixedGameLoop;

  world: LevelWorld;
  view: LevelView;
  fxMan: FxManager;
  hud: GameHud;
  scriptRunner: ScriptRunner | null = null;
  player: PlayerEntity | null = null;

  readonly xOffset = 10;
  cycle = 0;
  xFriction = Data.FRICTION_X;
  yFriction = Data.FRICTION_Y;
  gFriction = Data.FRICTION_GROUND;
  sFriction = Data.FRICTION_SLIDE;
  speedFactor = 1.0;
  diffFactor = 1.0;

  fl_lock = false;
  fl_clear = false;
  fl_gameOver = false;
  fl_pause = false;
  fl_ice = false;
  fl_aqua = false;
  fl_wind = false;
  windSpeed = 0;
  fl_mirror = false;
  fl_nightmare = false;
  fl_ninja = false;
  fl_bombExpert = false;
  fl_warpStart = false;

  forcedDarkness: number | null = null;
  fakeLevelId: number | null = null;
  huTimer = 0;
  huState = 0;

  readonly globalActives: boolean[] = new Array<boolean>(200).fill(false);
  readonly worldKeys: boolean[] = new Array<boolean>(100).fill(false);
  private readonly dvars = new Map<string, string>();
  private readonly comboMap = new Map<number, number>();

  private readonly lists: BaseEntity[][] = Array.from({ length: 24 }, () => []);
  private readonly killList: BaseEntity[] = [];
  private readonly unregList: { type: number; ent: BaseEntity }[] = [];
  private uniqIdCounter = 1;
  badCount = 0;

  currentSetName = 'adventure';
  currentDim = 0;
  dimensions: LevelWorld[] = [];
  readonly specialPicks: number[] = [];
  readonly scorePicks: number[] = [];

  private shakeTimer = 0;
  private shakeTotal = 0;
  private shakePower = 0;

  private popMC: SwfMovieClip | null = null;
  private pointerMC: SwfMovieClip | null = null;
  private itemNameMC: SwfMovieClip | null = null;
  private pauseMC: SwfMovieClip | null = null;
  private gameOverMC: SwfMovieClip | null = null;
  private darknessMC: SwfMovieClip | null = null;
  private extraHoles: { x: number; y: number; d: number }[] = [];
  private dfactor = 0;
  private targetDark = 0;

  private readonly portalMcList: { x: number; y: number; mc: SwfMovieClip; cpt: number }[] = [];
  private nextLink: PortalLink | null = null;
  private keyLock: string | null = null;

  highScore = 0;
  savedData: GameSaveData;

  onLevelChange?: (levelId: number, levelSet: string) => void;
  onScoreChange?: (score: number) => void;
  onLivesChange?: (lives: number) => void;
  onStateChange?: (state: { isOver: boolean; isPaused: boolean }) => void;

  constructor(
    app: Application,
    lib: SwfLibrary,
    dataStore: GameDataStore,
    audio: AudioEngine,
    input: InputController,
    initialSet: LevelSet,
    setName = 'adventure',
  ) {
    this.app = app;
    this.lib = lib;
    this.dataStore = dataStore;
    this.audio = audio;
    this.input = input;
    this.currentSetName = setName;

    this.savedData = this.loadSave();
    this.highScore = this.savedData.highScore;

    // Create root container for depth-managed SWF layers
    this.gameRoot = lib.createEmptyClip();
    this.gameRoot.mcName = 'gameRoot';
    this.gameRoot._x = this.xOffset;
    this.gameRoot._y = 0;
    app.stage.addChild(this.gameRoot);

    this.depthMan = new DepthManager(this.gameRoot);
    this.world = new LevelWorld(initialSet, 0, true);
    this.dimensions.push(this.world);

    this.view = new LevelView(this.world, this.depthMan);
    this.fxMan = new FxManager(this);
    this.hud = new GameHud(this, 0, 2, 0);

    this.gameLoop = new FixedGameLoop({
      onLogicStep: () => this.update(),
      onAnimStep: () => this.stepAnimation(),
    });
  }

  static async create(
    app: Application,
    lib: SwfLibrary,
    dataStore: GameDataStore,
    audio: AudioEngine,
    input: InputController,
    preferredSet = 'adventure',
  ): Promise<GameSession> {
    const set = await dataStore.loadLevelSet(preferredSet);
    const session = new GameSession(app, lib, dataStore, audio, input, set, preferredSet);

    // If starting in adventure mode, eagerly preload the other 4 linked dimensions
    if (preferredSet === 'adventure') {
      const extraDims = ['deepnight', 'hiko', 'ayame', 'hk'];
      for (const name of extraDims) {
        try {
          const extraSet = await dataStore.loadLevelSet(name);
          const extraWorld = new LevelWorld(extraSet, 0, false);
          session.dimensions.push(extraWorld);
        } catch {
          // non-critical if optional dimension file fails
        }
      }
    }

    session.initGame();
    return session;
  }

  // ------------------------------------------------------------- Persistence

  private loadSave(): GameSaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        return JSON.parse(raw) as GameSaveData;
      }
    } catch {
      // ignore storage errors
    }
    return {
      highScore: 0,
      highestLevel: {},
      preferredLang: this.dataStore.langId,
      muted: false,
    };
  }

  private saveGame(): void {
    try {
      this.savedData.highScore = Math.max(this.savedData.highScore, this.highScore);
      this.savedData.highestLevel[this.currentSetName] = Math.max(
        this.savedData.highestLevel[this.currentSetName] ?? 0,
        this.world.currentId,
      );
      this.savedData.preferredLang = this.dataStore.langId;
      this.savedData.muted = this.audio.isMuted;
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.savedData));
    } catch {
      // ignore storage quota / sandbox write errors
    }
  }

  // -------------------------------------------------------- Game Lifecycle

  initGame(startLevelId = 0): void {
    this.clearLevel();
    this.fl_gameOver = false;
    this.fl_clear = false;
    this.fl_lock = false;
    this.fl_pause = false;
    this.cycle = 0;
    this.gameOverMC?.removeMovieClip();
    this.gameOverMC = null;

    this.playMusicTrack(0);
    this.world.goto(startLevelId);
    this.view.displayCurrent();

    const sx = this.flipCoordCase(this.world.current.playerX);
    this.player = PlayerEntity.attach(
      this,
      BaseEntity.x_ctr(sx),
      BaseEntity.y_ctr(this.world.current.playerY),
    );

    this.startLevel();
  }

  startLevel(): void {
    this.badCount = 0;
    this.fl_clear = false;
    this.fl_lock = false;
    this.huTimer = 0;
    this.huState = 0;
    this.forcedDarkness = null;

    this.scriptRunner?.destroy();
    this.scriptRunner = new ScriptRunner(this, this.world.current);

    this.view.displayCurrent();

    const badCount = this.scriptRunner.insertBads();
    if (badCount === 0) {
      this.fxMan.attachExit();
      this.fl_clear = true;
    }

    if (!this.world.isVisited()) {
      this.addLevelItems();
    }

    this.scriptRunner.onLevelAttach();
    this.scriptRunner.onPlayerBirth();
    this.scriptRunner.compile();

    if (this.fl_warpStart && this.world.fl_mainWorld) {
      this.view.attachSprite(
        'door_secret',
        BaseEntity.x_ctr(this.world.current.playerX),
        BaseEntity.y_ctr(this.world.current.playerY) + Data.CASE_HEIGHT * 0.5,
        true,
      );
      this.fl_warpStart = false;
    }

    if (!this.world.isVisited()) {
      const zoneName = this.dataStore.getSectorName(this.currentDim, this.world.currentId);
      if (zoneName) {
        this.fxMan.attachLevelPop(zoneName, this.world.currentId > 0);
      }
    }
    this.world.markVisited();

    if (this.player) {
      this.player.onStartLevel(this.world.fl_mainWorld);
      if (this.player.y < 0) {
        this.fxMan.attachEnter(this.player.x, 0);
      }
    }

    if (this.world.fl_mainWorld && this.world.currentId === 0) {
      this.fxMan.detachExit();
    }

    this.onLevelChange?.(this.world.currentId, this.currentSetName);
  }

  private addLevelItems(): void {
    if (this.world.current.specialSlots.length > 0) {
      const pt =
        this.world.current.specialSlots[
          Math.floor(Math.random() * this.world.current.specialSlots.length)
        ];
      const id = this.dataStore.pickRandomSpecialItem();
      this.scriptRunner?.insertSpecialItem(
        id,
        null,
        pt.x,
        pt.y,
        Data.SPECIAL_ITEM_TIMER,
        null,
        false,
        true,
      );
    }

    if (this.world.current.scoreSlots.length > 0) {
      const pt =
        this.world.current.scoreSlots[
          Math.floor(Math.random() * this.world.current.scoreSlots.length)
        ];
      const id = this.dataStore.pickRandomScoreItem();
      this.scriptRunner?.insertScoreItem(
        id,
        null,
        pt.x,
        pt.y,
        Data.SCORE_ITEM_TIMER,
        null,
        false,
        true,
      );
    }

    this.scriptRunner?.insertExtend();
  }

  nextLevel(): void {
    if (this.fl_lock || this.fl_gameOver) return;

    if (this.fl_warpStart) {
      this.fl_warpStart = false;
      this.forcedGoto(10);
      return;
    }

    const nextId = this.world.currentId + 1;
    if (nextId >= this.world.levelCount) {
      this.onGameOver();
      return;
    }

    this.goto(nextId);
  }

  forcedGoto(id: number): void {
    if (this.fl_lock || this.fl_gameOver) return;
    this.goto(id);
    if (this.player) {
      const sx = this.flipCoordCase(this.world.current.playerX);
      this.player.moveTo(BaseEntity.x_ctr(sx), BaseEntity.y_ctr(this.world.current.playerY - 1));
      this.player.shield(Data.SHIELD_DURATION * 1.3);
    }
  }

  goto(id: number): void {
    this.clearLevel();
    this.world.goto(id);

    for (const e of this.getList(Data.ENTITY)) {
      e.world = this.world;
    }

    if (this.player) {
      const sx = this.flipCoordCase(this.world.current.playerX);
      this.player.moveTo(BaseEntity.x_ctr(sx), -200);
      this.player.onNextLevel();
    }

    this.audio.playSound('sound_level_clear', Data.CHAN_INTERF);
    this.startLevel();
  }

  async switchLevelSet(name: string, levelId = 0): Promise<void> {
    const set = await this.dataStore.loadLevelSet(name);
    this.currentSetName = name;
    this.currentDim = 0;
    this.dimensions = [new LevelWorld(set, levelId, true)];
    this.world = this.dimensions[0];
    this.view.destroy();
    this.view = new LevelView(this.world, this.depthMan);
    this.initGame(levelId);
  }

  clearLevel(): void {
    this.killPop();
    this.killPointer();
    this.killItemName();
    this.fxMan.clear();

    this.destroyList(Data.BAD);
    this.destroyList(Data.ITEM);
    this.destroyList(Data.BOMB);
    this.destroyList(Data.SUPA);
    this.destroyList(Data.SHOOT);
    this.destroyList(Data.FX);
    this.destroyList(Data.BOSS);

    this.dvars.clear();
    this.cleanKills();
  }

  // ------------------------------------------------------------- Entity Lists

  private getListId(type: number): number {
    return Math.round(Math.log2(type));
  }

  getUniqId(): number {
    return this.uniqIdCounter++;
  }

  addToList(type: number, e: BaseEntity): void {
    const id = this.getListId(type);
    if (id >= 0 && id < this.lists.length) {
      this.lists[id].push(e);
    }
  }

  removeFromList(type: number, e: BaseEntity): void {
    const id = this.getListId(type);
    if (id >= 0 && id < this.lists.length) {
      const idx = this.lists[id].indexOf(e);
      if (idx >= 0) this.lists[id].splice(idx, 1);
    }
  }

  queueUnregister(type: number, e: BaseEntity): void {
    this.unregList.push({ type, ent: e });
  }

  queueKill(e: BaseEntity): void {
    this.killList.push(e);
  }

  getList(type: number): BaseEntity[] {
    const id = this.getListId(type);
    return this.lists[id] ?? [];
  }

  getBads(): BadEntity[] {
    return this.getList(Data.BAD) as BadEntity[];
  }

  getBombs(): BombEntity[] {
    return this.getList(Data.BOMB) as BombEntity[];
  }

  getItems(): ItemEntity[] {
    return this.getList(Data.ITEM) as ItemEntity[];
  }

  getListAt(type: number, cx: number, cy: number): BaseEntity[] {
    return this.getList(type).filter((e) => e.cx === cx && e.cy === cy);
  }

  countList(type: number): number {
    return this.getList(type).length;
  }

  getClose(type: number, x: number, y: number, radius: number, flOnGround: boolean): BaseEntity[] {
    const list = this.getList(type);
    const out: BaseEntity[] = [];
    const sqrRad = radius * radius;
    for (const e of list) {
      if (e.fl_kill || e.fl_destroy) continue;
      const sqr = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
      if (sqr <= sqrRad) {
        if (!flOnGround || e.y <= y + Data.CASE_HEIGHT) {
          out.push(e);
        }
      }
    }
    return out;
  }

  getOne(type: number): BaseEntity | null {
    const list = this.getList(type);
    if (list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  destroyList(type: number): void {
    const list = [...this.getList(type)];
    for (const e of list) {
      e.destroy();
    }
  }

  cleanKills(): void {
    for (const item of this.unregList) {
      this.removeFromList(item.type, item.ent);
    }
    this.unregList.length = 0;

    for (const e of this.killList) {
      e.mc.removeMovieClip();
    }
    this.killList.length = 0;
  }

  // ----------------------------------------------------------- Game Mechanics

  countCombo(comboId: number): number {
    const cur = (this.comboMap.get(comboId) ?? 0) + 1;
    this.comboMap.set(comboId, cur);
    return cur;
  }

  canAddItem(): boolean {
    return !this.fl_clear || this.world.current.badList.length === 0;
  }

  checkLevelClear(): boolean {
    if (this.fl_clear) return true;
    if (this.countList(Data.BAD_CLEAR) > 0) return false;

    this.fl_clear = true;
    this.fxMan.attachExit();
    this.scriptRunner?.clearEndTriggers();
    return true;
  }

  shake(duration: number | null, power: number | null): void {
    if (duration === null || power === null) {
      this.shakeTimer = 0;
      this.shakePower = 0;
      return;
    }
    if (duration < this.shakeTimer && power < this.shakePower) return;
    this.shakeTotal = duration;
    this.shakeTimer = duration;
    this.shakePower = power;
  }

  onExplode(x: number, y: number, radius: number): void {
    this.scriptRunner?.onExplode(x, y, radius);
  }

  onKillBad(_b: BaseEntity): void {
    this.checkLevelClear();
  }

  onHurryUp(): SwfMovieClip | null {
    this.huState++;
    this.huTimer = 0;

    for (const b of this.getList(Data.BAD)) {
      (b as any).onHurryUp?.();
    }

    const mc = this.fxMan.attachHurryUp();
    if (this.huState === 1) {
      this.audio.playSound('sound_hurry', Data.CHAN_INTERF);
    } else if (this.huState === 2) {
      this.callEvilOne();
    }
    return mc;
  }

  resetHurry(): void {
    this.huTimer = 0;
    this.huState = 0;
    this.destroyList(Data.HU_BAD);

    for (const b of this.getList(Data.BAD)) {
      (b as any).calmDown?.();
    }
  }

  private callEvilOne(): void {
    if (this.player && !this.player.fl_kill) {
      const fb = FireBallBad.attach(this, this.player);
      fb.fl_summon = false;
      fb.stopBlink();
      fb.angerMore();
    }
  }

  onResurrect(): void {
    this.resetHurry();
    this.updateDarkness();
    this.scriptRunner?.onPlayerBirth();
    this.scriptRunner?.onPlayerDeath();
  }

  onGameOver(): void {
    this.fl_gameOver = true;
    this.audio.stopMusic();
    this.saveGame();

    this.gameOverMC?.removeMovieClip();
    this.gameOverMC = this.depthMan.attach('hammer_interf_pop', Data.DP_TOP);
    this.gameOverMC._x = Data.GAME_WIDTH * 0.5;
    this.gameOverMC.gotoAndStop('1');

    const tf = this.gameOverMC.getClip('sub')?.getText('field');
    if (tf) {
      tf.text = 'GAME OVER\nClick or press Space to Restart';
    }

    this.onStateChange?.({ isOver: true, isPaused: false });
  }

  attachBad(id: number, x: number, y: number): BaseEntity {
    return createBad(this, id, x, y);
  }

  spawnScoreItem(x: number, y: number, id: number, subId: number | null): BaseEntity {
    return ScoreItem.attach(this, x, y, id, subId);
  }

  spawnSpecialItem(x: number, y: number, id: number, subId: number | null): BaseEntity | null {
    return SpecialItem.attach(this, x, y, id, subId);
  }

  spawnExtend(): void {
    if (this.fl_clear) return;
    const pt = this.world.getGround(
      Math.floor(Math.random() * Data.LEVEL_WIDTH),
      Math.floor(Math.random() * Data.LEVEL_HEIGHT),
    );
    const x = BaseEntity.x_ctr(pt.x);
    const y = BaseEntity.y_ctr(pt.y);
    const id = this.drawRandomExtend();
    SpecialItem.attach(this, x, y, 0, id);
  }

  private drawRandomExtend(): number {
    const weights = Data.RAND_EXTENDS;
    let total = 0;
    for (const w of weights) total += w;
    let roll = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  // ----------------------------------------------------------- UI & Banners

  attachPop(msg: string, flTuto: boolean): void {
    this.killPop();
    const mc = this.depthMan.attach('hammer_interf_pop', Data.DP_INTERF);
    mc._x = Data.GAME_WIDTH * 0.5;

    const sub = mc.getClip('sub');
    if (sub) {
      sub.gotoAndStop(flTuto ? '2' : '1');
      if (flTuto) {
        const header = sub.getText('header');
        if (header) header.text = this.dataStore.getStatic(2);
      }
      const field = sub.getText('field');
      if (field) {
        field.text = msg.replace(/^\n+/, '').replace(/\*/g, '');
        field._y = -field.textHeight * 0.5 - 2;
      }
    }
    this.popMC = mc;
  }

  killPop(): void {
    this.popMC?.removeMovieClip();
    this.popMC = null;
  }

  attachPointer(cx: number, cy: number, ocx: number, ocy: number): void {
    this.killPointer();
    const x = BaseEntity.x_ctr(cx);
    const y = BaseEntity.y_ctr(cy);
    const ox = BaseEntity.x_ctr(ocx);
    const oy = BaseEntity.y_ctr(ocy);

    const mc = this.depthMan.attach('hammer_fx_pointer', Data.DP_INTERF);
    mc._x = x;
    mc._y = y;
    const ang = (Math.atan2(oy - y, ox - x) * 180) / Math.PI;
    mc.rotationDeg = ang - 90;
    this.pointerMC = mc;
  }

  killPointer(): void {
    this.pointerMC?.removeMovieClip();
    this.pointerMC = null;
  }

  attachItemName(id: number): void {
    const name = this.dataStore.getItemName(id);
    if (!name) return;
    this.killItemName();

    const mc = this.depthMan.attach('hammer_interf_item_name', Data.DP_TOP);
    mc._x = Data.GAME_WIDTH * 0.5 + 20;
    mc._y = 15;
    const tf = mc.getText('field') ?? mc.findFirstText();
    if (tf) tf.text = name;

    const iconLink = id < 1000 ? 'hammer_item_special' : 'hammer_item_score';
    const icon = this.depthMan.lib.attach(iconLink);
    const frame = id < 1000 ? id + 1 : id - 1000 + 1;
    icon.gotoAndStop(String(frame));
    icon.getClip('sub')?.stop();
    icon._x = tf ? -tf.textWidth * 0.5 - 20 : -50;
    icon._y = 10;
    icon._xscale = 75;
    icon._yscale = 75;
    mc.addChild(icon);

    this.itemNameMC = mc;
  }

  killItemName(): void {
    this.itemNameMC?.removeMovieClip();
    this.itemNameMC = null;
  }

  // ----------------------------------------------------- Portals & Dimensions

  onEnterCase(cx: number, cy: number): void {
    this.scriptRunner?.onEnterCase(cx, cy);
  }

  usePortal(pid: number, _entity: BaseEntity | null): boolean {
    if (this.nextLink) return false;
    const link = this.dataStore.portalLinks.links.find(
      (l) =>
        l.from_did === this.currentDim && l.from_lid === this.world.currentId && l.from_pid === pid,
    );
    if (!link) return false;

    this.nextLink = link;
    this.switchDimensionById(link.to_did, link.to_lid, link.to_pid);
    return true;
  }

  openPortal(cx: number, cy: number, pid: number): boolean {
    if (this.portalMcList[pid]) return false;
    this.scriptRunner?.insertPortal(cx, cy, pid);

    const x = BaseEntity.x_ctr(this.flipCoordCase(cx));
    const y = BaseEntity.y_ctr(cy) - Data.CASE_HEIGHT * 0.5;

    const mc = this.depthMan.attach('hammer_portal', Data.DP_SPRITE_BACK_LAYER);
    mc._x = x;
    mc._y = y;

    this.fxMan.attachExplosion(x, y, 40);
    this.fxMan.attachShine(x, y);
    this.portalMcList[pid] = { x, y, mc, cpt: 0 };
    return true;
  }

  switchDimensionById(did: number, lid: number, _pid: number): void {
    if (did < 0 || did >= this.dimensions.length) return;
    this.currentDim = did;
    this.world = this.dimensions[did];
    this.view.destroy();
    this.view = new LevelView(this.world, this.depthMan);
    this.goto(lid);
    this.nextLink = null;
  }

  // ------------------------------------------------------------- Darkness

  clearExtraHoles(): void {
    this.extraHoles = [];
    this.updateDarkness();
  }

  addHole(x: number, y: number, diameter: number): void {
    this.extraHoles.push({ x, y, d: diameter });
    this.updateDarkness();
  }

  updateDarkness(): void {
    if (this.forcedDarkness !== null) {
      this.targetDark = this.forcedDarkness;
    } else if (
      this.world.fl_mainWorld &&
      (this.world.currentId < Data.MIN_DARKNESS_LEVEL || this.world.currentId > 101)
    ) {
      this.darknessMC?.removeMovieClip();
      this.darknessMC = null;
      this.dfactor = 0;
      return;
    } else {
      this.targetDark = this.world.currentId;
    }

    if (!this.darknessMC) {
      this.darknessMC = this.depthMan.attach('hammer_fx_darkness', Data.DP_BORDERS);
      this.darknessMC._x = -this.xOffset;
    }
  }

  private holeUpdate(): void {
    if (!this.darknessMC) return;

    if (this.dfactor < this.targetDark) {
      this.dfactor = Math.min(this.targetDark, this.dfactor + 2);
    } else if (this.dfactor > this.targetDark) {
      this.dfactor = Math.max(this.targetDark, this.dfactor - 2);
    }

    this.darknessMC._alpha = this.dfactor;
  }

  // ------------------------------------------------- Dynamic Vars & World Keys

  setDynamicVar(name: string, value: string): void {
    this.dvars.set(name.replace(/^\$/, '').toLowerCase(), value);
  }

  getDynamicVar(name: string): string | undefined {
    return this.dvars.get(name.replace(/^\$/, '').toLowerCase());
  }

  hasKey(id: number | null): boolean {
    if (id === null || Number.isNaN(id)) return true;
    return this.worldKeys[id] === true;
  }

  giveKey(id: number): void {
    this.worldKeys[id] = true;
  }

  // --------------------------------------------------------------- Coordinate

  flipCoordReal(x: number): number {
    return this.fl_mirror ? Data.GAME_WIDTH - x - 1 : x;
  }

  flipCoordCase(cx: number): number {
    return this.fl_mirror ? Data.LEVEL_WIDTH - cx - 1 : cx;
  }

  playMusicTrack(trackId: number): void {
    switch (trackId) {
      case 0:
        this.audio.playMusic('music_ingame');
        break;
      case 1:
        this.audio.playMusic('music_boss');
        break;
      case 2:
        this.audio.playMusic('music_hurry');
        break;
      default:
        this.audio.playMusic('music_ingame');
        break;
    }
  }

  setWarpStart(): void {
    this.fl_warpStart = true;
  }

  pickUpScore(id: number, _subId: number | null): number {
    this.scorePicks[id] = (this.scorePicks[id] ?? 0) + 1;
    if (this.player) {
      this.highScore = Math.max(this.highScore, this.player.score);
      this.onScoreChange?.(this.player.score);
    }
    return this.scorePicks[id];
  }

  pickUpSpecial(id: number): number {
    this.specialPicks[id] = (this.specialPicks[id] ?? 0) + 1;
    return this.specialPicks[id];
  }

  // ------------------------------------------------------- Pause & Instructions

  togglePause(): void {
    if (this.fl_pause) this.onUnpause();
    else this.onPause();
  }

  onPause(): void {
    if (this.fl_lock || this.fl_gameOver) return;
    this.fl_pause = true;
    this.pauseMC?.removeMovieClip();

    this.pauseMC = this.depthMan.attach('hammer_interf_instructions', Data.DP_INTERF);
    this.pauseMC._x = Data.GAME_WIDTH * 0.5;
    this.pauseMC._y = Data.GAME_HEIGHT * 0.5;

    const title = this.pauseMC.getText('title');
    if (title) title.text = this.dataStore.getStatic(5) || 'PAUSE';

    const move = this.pauseMC.getText('move');
    if (move) move.text = this.dataStore.getStatic(7) || 'Move: Arrows / WASD';

    const attack = this.pauseMC.getText('attack');
    if (attack) attack.text = this.dataStore.getStatic(8) || 'Place Bomb: Space / Ctrl';

    const sector = this.pauseMC.getText('sector');
    if (sector) {
      const sName = this.dataStore.getSectorName(this.currentDim, this.world.currentId);
      sector.text = sName ? `« ${sName} »` : '';
    }

    const tip = this.pauseMC.getText('tip');
    if (tip) {
      tip.text = `${this.dataStore.getStatic(300)} ${this.dataStore.getStatic(301)}`;
    }

    this.onStateChange?.({ isOver: this.fl_gameOver, isPaused: true });
  }

  onUnpause(): void {
    if (!this.fl_pause) return;
    this.fl_pause = false;
    this.pauseMC?.removeMovieClip();
    this.pauseMC = null;
    this.onStateChange?.({ isOver: this.fl_gameOver, isPaused: false });
  }

  // ------------------------------------------------------- Fixed Update Loop

  update(): void {
    this.input.poll();

    // Check pause key toggle
    if (this.input.consumePress('pause')) {
      this.togglePause();
    }

    if (this.fl_gameOver) {
      if (this.input.consumePress('attack') || this.input.consumePress('jump')) {
        this.initGame();
      }
      return;
    }

    if (this.fl_pause) {
      return;
    }

    this.cycle += 1;
    this.fl_ice = this.getDynamicVar('$ICE') !== undefined;
    this.fl_aqua = this.getDynamicVar('$AQUA') !== undefined;

    // Hurry up timer
    this.huTimer += 1;
    if (
      this.huState < Data.HU_STEPS.length &&
      this.huTimer >= Data.HU_STEPS[this.huState] / this.diffFactor
    ) {
      this.onHurryUp();
    } else if (this.huState >= Data.HU_STEPS.length && this.countList(Data.HU_BAD) === 0) {
      this.callEvilOne();
    }

    // Portal floating animation
    for (const p of this.portalMcList) {
      if (p) {
        p.cpt += 0.1;
        p.mc._y = p.y + 2 * Math.sin(p.cpt);
      }
    }

    // Update level script
    this.scriptRunner?.update();

    // Update entities (32 Hz)
    for (const e of this.getList(Data.ENTITY)) {
      e.update();
      e.endUpdate();
    }

    this.cleanKills();
    this.checkLevelClear();

    // Screen shake update
    if (this.shakeTimer > 0) {
      this.shakeTimer -= 1;
      const ratio = this.shakeTotal > 0 ? this.shakeTimer / this.shakeTotal : 0;
      const ox = (Math.random() * 2 - 1) * this.shakePower * ratio;
      const oy = (Math.random() * 2 - 1) * this.shakePower * ratio;
      this.gameRoot._x = this.xOffset + Math.round(ox);
      this.gameRoot._y = Math.round(oy);
    } else {
      this.gameRoot._x = this.xOffset;
      this.gameRoot._y = 0;
    }

    // Item name banner fade
    if (this.itemNameMC) {
      this.itemNameMC._alpha -= (105 - this.itemNameMC._alpha) * 0.01;
      if (this.itemNameMC._alpha <= 5) {
        this.killItemName();
      }
    }

    this.holeUpdate();
    this.fxMan.update();
    this.hud.update();
  }

  stepAnimation(): void {
    // 40 Hz MovieClip timeline stepper
    this.gameRoot.stepAnimation();
  }

  start(): void {
    this.gameLoop.start();
  }

  stop(): void {
    this.gameLoop.stop();
  }

  restartLevel(): void {
    this.initGame(this.world.currentId);
  }

  changeLevel(levelId: number): void {
    if (levelId < 0 || levelId >= this.world.set.levels.length) return;
    this.initGame(levelId);
  }

  async changeSet(setName: string, levelId = 0): Promise<void> {
    const set = await this.dataStore.loadLevelSet(setName);
    this.currentSetName = setName;
    this.currentDim = 0;
    this.dimensions = [new LevelWorld(set, levelId, true)];
    this.world = this.dimensions[0];
    this.view = new LevelView(this.world, this.depthMan);
    this.initGame(levelId);
  }

  destroy(): void {
    this.gameLoop.stop();
    this.clearLevel();
    this.saveGame();
    this.app.stage.removeChild(this.gameRoot);
  }
}
