import { Container, Sprite, type Texture } from 'pixi.js';
import type { AudioEngine } from '../../engine/Audio';
import { DepthManager } from '../../engine/DepthManager';
import type { InputController, PlayerKeys } from '../../engine/Input';
import type { SwfLibrary } from '../../engine/swf/SwfLibrary';
import { type SwfMovieClip, SwfTextField } from '../../engine/swf/SwfMovieClip';
import { Data, type GameDataStore } from '../Data';
import type { PortalLink } from '../data/types';
import { BaseEntity } from '../entity/Entity';
import { ItemEntity, ScoreItem, SpecialItem } from '../entity/Item';
import { PlayerEntity } from '../entity/Player';
import { BadEntity, createBad, FireBallBad } from '../entity/Bad';
import { BombEntity } from '../entity/Bomb';
import type { BossEntity } from '../entity/Boss';
import { FxManager } from '../FxManager';
import type { Random } from '../Random';
import { PersistCodec } from '../../engine/codec/PersistCodec';
import { Timer } from '../../engine/Timer';
import type { GameParameters } from '../GameParameters';
import { RandomManager } from '../RandomManager';
import { StatsManager } from '../StatsManager';
import { Chrono } from '../Chrono';
import { GameHud } from '../gui/GameHud';
import { JoinScreen } from '../gui/JoinScreen';
import { type PadButton, padGlyph } from '../gui/PadGlyphs';
import type { IGameContext } from '../GameContext';
import type { GameSession } from '../GameSession';
import { LevelView } from '../levels/LevelView';
import { LevelWorld } from '../levels/LevelWorld';
import { Log } from '../Log';
import { ScriptRunner } from '../levels/ScriptRunner';

/**
 * Depths of the keyboard keys on frame 1 of `hammer_interf_instructions` (the pause screen),
 * per row: the arrow keys, the space bar and its text, the P key. A controller's buttons
 * replace them (`showPausePrompts`).
 */
const PAUSE_KEYS = {
  move: [9, 12, 14, 17, 19, 22],
  attack: [26, 29],
  pause: [34, 37],
} as const;

/** `Timer.tmod` during bullet time (`GameMode.main`). */
const BULLET_TMOD = 0.3;

/** An event of the world map (`GameMode.mapEvents`): its main-world level, `Data.EVENT_*`, text. */
export interface MapEvent {
  lid: number;
  eid: number;
  misc: string | null;
}

/**
 * Port of `mode.GameMode` (`class/hammer/mode/GameMode.mt`) and of its base `Mode`
 * (`class/hammer/Mode.mt`): what every game mode shares. A mode extends it and overrides what
 * the original's does (`mode/Adventure.ts`).
 *
 * As in the original, each game is a new mode object, started by the manager
 * (`GameSession.startGameMode`), with its own clip (`mc`), so nothing is left from the game
 * before. The level views and their transitions (`levels.ViewManager`) and the per-frame part of
 * `levels.GameMechanics` are here too ("ViewManager" below); the level data is in `LevelWorld`.
 *
 * Not ported: the color filter (`setColorHex`, `resetCol`: its only call, the water tint, is
 * commented out in the original), `attachRadius`, `getPicks` (replaced by `getPicks2` there),
 * `printBetaInfos`, and Escape's `endMode` in local mode (`getControls`: the port is never
 * local).
 */
export abstract class GameMode implements IGameContext {
  /** `Mode.manager`: the session, which stands for the original's `GameManager`. */
  readonly manager: GameSession;
  readonly lib: SwfLibrary;
  readonly audio: AudioEngine;
  readonly input: InputController;
  readonly dataStore: GameDataStore;
  /**
   * `Mode.mc`: the clip holding the whole game, inside the manager's root. The flips, the
   * screen shake and the water move it.
   */
  readonly mc: SwfMovieClip;
  readonly depthMan: DepthManager;

  world!: LevelWorld;
  view!: LevelView;
  fxMan: FxManager;
  /** `GameMode.gi`, made by `initInterface` once the players are there. */
  hud!: GameHud;
  scriptRunner: ScriptRunner | null = null;
  /** The first player (pid 0), set by `insertPlayer`. */
  player: PlayerEntity | null = null;

  /** Every random draw of the game goes through `rand` (the session's, seeded per game). */
  readonly rand: Random;
  randMan: RandomManager;
  statsMan: StatsManager;
  /** `GameMode.gameChrono`: real play time, stopped while the game is locked. */
  gameChrono: Chrono;
  /** `GameMode.duration`: frames played (not counted while the game is locked). */
  duration = 0;
  /** `GameMode.savedScores`: each player's final score, by pid. */
  savedScores: number[] = [];

  readonly xOffset = 10;
  readonly yOffset = 0;
  cycle = 0;
  xFriction: number = Data.FRICTION_X;
  yFriction: number = Data.FRICTION_Y;
  gFriction: number = Data.FRICTION_GROUND;
  sFriction: number = Data.FRICTION_SLIDE;
  speedFactor = 1.0;
  diffFactor = 1.0;

  /** `Mode.fl_lock`: a new mode is locked (the `Mode` constructor's `lock()`). */
  fl_lock = true;
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
  /** `GameMode.windTimer`: frames of wind left. Nothing in the original starts wind. */
  protected windTimer = 0;
  /** `GameMode.aquaTimer`: phase of the water wobble of `$AQUA` levels. */
  protected aquaTimer = 0;
  /** Game options (`GameMode` constructor), from the manager's `config`. */
  fl_mirror: boolean;
  fl_nightmare: boolean;
  fl_ninja: boolean;
  fl_bombExpert: boolean;
  /** Only `MultiCoop` turns it on (`OPT_BOMB_CONTROL`, Phase 4). */
  fl_bombControl = false;
  /**
   * `GameMode.fl_static`: "si true, le comportement initial des monstres sera prévisible
   * (random sinon)". Walkers and flyers then start in a fixed direction (`Bad.ts`). Only
   * `TimeAttack` turns it on.
   */
  fl_static = false;
  /** `Mode._name`: the mode's name, which `Player` checks against `$time`. */
  _name = '$abstractGameMode';

