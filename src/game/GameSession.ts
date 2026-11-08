import { type Container, type Renderer, Sprite, type Texture } from 'pixi.js';
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
import { BatBoss, type BossEntity, TuberculozBoss } from './entity/Boss';
import { SupaItem } from './entity/Supa';
import { FxManager } from './FxManager';
import { Random } from './Random';
import { PersistCodec } from '../engine/codec/PersistCodec';
import packageJson from '../../package.json';
import { GameParameters, SYSTEM_FAMILIES } from './GameParameters';
import { type GameResult, Loader } from './Loader';
import { RandomManager } from './RandomManager';
import { StatsManager } from './StatsManager';
import { Chrono, realTimer } from './Chrono';
import { GameHud } from './gui/GameHud';
import type { IGameContext } from './GameContext';
import { LevelView } from './levels/LevelView';
import { LevelWorld } from './levels/LevelWorld';
import { Log } from './Log';
import { ScriptRunner } from './levels/ScriptRunner';

const SAVE_KEY = 'hammerfenix_save_v1';

export interface GameSaveData {
  highScore: number;
  highestLevel: Record<string, number>;
  preferredLang: string;
  muted: boolean;
}

/** What the session needs from the PixiJS app: a stage to put the game on. */
export interface GameHost {
  readonly stage: Container;
  /** Draws the level snapshots of the transitions; absent when headless. */
  readonly renderer?: Renderer;
}

