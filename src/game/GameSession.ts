import type { Container } from 'pixi.js';
import { AudioEngine } from '../engine/Audio';
import { DepthManager } from '../engine/DepthManager';
import { FixedGameLoop } from '../engine/GameLoop';
import { InputController } from '../engine/Input';
import { InputPlayer, InputRecorder, type Replay } from '../engine/InputRecording';
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
import { Random } from './Random';
import { RandomManager } from './RandomManager';
import { GameHud } from './gui/GameHud';
import type { IGameContext } from './GameContext';
import { LevelView } from './levels/LevelView';
import { LevelWorld } from './levels/LevelWorld';
import { ScriptRunner } from './levels/ScriptRunner';

const SAVE_KEY = 'hammerfenix_save_v1';

/**
 * Item families the player has unlocked. The original reads them from the player profile
 * (`GameParameters.specialItemFamilies` / `scoreItemFamilies`). Until profiles exist (roadmap 3.2),
 * use the base families.
 */
const SPECIAL_ITEM_FAMILIES: readonly number[] = [0, 1, 2];
const SCORE_ITEM_FAMILIES: readonly number[] = [1000, 1001, 1002];

export interface GameSaveData {
  highScore: number;
  highestLevel: Record<string, number>;
  preferredLang: string;
  muted: boolean;
}

/** What the session needs from the PixiJS app: a stage to put the game on. */
export interface GameHost {
  readonly stage: Container;
}

/** `GameManager.musics`: the in-game, boss and hurry-up tracks. */
export const MUSIC_TRACKS: readonly string[] = ['music_ingame', 'music_boss', 'music_hurry'];

export class GameSession implements IGameContext {
  readonly app: GameHost;
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

  /** Every random draw of the game goes through `rand`, so a seed and inputs replay a game. */
  readonly rand = new Random();
  /** Seed of the current game, set by `initGame()`. */
  seed = 0;
  randMan: RandomManager = new RandomManager(this.rand);
  /** Random source of the SWF frame scripts: seeded with the game, but apart from `rand`. */
  private readonly animRand = new Random();

