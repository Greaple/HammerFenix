import type { Container, Renderer } from 'pixi.js';
import { AudioEngine } from '../engine/Audio';
import { FixedGameLoop } from '../engine/GameLoop';
import { InputController } from '../engine/Input';
import { InputPlayer, InputRecorder, type Replay } from '../engine/InputRecording';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import type { SwfMovieClip } from '../engine/swf/SwfMovieClip';
import { Data, GameDataStore } from './Data';
import { Random } from './Random';
import { Timer } from '../engine/Timer';
import {
  GameParameters,
  loadSettings,
  type PlayerSettings,
  saveSettings,
  SYSTEM_FAMILIES,
} from './GameParameters';
import { type GameResult, Loader, type ScoreStats } from './Loader';
import { realTimer } from './Chrono';
import { padStartText } from './gui/PadGlyphs';
import { Log } from './Log';
import { Adventure } from './mode/Adventure';
import type { GameMode } from './mode/GameMode';

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

/** `GameManager.musics`: the in-game, boss and hurry-up tracks. */
export const MUSIC_TRACKS: readonly string[] = ['music_ingame', 'music_boss', 'music_hurry'];

/** The dimensions the adventure's portals lead to (`Adventure.initWorld`). */
const ADVENTURE_DIMENSIONS = ['deepnight', 'hiko', 'ayame', 'hk'];

/**
 * The page's side of the game: what stays from one game to the next. It stands for the
 * original's `GameManager` (`class/hammer/GameManager.mt`: the current mode, the game log, the
 * parameters, the sound channels) and holds the port's own tools around it: the logic loop, the
 * `Loader`, the level sets, the settings, the recordings and the local save.
 *
 * Each game is a new mode object (`game`, the original's `manager.current`), a `GameMode`
 * subclass built by `startGame`: the state of a game is there (`session.game.world`,
 * `session.game.player`...).
 */
export class GameSession {
  readonly app: GameHost;
  readonly lib: SwfLibrary;
  readonly audio: AudioEngine;
  readonly input: InputController;
  readonly dataStore: GameDataStore;

  /** `GameManager.root` (the Loader's `game` clip): each mode puts its own clip in it. */
  readonly gameRoot: SwfMovieClip;
  readonly gameLoop: FixedGameLoop;

  /** `GameManager.current`: the mode of the current game, a new one for each game. */
  game!: GameMode;
  /** `game` is set and not destroyed yet. */
  private modeAlive = false;

