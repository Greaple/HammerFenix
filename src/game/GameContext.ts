import type { AudioEngine } from '../engine/Audio';
import type { DepthManager } from '../engine/DepthManager';
import type { InputController } from '../engine/Input';
import type { SwfMovieClip } from '../engine/swf/SwfMovieClip';
import type { GameDataStore } from './Data';
import type { FxManager } from './FxManager';
import type { GameParameters } from './GameParameters';
import type { BaseEntity } from './entity/Entity';
import type { GameHud } from './gui/GameHud';
import type { LevelView } from './levels/LevelView';
import type { LevelWorld } from './levels/LevelWorld';
import type { ScriptRunner } from './levels/ScriptRunner';
import type { Random } from './Random';
import type { RandomManager } from './RandomManager';
import type { StatsManager } from './StatsManager';

/**
 * Shared runtime contract exposed by `GameMode` (`mode/GameMode.ts`) to entities, FX, HUD, and
 * level scripts. Mirrors the interface of `mode.GameMode` in the original MotionTypes codebase.
 */
export interface IGameContext {
  readonly depthMan: DepthManager;
  readonly audio: AudioEngine;
  readonly input: InputController;
  readonly dataStore: GameDataStore;
  readonly world: LevelWorld;
  readonly view: LevelView;
  readonly fxMan: FxManager;
  readonly hud: GameHud;
  readonly rand: Random;
  readonly randMan: RandomManager;
  readonly statsMan: StatsManager;
  /** `GameManager.CONFIG`: the families, options and the player's settings. */
  readonly config: GameParameters;

  /** `GameMode.mc`: the clip holding the whole game, moved by the screen shake. */
  readonly mc: SwfMovieClip;
  readonly xOffset: number;
  cycle: number;
  xFriction: number;
  yFriction: number;
  gFriction: number;
  sFriction: number;
  speedFactor: number;
  readonly diffFactor: number;
  readonly scriptRunner: ScriptRunner | null;

  /** `GameManager.fl_debug`, also standing for `GameManager.isDev()`: the dev keys are on. */
  readonly fl_debug: boolean;
  fl_lock: boolean;
  fl_clear: boolean;
  fl_gameOver: boolean;
  fl_pause: boolean;
  fl_ice: boolean;
  fl_aqua: boolean;
  fl_wind: boolean;
  windSpeed: number;
  fl_mirror: boolean;
  fl_nightmare: boolean;
  fl_ninja: boolean;
  fl_bombExpert: boolean;
  fl_bombControl: boolean;
  /**
   * `GameMode.fl_static`: the enemies' first direction is fixed instead of random (only the
   * Time Attack modes turn it on).
   */
  readonly fl_static: boolean;
  /** `GameMode._name`, e.g. `$adventure`, `$time`. */
  readonly _name: string;
  forcedDarkness: number | null;
  fakeLevelId: number | null;
  huTimer: number;
  badCount: number;
  endModeTimer: number;
  huState: number;

  readonly globalActives: boolean[];
  fl_flipX: boolean;
  fl_flipY: boolean;
  endLevelStack: (() => void)[];
  perfectItemCpt: number;
  /** `GameManager.KEY` */
  readonly scoreKey: number;

  /** `GameManager.CONFIG.hasFamily`: whether the player has unlocked this item family. */
  hasFamily(id: number): boolean;
  /** `GameManager.CONFIG.hasOption`: whether the game option (`Data.OPT_*`) is on. */
  hasOption(oid: string): boolean;
  getUniqId(): number;
  addToList(type: number, e: BaseEntity): void;
  removeFromList(type: number, e: BaseEntity): void;
  queueUnregister(type: number, e: BaseEntity): void;
  queueKill(e: BaseEntity): void;
  getList(type: number): BaseEntity[];
  getListAt(type: number, cx: number, cy: number): BaseEntity[];
  countList(type: number): number;
  getClose(type: number, x: number, y: number, radius: number, flOnGround: boolean): BaseEntity[];
  getOne(type: number): BaseEntity | null;
  getAnotherOne(type: number, e: BaseEntity): BaseEntity | null;
  destroyList(type: number): void;
  destroySome(type: number, n: number): void;
  cleanKills(): void;

  countCombo(comboId: number): number;
  canAddItem(): boolean;
  checkLevelClear(): boolean;
  nextLevel(): void;
  forcedGoto(id: number): void;
  shake(duration: number | null, power: number | null): void;
  bulletTime(d: number): void;
  flipX(fl: boolean): void;
  flipY(fl: boolean): void;
  isBossLevel(id: number): boolean;

  onExplode(x: number, y: number, radius: number): void;
  onKillBad(b: BaseEntity): void;
  onHurryUp(): SwfMovieClip | null;
  resetHurry(): void;
  onResurrect(): void;
  /** `GameMode.registerMapEvent`: an event of the world map (`Data.EVENT_*`) at this level. */
  registerMapEvent(eid: number, misc: string | null): void;
  onGameOver(): void;
  registerScore(pid: number, score: number): void;
  /** `GameManager.logAction` */
  logAction(str: string): void;
  /** `GameManager.logIllegal` */
  logIllegal(str: string): void;

  attachBad(id: number, x: number, y: number): BaseEntity;
  spawnScoreItem(x: number, y: number, id: number, subId: number | null): BaseEntity;
  spawnSpecialItem(x: number, y: number, id: number, subId: number | null): BaseEntity | null;

  attachPop(msg: string, flTuto: boolean): void;
  killPop(): void;
  attachPointer(cx: number, cy: number, ocx: number, ocy: number): void;
  killPointer(): void;
  attachItemName(id: number): void;

  onEnterCase(cx: number, cy: number): void;
  usePortal(pid: number | null, entity: BaseEntity | null): boolean;
  openPortal(cx: number, cy: number, pid: number): boolean;

  setDynamicVar(name: string, value: string): void;
  getDynamicVar(name: string): string | undefined;
  hasKey(id: number | null): boolean;
  giveKey(id: number): void;

  flipCoordReal(x: number): number;
  flipCoordCase(cx: number): number;
  playMusicTrack(trackId: number): void;
  setWarpStart(): void;
  pickUpScore(id: number, subId: number | null): number;
  pickUpSpecial(id: number): number;

  clearExtraHoles(): void;
  addHole(x: number, y: number, diameter: number): void;
  updateDarkness(): void;
}