  forcedDarkness: number | null = null;
  fakeLevelId: number | null = null;
  /** `Mode.currentTrack`, the music track playing: 0 main, 1 boss, 2 hurry up. */
  currentTrack = 0;
  /**
   * The track the game asked for last, even with no music (port addition): the sound panel
   * starts it when the music is switched on during a game.
   */
  protected wantedTrack: number | null = null;
  protected fl_badsCallback = false;
  /** `GameMode.usePortal`: the portal taken was on the right half (the side scroll goes left). */
  protected fl_rightPortal = false;

  // `ViewManager` (one per world in the original; only the current world's is ever active)
  /** Snapshot of the previous view, scrolled or faded out over the new one. */
  protected fake: SwfMovieClip | null = null;
  protected fakeTexture: Texture | null = null;
  protected scrollCpt = 0;
  protected scrollDir = 1;
  protected fl_scrolling = false;
  protected fl_hscrolling = false;
  protected fl_fading = false;
  protected fl_restoring = false;
  protected fl_fadeNextTransition = false;
  /** Players that were not on the portal when the dimension changed (`latePlayers`). */
  protected latePlayers: PlayerEntity[] = [];
  /** Arrival portal of the last dimension change. */
  protected portalId = -1;
  huTimer = 0;
  huState = 0;

  readonly globalActives: boolean[] = new Array<boolean>(200).fill(false);
  readonly worldKeys: boolean[] = new Array<boolean>(100).fill(false);
  protected readonly dvars = new Map<string, string>();
  protected readonly comboMap = new Map<number, number>();

  protected readonly lists: BaseEntity[][] = Array.from({ length: 24 }, () => []);
  protected readonly killList: BaseEntity[] = [];
  protected readonly unregList: { type: number; ent: BaseEntity }[] = [];
  protected uniqIdCounter = 1;
  badCount = 0;
  /** Ends the game when it runs out (the elevator exit after Tuberculoz, code trigger 4). */
  endModeTimer = 0;

  currentDim = 0;
  /** `GameMode.dimensions`: the mode's worlds (`addWorld`), the main one first. */
  dimensions: LevelWorld[] = [];
  readonly specialPicks: number[] = [];
  readonly scorePicks: number[] = [];

  protected shakeTimer = 0;
  protected shakeTotal = 0;
  protected shakePower = 0;

  /** `GameMode.fl_bullet`: bullet time is allowed (always, in the original). */
  fl_bullet = true;
  /**
   * `GameMode.fl_disguise`: the disguise key works. True in `GameMode`; only the boss rush,
   * soccer and co-op modes turn it off.
   */
  fl_disguise = true;
  /** `GameMode.fl_map`: the C key shows the world map (`Adventure` turns it on). */
  fl_map = false;
  /** `GameMode.mapMC` and `mapIcons`: the world map on screen, and its icons. */
  protected mapMC: SwfMovieClip | null = null;
  protected mapIcons: SwfMovieClip[] = [];
  /**
   * `GameMode.mapTravels` (portal exits and returns) and `mapEvents` (deaths, extends): what the
   * world map shows, by main-world level.
   */
  mapTravels: MapEvent[] = [];
  mapEvents: MapEvent[] = [];
  /** Bullet time left, in frames of the original's real time. */
  protected bulletTimer = 0;
  /** `GameMode.lagCpt`: frames run under 16 fps in a row (the lag manager). */
  protected lagCpt = 0;

  /** Screen flips of the blue and red glasses (items 30, 31). */
  fl_flipX = false;
  fl_flipY = false;
  /** Called once when the level is cleared (fish items 77-79). Not emptied on a level change. */
  endLevelStack: (() => void)[] = [];
  /** Pearls left after a level conversion (items 81, 96-98). Unset (NaN) until the first one. */
  perfectItemCpt = NaN;

  protected popMC: SwfMovieClip | null = null;
  protected pointerMC: SwfMovieClip | null = null;
  protected itemNameMC: SwfMovieClip | null = null;
  protected pauseMC: SwfMovieClip | null = null;
  /** What the pause screen's key pictures show: `keys`, or `pad:` and the layout. */
  protected pausePrompts = 'keys';
  protected pausePadLayer: Container | null = null;
  /** `requestPause` waits for the controls to be unlocked. */
  protected pauseAsked = false;
  /** The players are choosing their devices (G.3, `startJoin`): the game is paused under it. */
  protected join: JoinScreen | null = null;
  /** The players to ask (`askJoin`), once the controls are unlocked. */
  protected joinAsked: number[] | null = null;
  /** The players choose their devices in this game (`askJoin`). */
  protected fl_join = false;
  /** The game was locked when the join screen showed (`startJoin`). */
  protected joinLocked = false;
  /** The keys the mode gave each player, by pid: the keyboard sides a player can choose. */
  protected joinSides: PlayerKeys[] = [];
  protected darknessMC: SwfMovieClip | null = null;
  /** `darknessMC.holes`: the players' light spots (`hole1`, `hole2`), then the extra ones. */
  protected darknessHoles: SwfMovieClip[] = [];
  protected extraHoles: { x: number; y: number; d: number; mc: SwfMovieClip | null }[] = [];
  protected dfactor = 0;
  protected targetDark = 0;

  protected readonly portalMcList: { x: number; y: number; mc: SwfMovieClip; cpt: number }[] = [];
  protected nextLink: PortalLink | null = null;