  private recorder: InputRecorder | null = null;
  private recordStart: { set: string; level: number; seed: number } | null = null;
  /** The last recording, kept after it stops (also when a debug restart ends it). */
  lastRecording: Replay | null = null;

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
  /** Music track playing: 0 main, 1 boss, 2 hurry up. */
  currentTrack = 0;
  /** `Adventure`: kill order of the level's enemies, for the super item (task 2.1). */
  perfectOrder: number[] = [];
  perfectCount = 0;
  private fl_badsCallback = false;
  /** Set while forcedGoto / portals place the players before the level becomes ready. */
  private fl_deferLevelReady = false;
  /** Players that were not on the portal when the dimension changed (`latePlayers`). */
  private latePlayers: PlayerEntity[] = [];
  /** Arrival portal of the last dimension change. */
  private portalId = -1;
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
  /** Ends the game when it runs out (the elevator exit after Tuberculoz, code trigger 4). */
  endModeTimer = 0;

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
    app: GameHost,
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
    lib.random = () => this.animRand.next();
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
    app: GameHost,
    lib: SwfLibrary,
    dataStore: GameDataStore,
    audio: AudioEngine,
    input: InputController,
    preferredSet = 'adventure',
  ): Promise<GameSession> {
    const set = await dataStore.loadLevelSet(preferredSet);
    const session = new GameSession(app, lib, dataStore, audio, input, set, preferredSet);
    session.dimensions.push(...(await GameSession.loadExtraDimensions(dataStore, preferredSet)));
    session.initGame();
    return session;
  }

  /** The adventure links to 4 other dimensions through portals; load them as secondary worlds. */
  private static async loadExtraDimensions(
    dataStore: GameDataStore,
    setName: string,
  ): Promise<LevelWorld[]> {
    if (setName !== 'adventure') return [];
    const out: LevelWorld[] = [];
    for (const name of ['deepnight', 'hiko', 'ayame', 'hk']) {
      try {
        out.push(new LevelWorld(await dataStore.loadLevelSet(name), 0, false));
      } catch {
        // non-critical if optional dimension file fails
      }
    }
    return out;
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

  initGame(startLevelId = 0, seed = Random.makeSeed()): void {
    // Drop the previous game's players; clearLevel() leaves them alive between levels.
    this.destroyList(Data.PLAYER);
    this.player = null;
    this.clearLevel();
    this.fxMan.clear(); // a new GameMode starts with no effects

    this.resetGameState();
    this.backToMainWorld(); // a new GameMode starts in dimensions[0]
    this.fakeLevelId = null;
    this.seed = seed;
    this.rand.reseed(seed);
    this.animRand.reseed(seed ^ 0x5eed);
    this.initRandMan();
    this.gameLoop.resetPhase();

    this.fl_gameOver = false;
    this.fl_clear = false;
    this.fl_lock = false;
    this.fl_pause = false;
    this.cycle = 0;
    this.gameOverMC?.removeMovieClip();
    this.gameOverMC = null;

    // Adventure.initGame
    this.playMusicTrack(0);
    this.world.goto(startLevelId);
    this.world.fl_entered = true;
    this.onWorldRead();
    // insertPlayer: attached hidden; onLevelReady shows it
    const sx = this.flipCoordCase(this.world.current.playerX);
    this.player = PlayerEntity.attach(
      this,
      BaseEntity.x_ctr(sx),
      BaseEntity.y_ctr(this.world.current.playerY),
    );
    this.player.hide();
    // `GameInterface.initSingle` reads the new player's score and lives
    this.hud.setScore(this.player.score, true);
    this.hud.setLives(this.player.lives);
    this.hud.clearExtends();

    // The first level has no scroll: it is ready at once, before its script compiles
    this.onDataReady(true);
  }

  /**
   * The original starts each game with a new `GameMode` object. This session object is reused,
   * so clear everything a previous game may have changed.
   */
  private resetGameState(): void {
    for (const w of this.dimensions) w.resetForNewGame();
    this.globalActives.fill(false);
    this.worldKeys.fill(false);
    this.comboMap.clear();
    this.specialPicks.length = 0;
    this.scorePicks.length = 0;
    this.uniqIdCounter = 1;
    this.speedFactor = 1.0;
    this.diffFactor = 1.0;
    this.fl_warpStart = false;
    this.fakeLevelId = null;
    this.forcedDarkness = null;
    this.extraHoles = [];
    this.killPortals();
    this.nextLink = null;
    this.keyLock = null;
    this.currentTrack = 0;
    this.perfectOrder = [];
    this.perfectCount = 0;
    // GameMode constructor: world keys unlocked by quests (families 5000-5099)
    for (let i = 5000; i < 5100; i++) {
      if (this.hasFamily(i)) this.giveKey(i - 5000);
    }
    this.endModeTimer = 0;
    this.shakeTimer = 0;
    this.shakeTotal = 0;
    this.shakePower = 0;
  }

  hasFamily(id: number): boolean {
    return SPECIAL_ITEM_FAMILIES.includes(id) || SCORE_ITEM_FAMILIES.includes(id);
  }

  /** From `GameMode.init`: register the extend letters and the unlocked item families. */
  private initRandMan(): void {
    this.randMan = new RandomManager(this.rand);
    this.randMan.register(Data.RAND_EXTENDS_ID, [...Data.RAND_EXTENDS]);
    this.randMan.register(
      Data.RAND_ITEMS_ID,
      this.dataStore.getRandFromFamilies(this.dataStore.items.special, SPECIAL_ITEM_FAMILIES),
    );
    this.randMan.register(
      Data.RAND_SCORES_ID,
      this.dataStore.getRandFromFamilies(this.dataStore.items.score, SCORE_ITEM_FAMILIES),
    );
  }

  /** `GameMechanics.onReadComplete`: a new script engine for the level just read. */
  private onWorldRead(): void {
    this.scriptRunner = new ScriptRunner(this, this.world.current);
  }

  /**
   * `ViewManager.onDataReady` + `GameMechanics.onDataReady`: the level's view is created, then
   * its script compiles and runs its first cycle. A level shown without a transition (`fl_direct`:
   * new game, level picker) is ready before the compile, so its bads and items join the script
   * before the first cycle. Otherwise the level scrolls in first (task 2.7; the port has no
   * scroll yet and the caller calls `onLevelReady`). The original also parses the IA map over
   * several frames before this.
   */
  private onDataReady(fl_direct: boolean): void {
    this.view.destroy();
    this.view = this.createView(this.world.currentId);
    this.view.moveTo(0, 0);
    if (fl_direct) {
      this.onLevelReady();
    }
    this.scriptRunner?.compile();
  }

  /** `GameMechanics.createView` + `ViewManager.createView` */
  private createView(id: number): LevelView {
    this.scriptRunner?.onLevelAttach();
    const v = new LevelView(this.world, this.depthMan);
    v.fl_hideTiles = this.world.fl_hideTiles;
    v.fl_hideBorders = this.world.fl_hideBorders;
    v.detach();
    if (!this.world.fl_shadow) {
      v.removeShadows();
    }
    v.display(id);
    return v;
  }

  /** `GameMechanics.update`. The IA map is parsed at once in `LevelWorld.goto`. */
  private updateWorld(): void {
    if (!this.world.fl_lock) {
      this.scriptRunner?.update();
    }

    // Floating portal fields
    for (const p of this.world.portalList) {
      p.mc._y = p.y + 3 * Math.sin(p.cpt);
      p.cpt += 0.1;
      if (this.rand.random(5) === 0) {
        const a = this.fxMan.attachFx(
          p.x + Data.CASE_WIDTH * 0.5 + this.rand.random(15) * (this.rand.random(2) * 2 - 1),
          p.y + Data.CASE_WIDTH * 0.5 + this.rand.random(15) * (this.rand.random(2) * 2 - 1),
          'hammer_fx_star',
        );
        if (a) {
          a.mc._xscale = this.rand.random(70) + 30;
          a.mc._yscale = a.mc._xscale;
        }
      }
    }
  }

  /** `GameMode.onLevelReady` + `Adventure.onLevelReady`: the level has scrolled in. */
  onLevelReady(): void {
    this.fl_lock = false;
    this.initLevel();
    this.startLevel();
    for (const e of this.getList(Data.ENTITY)) e.world = this.world;
    for (const p of this.getList(Data.PLAYER)) (p as PlayerEntity).show();

    if (this.fl_warpStart) {
      if (this.world.fl_mainWorld) {
        // The original uses x_ctr for the y coordinate here
        this.view.attachSprite(
          'door_secret',
          BaseEntity.x_ctr(this.world.current.playerX),
          BaseEntity.x_ctr(this.world.current.playerY) + Data.CASE_HEIGHT * 0.5,
          true,
        );
      }
      this.fl_warpStart = false;
    }
    if (!this.world.isVisited()) {
      const zoneName = this.dataStore.getSectorName(this.currentDim, this.world.currentId);
      this.fxMan.attachLevelPop(zoneName, this.world.currentId > 0);
    }
    this.onLevelChange?.(this.world.currentId, this.currentSetName);
  }

  /** `GameMode.initLevel` */
  private initLevel(): void {
    if (!this.world.isVisited()) {
      this.resetHurry();
    }
    this.badCount = 0;
    this.forcedDarkness = null;
    this.fl_clear = false;
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.onStartLevel(this.world.fl_mainWorld);
      if (p.y < 0) {
        this.fxMan.attachEnter(p.x, 0);
      }
    }
  }

  /** `Adventure.startLevel` + `GameMode.startLevel` */
  startLevel(): void {
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.setBaseAnims(Data.ANIM_PLAYER_WALK, Data.ANIM_PLAYER_STOP);
    }
    this.perfectOrder = [];
    this.perfectCount = 0;

    const n = this.scriptRunner?.insertBads() ?? 0;
    if (n === 0) {
      this.fxMan.attachExit();
      this.fl_clear = true;
    }
    this.updateDarkness();
    if (!this.world.isVisited()) {
      this.addLevelItems();
    }
    this.scriptRunner?.onPlayerBirth();
    this.world.unlock();
    this.fl_badsCallback = false;
    if (this.isBossLevel(this.world.currentId)) {
      this.fxMan.attachWarning();
    }
    // Bosses (Bat, Tuberculoz) are tasks 2.8 and 2.9
    if (this.world.fl_mainWorld && this.world.currentId === 0) {
      this.fxMan.detachExit();
    }
  }

  /** `Adventure.isBossLevel` */
  isBossLevel(id: number): boolean {
    return (
      this.world.fl_mainWorld &&
      ((id >= 30 && id % 10 === 0) || id === Data.BAT_LEVEL || id === Data.TUBERCULOZ_LEVEL)
    );
  }

  /** `Adventure.addLevelItems` */
  private addLevelItems(): void {
    // Extends: `statsMan.spreadExtend()` (StatsManager is task 2.10; it only inserts the extend
    // timer when the player earned letters)
    if (this.world.current.specialSlots.length > 0) {
      this.scriptRunner?.insertExtend();
    }

    if (this.world.current.specialSlots.length > 0) {
      const pt =
        this.world.current.specialSlots[this.rand.random(this.world.current.specialSlots.length)];
      this.scriptRunner?.insertSpecialItem(
        this.randMan.draw(Data.RAND_ITEMS_ID) ?? 0,
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
        this.world.current.scoreSlots[this.rand.random(this.world.current.scoreSlots.length)];
      this.scriptRunner?.insertScoreItem(
        this.randMan.draw(Data.RAND_SCORES_ID) ?? 0,
        null,
        pt.x,
        pt.y,
        Data.SCORE_ITEM_TIMER,
        null,
        false,
        true,
      );

      if (this.globalActives[94]) {
        const cx = this.rand.random(Data.LEVEL_WIDTH);
        const cy = this.rand.random(Data.LEVEL_HEIGHT - 5);
        const ptC = this.world.getGround(cx, cy);
        this.scriptRunner?.insertScoreItem(
          this.randMan.draw(Data.RAND_SCORES_ID) ?? 0,
          null,
          ptC.x,
          ptC.y,
          Data.SCORE_ITEM_TIMER,
          null,
          false,
          true,
        );
      }
    }
  }

  /** `Adventure.nextLevel` + `GameMode.nextLevel` */
  nextLevel(): void {
    this.fakeLevelId = (this.fakeLevelId ?? 0) + 1;
    this.goto(this.world.currentId + 1);
    if (this.fl_warpStart) {
      this.world.currentId = 0;
      this.fl_lock = false;
      this.forcedGoto(10);
    }
  }

  /** `GameMode.forcedGoto` */
  forcedGoto(id: number): void {
    this.fakeLevelId = (this.fakeLevelId ?? 0) + id - this.world.currentId;
    this.world.fl_hideBorders = false;
    this.world.fl_hideTiles = false;
    this.fl_deferLevelReady = true;
    this.goto(id);
    this.fl_deferLevelReady = false;
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.moveTo(
        BaseEntity.x_ctr(this.world.current.playerX),
        BaseEntity.y_ctr(this.world.current.playerY - 1),
      );
      p.shield(Data.SHIELD_DURATION * 1.3);
      p.hide();
    }
    // No scroll yet (task 2.7): the level is ready at once
    this.onDataReady(false);
    this.onLevelReady();
  }

  /** `Adventure.goto` + `GameMode.goto` */
  goto(id: number): void {
    if (this.fl_lock || this.fl_gameOver) return;
    this.perfectOrder = [];
    this.perfectCount = 0;
    if (id >= this.world.levelCount) {
      this.onEndOfSet();
      return;
    }

    this.clearExtraHoles();
    this.world.lock();
    this.killPortals();
    this.clearLevel();
    this.fl_lock = true;
    this.fl_clear = false;
    this.world.markVisited(); // GameMechanics.goto marks the level being left
    this.world.goto(id);
    this.onWorldRead();

    for (const e of this.getList(Data.ENTITY)) {
      e.world = this.world;
    }

    // Players fall in from above, where they left the previous level
    const lp = this.getList(Data.PLAYER) as PlayerEntity[];
    let best: PlayerEntity | null = null;
    for (const p of lp) {
      if (best === null || p.y > best.y) best = p;
    }
    if (best) {
      for (const p of lp) {
        p.moveTo(best.x, -600);
        p.hide();
        p.onNextLevel();
      }
      best.moveTo(best.x, -200);
    }
    this.fxMan.onNextLevel();
    this.audio.playSound('sound_level_clear', Data.CHAN_INTERF);

    // No scroll yet (task 2.7): the level is ready at once. forcedGoto calls these itself after
    // placing the players.
    if (!this.fl_deferLevelReady) {
      this.onDataReady(false);
      this.onLevelReady();
    }
  }

  /** `Adventure.onEndOfSet`: the original leaves the game (`exitGame`). */
  onEndOfSet(): void {
    this.onGameOver();
  }

  clearLevel(): void {
    this.killPop();
    this.killPointer();
    this.killItemName();

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
    return list[this.rand.random(list.length)];
  }

  /** A random entity of `type` other than `e`, or null when there is no other one. */
  getAnotherOne(type: number, e: BaseEntity): BaseEntity | null {
    const l = this.getList(type);
    if (l.length <= 1) return null;
    let i: number;
    do {
      i = this.rand.random(l.length);
    } while (l[i] === e);
    return l[i];
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

  /** `GameMode.checkLevelClear` */
  checkLevelClear(): boolean {
    if (this.fl_clear) return true;
    if (this.countList(Data.BAD_CLEAR) > 0) return false;
    if (
      this.world.fl_mainWorld &&
      (this.world.currentId === Data.BAT_LEVEL || this.world.currentId === Data.TUBERCULOZ_LEVEL)
    ) {
      return false;
    }
    this.onLevelClear();
    return true;
  }

  /** `GameMode.onLevelClear` (+ `Adventure.onLevelClear`'s super item, task 2.1) */
  onLevelClear(): void {
    if (this.fl_clear) return;
    this.scriptRunner?.clearEndTriggers();
    // Extend letters still on screen disappear
    for (const it of this.getList(Data.SPECIAL_ITEM) as ItemEntity[]) {
      if (it.id === 0) it.destroy();
    }
    this.fl_clear = true;
    this.fxMan.attachExit();
  }

  shake(duration: number | null, power: number | null): void {
    if (duration === null || power === null) {
      this.shakeTimer = 0; // the original resets the timer only (twice), not the power
      return;
    }
    if (duration < this.shakeTimer || power < this.shakePower) return;
    this.shakeTotal = duration;
    this.shakeTimer = duration;
    this.shakePower = power;
  }

  onExplode(x: number, y: number, radius: number): void {
    this.scriptRunner?.onExplode(x, y, radius);
  }

  /** `Adventure.onKillBad` (GameMode's is empty) */
  onKillBad(b: BaseEntity): void {
    if (this.badCount > 1 && b.uniqId === this.perfectOrder[0]) {
      this.perfectOrder.splice(0, 1);
    }
  }

  /** `Adventure.onHurryUp` + `GameMode.onHurryUp` */
  onHurryUp(): SwfMovieClip | null {
    this.huState++;
    this.huTimer = 0;

    for (const b of this.getBads()) {
      b.onHurryUp();
    }

    const mc = this.fxMan.attachHurryUp();
    if (this.huState === 1) {
      this.audio.playSound('sound_hurry', Data.CHAN_INTERF);
    }
    if (this.huState === 2) {
      this.callEvilOne(0);
    }
    if (this.currentTrack === 0) {
      this.playMusicTrack(2);
    }
    return mc;
  }

  /** `Adventure.resetHurry` + `GameMode.resetHurry` */
  resetHurry(): void {
    this.huTimer = 0;
    this.huState = 0;

    // Difficulty grows with spare lives
    let max = 0;
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      max = p.lives > max ? p.lives : max;
    }
    this.diffFactor = max < 4 ? 1.0 : 1.0 + 0.05 * (max - 3);
    if (this.fl_nightmare) {
      this.diffFactor *= 1.4;
    }

    this.destroyList(Data.HU_BAD);
    for (const b of this.getBads()) {
      b.calmDown();
    }
    // Bosses' onPlayerDeath: tasks 2.8 and 2.9

    if (this.currentTrack === 2) {
      this.playMusicTrack(0);
    }
  }

  /** `GameMode.callEvilOne`: the fire ball. With base anger 0 it starts as a harmless summon. */
  private callEvilOne(baseAnger: number): void {
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      if (!p.fl_kill) {
        const mc = FireBallBad.attach(this, p);
        mc.anger = baseAnger - 1;
        if (baseAnger > 0) {
          mc.fl_summon = false;
          mc.stopBlink();
        }
        mc.angerMore();
      }
    }
  }

  onResurrect(): void {
    this.destroyList(Data.SUPA);
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

  /** `Adventure.attachBad` + `GameMode.attachBad` */
  attachBad(id: number, x: number, y: number): BaseEntity {
    const b = createBad(this, id, x, y);
    if (b.isType(Data.BAD_CLEAR)) {
      this.badCount++;
      this.perfectOrder.push(b.uniqId);
      this.perfectCount++;
    }
    return b;
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
      this.rand.random(Data.LEVEL_WIDTH),
      this.rand.random(Data.LEVEL_HEIGHT),
    );
    const x = BaseEntity.x_ctr(pt.x);
    const y = BaseEntity.y_ctr(pt.y);
    const id = this.randMan.draw(Data.RAND_EXTENDS_ID) ?? 0;
    SpecialItem.attach(this, x, y, 0, id);
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

  killPortals(): void {
    for (const p of this.portalMcList) {
      p?.mc.removeMovieClip();
    }
    this.portalMcList.length = 0;
  }

  // ----------------------------------------------------- Portals & Dimensions

  onEnterCase(cx: number, cy: number): void {
    this.scriptRunner?.onEnterCase(cx, cy);
  }

  /** `GameMode.usePortal`: false when the portal leads nowhere. Map events are not ported. */
  usePortal(pid: number, e: BaseEntity | null): boolean {
    if (this.nextLink !== null) return false;
    const link = this.dataStore.portalLinks.links.find(
      (l) =>
        l.from_did === this.currentDim && l.from_lid === this.world.currentId && l.from_pid === pid,
    );
    if (!link) return false;

    if (e === null) {
      // Floating portal: players are pulled in, then shrink (see update)
      const portal = this.portalMcList[pid];
      for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
        if (portal) {
          p.dx = (portal.x - p.x) * 0.018;
          p.dy = (portal.y - p.y) * 0.018;
        }
        p.fl_hitWall = false;
        p.fl_hitGround = false;
        p.fl_gravity = false;
        p.fl_friction = false;
        p.clearTemp();
        p.unshield();
        p.lockControls(Data.SECOND * 9999);
        p.playAnim(Data.ANIM_PLAYER_DIE);
      }
      this.nextLink = link;
    } else {
      this.switchDimensionById(link.to_did, link.to_lid, link.to_pid);
    }
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

  /** `GameMode.switchDimensionById`. The fade / side scroll transition is task 2.7. */
  switchDimensionById(id: number, lid: number, pid: number): void {
    if (!this.fl_clear) return;
    if (id < 0 || id >= this.dimensions.length) return;

    this.resetHurry();
    this.latePlayers = [];
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.clearTemp();
      p.clearRec();
      p.mc._xscale = p.scaleFactor * 100;
      p.mc._yscale = p.mc._xscale;
      p.lockTimer = 0;
      p.fl_lockControls = false;
      p.fl_gravity = true;
      p.fl_friction = true;
      if (!p.fl_kill) {
        p.fl_hitWall = true;
        p.fl_hitGround = true;
      }
      p.changeWeapon(Data.WEAPON_B_CLASSIC);
      if (this.world.getCase(p.cx, p.cy) !== Data.FIELD_PORTAL) {
        this.latePlayers.push(p);
      }
      p.hide();
    }
    this.holeUpdate();
    this.clearExtraHoles();
    this.clearLevel();
    this.killPortals();
    this.fxMan.clear();
    this.cleanKills();
    this.currentDim = id;

    // world.suspend(): the script left is saved and the level counts as visited
    this.world.suspend(this.scriptRunner?.scriptToString() ?? null);
    this.world = this.dimensions[id];
    this.fl_lock = true;
    this.fl_clear = false;

    // world.restoreFrom(): GameMechanics.goto marks this world's previous level as visited
    if (this.world.fl_entered) this.world.markVisited();
    this.world.goto(lid);
    this.world.fl_entered = true;
    this.onWorldRead();
    this.onDataReady(false);
    for (const e of this.getList(Data.ENTITY)) e.world = this.world;

    this.fakeLevelId = this.world.fl_mainWorld ? null : 0;
    this.portalId = pid;
    this.nextLink = null;

    // End of the transition (GameMechanics.onFadeDone / onHScrollDone)
    this.onRestore();
    this.onLevelReady();
  }

  /** `GameMode.getPortalEntrance`: arrival case after a dimension change. */
  private getPortalEntrance(pid: number): { x: number; y: number; fl_unstable: boolean } {
    let px = this.world.current.playerX;
    let py = this.world.current.playerY;
    let flUnstable = false;
    const portal = pid >= 0 ? this.world.portalList[pid] : undefined;
    if (portal) {
      px = portal.cx;
      py = portal.cy;
      if (this.world.getCase(px, py + 1) === Data.FIELD_PORTAL) {
        while (this.world.getCase(px, py + 1) === Data.FIELD_PORTAL) {
          py++;
        }
        if (this.world.getCase(px - 1, py) <= 0) {
          px -= 1;
        } else if (this.world.getCase(px + 1, py) <= 0) {
          px += 1;
        }
      } else {
        if (this.world.getCase(px + 1, py) === Data.FIELD_PORTAL) {
          py += 2;
        }
        flUnstable = true;
      }
    } else {
      flUnstable = true;
    }
    return { x: px, y: py, fl_unstable: flUnstable };
  }

  /** `GameMode.onRestore`: players appear at the arrival portal. */
  private onRestore(): void {
    this.fl_lock = false;
    const pt = this.getPortalEntrance(this.portalId);
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.moveToCase(pt.x, pt.y);
      p.show();
      p.unshield();
      if (pt.fl_unstable) {
        p.knock(Data.SECOND * 0.6);
      }
    }
    for (const p of this.latePlayers) {
      p.knock(Data.SECOND * 1.3);
      p.dx = 0;
    }
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

  /** `Mode.playMusic`: tracks are `[music, boss, hurryUp]`. */
  playMusicTrack(trackId: number): void {
    if (MUSIC_TRACKS[trackId] === undefined) return;
    this.currentTrack = trackId;
    this.audio.playMusic(MUSIC_TRACKS[trackId]);
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
    this.world.lock();
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
    this.world.unlock();
    this.pauseMC?.removeMovieClip();
    this.pauseMC = null;
    this.onStateChange?.({ isOver: this.fl_gameOver, isPaused: false });
  }

  // ------------------------------------------------------- Fixed Update Loop

  /** `GameMode.main` */
  update(): void {
    this.input.poll();

    // Check pause key toggle
    if (this.input.consumePress('pause')) {
      this.togglePause();
    }

    if (this.fl_gameOver) {
      if (this.input.consumePress('attack') || this.input.consumePress('jump')) {
        // Seed drawn from the game, so a replay that restarts after a game over stays in sync.
        this.initGame(0, (this.rand.next() * 0x100000000) >>> 0);
      }
      return;
    }

    if (this.fl_pause) {
      return;
    }

    this.cycle += 1;
    this.fl_ice = this.getDynamicVar('$ICE') !== undefined;
    this.fl_aqua = this.getDynamicVar('$AQUA') !== undefined;

    this.updateWorld();
    this.hud.update();

    if (this.fl_lock) return;

    if (this.getBads().length > 0 && !this.fl_badsCallback) {
      this.onBadsReady();
      this.fl_badsCallback = true;
    }

    // Floating portals
    for (const p of this.portalMcList) {
      if (p) {
        p.mc._y = p.y + 2 * Math.sin(p.cpt);
        p.cpt += 0.1;
        if (this.rand.random(5) === 0) {
          const a = this.fxMan.attachFx(
            p.x + this.rand.random(25) * (this.rand.random(2) * 2 - 1),
            p.y + this.rand.random(25) * (this.rand.random(2) * 2 - 1),
            'hammer_fx_star',
          );
          if (a) {
            a.mc._xscale = this.rand.random(70) + 30;
            a.mc._yscale = a.mc._xscale;
          }
        }
      }
    }

    // Automatic end of the mode (scores are registered by the game over, task 2.11)
    if (this.endModeTimer > 0) {
      this.endModeTimer -= 1;
      if (this.endModeTimer <= 0) {
        this.onGameOver();
      }
    }

    this.fxMan.update();

    // Hurry up
    this.huTimer += 1;
    if (
      this.huState < Data.HU_STEPS.length &&
      this.huTimer >= Data.HU_STEPS[this.huState] / this.diffFactor
    ) {
      this.onHurryUp();
    }
    if (this.huState >= Data.HU_STEPS.length) {
      if (this.countList(Data.HU_BAD) === 0) {
        this.callEvilOne(Math.round(this.huTimer / Data.AUTO_ANGER));
      }
    }

    // Entities (32 Hz)
    for (const e of this.getList(Data.ENTITY)) {
      e.update();
      e.endUpdate();
    }

    this.holeUpdate();
    this.cleanKills();
    if (!this.world.fl_lock) {
      this.checkLevelClear();
    }

    // Floating portal: players shrink into it, then the dimension changes
    if (this.nextLink !== null) {
      for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
        p.mc._xscale *= 0.85;
        p.mc._yscale = Math.abs(p.mc._xscale);
        if (Math.abs(p.mc._xscale) <= 2) {
          const link = this.nextLink;
          this.nextLink = null;
          this.switchDimensionById(link.to_did, link.to_lid, link.to_pid);
          break;
        }
      }
    }

    // Screen shake
    if (this.shakeTimer > 0) {
      this.shakeTimer -= 1;
      if (this.shakeTimer <= 0) {
        this.shakeTimer = 0;
        this.shakePower = 0;
      }
      const amp = () =>
        (this.rand.random(2) * 2 - 1) *
        (this.rand.random(Math.round(this.shakePower * 10)) / 10) *
        (this.shakeTimer / this.shakeTotal);
      this.gameRoot._x = Math.round(this.xOffset + amp());
      this.gameRoot._y = Math.round(amp());
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

    if (this.countList(Data.BAD_CLEAR) > 0) {
      this.fxMan.detachExit();
    }

    // Nightmare: calm enemies get angry
    if (this.fl_nightmare) {
      for (const b of this.getBads()) {
        if (b.isType(Data.BAD_CLEAR) && b.anger === 0) {
          b.angerMore();
        }
      }
    }
  }

  /** `GameMode.onBadsReady`: ninja mode picks a foe and its friends (option, task 3.3). */
  private onBadsReady(): void {}

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
    this.stopInputCapture();
    this.initGame(this.world.currentId);
  }

  changeLevel(levelId: number): void {
    if (levelId < 0 || levelId >= this.world.set.levels.length) return;
    this.stopInputCapture();
    this.initGame(levelId);
  }

  // ------------------------------------------------------ Recording & replay

  /** Starts a new game at `levelId` of the current set, recording every tick's input. */
  startRecording(levelId = this.world.currentId): void {
    this.stopInputCapture();
    this.backToMainWorld();
    this.initGame(levelId);
    this.input.resetState();
    this.recorder = new InputRecorder();
    this.recordStart = { set: this.currentSetName, level: levelId, seed: this.seed };
    this.input.startRecording(this.recorder);
  }

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  /** Ends the recording and returns it (also kept as `lastRecording`). */
  stopRecording(): Replay | null {
    if (!this.recorder || !this.recordStart) return null;
    this.input.stopRecording();
    const { set, level, seed } = this.recordStart;
    this.lastRecording = this.recorder.toReplay(set, level, seed);
    this.recorder = null;
    this.recordStart = null;
    return this.lastRecording;
  }

  /** Starts the replay's game; from the next tick on, input comes from the replay. */
  async playReplay(replay: Replay): Promise<InputPlayer> {
    this.stopInputCapture();
    if (replay.set !== this.currentSetName) {
      await this.changeSet(replay.set, replay.level);
    }
    this.backToMainWorld();
    this.initGame(replay.level, replay.seed);
    const player = new InputPlayer(replay.input);
    this.input.startReplay(player);
    return player;
  }

  private stopInputCapture(): void {
    this.stopRecording();
    this.input.stopReplay();
  }

  private backToMainWorld(): void {
    if (this.currentDim === 0 && this.world === this.dimensions[0]) return;
    this.currentDim = 0;
    this.world = this.dimensions[0];
    this.view.destroy();
    this.view = new LevelView(this.world, this.depthMan);
  }

  async changeSet(setName: string, levelId = 0): Promise<void> {
    this.stopInputCapture();
    const set = await this.dataStore.loadLevelSet(setName);
    const extraDims = await GameSession.loadExtraDimensions(this.dataStore, setName);
    this.currentSetName = setName;
    this.currentDim = 0;
    this.dimensions = [new LevelWorld(set, levelId, true), ...extraDims];
    this.world = this.dimensions[0];
    this.view.destroy();
    this.view = new LevelView(this.world, this.depthMan);
    this.initGame(levelId);
  }

  destroy(): void {
    this.gameLoop.stop();
    this.killPortals();
    this.clearLevel();
    this.saveGame();
    this.app.stage.removeChild(this.gameRoot);
  }
}