/** `Timer.tmod` during bullet time (`GameMode.main`). */
const BULLET_TMOD = 0.3;

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
  statsMan: StatsManager = new StatsManager(this);
  /** `Std.getTimer()` for the chronos. Tests can replace it. */
  getTimer: () => number = realTimer;
  /** `GameMode.gameChrono`: real play time, stopped while the game is locked. */
  gameChrono: Chrono = new Chrono(this.getTimer);
  /** `GameManager.history`: the game log. Only its "illegal" mark survives the game over. */
  history: string[] = [];
  /** `GameManager.KEY`: hides the players' scores from memory editors (`Player.scoreCS`). */
  scoreKey = 0;
  /** `GameMode.duration`: frames played (not counted while the game is locked). */
  duration = 0;
  /** `GameMode.savedScores`: each player's final score, by pid. */
  savedScores: number[] = [];
  /**
   * `GameManager.CONFIG`: the families and options of the next game. The site sets them from
   * the player's profile (`setParameters`); with no site the original uses the system families.
   */
  config = new GameParameters(SYSTEM_FAMILIES, '');
  /** The page around the game: the fades at the end of a game and the hand-off to the site. */
  readonly loader: Loader;
  /**
   * The `$mode` of the current game when the site (the menu) started it, null for a game started
   * otherwise (debug toolbar, replays). Only the site's games count for the profile.
   */
  siteMode: string | null = null;
  /** The `$mode` of the game the Loader is waiting to start. */
  private readyMode: string | null = null;
  /** The last game's result, once the Loader is done with it. */
  lastResult: GameResult | null = null;
  onGameResult?: (result: GameResult) => void;
  /** Random source of the SWF frame scripts: seeded with the game, but apart from `rand`. */
  private readonly animRand = new Random();

  private recorder: InputRecorder | null = null;
  private recordStart: {
    set: string;
    level: number;
    seed: number;
    families: string;
    options: string;
  } | null = null;
  /** The last recording, kept after it stops (also when a debug restart ends it). */
  lastRecording: Replay | null = null;

  readonly xOffset = 10;
  readonly yOffset = 0;
  cycle = 0;
  xFriction = Data.FRICTION_X;
  yFriction = Data.FRICTION_Y;
  gFriction = Data.FRICTION_GROUND;
  sFriction = Data.FRICTION_SLIDE;
  speedFactor = 1.0;
  diffFactor = 1.0;

  /**
   * `GameManager.fl_debug`, which the original sets in dev mode (`isDev`: the set `xml_dev` is
   * there). Here it is the page's dev switch, and it only turns on the dev keys: the port loads
   * no `xml_dev` world. Off for headless replays.
   */
  private _fl_debug = false;
  get fl_debug(): boolean {
    return this._fl_debug;
  }
  set fl_debug(on: boolean) {
    this._fl_debug = on;
    this.input.devKeys = on;
  }

  fl_lock = false;
  fl_clear = false;
  fl_gameOver = false;
  fl_pause = false;
  /** `Mode.fl_music`: a music track is playing. */
  fl_music = false;
  /** `GameMode.fl_mute`: the music was switched off with M. */
  fl_mute = false;
  /** The next pause screen tip, `Lang` text `301 + tipId`. */
  tipId = 0;
  fl_ice = false;
  fl_aqua = false;
  fl_wind = false;
  windSpeed = 0;
  /** Game options (`GameMode` constructor): set from `config` at each new game. */
  fl_mirror = false;
  fl_nightmare = false;
  fl_ninja = false;
  fl_bombExpert = false;
  /** Only `MultiCoop` turns it on (`OPT_BOMB_CONTROL`, Phase 4). */
  fl_bombControl = false;
  fl_warpStart = false;
  /** `GameMode._name`: the mode's name, which `Player` checks against `$time`. */
  readonly _name = '$adventure';

  forcedDarkness: number | null = null;
  fakeLevelId: number | null = null;
  /** Music track playing: 0 main, 1 boss, 2 hurry up. */
  currentTrack = 0;
  /** `Adventure`: kill order of the level's enemies, for the super item (task 2.1). */
  perfectOrder: number[] = [];
  perfectCount = 0;
  private fl_badsCallback = false;
  /** `GameMode.usePortal`: the portal taken was on the right half (the side scroll goes left). */
  private fl_rightPortal = false;

  // `ViewManager` (one per world in the original; only the current world's is ever active)
  /** Snapshot of the previous view, scrolled or faded out over the new one. */
  private fake: SwfMovieClip | null = null;
  private fakeTexture: Texture | null = null;
  private scrollCpt = 0;
  private scrollDir = 1;
  private fl_scrolling = false;
  private fl_hscrolling = false;
  private fl_fading = false;
  private fl_restoring = false;
  private fl_fadeNextTransition = false;
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

  /** `GameMode.fl_bullet`: bullet time is allowed (always, in the original). */
  fl_bullet = true;
  /** Bullet time left, in frames of the original's real time. */
  private bulletTimer = 0;

  /** Screen flips of the blue and red glasses (items 30, 31). */
  fl_flipX = false;
  fl_flipY = false;
  /** Called once when the level is cleared (fish items 77-79). Not emptied on a level change. */
  endLevelStack: (() => void)[] = [];
  /** Pearls left after a level conversion (items 81, 96-98). Unset (NaN) until the first one. */
  perfectItemCpt = NaN;

  private popMC: SwfMovieClip | null = null;
  private pointerMC: SwfMovieClip | null = null;
  private itemNameMC: SwfMovieClip | null = null;
  private pauseMC: SwfMovieClip | null = null;
  /** Placeholder shown once the game has ended, until the results screen (3.1c). */
  private darknessMC: SwfMovieClip | null = null;
  /** `darknessMC.holes`: the players' light spots (`hole1`, `hole2`), then the extra ones. */
  private darknessHoles: SwfMovieClip[] = [];
  private extraHoles: { x: number; y: number; d: number; mc: SwfMovieClip | null }[] = [];
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

    this.loader = new Loader({
      lib,
      stage: app.stage,
      gameRoot: this.gameRoot,
      getLangStr: (id) => this.dataStore.getStatic(id),
      startGameInstance: () => {
        this.initGame(0);
        this.siteMode = this.readyMode;
      },
    });
    this.loader.onResult = (r) => this.onGameEnd(r);

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

  /** The language the last session saved, or null (read before the data loads). */
  static savedLang(): string | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const lang = raw ? (JSON.parse(raw) as Partial<GameSaveData>).preferredLang : null;
      return typeof lang === 'string' ? lang : null;
    } catch {
      return null;
    }
  }

  /** Whether the last session left the sound off. */
  get savedMuted(): boolean {
    return this.savedData.muted === true;
  }

  /** Saves the current language and sound switch as the next session's. */
  saveSettings(): void {
    try {
      this.savedData.preferredLang = this.dataStore.langId;
      this.savedData.muted = this.audio.isMuted;
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.savedData));
    } catch {
      // ignore storage quota / sandbox write errors
    }
  }

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

    this.initOptions();
    this.resetGameState();
    this.backToMainWorld(); // a new GameMode starts in dimensions[0]
    this.fakeLevelId = null;
    this.resetView(); // a new GameMode has no view yet
    this.seed = seed;
    this.rand.reseed(seed);
    this.animRand.reseed(seed ^ 0x5eed);
    this.initRandMan();
    this.statsMan = new StatsManager(this);
    this.gameChrono = new Chrono(this.getTimer);
    this.gameLoop.resetPhase();

    this.fl_gameOver = false;
    this.fl_clear = false;
    this.fl_lock = true; // Mode constructor (its lock() runs before gameChrono exists)
    this.fl_pause = false;
    this.fl_mute = false;
    this.tipId = 0;
    this.cycle = 0;
    // A new GameManager and Loader: the original loads a new page for each game
    this.initSoundChannels();
    this.loader.reset();
    this.lastResult = null;
    this.siteMode = null;
    this.history = [];
    const keyRand = new Random();
    keyRand.reseed(seed ^ 0x4b4559);
    this.scoreKey = keyRand.random(999999) * keyRand.random(999999);
    this.duration = 0;
    this.savedScores = [];

    // Adventure.initGame
    this.playMusicTrack(0);
    this.world.goto(startLevelId);
    this.world.fl_entered = true;
    this.onWorldRead();
    // insertPlayer: attached hidden; onLevelReady shows it
    this.player = PlayerEntity.attach(
      this,
      BaseEntity.x_ctr(this.world.current.playerX),
      BaseEntity.y_ctr(this.world.current.playerY),
    );
    this.player.hide();
    // `GameInterface.initSingle` reads the new player's score and lives
    this.hud.setScore(this.player.score, true);
    this.hud.setLives(this.player.lives);
    this.hud.clearExtends();
    // The first level shows once its IA map is parsed (updateWorld), without a scroll
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
    this.darknessMC?.removeMovieClip();
    this.darknessMC = null;
    this.darknessHoles = [];
    this.dfactor = 0;
    this.targetDark = 0;
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
    this.bulletTimer = 0;
    this.gameLoop.bulletScale = 1;
    this.endLevelStack = [];
    this.perfectItemCpt = NaN;
    this.flipX(false);
    this.flipY(false);
  }

  hasFamily(id: number): boolean {
    return this.config.hasFamily(id);
  }

  /** `GameManager.CONFIG.hasOption` */
  hasOption(oid: string): boolean {
    return this.config.hasOption(oid);
  }

  /**
   * `GameMode` constructor: the options of the new game, and `addWorld`, which gives each
   * dimension the mirror flag (its levels are read flipped, `SetManager.flip`).
   */
  private initOptions(): void {
    this.fl_mirror = this.config.hasOption(Data.OPT_MIRROR);
    this.fl_nightmare = this.config.hasOption(Data.OPT_NIGHTMARE);
    this.fl_ninja = this.config.hasOption(Data.OPT_NINJA);
    this.fl_bombExpert = this.config.hasOption(Data.OPT_BOMB_EXPERT);
    this.fl_bombControl = false;
    for (const w of this.dimensions) w.fl_mirror = this.fl_mirror;
  }

  /** The `$families` and `$options` of the next games, as the site sent them. */
  setParameters(families: string, options = ''): void {
    this.config = new GameParameters(families, options);
  }

  /** From `GameMode.init`: register the extend letters and the unlocked item families. */
  private initRandMan(): void {
    this.randMan = new RandomManager(this.rand);
    this.randMan.register(Data.RAND_EXTENDS_ID, [...Data.RAND_EXTENDS]);
    this.randMan.register(
      Data.RAND_ITEMS_ID,
      this.dataStore.getRandFromFamilies(
        this.dataStore.items.special,
        this.config.specialItemFamilies,
      ),
    );
    this.randMan.register(
      Data.RAND_SCORES_ID,
      this.dataStore.getRandFromFamilies(this.dataStore.items.score, this.config.scoreItemFamilies),
    );
  }

  /** `GameMechanics.onReadComplete`: a new script engine for the level just read. */
  private onWorldRead(): void {
    this.scriptRunner = new ScriptRunner(this, this.world.current);
  }

  // ------------------------------------------------------------ ViewManager

  /**
   * `ViewManager.onDataReady` + `GameMechanics.onDataReady`: the level is read and its IA map
   * parsed. A view still attached (the previous level's) is replaced by a snapshot that scrolls up
   * with the new view; otherwise the new view shows at once (new game, warp) or waits for the
   * portal transition (`fl_restoring`). Then the level script compiles.
   */
  private onDataReady(): void {
    if (!this.view.fl_attach) {
      this.view.destroy();
      this.view = this.createView(this.world.currentId);
      if (this.fl_restoring) {
        this.view.moveTo(Data.GAME_WIDTH, 0);
        this.onRestoreReady();
      } else {
        this.view.moveTo(0, 0);
        this.onViewReady();
      }
    } else {
      this.cloneView(this.view);

      this.world.teleporterList = [];

      this.view.destroy();
      this.view = this.createView(this.world.currentId);
      this.view.moveTo(0, Data.GAME_HEIGHT);
      this.scrollCpt = 0;

      this.fl_scrolling = true;
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

  /** `ViewManager.cloneView` */
  private cloneView(v: LevelView): void {
    this.createFake(v.getSnapShot(this.app.renderer ?? null));
  }

  /** `ViewManager.createFake`: shows a snapshot above the level (`DP_SCROLLER`). */
  private createFake(snap: Texture | null): void {
    this.removeFake();
    this.fake = this.depthMan.empty(Data.DP_SCROLLER);
    // blendMode LAYER: no effect on a single bitmap
    if (snap) {
      const bmp = new Sprite(snap);
      bmp.x = -10;
      this.fake.addChild(bmp);
    }
    this.fakeTexture = snap;
    this.fake._alpha = Math.max(0, 100 - this.world.darknessFactor);
  }

  private removeFake(): void {
    this.fake?.removeMovieClip();
    this.fake = null;
    this.fakeTexture?.destroy(true);
    this.fakeTexture = null;
  }

  /** A new game: no transition running, and no view attached (the first level shows at once). */
  private resetView(): void {
    this.removeFake();
    this.fl_scrolling = false;
    this.fl_hscrolling = false;
    this.fl_fading = false;
    this.fl_restoring = false;
    this.fl_fadeNextTransition = false;
    this.view.detach();
  }

  /** `ViewManager.onTransitionDone` */
  private onTransitionDone(): void {
    this.view.moveTo(0, 0);
    this.removeFake();
    if (this.world.fl_mirror) {
      this.world.flipPortals();
    }
  }

  /** `ViewManager.onScrollDone` */
  private onScrollDone(): void {
    this.fl_scrolling = false;
    this.onViewReady();
  }

  /** `ViewManager.onHScrollDone` + `GameMechanics.onHScrollDone` */
  private onHScrollDone(): void {
    this.fl_hscrolling = false;
    this.onRestore();
    this.onViewReady();
  }

  /** `ViewManager.onFadeDone` + `GameMechanics.onFadeDone` */
  private onFadeDone(): void {
    this.fl_fading = false;
    this.onRestore();
    this.onViewReady();
  }

  /** `GameMechanics.onViewReady`: the level can be played. */
  private onViewReady(): void {
    this.onLevelReady();
  }

  /** `ViewManager.onRestoreReady` + `GameMechanics.onRestoreReady` */
  private onRestoreReady(): void {
    this.fl_restoring = false;
    if (this.fl_fadeNextTransition) {
      this.fl_fadeNextTransition = false;
      this.fl_fading = true;
      this.view.moveTo(0, 0);
    } else {
      this.fl_hscrolling = true;
      this.scrollCpt = 0;
    }
    this.scrollDir = this.fl_rightPortal ? 1 : -1;
  }

  /**
   * `ViewManager.restoreFrom` + `ViewManager.restore` + `GameMechanics.goto`: the world comes
   * back from suspension, with the previous world's snapshot to scroll or fade out.
   */
  private restoreFrom(snap: Texture | null, lid: number): void {
    this.createFake(snap);
    this.view.moveTo(Data.GAME_WIDTH, 0);
    this.fl_restoring = true;
    // GameMechanics.goto marks this world's previous level as visited
    if (this.world.fl_entered) this.world.markVisited();
    this.world.goto(lid);
    this.world.fl_entered = true;
    this.onWorldRead();
  }

  /** `ViewManager.update`: level scroll, portal side scroll and portal fade. */
  private updateView(): void {
    if (this.fl_scrolling) {
      this.scrollCpt += Data.SCROLL_SPEED;
      this.view.moveTo(0, Data.GAME_HEIGHT + Math.sin(this.scrollCpt) * (0 - Data.GAME_HEIGHT));
      if (this.fake) {
        this.fake._x = 0;
        this.fake._y = -Math.sin(this.scrollCpt) * Data.GAME_HEIGHT;
      }

      if (this.scrollCpt >= Math.PI / 2) {
        this.onTransitionDone();
        this.onScrollDone();
      }
    }

    if (this.fl_hscrolling) {
      this.scrollCpt += this.scrollDir * Data.SCROLL_SPEED;
      if (this.scrollDir > 0) {
        this.view.moveTo(
          20 + Data.GAME_WIDTH + Math.sin(this.scrollCpt) * (0 - Data.GAME_WIDTH - 20),
          0,
        );
      } else {
        this.view.moveTo(
          -Data.GAME_WIDTH - 20 - Math.sin(this.scrollCpt) * (Data.GAME_WIDTH + 20),
          0,
        );
      }
      if (this.fake) {
        this.fake._x = -Math.sin(this.scrollCpt) * (Data.GAME_WIDTH + 20);
        this.fake._y = 0;
      }

      if (this.scrollCpt >= Math.PI / 2 || this.scrollCpt <= -Math.PI / 2) {
        this.onTransitionDone();
        this.onHScrollDone();
      }
    }

    if (this.fl_fading && this.fake) {
      this.fake._alpha -= Data.FADE_SPEED;

      const blur = 100 - this.fake._alpha;
      this.fake.setBlur(blur, blur * 0.3);

      if (this.fake._alpha <= 0) {
        this.onTransitionDone();
        this.onFadeDone();
      }
    }
  }

  /** `GameMechanics.update` (with `ViewManager.update` first). */
  private updateWorld(): void {
    this.updateView();

    // IA map of the level just read, MAX_ITERATION cases per frame
    if (this.world.fl_parsing) {
      if (this.world.parseCurrentIA() && this.world.isDataReady()) {
        this.onDataReady();
      }
    }

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
    this.unlock();
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
    this.statsMan.reset();
    this.scriptRunner?.onPlayerBirth();
    this.world.unlock();
    this.fl_badsCallback = false;
    if (this.isBossLevel(this.world.currentId)) {
      this.fxMan.attachWarning();
    }
    // Boss 1
    if (this.world.fl_mainWorld && this.world.currentId === Data.BAT_LEVEL) {
      BatBoss.attach(this);
      this.fl_clear = false;
    }
    // Boss 2
    if (this.world.fl_mainWorld && this.world.currentId === Data.TUBERCULOZ_LEVEL) {
      TuberculozBoss.attach(this);
      this.fl_clear = false;
    }
    // No exit arrow on level 0
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
    // Extends
    if (this.world.current.specialSlots.length > 0) {
      this.statsMan.spreadExtend();
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
      this.unlock();
      this.view.detach(); // level 10 shows at once, without a scroll
      this.forcedGoto(10);
    }
  }

  /** `GameMode.forcedGoto` */
  forcedGoto(id: number): void {
    this.fakeLevelId = (this.fakeLevelId ?? 0) + id - this.world.currentId;
    this.world.fl_hideBorders = false;
    this.world.fl_hideTiles = false;
    this.goto(id);
    for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
      p.moveTo(
        BaseEntity.x_ctr(this.world.current.playerX),
        BaseEntity.y_ctr(this.world.current.playerY - 1),
      );
      p.shield(Data.SHIELD_DURATION * 1.3);
      p.hide();
    }
  }

  /** `Mode.lock` + `GameMode.lock`: freezes the game and stops the game chrono. */
  lock(): void {
    this.fl_lock = true;
    this.gameChrono.stop();
  }

  /** `Mode.unlock` + `GameMode.unlock` */
  unlock(): void {
    this.fl_lock = false;
    this.gameChrono.start();
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
    this.lock();
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
  }

  /** `Adventure.onEndOfSet` */
  onEndOfSet(): void {
    this.exitGame();
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

  /**
   * `GameMode.getOne`: a random entity of `type`, or null. On an empty list `Std.random(0)` is 0
   * and draws nothing (Flash's `random`, as Ruffle's `action_random_number`), as here.
   */
  getOne(type: number): BaseEntity | null {
    const l = this.getList(type);
    return l[this.rand.random(l.length)] ?? null;
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

  /** `GameMode.destroySome`: destroys `n` random entities of a type. */
  destroySome(type: number, n: number): void {
    const l = [...this.getList(type)];
    while (l.length > 0 && n > 0) {
      const i = this.rand.random(l.length);
      l[i].destroy();
      l.splice(i, 1);
      n--;
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

  /** `Adventure.onLevelClear`: a super item falls when the enemies were killed in order. */
  onLevelClear(): void {
    this.gameModeOnLevelClear();
    if (
      !this.world.isVisited() &&
      this.perfectOrder.length === 0 &&
      (this.scriptRunner?.cycle ?? 0) >= 10
    ) {
      for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
        p.setBaseAnims(Data.ANIM_PLAYER_WALK_V, Data.ANIM_PLAYER_STOP_V);
      }
      SupaItem.attach(this, this.perfectCount - 1);
      this.statsMan.inc(Data.STAT_SUPAITEM, 1);
    }
  }

  /** `GameMode.onLevelClear` */
  private gameModeOnLevelClear(): void {
    if (this.fl_clear) return;
    this.scriptRunner?.clearEndTriggers();
    // Extend letters still on screen disappear
    for (const it of this.getList(Data.SPECIAL_ITEM) as ItemEntity[]) {
      if (it.id === 0) it.destroy();
    }
    this.fl_clear = true;
    this.fxMan.attachExit();

    // Post-clear call stack
    for (let i = 0; i < this.endLevelStack.length; i++) {
      this.endLevelStack[i]();
    }
    this.endLevelStack = [];
  }

  /** `GameMode.flipX`: mirrors the whole game clip horizontally. */
  flipX(fl: boolean): void {
    this.fl_flipX = fl;
    if (fl) {
      this.gameRoot._xscale = -100;
      this.gameRoot._x = Data.GAME_WIDTH + this.xOffset;
    } else {
      this.gameRoot._xscale = 100;
      this.gameRoot._x = this.xOffset;
    }
  }

  /** `GameMode.flipY`: turns the whole game clip upside down. */
  flipY(fl: boolean): void {
    this.fl_flipY = fl;
    if (fl) {
      this.gameRoot._yscale = -100;
      this.gameRoot._y = Data.GAME_HEIGHT + this.yOffset + 20;
    } else {
      this.gameRoot._yscale = 100;
      this.gameRoot._y = this.yOffset;
    }
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

  /** `Adventure.onExplode` + `GameMode.onExplode`: a player bomb exploded. */
  onExplode(x: number, y: number, radius: number): void {
    this.scriptRunner?.onExplode(x, y, radius);
    if (this.world.fl_mainWorld && this.world.currentId === Data.TUBERCULOZ_LEVEL) {
      this.getBoss()?.onExplode?.(x, y, radius);
    }
  }

  /** `GameMode.getOne(Data.BOSS)` */
  getBoss(): BossEntity | null {
    return this.getOne(Data.BOSS) as BossEntity | null;
  }

  /**
   * `GameMode.bulletTime`: `d` frames of slow motion. The original sets `Timer.tmod` to 0.3;
   * logic here always steps by 1, so the loop's clock slows instead (same moves, slower).
   */
  bulletTime(d: number): void {
    if (!this.fl_bullet) return;
    this.bulletTimer = d;
  }

  /** `Adventure.onKillBad` (GameMode's is empty) */
  onKillBad(b: BaseEntity): void {
    // Boss Tuberculoz
    if (this.world.fl_mainWorld && this.world.currentId === Data.TUBERCULOZ_LEVEL) {
      this.getBoss()?.onKillBad?.();
    }
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
    // Boss
    this.getBoss()?.onPlayerDeath();

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

  /** `GameMode.onGameOver` + `Adventure.onGameOver` */
  onGameOver(): void {
    this.fl_gameOver = true;
    this.logAction('$t=' + Math.round(this.duration / Data.SECOND));

    const fl_illegal = this.history.join('|').indexOf('!', 0) >= 0;

    // `F=` is the site's `$version` parameter: the port's version here
    this.history = ['F=' + packageJson.version, 'T=' + this.gameChrono.get()];
    if (fl_illegal) {
      this.history.push('$illegal'.substring(1));
    }

    this.stopMusic();
    this.saveGame(); // the port's local high score, until the profile (3.2b)

    this.saveScore();
    this.onStateChange?.({ isOver: true, isPaused: false });
  }

  /**
   * `Adventure.saveScore`: hands the score to the Loader. The original first checks the set's
   * checksum, and stops with a fatal error for any set but the adventure; the port's set picker
   * plays every set in this mode, so they all send their score.
   */
  saveScore(): void {
    this.loader.gameOver(this.savedScores[0], null, {
      reachedLevel: this.dimensions[0].currentId,
      item2: this.getPicks2(),
      data: this.history,
    });
  }

  /** `GameMode.registerScore`: keeps the first non-zero final score of a player. */
  registerScore(pid: number, score: number): void {
    if (this.savedScores[pid] == null || this.savedScores[pid] <= 0) {
      this.savedScores[pid] = score;
    }
  }

  /** `GameMode.getPicks2`: pick count per item id, the score items at id + 1000. */
  getPicks2(): number[] {
    const s: number[] = [];
    for (let i = 0; i < this.specialPicks.length; i++) {
      if (this.specialPicks[i] != null) {
        s[i] = this.specialPicks[i];
      }
    }
    for (let i = 0; i < this.scorePicks.length; i++) {
      if (this.scorePicks[i] != null) {
        s[i + 1000] = this.scorePicks[i];
      }
    }
    return s;
  }

  /** `GameMode.exitGame`: the end of the set sends the item picks to `endGame.html`. */
  exitGame(): void {
    const codec = new PersistCodec();
    const out = codec.encode(codec.encode(this.specialPicks) + ':' + codec.encode(this.scorePicks));
    this.redirect('endGame.html', out);
  }

  /** `GameManager.redirect` */
  private redirect(url: string, params: string): void {
    this.lock();
    this.loader.exitGame(url, params);
  }

  /** `GameManager.logAction`: adds an entry to the game log. */
  logAction(str: string): void {
    str = str.split('$').join('');
    str = str.split(':').join('.');
    this.history.push(str);
  }

  /** `GameManager.logIllegal`: marks the game as cheated. */
  logIllegal(str: string): void {
    this.logAction('$!' + str);
  }

  /**
   * The Loader has covered the game: the original's site takes over here. Shows a placeholder
   * until the results screen (3.1c).
   */
  /** The Loader is done: the results screen takes over (3.1c, `Shell`). */
  private onGameEnd(result: GameResult): void {
    this.lastResult = result;
    this.onGameResult?.(result);
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
  usePortal(pid: number | null, e: BaseEntity | null): boolean {
    if (this.nextLink !== null) return false;
    const link = this.dataStore.portalLinks.links.find(
      (l) =>
        l.from_did === this.currentDim && l.from_lid === this.world.currentId && l.from_pid === pid,
    );
    if (!link) return false;

    // The original reads e.x even when e is null (a floating portal): NaN, so a left portal.
    // Its map events (EVENT_EXIT_*) are not ported.
    this.fl_rightPortal = e !== null && this.flipCoordReal(e.x) >= Data.GAME_WIDTH * 0.5;

    if (e === null) {
      // Floating portal: players are pulled in, then shrink (see update)
      const portal = pid === null ? undefined : this.portalMcList[pid];
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
    this.fxMan.inGameParticles(Data.PARTICLE_PORTAL, x, y, 5);
    this.fxMan.attachShine(x, y);
    this.portalMcList[pid] = { x, y, mc, cpt: 0 };
    return true;
  }

  /**
   * `GameMode.switchDimensionById`. The new world shows once its IA map is parsed, with a side
   * scroll (a fade when arriving at no portal, `pid < 0`); `onRestore` then places the players.
   */
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
    const ss = this.view.getSnapShot(this.app.renderer ?? null);
    // world.suspend(): the script left is saved and the level counts as visited
    this.world.suspend(this.scriptRunner?.scriptToString() ?? null);
    this.view.detach(); // ViewManager.suspend
    this.removeFake();
    this.world = this.dimensions[id];
    this.world.darknessFactor = this.dfactor;
    this.lock();
    this.fl_clear = false;
    if (pid < 0) {
      this.fl_fadeNextTransition = true;
    }
    this.restoreFrom(ss, lid);
    for (const e of this.getList(Data.ENTITY)) e.world = this.world;

    this.fakeLevelId = this.world.fl_mainWorld ? null : 0;
    this.portalId = pid;
    this.nextLink = null;
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
    this.unlock();
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

  /** `GameMode.updateDarkness`: darkness of the level, light spots of the players and the extra ones. */
  updateDarkness(): void {
    // Darkness target
    if (this.forcedDarkness !== null) {
      this.targetDark = this.forcedDarkness;
    } else if (this.world.fl_mainWorld) {
      if (this.world.currentId < Data.MIN_DARKNESS_LEVEL || this.world.currentId > 101) {
        this.darknessMC?.removeMovieClip();
        this.darknessMC = null;
        this.darknessHoles = [];
        this.world.darknessFactor = 0;
        this.dfactor = 0;
        return;
      }
      this.targetDark = this.world.currentId;
    } else {
      this.targetDark = this.world.darknessFactor;
    }

    // Attach: a black veil the holes erase (blendMode LAYER, holes ERASE)
    if (!this.darknessMC) {
      const mc = this.depthMan.attach('hammer_fx_darkness', Data.DP_BORDERS);
      mc._x -= this.xOffset;
      mc.setLayerBlend();
      this.darknessMC = mc;
      this.darknessHoles = [];
      for (const name of ['hole1', 'hole2']) {
        const hole = mc.getClip(name);
        if (!hole) continue;
        hole.blendMode = 'erase';
        hole._y = -500;
        this.darknessHoles.push(hole);
      }
    }

    // Base size
    for (let i = 0; i < 2; i++) {
      const hole = this.darknessHoles[i];
      if (!hole) continue;
      hole._xscale = 100;
      hole._yscale = hole._xscale;
    }

    // Extra light spots
    this.detachExtraHoles();
    for (const eh of this.extraHoles) {
      const hole = this.lib.attach('hammer_fx_darknessHole');
      const depth = this.uniqIdCounter++;
      hole.mcDepth = depth;
      hole.zIndex = depth;
      this.darknessMC.addChild(hole);
      hole._x = eh.x;
      hole._y = eh.y;
      hole._width = eh.d;
      hole._height = eh.d;
      hole.blendMode = 'erase';
      this.darknessHoles.push(hole);
      eh.mc = hole;
    }

    // Player items: candle (bigger spot), light bulb (less darkness)
    const l = this.getList(Data.PLAYER) as PlayerEntity[];
    for (let i = 0; i < l.length; i++) {
      if (l[i].fl_candle || l[i].actives[68]) {
        const hole = this.darknessHoles[i];
        if (hole) {
          hole._xscale = 150;
          hole._yscale = hole._xscale;
        }
      }
      if (l[i].fl_torch || l[i].actives[26]) {
        if (this.forcedDarkness === null) {
          this.targetDark *= 0.5;
        } else {
          this.targetDark *= 0.75; // forced darkness is more "opaque"
        }
      }
    }

    this.holeUpdate();
  }

  /** `GameMode.addHole`: an extra light spot, shown by the next `updateDarkness`. */
  addHole(x: number, y: number, diameter: number): void {
    this.extraHoles.push({ x, y, d: diameter, mc: null });
  }

  private detachExtraHoles(): void {
    for (const eh of this.extraHoles) {
      eh.mc?.removeMovieClip();
      eh.mc = null;
    }
    this.darknessHoles.splice(2);
  }

  clearExtraHoles(): void {
    this.detachExtraHoles();
    this.extraHoles = [];
  }

  /** `GameMode.holeUpdate`: the light spots follow the players, the darkness eases to its target. */
  private holeUpdate(): void {
    if (!this.darknessMC) return;

    // Holes
    const l = this.getList(Data.PLAYER) as PlayerEntity[];
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      const tx = p.x + Data.CASE_WIDTH * 0.5;
      const ty = p.y - Data.CASE_HEIGHT;
      const hole = this.darknessHoles[i];
      if (!hole) continue;
      if (p.mc._visible) {
        hole._visible = true;
        hole._x += (tx - hole._x) * 0.5;
        hole._y += (ty - hole._y) * 0.5;
      } else {
        hole._visible = false;
        hole._x = tx;
        hole._y = ty;
      }
    }

    // Brightness tween
    this.dfactor = Math.round(this.dfactor);
    this.targetDark = Math.round(this.targetDark);
    if (this.dfactor < this.targetDark) {
      this.dfactor += 2;
      if (this.dfactor > this.targetDark) {
        this.dfactor = this.targetDark;
      }
    }
    if (this.dfactor > this.targetDark) {
      this.dfactor -= 2;
      if (this.dfactor < this.targetDark) {
        this.dfactor = this.targetDark;
      }
    }

    this.world.darknessFactor = this.dfactor;
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

  /**
   * `GameManager` constructor, "Sounds channels": each channel's volume from the player's
   * settings, the enemies' and the interface's 10 lower. The no-music `sound_kick` loop at volume
   * 0 that follows is not ported (it plays nothing).
   */
  private initSoundChannels(): void {
    const volume = this.config.soundVolume * 100;
    const audio = this.audio;
    audio.setVolume(Data.CHAN_MUSIC, this.config.musicVolume * 100);
    audio.setVolume(Data.CHAN_PLAYER, volume);
    audio.setVolume(Data.CHAN_BOMB, volume);
    audio.setVolume(Data.CHAN_ITEM, volume);
    audio.setVolume(Data.CHAN_FIELD, volume);
    audio.setVolume(Data.CHAN_BAD, Math.max(0, volume - 10));
    audio.setVolume(Data.CHAN_INTERF, Math.max(0, volume - 10));
    audio.setMusicVolume(this.config.musicVolume * 100);
  }

  /** `Mode.playMusic` / `playMusicAt(id, 0)`: tracks are `[music, boss, hurryUp]`. */
  playMusicTrack(trackId: number): void {
    if (!this.config.hasMusic()) return;
    if (MUSIC_TRACKS[trackId] === undefined) return;
    if (this.fl_music) this.stopMusic();
    this.currentTrack = trackId;
    this.audio.playMusic(MUSIC_TRACKS[trackId]);
    this.fl_music = true;
    this.setMusicVolume(this.fl_mute ? 0 : 1);
  }

  /** `Mode.stopMusic` */
  stopMusic(): void {
    if (!this.config.hasMusic()) return;
    this.audio.stopMusic();
    this.fl_music = false;
  }

  /** `Mode.setMusicVolume`: `n` times the player's music volume. */
  setMusicVolume(n: number): void {
    if (!this.fl_music || !this.config.hasMusic()) return;
    n *= this.config.musicVolume * 100;
    this.audio.setMusicVolume(Math.round(n));
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
    this.lock();
    this.world.lock();
    this.pauseMC?.removeMovieClip();

    const mc = this.depthMan.attach('hammer_interf_instructions', Data.DP_INTERF);
    this.pauseMC = mc;
    mc.gotoAndStop('1');
    mc._x = Data.GAME_WIDTH * 0.5;
    mc._y = Data.GAME_HEIGHT * 0.5;
    const lang = (id: number) => this.dataStore.getLangText(id);
    const setText = (name: string, text: string) => {
      const field = mc.getText(name);
      if (field) field.text = text;
    };
    // AS2 writes "null" for a missing text
    setText('click', '');
    setText('title', `${lang(5)}`);
    setText('move', `${lang(7)}`);
    setText('attack', `${lang(8)}`);
    setText('pause', `${lang(9)}`);
    setText('space', `${lang(10)}`);
    setText(
      'sector',
      `${lang(14)}«${this.dataStore.getSectorName(this.currentDim, this.world.currentId)}»`,
    );

    // Tool tip
    let tip = lang(301 + this.tipId++);
    if (tip === null) {
      this.tipId = 0;
      tip = lang(301 + this.tipId++);
    }
    const tipField = mc.getText('tip');
    if (tipField) tipField.htmlText = `<b>${lang(300)}</b>${tip}`;

    if (!this.fl_mute) this.setMusicVolume(0.5);

    this.onStateChange?.({ isOver: this.fl_gameOver, isPaused: true });
  }

  onUnpause(): void {
    if (!this.fl_pause) return;
    this.fl_pause = false;
    this.unlock();
    this.world.unlock();
    this.pauseMC?.removeMovieClip();
    this.pauseMC = null;
    if (!this.fl_mute) this.setMusicVolume(1);
    this.onStateChange?.({ isOver: this.fl_gameOver, isPaused: false });
  }

  /**
   * `Mode.getDebugControls` + `GameMode.getDebugControls`: Backspace clears the log, Shift slows
   * the game to `tmod` 0.3 and Home puts it back to 1 (Shift held with bullet time does nothing
   * more). Returns this tick's `tmod`. `Adventure`'s Ctrl+Shift+M (the co-op mode) waits for
   * Phase 4.
   */
  private getDebugControls(tmod: number): number {
    if (this.input.isKeyDown(8)) {
      Log.clear();
    }
    if (this.input.isKeyDown(16)) {
      tmod = 0.3;
    }
    if (this.input.isKeyDown(36)) {
      tmod = 1.0;
    }
    return tmod;
  }

  /**
   * The end of `GameMode.getControls`: F prints the frame rate and B the build time. The
   * original reads them in every mode, but its log shows only in dev mode, so here they wait for
   * the dev keys (`isKeyDown` is false without them). The Flash version line is left out.
   */
  private getDevControls(): void {
    if (this.input.isKeyDown(70)) {
      const fps = this.gameLoop.fps;
      Log.print(`${Math.round(fps)} FPS`);
      Log.print(`Performances: ${Math.min(100, Math.round((100 * fps) / 30))}%`);
    }
    if (this.input.isKeyDown(66)) {
      Log.print('Dernière mise à jour:');
      Log.print(typeof __BUILD_TIME__ === 'undefined' ? '?' : __BUILD_TIME__);
    }
  }

  /** `GameMode.printDebugInfos`, on the pause screen in dev mode (what the port has of it). */
  private printDebugInfos(): void {
    Log.print(`build:${typeof __BUILD_TIME__ === 'undefined' ? '?' : __BUILD_TIME__}`);
    Log.print(`lang=${this.dataStore.langId}`);
    Log.print(`debug=${this.fl_debug}`);
    Log.print('--- DATA ---');
    Log.print(`families=${this.config.families.join(',')}`);
    Log.print(`ent = ${this.countList(Data.ENTITY)}`);
    Log.print(`bad = ${this.countList(Data.BAD)}`);
    const k: number[] = [];
    for (let i = 0; i < this.worldKeys.length; i++) {
      if (this.worldKeys[i]) k.push(i);
    }
    Log.print(`keys= ${k.join(', ')}`);
  }

  // ------------------------------------------------------- Fixed Update Loop

  /** One logic tick: `GameMode.main`, then the dev log's lines of the tick. */
  update(): void {
    this.main();
    Log.flush();
  }

  /** `GameMode.main` */
  private main(): void {
    // `Loader.mainGame` stops calling the game's main at the game over, and for good once the
    // game's clip is removed
    if (!this.loader.gameRunning) {
      this.input.poll();
      // Port addition: the space bar starts the game as a click does, since the menu is left
      // with it ("click to start" alone sent keyboard players to the mouse)
      if (this.loader.waitingStart && this.input.consumePress('attack')) this.clickStart();
      return;
    }

    this.gameChrono.update();
    this.input.poll();

    // Check pause key toggle (P, and Escape: `GameMode.main` pauses with it on the site)
    if (this.input.consumePress('pause')) {
      this.togglePause();
    }

    // Music (M)
    if (!this.fl_lock && this.fl_music && this.input.consumePress('music')) {
      this.fl_mute = !this.fl_mute;
      this.setMusicVolume(this.fl_mute ? 0 : 1);
    }

    // Suicide (Ctrl+Shift+K): the way to give up a game. The original also waits for
    // `fl_switch`, which only `ModeSwitcher` sets (never in the Adventure).
    if (this.input.isDown('suicide')) {
      if (!this.fl_lock && this.countList(Data.PLAYER) > 0) {
        this.destroyList(Data.PLAYER);
        this.onGameOver();
      }
    }

    // Pause: the dev mode prints its infos
    if (this.fl_pause && this.fl_debug) {
      this.printDebugInfos();
    }

    // Bullet time: the original counts it in real frames, each moving the game by 0.3.
    // `Timer.update` recomputes `tmod` each frame (`calc_tmod`), so it lasts that frame only.
    let tmod = 1;
    if (this.fl_bullet && this.bulletTimer > 0) {
      this.bulletTimer -= 1 / BULLET_TMOD;
      if (this.bulletTimer > 0) tmod = BULLET_TMOD;
    }
    if (this.fl_debug) {
      tmod = this.getDebugControls(tmod);
    }
    this.gameLoop.bulletScale = tmod;
    this.getDevControls();

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

    this.duration += 1;

    // Automatic end of the mode
    if (this.endModeTimer > 0) {
      this.endModeTimer -= 1;
      if (this.endModeTimer <= 0) {
        for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
          this.registerScore(p.pid, p.score);
        }
        this.onGameOver();
      }
    }

    this.fxMan.update();

    // Hurry up (H: 21 times faster in dev mode)
    this.huTimer += 1;
    if (this.input.isKeyDown(72) && this.fl_debug) {
      this.huTimer += 20;
    }
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
      if (this.fl_flipX) {
        this.gameRoot._x = Data.GAME_WIDTH + this.xOffset - Math.round(amp());
      } else {
        this.gameRoot._x = Math.round(this.xOffset + amp());
      }
      if (this.fl_flipY) {
        this.gameRoot._y = Data.GAME_HEIGHT + 20 + Math.round(this.yOffset + amp());
      } else {
        this.gameRoot._y = Math.round(this.yOffset + amp());
      }
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

  /**
   * `GameMode.onBadsReady`: in ninja mode, one enemy is the foe (killing it first clears the
   * level) and some others are friends (killing one kills the player), more of them deeper in.
   */
  private onBadsReady(): void {
    if (this.fl_ninja && this.getList(Data.BAD_CLEAR).length > 1) {
      const foe = this.getOne(Data.BAD_CLEAR) as BadEntity;
      foe.fl_ninFoe = true;

      let friendsLimit: number;
      if (
        this.fl_nightmare ||
        !this.world.fl_mainWorld ||
        (this.world.fl_mainWorld && this.world.currentId >= 20)
      ) {
        const lid = this.dimensions[0].currentId;
        friendsLimit = Math.floor(Math.max(2, Math.floor((lid - 20) / 10)));
      } else {
        friendsLimit = 1;
      }
      if (this.fl_nightmare) {
        friendsLimit++;
      }
      friendsLimit = Math.round(Math.min(this.getList(Data.BAD_CLEAR).length - 1, friendsLimit));
      while (friendsLimit > 0) {
        const b = this.getAnotherOne(Data.BAD_CLEAR, foe) as BadEntity;
        if (!b.fl_ninFriend) {
          b.fl_ninFriend = true;
          friendsLimit--;
        }
      }
    }
  }

  stepAnimation(): void {
    // `Loader.mainGame` runs once per Flash frame (40 Hz)
    this.loader.main();
    // 40 Hz MovieClip timeline stepper
    if (this.loader.fl_game) this.gameRoot.stepAnimation();
  }

  start(): void {
    this.gameLoop.start();
  }

  /**
   * The site page has chosen the mode (3.1b): the Loader shows "click to start", and the click
   * (`clickStart`) builds a new game. `mode` is the site's `$mode`; only `solo` (Adventure) is
   * ported.
   */
  gameReady(mode = 'solo'): void {
    this.stopInputCapture();
    this.backToMainWorld();
    this.readyMode = mode;
    this.loader.gameReady(mode);
    this.gameRoot.visible = false; // `game` holds no GameManager yet
    this.onStateChange?.({ isOver: false, isPaused: false });
  }

  /**
   * The menu starts the game at once, without the Loader's "click to start" (port addition,
   * `Loader.startNow`): the assets are already loaded.
   */
  startNow(mode = 'solo'): void {
    this.stopInputCapture();
    this.backToMainWorld();
    this.readyMode = mode;
    this.loader.startNow(mode);
    this.onStateChange?.({ isOver: false, isPaused: false });
  }

  /**
   * The level is drawn: a new game first reads the level's map (about 17 frames) with no view
   * attached, which shows black. The menu waits for this before fading out.
   */
  get levelShown(): boolean {
    return this.loader.gameRunning && this.view.fl_attach;
  }

  /** A click on the game: `loading.onRelease`. */
  clickStart(): void {
    this.loader.onRelease();
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
    this.recordStart = {
      set: this.currentSetName,
      level: levelId,
      seed: this.seed,
      families: this.config.families.join(','),
      options: this.config.optionList.join(','),
    };
    this.input.startRecording(this.recorder);
  }

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  /** Ends the recording and returns it (also kept as `lastRecording`). */
  stopRecording(): Replay | null {
    if (!this.recorder || !this.recordStart) return null;
    this.input.stopRecording();
    const { set, level, seed, families, options } = this.recordStart;
    this.lastRecording = this.recorder.toReplay(set, level, seed, families, options);
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
    this.setParameters(replay.families ?? SYSTEM_FAMILIES, replay.options ?? '');
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