  /** `Mode` and `GameMode` constructors. `init()` then starts the game. */
  constructor(m: GameSession) {
    // `Mode`
    this.manager = m;
    this.lib = m.lib;
    this.audio = m.audio;
    this.input = m.input;
    this.dataStore = m.dataStore;
    this.rand = m.rand;
    this.mc = m.lib.createEmptyClip();
    this.mc.mcName = 'mode';
    m.gameRoot.addChild(this.mc);
    this.depthMan = new DepthManager(this.mc);

    // `GameMode`
    this.fl_mirror = m.config.hasOption(Data.OPT_MIRROR);
    this.fl_nightmare = m.config.hasOption(Data.OPT_NIGHTMARE);
    this.fl_ninja = m.config.hasOption(Data.OPT_NINJA);
    this.fl_bombExpert = m.config.hasOption(Data.OPT_BOMB_EXPERT);

    this.fxMan = new FxManager(this);
    this.statsMan = new StatsManager(this);
    // The extend letters and the unlocked item families
    this.randMan = new RandomManager(this.rand);
    this.randMan.register(Data.RAND_EXTENDS_ID, [...Data.RAND_EXTENDS]);
    this.randMan.register(
      Data.RAND_ITEMS_ID,
      this.dataStore.getRandFromFamilies(
        this.dataStore.items.special,
        m.config.specialItemFamilies,
      ),
    );
    this.randMan.register(
      Data.RAND_SCORES_ID,
      this.dataStore.getRandFromFamilies(this.dataStore.items.score, m.config.scoreItemFamilies),
    );
    this.gameChrono = new Chrono(m.getTimer);

    // World keys unlocked by quests (families 5000-5099)
    for (let i = 5000; i < 5100; i++) {
      if (this.hasFamily(i)) this.giveKey(i - 5000);
    }
  }

  /** `GameManager.CONFIG`: the families, options and settings of the game. */
  get config(): GameParameters {
    return this.manager.config;
  }

  /** `GameManager.fl_debug` */
  get fl_debug(): boolean {
    return this.manager.fl_debug;
  }

  /** `GameManager.KEY` */
  get scoreKey(): number {
    return this.manager.scoreKey;
  }

  // -------------------------------------------------------- Game Lifecycle

  /** `Mode.init`: called by the manager once the mode is built. A mode starts its game here. */
  init(): void {
    this.mc._x = this.xOffset;
    this.mc._y = this.yOffset;
  }

  /** `GameMode.initWorld`: the mode's worlds (`addWorld`). */
  protected initWorld(): void {
    // do nothing
  }

  /** `GameMode.initGame`: sets the game on its first level. */
  protected initGame(): void {
    this.initWorld();
  }

  /**
   * `GameMode.initInterface` (not called by `GameMode` itself): the HUD, once the players are
   * there (`GameInterface.initSingle` reads the player's score and lives).
   */
  protected initInterface(): void {
    this.hud?.destroy();
    this.hud = new GameHud(this);
  }

  /** `GameMode.initPlayer`: what the mode gives a new player. */
  protected initPlayer(_p: PlayerEntity): void {
    // do nothing
  }

  /**
   * `GameMode.addWorld`: adds a dimension, read from a level set the session has loaded
   * (`GameSession.loadSets`). The first one is the main world, where the game starts. Returns
   * null for a set that is not loaded (an optional dimension whose file failed).
   */
  protected addWorld(name: string): LevelWorld | null {
    const set = this.dataStore.getLevelSet(name);
    if (!set) return null;
    const dim = new LevelWorld(set, 0, this.dimensions.length === 0);
    dim.fl_mirror = this.fl_mirror;
    // The constructor read level 0 before it knew the mirror flag
    dim.resetForNewGame();
    if (this.dimensions.length === 0) {
      this.world = dim;
      // `ViewManager`: no view attached yet, so the first level shows at once, without a scroll
      this.view = new LevelView(dim, this.depthMan);
    }
    this.dimensions.push(dim);
    return dim;
  }

  /**
   * `world.goto(id)` for the first level of a game. The original's `GameMechanics` then starts
   * its script engine by itself (`onReadComplete`); here the mode holds it (`onWorldRead`). The
   * level shows once its IA map is parsed (`updateWorld`).
   */
  protected gotoFirstLevel(id: number): void {
    this.world.goto(id);
    this.world.fl_entered = true;
    this.onWorldRead();
  }

  /**
   * `GameMode.insertPlayer`: a new player at case (`cx`, `cy`), hidden, numbered after the
   * players alive. The input then reads one action mask per player (G.2).
   */
  insertPlayer(cx: number, cy: number): PlayerEntity {
    let pid = 0;
    for (const p of this.getList(Data.PLAYER)) {
      if (!p.fl_destroy) pid++;
    }
    const p = PlayerEntity.attach(this, BaseEntity.x_ctr(cx), BaseEntity.y_ctr(cy));
    p.hide();
    p.pid = pid;
    this.input.setPlayerCount(pid + 1);
    if (pid === 0) this.player = p;
    return p;
  }

  hasFamily(id: number): boolean {
    return this.config.hasFamily(id);
  }

  /** `GameManager.CONFIG.hasOption` */
  hasOption(oid: string): boolean {
    return this.config.hasOption(oid);
  }

  /** `GameMechanics.onReadComplete`: a new script engine for the level just read. */
  protected onWorldRead(): void {
    this.scriptRunner = new ScriptRunner(this, this.world.current);
  }

  // ------------------------------------------------------------ ViewManager