  /** Every random draw of the game goes through `rand`, so a seed and inputs replay a game. */
  readonly rand = new Random();
  /** Seed of the current game, set by `startGame()`. */
  seed = 0;
  /** `Std.getTimer()` for the chronos. Tests can replace it. */
  getTimer: () => number = realTimer;
  /** `GameManager.history`: the game log. Only its "illegal" mark survives the game over. */
  history: string[] = [];
  /** `GameManager.KEY`: hides the players' scores from memory editors (`Player.scoreCS`). */
  scoreKey = 0;
  /** `GameManager.musics` */
  readonly musics = MUSIC_TRACKS;
  /**
   * The player's settings (the site's "Options" page, roadmap 2C.5), saved in `localStorage`.
   * The next game reads them (`setParameters`).
   */
  settings: PlayerSettings = loadSettings();
  /**
   * `GameManager.CONFIG`: the families and options of the next game. The site sets them from
   * the player's profile (`setParameters`); with no site the original uses the system families.
   */
  config = new GameParameters(SYSTEM_FAMILIES, '', this.settings);
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
    detail: number;
    shake: number;
  } | null = null;
  /** The last recording, kept after it stops (also when a debug restart ends it). */
  lastRecording: Replay | null = null;

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

  /** The level set the games play (the set picker of the debug toolbar changes it). */
  currentSetName = 'adventure';

  highScore = 0;
  savedData: GameSaveData;

  onLevelChange?: (levelId: number, levelSet: string) => void;
  onScoreChange?: (score: number) => void;
  onStateChange?: (state: { isOver: boolean; isPaused: boolean }) => void;
  /** Opens the sound panel over the paused game (port addition). */
  onSoundMenu?: () => void;

  /** The level sets must be loaded (`loadSets`) before the first game: use `create`. */
  constructor(
    app: GameHost,
    lib: SwfLibrary,
    dataStore: GameDataStore,
    audio: AudioEngine,
    input: InputController,
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

    // The root every mode puts its clip in
    this.gameRoot = lib.createEmptyClip();
    this.gameRoot.mcName = 'gameRoot';
    app.stage.addChild(this.gameRoot);

    lib.random = () => this.animRand.next();

    this.loader = new Loader({
      lib,
      stage: app.stage,
      gameRoot: this.gameRoot,
      getLangStr: (id) => this.dataStore.getStatic(id),
      startGameInstance: () => {
        this.startGame(0);
        this.siteMode = this.readyMode;
      },
      startText: () =>
        this.input.device === 'gamepad'
          ? padStartText(this.dataStore.langId, this.input.padLayout)
          : null,
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
    const session = new GameSession(app, lib, dataStore, audio, input, preferredSet);
    await session.loadSets(preferredSet);
    session.startGame();
    return session;
  }

  /**
   * Loads the level sets a game on `setName` reads (`GameMode.addWorld`): the set itself and,
   * for the adventure, the dimensions its portals lead to.
   */
  private async loadSets(setName: string): Promise<void> {
    await this.dataStore.loadLevelSet(setName);
    if (setName !== 'adventure') return;
    for (const name of ADVENTURE_DIMENSIONS) {
      try {
        await this.dataStore.loadLevelSet(name);
      } catch {
        // non-critical if optional dimension file fails
      }
    }
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
        this.game.world.currentId,
      );
      this.savedData.preferredLang = this.dataStore.langId;
      this.savedData.muted = this.audio.isMuted;
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.savedData));
    } catch {
      // ignore storage quota / sandbox write errors
    }
  }

  // -------------------------------------------------------- Game Lifecycle

  /**
   * A new game on level `startLevelId` of the current set. The original loads a new page for
   * each game, so a new `GameManager`, Loader and mode: here the previous mode is destroyed, the
   * manager's state reset, and a new mode started.
   */
  startGame(startLevelId = 0, seed = Random.makeSeed()): void {
    // Before the new seed: destroying the entities must not draw from the new game's numbers
    this.dropMode();

    this.seed = seed;
    this.rand.reseed(seed);
    this.animRand.reseed(seed ^ 0x5eed);
    this.gameLoop.resetPhase();

    this.initSoundChannels();
    this.loader.reset();
    this.lastResult = null;
    this.siteMode = null;
    this.history = [];
    const keyRand = new Random();
    keyRand.reseed(seed ^ 0x4b4559);
    this.scoreKey = keyRand.random(999999) * keyRand.random(999999);
    // Every player back on `PlayerController`'s own keys
    this.input.resetKeys();

    this.startGameMode(this.createMode(startLevelId));
  }

  /**
   * `GameManager.startDefaultGame`: the mode the site's `$mode` asks for. Only `solo`
   * (`Adventure`) is ported, and it plays the other sets too.
   */
  private createMode(firstLevel: number): GameMode {
    return new Adventure(this, firstLevel);
  }

  /**
   * `GameManager.startGameMode` (`transition`): `next` becomes the current mode and starts, then
   * the previous one is destroyed (unless `startGame` already did).
   */
  startGameMode(next: GameMode): void {
    const prev = this.modeAlive ? this.game : null;
    this.game = next;
    this.modeAlive = true;
    next.init();
    prev?.destroy();
  }

  private dropMode(): void {
    if (!this.modeAlive) return;
    this.modeAlive = false;
    this.game.destroy();
  }

  /**
   * The `$families` and `$options` of the next games, as the site sent them, with the player's
   * settings (or `settings`, for a replay).
   */
  setParameters(families: string, options = '', settings: PlayerSettings = this.settings): void {
    this.config = new GameParameters(families, options, settings);
  }

  /**
   * Changes the player's settings (the settings screen); the next game uses them. During a game
   * (the sound panel of the pause, a port addition) the volumes, sound and music apply at once,
   * and the details and shaking wait for the next game.
   */
  setSettings(s: PlayerSettings): void {
    this.settings = { ...s };
    saveSettings(this.settings);
    if (!this.loader.gameRunning) {
      this.config = new GameParameters(
        this.config.families.join(','),
        this.config.optionList.join(','),
        this.settings,
      );
      return;
    }
    const hadMusic = this.config.hasMusic();
    this.config.setSound(this.settings);
    this.initSoundChannels();
    this.game.onSoundSettings(hadMusic);
  }

  /**
   * The sound panel can open: on the pause screen, and not while recording or replaying (it is
   * not in the original, and its keys would reach the game).
   */
  get soundMenuAvailable(): boolean {
    return (
      this.loader.gameRunning &&
      this.game.pauseScreenShown &&
      !this.recorder &&
      !this.input.replaying
    );
  }

  /**
   * Port addition: pauses the game from outside it (a hidden tab, the controller unplugged), if
   * one is running.
   */
  requestPause(): void {
    if (!this.loader.gameRunning) return;
    this.game.requestPause();
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

  // ------------------------------------------------- End of a game (the site)

  /**
   * The Loader's `gameOver` global, which a mode's `saveScore` calls: the game is over and its
   * score goes to the site. Also keeps the port's local high score, and tells the page.
   */
  gameOver(score: number, runId: number | null, stats: ScoreStats): void {
    this.saveGame();
    this.loader.gameOver(score, runId, stats);
    this.onStateChange?.({ isOver: true, isPaused: false });
  }

  /** `GameManager.redirect`: the game leaves for a page of the site (the end of the set). */
  redirect(url: string, params: string): void {
    this.game.lock();
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

  /** The Loader is done: the results screen takes over (3.1c, `Shell`). */
  private onGameEnd(result: GameResult): void {
    this.lastResult = result;
    this.onGameResult?.(result);
  }

  // ------------------------------------------------------- Fixed Update Loop

  /**
   * One logic tick: `GameManager.main` (`Timer.update` gives this frame's `tmod`, always 1
   * here), the mode's `main`, then the dev log's lines of the tick.
   */
  update(): void {
    Timer.tmod = 1;
    // `Loader.mainGame` stops calling the game's main at the game over, and for good once the
    // game's clip is removed
    if (this.loader.gameRunning) {
      this.game.main();
    } else {
      this.input.poll();
      // Port addition: the space bar starts the game as a click does, since the menu is left
      // with it ("click to start" alone sent keyboard players to the mouse), and so does a
      // controller's A, which the text then names
      if (this.loader.waitingStart) {
        this.loader.refreshStartText();
        if (this.input.consumeMenu('ok')) this.clickStart();
      }
    }
    Log.flush();
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
    this.readyMode = mode;
    this.loader.startNow(mode);
    this.onStateChange?.({ isOver: false, isPaused: false });
  }

  /**
   * The level is drawn: a new game first reads the level's map (about 17 frames) with no view
   * attached, which shows black. The menu waits for this before fading out.
   */
  get levelShown(): boolean {
    return this.loader.gameRunning && this.game.view.fl_attach;
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
    this.startGame(this.game.world.currentId);
  }

  changeLevel(levelId: number): void {
    if (levelId < 0 || levelId >= this.game.world.set.levels.length) return;
    this.stopInputCapture();
    this.startGame(levelId);
  }

  // ------------------------------------------------------ Recording & replay

  /** Starts a new game at `levelId` of the current set, recording every tick's input. */
  startRecording(levelId = this.game.world.currentId): void {
    this.stopInputCapture();
    this.startGame(levelId);
    this.input.resetState();
    this.recorder = new InputRecorder();
    this.recordStart = {
      set: this.currentSetName,
      level: levelId,
      seed: this.seed,
      families: this.config.families.join(','),
      options: this.config.optionList.join(','),
      detail: this.config.fl_detail ? 1 : 0,
      shake: this.config.fl_shaky ? 1 : 0,
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
    const { set, level, seed, families, options, detail, shake } = this.recordStart;
    this.lastRecording = this.recorder.toReplay(set, level, seed, families, options);
    // Low details and no shaking change the random draws, so the replay keeps them
    if (detail === 0) this.lastRecording.detail = 0;
    if (shake === 0) this.lastRecording.shake = 0;
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
    this.setParameters(replay.families ?? SYSTEM_FAMILIES, replay.options ?? '', {
      ...this.settings,
      detail: replay.detail ?? 1,
      shake: replay.shake ?? 1,
    });
    this.startGame(replay.level, replay.seed);
    const player = new InputPlayer(replay.input, replay.otherInputs);
    this.input.startReplay(player);
    return player;
  }

  private stopInputCapture(): void {
    this.stopRecording();
    this.input.stopReplay();
  }

  /** The games now play `setName` (the debug toolbar's set picker); starts one at `levelId`. */
  async changeSet(setName: string, levelId = 0): Promise<void> {
    this.stopInputCapture();
    await this.loadSets(setName);
    this.currentSetName = setName;
    this.startGame(levelId);
  }

  destroy(): void {
    this.gameLoop.stop();
    this.saveGame();
    this.dropMode();
    this.app.stage.removeChild(this.gameRoot);
  }
}