  /**
   * `ViewManager.onDataReady` + `GameMechanics.onDataReady`: the level is read and its IA map
   * parsed. A view still attached (the previous level's) is replaced by a snapshot that scrolls up
   * with the new view; otherwise the new view shows at once (new game, warp) or waits for the
   * portal transition (`fl_restoring`). Then the level script compiles.
   */
  protected onDataReady(): void {
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
  protected createView(id: number): LevelView {
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
  protected cloneView(v: LevelView): void {
    this.createFake(v.getSnapShot(this.manager.app.renderer ?? null));
  }

  /** `ViewManager.createFake`: shows a snapshot above the level (`DP_SCROLLER`). */
  protected createFake(snap: Texture | null): void {
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

  protected removeFake(): void {
    this.fake?.removeMovieClip();
    this.fake = null;
    this.fakeTexture?.destroy(true);
    this.fakeTexture = null;
  }

  /** `ViewManager.onTransitionDone` */
  protected onTransitionDone(): void {
    this.view.moveTo(0, 0);
    this.removeFake();
    if (this.world.fl_mirror) {
      this.world.flipPortals();
    }
  }

  /** `ViewManager.onScrollDone` */
  protected onScrollDone(): void {
    this.fl_scrolling = false;
    this.onViewReady();
  }

  /** `ViewManager.onHScrollDone` + `GameMechanics.onHScrollDone` */
  protected onHScrollDone(): void {
    this.fl_hscrolling = false;
    this.onRestore();
    this.onViewReady();
  }

  /** `ViewManager.onFadeDone` + `GameMechanics.onFadeDone` */
  protected onFadeDone(): void {
    this.fl_fading = false;
    this.onRestore();
    this.onViewReady();
  }

  /** `GameMechanics.onViewReady`: the level can be played. */
  protected onViewReady(): void {
    this.onLevelReady();
    // The page shows the level and the game's level set (its main world's)
    this.manager.onLevelChange?.(this.world.currentId, this.dimensions[0].set.name);
  }

  /** `ViewManager.onRestoreReady` + `GameMechanics.onRestoreReady` */
  protected onRestoreReady(): void {
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
  protected restoreFrom(snap: Texture | null, lid: number): void {
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
  protected updateView(): void {
    if (this.fl_scrolling) {
      this.scrollCpt += Data.SCROLL_SPEED * Timer.tmod;
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
      this.scrollCpt += this.scrollDir * Data.SCROLL_SPEED * Timer.tmod;
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
      this.fake._alpha -= Timer.tmod * Data.FADE_SPEED;

      const blur = 100 - this.fake._alpha;
      this.fake.setBlur(blur, blur * 0.3);

      if (this.fake._alpha <= 0) {
        this.onTransitionDone();
        this.onFadeDone();
      }
    }
  }

  /** `GameMechanics.update` (with `ViewManager.update` first). */
  protected updateWorld(): void {
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
      p.cpt += Timer.tmod * 0.1;
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

  /** `GameMode.onLevelReady`: the level has scrolled in and can be played. */
  onLevelReady(): void {
    this.unlock();
    this.initLevel();
    this.startLevel();
    for (const e of this.getList(Data.ENTITY)) e.world = this.world;
    for (const p of this.getList(Data.PLAYER)) (p as PlayerEntity).show();
  }

  /** `GameMode.initLevel` */
  protected initLevel(): void {
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

  /** `GameMode.startLevel` */
  startLevel(): void {
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
  }

  /** `GameMode.isBossLevel`: true for the levels with a boss. */
  isBossLevel(_id: number): boolean {
    return false;
  }

  /** `GameMode.addLevelItems`: the level's standard items, which depend on the mode. */
  protected addLevelItems(): void {
    // do nothing
  }

  /** `GameMode.nextLevel` */
  nextLevel(): void {
    this.fakeLevelId = (this.fakeLevelId ?? 0) + 1;
    this.goto(this.world.currentId + 1);
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

  /** `GameMode.goto`: changes level. */
  goto(id: number): void {
    if (this.fl_lock || this.fl_gameOver) return;
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

  /** `GameMode.onEndOfSet`: the level set has no next level. */
  onEndOfSet(): void {
    // do nothing
  }

  /** `GameMode.clearLevel` */
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

  protected getListId(type: number): number {
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

  /** `GameMode.onLevelClear` */
  onLevelClear(): void {
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
      this.mc._xscale = -100;
      this.mc._x = Data.GAME_WIDTH + this.xOffset;
    } else {
      this.mc._xscale = 100;
      this.mc._x = this.xOffset;
    }
  }

  /** `GameMode.flipY`: turns the whole game clip upside down. */
  flipY(fl: boolean): void {
    this.fl_flipY = fl;
    if (fl) {
      this.mc._yscale = -100;
      this.mc._y = Data.GAME_HEIGHT + this.yOffset + 20;
    } else {
      this.mc._yscale = 100;
      this.mc._y = this.yOffset;
    }
  }

  /** `GameMode.updateGroundFrictions`: the frictions on the ground and on ice for this `tmod`. */
  protected updateGroundFrictions(): void {
    this.gFriction = Math.pow(Data.FRICTION_GROUND, Timer.tmod);
    this.sFriction = Math.pow(Data.FRICTION_SLIDE, Timer.tmod);
  }

  /** `GameMode.wind`: wind of `speed` for `duration` frames, or none (`speed` null). */
  wind(speed: number | null, duration: number | null): void {
    if (speed === null) {
      this.fl_wind = false;
    } else {
      this.fl_wind = true;
      this.windSpeed = speed;
      this.windTimer = duration ?? 0;
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

  /** `GameMode.onExplode`: a player bomb exploded. */
  onExplode(x: number, y: number, radius: number): void {
    this.scriptRunner?.onExplode(x, y, radius);
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

  /** `GameMode.onKillBad`: an enemy died. */
  onKillBad(_b: BaseEntity): void {
    // do nothing
  }

  /** `GameMode.onHurryUp` */
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
    return mc;
  }

  /** `GameMode.resetHurry` */
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
  }

  /** `GameMode.callEvilOne`: the fire ball. With base anger 0 it starts as a harmless summon. */
  protected callEvilOne(baseAnger: number): void {
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

  /** `GameMode.onResurrect` */
  onResurrect(): void {
    this.registerMapEvent(Data.EVENT_DEATH, null);
    this.destroyList(Data.SUPA);
    this.resetHurry();
    this.updateDarkness();
    this.scriptRunner?.onPlayerBirth();
    this.scriptRunner?.onPlayerDeath();
  }

  /** `GameMode.onGameOver` */
  onGameOver(): void {
    this.fl_gameOver = true;
  }

  /** `GameMode.saveScore`: sends the result of the game. */
  saveScore(): void {
    // do nothing
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
    this.manager.redirect('endGame.html', out);
  }

  /** `GameManager.logAction` */
  logAction(str: string): void {
    this.manager.logAction(str);
  }

  /** `GameManager.logIllegal` */
  logIllegal(str: string): void {
    this.manager.logIllegal(str);
  }

  /** `GameMode.attachBad` */
  attachBad(id: number, x: number, y: number): BaseEntity {
    const b = createBad(this, id, x, y);
    if (b.isType(Data.BAD_CLEAR)) {
      this.badCount++;
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
        // Leading line breaks trimmed; `*word*` shows in a lighter color
        const text = msg.replace(/^[\n\r]+/, '');
        field.htmlText = Data.replaceTag(text, '*', '<font color="#f7e8d5">', '</font>');
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

  /** `GameMode.usePortal`: false when the portal leads nowhere. */
  usePortal(pid: number | null, e: BaseEntity | null): boolean {
    if (this.nextLink !== null) return false;
    const link = this.dataStore.portalLinks.links.find(
      (l) =>
        l.from_did === this.currentDim && l.from_lid === this.world.currentId && l.from_pid === pid,
    );
    if (!link) return false;

    // `Lang.getLevelName` is undefined for a level with no name: AS2 writes "undefined"
    const name = this.dataStore.getLevelName(link.to_did, link.to_lid) ?? 'undefined';

    // The original reads e.x even when e is null (a floating portal): NaN, so a left portal.
    this.fl_rightPortal = e !== null && this.flipCoordReal(e.x) >= Data.GAME_WIDTH * 0.5;
    this.registerMapEvent(
      this.fl_rightPortal ? Data.EVENT_EXIT_RIGHT : Data.EVENT_EXIT_LEFT,
      `${this.world.currentId + 1}. ${name}`,
    );

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
    const ss = this.view.getSnapShot(this.manager.app.renderer ?? null);
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
  protected getPortalEntrance(pid: number): { x: number; y: number; fl_unstable: boolean } {
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
  protected onRestore(): void {
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

    if (this.world.fl_mainWorld) {
      if (pt.x >= Data.LEVEL_WIDTH * 0.5) {
        this.registerMapEvent(Data.EVENT_BACK_RIGHT, null);
      } else {
        this.registerMapEvent(Data.EVENT_BACK_LEFT, null);
      }
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

  protected detachExtraHoles(): void {
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
  protected holeUpdate(): void {
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

  // -------------------------------------------------------------------- Music

  /** `Mode.playMusic` / `playMusicAt(id, 0)`: tracks are `[music, boss, hurryUp]`. */
  playMusicTrack(trackId: number): void {
    if (!this.config.hasMusic()) {
      this.wantedTrack = trackId;
      return;
    }
    if (this.manager.musics[trackId] === undefined) return;
    if (this.fl_music) this.stopMusic();
    this.wantedTrack = trackId;
    this.currentTrack = trackId;
    this.audio.playMusic(this.manager.musics[trackId]);
    this.fl_music = true;
    this.setMusicVolume(this.fl_mute ? 0 : 1);
  }

  /** `Mode.endMode`: the mode ends by itself. */
  endMode(): void {
    this.stopMusic();
  }

  /** `Mode.stopMusic` */
  stopMusic(): void {
    this.wantedTrack = null;
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

  /**
   * The script event `$e_ctrigger` 6 (`ScriptEngine`: `downcast(game).fl_warpStart = true`). The
   * field is `Adventure`'s: in another mode the original sets a field nothing reads.
   */
  setWarpStart(): void {
    // do nothing
  }

  /** `GameMode.pickUpScore`, and the port's local high score. */
  pickUpScore(id: number, _subId: number | null): number {
    this.scorePicks[id] = (this.scorePicks[id] ?? 0) + 1;
    if (this.player) {
      this.manager.highScore = Math.max(this.manager.highScore, this.player.score);
      this.manager.onScoreChange?.(this.player.score);
    }
    return this.scorePicks[id];
  }

  /** `GameMode.pickUpSpecial` */
  pickUpSpecial(id: number): number {
    this.specialPicks[id] = (this.specialPicks[id] ?? 0) + 1;
    return this.specialPicks[id];
  }

  // ------------------------------------------ Choosing the devices (G.3)

  /**
   * Port addition (G.3): in a game of two players or more, each player first chooses what they
   * play with (`JoinScreen`). The session asks it for the games the menu starts; the others
   * (debug tools, recordings, replays) keep the keys the mode gave and the controllers in
   * connection order.
   */
  askJoin(): void {
    const pl = this.getList(Data.PLAYER) as PlayerEntity[];
    if (pl.length < 2) return;
    this.fl_join = true;
    this.joinSides = pl.map((p) => this.input.playerKeys(p.pid));
    this.joinAsked = pl.map((p) => p.pid);
  }

  /** Whether the players are choosing their devices. */
  get joining(): boolean {
    return this.join !== null;
  }

  /**
   * Shows the join screen for the players asked, over the paused game. During a level change
   * the controls are locked, and it waits for the next tick that allows it, as `requestPause`.
   */
  protected startJoin(fl_lost: boolean): void {
    if (this.fl_pause) this.onUnpause();
    if (!this.canJoin() || !this.joinAsked) return;
    const pids = this.joinAsked;
    this.joinAsked = null;
    this.pauseAsked = false;
    this.fl_pause = true;
    this.joinLocked = this.fl_lock;
    this.lock();
    this.world.lock();
    this.join = new JoinScreen(this, pids, this.joinSides, fl_lost);
  }

  /**
   * Whether the join screen can show now: not while the game is locked (a level change). The
   * Time Attack modes also allow it during their countdown.
   */
  protected canJoin(): boolean {
    return !this.fl_lock;
  }

  /** The join screen's tick; the game goes on once every player has a device. */
  protected updateJoin(): void {
    if (!this.join?.update()) return;
    this.join.destroy();
    this.join = null;
    this.fl_pause = false;
    // A game that was locked under the screen (the Time Attack countdown) stays locked
    if (!this.joinLocked) this.unlock();
    this.world.unlock();
  }

  // ------------------------------------------------------- Pause & Instructions

  /**
   * Port addition: pauses the game from outside it (a hidden tab, the controller unplugged).
   * During a level change the controls are locked and `onPause` does nothing, so the pause
   * waits for the next tick that allows it. Called by `GameSession.requestPause`.
   */
  requestPause(): void {
    if (this.fl_pause || this.join) return;
    this.onPause();
    if (!this.fl_pause) this.pauseAsked = true;
  }

  /**
   * Port addition: with a controller, the pause screen shows its buttons instead of the
   * keyboard's (`PAUSE_KEYS`), and follows the device the player uses.
   */
  protected showPausePrompts(): void {
    const mc = this.pauseMC;
    if (!mc) return;
    const pad = this.input.device === 'gamepad';
    const shown = pad ? `pad:${this.input.padLayout}` : 'keys';
    if (shown === this.pausePrompts) return;
    this.pausePrompts = shown;
    this.pausePadLayer?.destroy({ children: true });
    this.pausePadLayer = null;
    const groups = Object.entries(PAUSE_KEYS).map(([row, depths]) => {
      const nodes = depths.map((d) => mc.childAtDepth(d)).filter((n) => n !== undefined);
      for (const n of nodes) n.visible = true;
      return { row: row as keyof typeof PAUSE_KEYS, nodes };
    });
    if (!pad) return;
    if (this.lib.headless) {
      for (const { nodes } of groups) for (const n of nodes) n.visible = false;
      return;
    }
    const layer = new Container();
    for (const { row, nodes } of groups) {
      // The keys' place in the clip, then hidden under the controller's buttons
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const n of nodes) {
        if (n instanceof SwfTextField) continue; // on its key
        const b = n.getBounds();
        const p0 = mc.toLocal({ x: b.minX, y: b.minY });
        const p1 = mc.toLocal({ x: b.maxX, y: b.maxY });
        x0 = Math.min(x0, p0.x);
        y0 = Math.min(y0, p0.y);
        x1 = Math.max(x1, p1.x);
        y1 = Math.max(y1, p1.y);
      }
      for (const n of nodes) n.visible = false;
      if (x0 > x1) continue;
      const buttons: PadButton[] =
        row === 'move' ? ['dpad', 'a'] : row === 'attack' ? ['b', 'x', 'r2'] : ['start'];
      // One size per kind of button on every row: the D-pad larger, as the arrow keys it covers
      const gap = 2; // the icons have their own margin
      const glyphs = buttons.map((b) => padGlyph(b, this.input.padLayout, b === 'dpad' ? 30 : 24));
      const total = glyphs.reduce((w, g) => w + g.width, 0) + gap * (glyphs.length - 1);
      let x = (x0 + x1) / 2 - total / 2;
      for (const g of glyphs) {
        g.position.set(x + g.width / 2, (y0 + y1) / 2);
        x += g.width + gap;
        layer.addChild(g);
      }
    }
    layer.zIndex = 1000; // above the clip's timeline depths
    mc.addChild(layer);
    this.pausePadLayer = layer;
  }

  // ------------------------------------------------------------- World map

  /** `GameMode.registerMapEvent`: an event of the world map, at the main world's level. */
  registerMapEvent(eid: number, misc: string | null): void {
    const lid = this.dimensions[0].currentId;

    if (!this.world.fl_mainWorld) {
      return;
    }

    // Leaves out what says nothing new
    for (const e of this.mapEvents) {
      // a return trip to the same level
      if (e.lid === lid && e.eid === Data.EVENT_EXIT_RIGHT && eid === Data.EVENT_BACK_RIGHT) {
        return;
      }
      if (e.lid === lid && e.eid === Data.EVENT_EXIT_LEFT && eid === Data.EVENT_BACK_LEFT) {
        return;
      }
      // left the same level more than once
      if (e.lid === lid && e.eid === Data.EVENT_EXIT_RIGHT && eid === Data.EVENT_EXIT_RIGHT) {
        return;
      }
      if (e.lid === lid && e.eid === Data.EVENT_EXIT_LEFT && eid === Data.EVENT_EXIT_LEFT) {
        return;
      }
    }

    const e: MapEvent = { lid, eid, misc };
    if (
      eid === Data.EVENT_EXIT_LEFT ||
      eid === Data.EVENT_EXIT_RIGHT ||
      eid === Data.EVENT_BACK_LEFT ||
      eid === Data.EVENT_BACK_RIGHT ||
      eid === Data.EVENT_TIME
    ) {
      this.mapTravels.push(e);
    } else {
      this.mapEvents.push(e);
    }
  }

  /** `GameMode.getMapY`: the map's height for a main-world level. */
  getMapY(lid: number): number {
    return 84 + Math.min(350, lid * 3.5);
  }

  /** `GameMode.attachMapIcon`: an event's icon on the map, `offset` of `offsetTotal` on its level. */
  protected attachMapIcon(
    eid: number,
    lid: number,
    txt: string | null,
    offset: number | null,
    offsetTotal: number | null,
  ): void {
    let x = Data.GAME_WIDTH * 0.5;
    const y = this.getMapY(lid);
    if (offset !== null && offsetTotal !== null) {
      const wid = 8;
      x += offset * wid - 0.5 * (offsetTotal - 1) * wid;
    }

    if (eid === Data.EVENT_EXIT_LEFT || eid === Data.EVENT_BACK_LEFT) {
      x = Data.GAME_WIDTH * 0.5 - 5;
    }
    if (eid === Data.EVENT_EXIT_RIGHT || eid === Data.EVENT_BACK_RIGHT) {
      x = Data.GAME_WIDTH * 0.5 + 5;
    }

    const mc = this.depthMan.attach('hammer_interf_mapIcon', Data.DP_INTERF);
    mc.gotoAndStop(String(eid));
    mc._x = Math.floor(x);
    mc._y = Math.floor(y);

    const field = mc.getText('field');
    if (field) field.text = txt ?? '?';
    this.mapIcons.push(mc);
  }

  /** `GameMode.onMap`: pauses the game under the world map. */
  onMap(): void {
    this.fl_pause = true;
    this.lock();
    this.world.lock();
    if (!this.fl_mute) {
      this.setMusicVolume(0.5);
    }

    this.mapMC?.removeMovieClip();
    const map = this.depthMan.attach('hammer_map', Data.DP_INTERF);
    this.mapMC = map;
    const field = map.getText('field');
    if (field) field.text = this.dataStore.getSectorName(this.currentDim, this.world.currentId);
    map._x = -this.xOffset;

    const lid = this.dimensions[0].currentId;
    const ptr = map.getClip('ptr');
    const pit = map.getClip('pit');
    if (lid === 0) {
      if (ptr) ptr._y = 70;
      if (pit) pit._visible = false;
    } else {
      if (ptr) ptr._y = this.getMapY(lid);
      if (pit) {
        pit.setOverlayBlend(); // blendMode = BlendMode.OVERLAY
        pit._alpha = 75;
        pit._yscale = Math.min(100, 100 * (lid / 100));
      }
    }

    // Portal crossings
    for (const e of this.mapTravels) {
      this.attachMapIcon(e.eid, e.lid, e.misc, null, null);
    }

    // Icons. The original attaches every event of a level once per event of that level, so a
    // level with n events gets n copies of its row, stacked at the same place.
    for (const e of this.mapEvents) {
      const list = this.mapEvents.filter((m) => m.lid === e.lid);
      for (let j = 0; j < list.length; j++) {
        this.attachMapIcon(list[j].eid, list[j].lid, list[j].misc, j, list.length);
      }
    }

    this.manager.onStateChange?.({ isOver: this.fl_gameOver, isPaused: true });
  }

  /** The map part of `GameMode.onUnpause`: the map and its icons go. */
  protected removeMap(): void {
    this.mapMC?.removeMovieClip();
    this.mapMC = null;
    for (const mc of this.mapIcons) mc.removeMovieClip();
    this.mapIcons = [];
  }

  togglePause(): void {
    if (this.join) return;
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
    this.pausePrompts = 'keys';
    this.pausePadLayer = null;
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
    this.showPausePrompts();

    this.manager.onStateChange?.({ isOver: this.fl_gameOver, isPaused: true });
  }

  onUnpause(): void {
    if (!this.fl_pause) return;
    this.fl_pause = false;
    this.unlock();
    this.world.unlock();
    this.pauseMC?.removeMovieClip();
    this.pauseMC = null;
    this.removeMap();
    if (!this.fl_mute) this.setMusicVolume(1);
    this.manager.onStateChange?.({ isOver: this.fl_gameOver, isPaused: false });
  }

  /**
   * `Mode.getDebugControls` + `GameMode.getDebugControls`: Backspace clears the log, Shift slows
   * the game to `tmod` 0.3 and Home puts it back to 1 (Shift held with bullet time does nothing
   * more). `Adventure`'s Ctrl+Shift+M (the co-op mode) waits for Phase 4.
   */
  protected getDebugControls(): void {
    if (this.input.isKeyDown(8)) {
      Log.clear();
    }
    if (this.input.isKeyDown(16)) {
      Timer.tmod = 0.3;
    }
    if (this.input.isKeyDown(36)) {
      Timer.tmod = 1.0;
    }
  }

  /**
   * The end of `GameMode.getControls`: F prints the frame rate and B the build time. The
   * original reads them in every mode, but its log shows only in dev mode, so here they wait for
   * the dev keys (`isKeyDown` is false without them). The Flash version line is left out.
   */
  protected getDevControls(): void {
    if (this.input.isKeyDown(70)) {
      const fps = this.manager.gameLoop.fps;
      Log.print(`${Math.round(fps)} FPS`);
      Log.print(`Performances: ${Math.min(100, Math.round((100 * fps) / 30))}%`);
    }
    if (this.input.isKeyDown(66)) {
      Log.print('Dernière mise à jour:');
      Log.print(typeof __BUILD_TIME__ === 'undefined' ? '?' : __BUILD_TIME__);
    }
  }

  /** The body of `GameMode.getControls`' disguise key: the next head, skipping the locked ones. */
  protected nextDisguise(p: PlayerEntity): void {
    const old = p.head;
    p.head++;
    if (p.head === Data.HEAD_AFRO && !this.hasFamily(109)) p.head++; // tuft
    if (p.head === Data.HEAD_CERBERE && !this.hasFamily(110)) p.head++; // cerberus
    if (p.head === Data.HEAD_PIOU && !this.hasFamily(111)) p.head++; // piou
    if (p.head === Data.HEAD_MARIO && !this.hasFamily(112)) p.head++; // mario
    if (p.head === Data.HEAD_TUB && !this.hasFamily(113)) p.head++; // cape
    if (p.head > Data.HEAD_TUB) {
      p.head = p.defaultHead;
    }
    if (old !== p.head) {
      p.replayAnim();
    }
  }

  /** `GameMode.printDebugInfos`, on the pause screen in dev mode (what the port has of it). */
  protected printDebugInfos(): void {
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

  /** `GameMode.main`: one logic tick of the game (`GameSession.update` calls it). */
  main(): void {
    // FPS: 30 seconds under 16 fps switch to low details and no shaking (lag manager). Flash
    // ran the game once per drawn frame, so the page's frame rate stands for `Timer.fps()`.
    // Port deviation: not while recording or replaying, as it would change the random draws.
    if (this.config.fl_detail && !this.manager.isRecording && !this.input.replaying) {
      if (this.manager.gameLoop.isRunning && this.manager.gameLoop.frameRate <= 16) {
        this.lagCpt += Timer.tmod;
        if (this.lagCpt >= Data.SECOND * 30) {
          this.config.setLowDetails();
          this.config.fl_shaky = false;
        }
      } else {
        this.lagCpt = 0;
      }
    }

    // Chrono
    this.gameChrono.update();
    this.input.poll();

    // The players choose their devices (G.3): at the start, and again for a player whose
    // controller is unplugged. Nothing else is read meanwhile.
    if (this.fl_join && !this.fl_gameOver) {
      if (!this.join) {
        const lost = this.input.lostPlayers();
        const fl_lost = lost.length > 0 && !this.joinAsked;
        if (fl_lost) this.joinAsked = lost;
        if (this.joinAsked) this.startJoin(fl_lost);
      }
      if (this.join) {
        this.updateJoin();
        return;
      }
    }

    // Check pause key toggle (P, and Escape: `GameMode.main` pauses with it on the site)
    if (this.input.consumePress('pause')) {
      this.togglePause();
    }
    // A pause asked from outside the game (hidden tab, controller unplugged), once allowed
    if (this.pauseAsked && !this.fl_lock) {
      this.pauseAsked = false;
      if (!this.fl_pause) this.onPause();
    }
    if (this.fl_pause) this.showPausePrompts();

    // World map (C): closes the pause or the map when locked, as P does
    if (this.fl_map && this.input.consumePress('map')) {
      if (this.fl_lock) {
        this.onUnpause();
      } else {
        this.onMap();
      }
    }

    // Music (M)
    if (!this.fl_lock && this.fl_music && this.input.consumePress('music')) {
      this.fl_mute = !this.fl_mute;
      this.setMusicVolume(this.fl_mute ? 0 : 1);
    }

    // Port addition: the sound panel from the pause (O, or the controller's R1)
    if (this.input.consumePress('sound') && this.manager.soundMenuAvailable) {
      this.manager.onSoundMenu?.();
    }

    // Suicide (Ctrl+Shift+K): the way to give up a game. The original also waits for
    // `fl_switch`, which only `ModeSwitcher` sets (never in the Adventure).
    if (this.input.isDown('suicide')) {
      if (!this.fl_lock && this.countList(Data.PLAYER) > 0) {
        this.destroyList(Data.PLAYER);
        this.onGameOver();
      }
    }

    // Disguises (`GameMode.getControls`, key D in the original, E here): the next head whose
    // quest family the profile has. Read every tick, as the original does, even in pause.
    if (this.fl_disguise && this.input.consumePress('disguise')) {
      const p = (this.getList(Data.PLAYER) as PlayerEntity[])[0];
      if (p) this.nextDisguise(p);
    }

    // Pause: the dev mode prints its infos
    if (this.fl_pause && this.fl_debug) {
      this.printDebugInfos();
    }

    // Bullet time: counted in real frames, each moving the game by 0.3. `Timer.update`
    // recomputes `tmod` each frame (`calc_tmod`), so it lasts that frame only. The movie clips
    // keep their 40 fps.
    if (this.fl_bullet && this.bulletTimer > 0) {
      this.bulletTimer -= Timer.tmod;
      if (this.bulletTimer > 0) {
        Timer.tmod = BULLET_TMOD;
      }
    }
    // Variables
    this.updateGroundFrictions();

    // `Mode.main`
    if (this.fl_debug) {
      this.getDebugControls();
    }
    this.getDevControls();

    if (this.fl_pause) {
      return;
    }

    // `Mode.updateConstants`: not while the game is locked
    if (!this.fl_lock) {
      this.xFriction = Math.pow(Data.FRICTION_X, Timer.tmod);
      this.yFriction = Math.pow(Data.FRICTION_Y, Timer.tmod);
      this.cycle += Timer.tmod;
    }
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
        p.cpt += Timer.tmod * 0.1;
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

    this.duration += Timer.tmod;

    // Automatic end of the mode
    if (this.endModeTimer > 0) {
      this.endModeTimer -= Timer.tmod;
      if (this.endModeTimer <= 0) {
        for (const p of this.getList(Data.PLAYER) as PlayerEntity[]) {
          this.registerScore(p.pid, p.score);
        }
        this.onGameOver();
      }
    }

    this.fxMan.update();

    // Hurry up (H: 21 times faster in dev mode)
    this.huTimer += Timer.tmod;
    if (this.input.isKeyDown(72) && this.fl_debug) {
      this.huTimer += Timer.tmod * 20;
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
      this.shakeTimer -= Timer.tmod;
      if (this.shakeTimer <= 0) {
        this.shakeTimer = 0;
        this.shakePower = 0;
      }
      const amp = () =>
        (this.rand.random(2) * 2 - 1) *
        (this.rand.random(Math.round(this.shakePower * 10)) / 10) *
        (this.shakeTimer / this.shakeTotal);
      if (this.fl_flipX) {
        this.mc._x = Data.GAME_WIDTH + this.xOffset - Math.round(amp());
      } else {
        this.mc._x = Math.round(this.xOffset + amp());
      }
      if (this.fl_flipY) {
        this.mc._y = Data.GAME_HEIGHT + 20 + Math.round(this.yOffset + amp());
      } else {
        this.mc._y = Math.round(this.yOffset + amp());
      }
    }

    // Water: the game bobs and stretches
    if (this.fl_aqua) {
      this.aquaTimer += 0.03 * Timer.tmod;
      if (!this.fl_flipY) {
        this.mc._y = -7 + 7 * Math.cos(this.aquaTimer);
        this.mc._yscale = 102 - 2 * Math.cos(this.aquaTimer);
      }
    } else {
      if (this.aquaTimer !== 0) {
        this.aquaTimer = 0;
        this.flipY(this.fl_flipY);
      }
    }

    // Wind
    if (this.windTimer > 0) {
      this.windTimer -= Timer.tmod;
      if (this.windTimer <= 0) {
        this.wind(null, null);
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

    // No exit arrow in the tutorial
    if (this.fxMan.mc_exitArrow) {
      if (this.manager.isTutorial()) {
        this.fxMan.detachExit();
      }
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
  protected onBadsReady(): void {
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

  // ------------------------------------------------------------ Port glue

  /** The pause screen is up (not the world map): the sound panel may open over it. */
  get pauseScreenShown(): boolean {
    return this.fl_pause && this.pauseMC !== null;
  }

  /**
   * Port addition: the sound settings changed during the game (the pause's sound panel).
   * `hadMusic` is `config.hasMusic()` before the change.
   */
  onSoundSettings(hadMusic: boolean): void {
    if (hadMusic && !this.config.hasMusic()) {
      this.audio.stopMusic();
      this.fl_music = false;
    } else if (!hadMusic && this.config.hasMusic() && this.wantedTrack !== null) {
      this.playMusicTrack(this.wantedTrack);
    }
    this.setMusicVolume(this.fl_mute ? 0 : this.fl_pause ? 0.5 : 1);
  }

  /**
   * `GameMode.destroy` + `Mode.destroy`: the manager drops the mode. Its clip goes with
   * everything on it. The entities and effects are destroyed first, as they hold more than
   * clips.
   */
  destroy(): void {
    this.destroyList(Data.PLAYER);
    this.clearLevel();
    this.fxMan.clear();
    this.killPortals();
    this.removeFake();
    this.view?.destroy();
    this.pausePadLayer?.destroy({ children: true });
    this.pausePadLayer = null;
    this.join = null;
    this.depthMan.destroy();
    this.mc.removeMovieClip();
    this.lock();
  }
}
