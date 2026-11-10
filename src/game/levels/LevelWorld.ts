import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { LevelData, LevelSet } from '../data/types';
import type { Random } from '../Random';

export class TeleporterData {
  mc: SwfMovieClip | null = null;
  podA: SwfMovieClip | null = null;
  podB: SwfMovieClip | null = null;

  readonly cx: number;
  readonly cy: number;
  readonly length: number;
  readonly dir: number;

  readonly centerX: number;
  readonly centerY: number;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;

  fl_on = false;

  constructor(cx: number, cy: number, len: number, dir: number) {
    this.cx = cx;
    this.cy = cy;
    this.length = len;
    this.dir = dir;

    let centerX = cx * Data.CASE_WIDTH + Data.CASE_WIDTH * 0.5;
    let centerY = cy * Data.CASE_HEIGHT + Data.CASE_HEIGHT;
    let startX = cx * Data.CASE_WIDTH + Data.CASE_WIDTH * 0.5;
    let startY = cy * Data.CASE_HEIGHT + Data.CASE_HEIGHT;

    if (dir === Data.HORIZONTAL) {
      centerX += len * 0.5 * Data.CASE_WIDTH;
      startX -= Data.CASE_WIDTH * 0.5;
    } else {
      centerY += len * 0.5 * Data.CASE_HEIGHT;
      startY -= Data.CASE_HEIGHT;
    }

    this.centerX = centerX;
    this.centerY = centerY;
    this.startX = startX;
    this.startY = startY;
    this.endX = dir === Data.HORIZONTAL ? startX + len * Data.CASE_WIDTH : startX;
    this.endY = dir === Data.HORIZONTAL ? startY : startY + len * Data.CASE_HEIGHT;
  }
}

export class PortalData {
  readonly mc: SwfMovieClip;
  readonly cx: number;
  readonly cy: number;
  readonly x: number;
  readonly y: number;
  cpt = 0;

  constructor(mc: SwfMovieClip, cx: number, cy: number) {
    this.mc = mc;
    this.cx = cx;
    this.cy = cy;
    this.x = mc._x;
    this.y = mc._y;
  }
}

/** `Data.cleanString`: trims spaces at both ends and turns CR into spaces. */
function cleanString(s: string): string {
  return s.replace(/^ +/, '').replace(/ +$/, '').replace(/\r/g, ' ');
}

function cloneLevel(src: LevelData): LevelData {
  return {
    map: src.map.map((col) => col.slice()),
    badList: src.badList.map((b) => ({ ...b })),
    playerX: src.playerX,
    playerY: src.playerY,
    skinTiles: src.skinTiles,
    skinBg: src.skinBg,
    specialSlots: src.specialSlots.map((s) => ({ ...s })),
    scoreSlots: src.scoreSlots.map((s) => ({ ...s })),
    script: src.script,
  };
}

/**
 * Port of `levels.SetManager` (`class/hammer/levels/SetManager.mt`) and
 * `levels.GameMechanics` (`class/hammer/levels/GameMechanics.mt`), plus the `ViewManager` flags
 * the views are built from. The level script engine and the view are kept on `GameMode`
 * (`scriptRunner`, `view`); `GameMode.updateWorld()` is `GameMechanics.update`.
 *
 * Not ported: the editor functions (`overwrite`, `rollback`, `insert`, `delete`, cookies).
 */
export class LevelWorld {
  set: LevelSet;
  currentId = 0;
  current!: LevelData;
  /** Mirror option: levels are read flipped (`flip`). Set by `GameMode.addWorld`. */
  fl_mirror = false;
  fl_mainWorld = true;
  darknessFactor = 0;

  flagMap: number[][] = [];
  fallMap: number[][] = [];
  /** The IA map of the current level is being parsed, `MAX_ITERATION` cases per frame. */
  fl_parsing = false;
  /** The IA map of the current level is ready (`flcurrentIA`). */
  flcurrentIA = false;
  private iteration = { cx: 0, cy: 0 };
  triggers: unknown[][][] = [];
  teleporterList: TeleporterData[] = [];
  portalList: PortalData[] = [];
  readonly visited = new Set<number>();
  /** Script lock: the level script only runs while the world is unlocked. */
  fl_lock = true;
  // ViewManager: flags given to each new view
  fl_hideTiles = false;
  fl_hideBorders = false;
  fl_shadow = true;
  /**
   * Level data, read once per game (`SetManager.levels[id]`). The original keeps a reference, so
   * changes made during play (tiles set by scripts) persist when a portal brings you back.
   */
  private levels: (LevelData | undefined)[] = [];
  /** False until the game enters this world: a fresh `SetManager` has no current level yet. */
  fl_entered = false;

  constructor(set: LevelSet, initialId = 0, isMainWorld = true) {
    this.set = set;
    this.fl_mainWorld = isMainWorld;
    this.resetTriggers();
    this.goto(initialId);
  }

  isVisited(): boolean {
    return this.visited.has(this.currentId);
  }

  markVisited(): void {
    this.visited.add(this.currentId);
  }

  lock(): void {
    this.fl_lock = true;
  }

  unlock(): void {
    this.fl_lock = false;
  }

  /**
   * `GameMechanics.suspend`: the world is left for another dimension. The script, as it stands,
   * is saved into the level data, so coming back runs what was left of it.
   */
  suspend(script: string | null): void {
    this.lock();
    if (script !== null) {
      this.current.script = cleanString(script);
    }
    this.markVisited();
  }
  resetTriggers(): void {
    this.triggers = Array.from({ length: Data.LEVEL_WIDTH }, () =>
      Array.from({ length: Data.LEVEL_HEIGHT }, () => []),
    );
  }

  get levelCount(): number {
    return this.set.levels.length;
  }

  setLevelSet(set: LevelSet, id = 0): void {
    this.set = set;
    this.resetForNewGame();
    this.goto(id);
  }

  /** Forgets visits and level changes: a new game reads every level afresh. */
  resetForNewGame(): void {
    this.visited.clear();
    this.levels = [];
    this.fl_lock = true;
    this.fl_entered = false;
  }

  /** `SetManager.levels[id]`, read on first use. */
  getLevel(id: number): LevelData {
    return (this.levels[id] ??= this.unserialize(id));
  }

  /**
   * `GameMechanics.goto` + `SetManager.goto`. Visits are marked by `GameMode`. The IA map is
   * then parsed over the next frames (`GameMode.updateWorld`), and the level is shown when it
   * is done (`onDataReady`).
   */
  goto(id: number): boolean {
    this.teleporterList = [];
    if (id < 0 || id >= this.set.levels.length) return false;
    this.resetIA();
    this.current = this.getLevel(id);
    this.currentId = id;
    this.onReadComplete();
    return true;
  }

  /** `GameMechanics.onReadComplete`: the IA parse starts (the script engine is `GameMode`'s). */
  private onReadComplete(): void {
    this.fl_parsing = true;
  }

  /** `SetManager.isDataReady` + `GameMechanics.isDataReady` */
  isDataReady(): boolean {
    return this.flcurrentIA;
  }

  /** Reads a level: `SetManager.unserialize` (walls converted) + `GameMechanics.parseWalls`. */
  private unserialize(id: number): LevelData {
    let l = cloneLevel(this.set.levels[id]);
    if (this.fl_mirror) {
      l = LevelWorld.flip(l);
    }
    this.convertWalls(l);
    this.parseWalls(l);
    return l;
  }

  /**
   * `SetManager.flip`: the level mirrored for good. Only the map and the player's start move;
   * enemies, item slots and scripts keep their data and are flipped when placed
   * (`GameMode.flipCoordCase`), as the original's own flip of them is commented out.
   */
  private static flip(l: LevelData): LevelData {
    return {
      ...l,
      playerX: Data.LEVEL_WIDTH - l.playerX - 1,
      map: Array.from({ length: Data.LEVEL_WIDTH }, (_, x) =>
        Array.from({ length: Data.LEVEL_HEIGHT }, (_, y) => l.map[Data.LEVEL_WIDTH - x - 1][y]),
      ),
    };
  }

  /**
   * `SetManager.flipPortals`: in each row, the portals in reverse order, so a portal keeps its
   * id (its link in `portalLinks`) once the level is mirrored.
   */
  flipPortals(): void {
    const ylist: PortalData[][] = [];
    for (const p of this.portalList) {
      (ylist[p.cy] ??= []).push(p);
    }
    const list: PortalData[] = [];
    for (let y = 0; y < ylist.length; y++) {
      const row = ylist[y];
      if (row !== undefined) {
        for (let i = row.length - 1; i >= 0; i--) list.push(row[i]);
      }
    }
    this.portalList = list;
  }

  private convertWalls(l: LevelData): void {
    const map = l.map;
    for (let cy = 0; cy < Data.LEVEL_HEIGHT; cy++) {
      for (let cx = 0; cx < Data.LEVEL_WIDTH; cx++) {
        if (map[cx][cy] === Data.WALL) {
          map[cx][cy] = Data.GROUND;
        }
      }
    }
  }

  /** Default level data (`levels.Data` constructor). */
  private static emptyLevel(): LevelData {
    return {
      map: Array.from({ length: Data.LEVEL_WIDTH }, () =>
        new Array<number>(Data.LEVEL_HEIGHT).fill(0),
      ),
      badList: [],
      playerX: 0,
      playerY: 0,
      skinTiles: 1,
      skinBg: 1,
      specialSlots: [],
      scoreSlots: [],
      script: '',
    };
  }

  /** True when the level id is past the end of the set or holds nothing. */
  isEmptyLevel(id: number, flipCoordCase: ((cx: number) => number) | null): boolean {
    if (id >= this.set.levels.length) {
      return true;
    }
    const ld = this.getLevel(id);
    const def = LevelWorld.emptyLevel();
    const defX = flipCoordCase === null ? def.playerX : flipCoordCase(def.playerX);
    const defY = def.playerY;
    return (
      ld.playerX === defX &&
      ld.playerY === defY &&
      ld.skinBg === def.skinBg &&
      ld.skinTiles === def.skinTiles &&
      ld.badList.length === 0 &&
      ld.specialSlots.length === 0 &&
      ld.scoreSlots.length === 0
    );
  }

  inBound(cx: number, cy: number): boolean {
    return cx >= 0 && cx < Data.LEVEL_WIDTH && cy >= 0 && cy < Data.LEVEL_HEIGHT;
  }

  /** Port of `SetManager.getCase`. */
  getCase(cx: number, cy: number): number {
    const map = this.current.map;
    if (this.inBound(cx, cy)) {
      if (cy === 0) {
        // Tiles on the top row do not act as floors
        return map[cx][0] > 0 ? Data.WALL : 0;
      }
      return map[cx][cy]; // in the play area
    } else if (cy < 0) {
      // Above the screen: `$map[cx][0]` is undefined left and right of the level
      return (map[cx]?.[0] ?? 0) > 0 ? Data.WALL : 0;
    } else {
      return Data.OUT_WALL; // off screen, below, left or right
    }
  }

  /**
   * Changes a cell during play (`$e_add`, `$e_rem`). Clearing a tile turns the wall under it
   * into a floor. Only the `IA_TILE` flag follows: the rest of the IA map keeps the values parsed
   * when the level was read.
   */
  forceCase(cx: number, cy: number, t: number): void {
    // SetManager.forceCase
    if (this.inBound(cx, cy)) {
      if (t <= 0 && this.getCase(cx, cy) > 0 && this.getCase(cx, cy + 1) === Data.WALL) {
        this.forceCase(cx, cy + 1, Data.GROUND);
      }
      this.current.map[cx][cy] = t;
    }
    // GameMechanics.forceCase
    if (this.inBound(cx, cy)) {
      this.forceFlag(cx, cy, Data.IA_TILE, t === Data.GROUND);
    }
  }

  forceFlag(cx: number, cy: number, flag: number, value: boolean): void {
    if (value) {
      this.flagMap[cx][cy] |= flag;
    } else {
      this.flagMap[cx][cy] &= ~flag;
    }
  }

  /** True when the entity's bounding box is in the play area. */
  shapeInBound(e: { x: number; y: number; mc: { _width: number; _height: number } }): boolean {
    return (
      e.x >= -e.mc._width && e.x < Data.GAME_WIDTH && e.y >= -e.mc._height && e.y < Data.GAME_HEIGHT
    );
  }

  checkFlag(cx: number, cy: number, flag: number): boolean {
    if (!this.inBound(cx, cy)) return false;
    return ((this.flagMap[cx]?.[cy] ?? 0) & flag) !== 0;
  }

  /** Marks the cells under another tile as walls (`Data.WALL`). */
  private parseWalls(l: LevelData): void {
    const map = l.map;
    for (let cy = 0; cy < Data.LEVEL_HEIGHT; cy++) {
      for (let cx = 0; cx < Data.LEVEL_WIDTH; cx++) {
        if (map[cx][cy] > 0 && cy > 0 && map[cx][cy - 1] > 0) {
          map[cx][cy] = Data.WALL;
        }
      }
    }
  }

  /** `GameMechanics.resetIA` */
  resetIA(): void {
    this.flcurrentIA = false;
    this.iteration = { cx: 0, cy: 0 };
    this.flagMap = Array.from({ length: Data.LEVEL_WIDTH }, () =>
      new Array<number>(Data.LEVEL_HEIGHT).fill(0),
    );
    this.fallMap = Array.from({ length: Data.LEVEL_WIDTH }, () =>
      new Array<number>(Data.LEVEL_HEIGHT).fill(-1),
    );
  }

  /**
   * `GameMechanics.parseCurrentIA`: parses the next `MAX_ITERATION` cases of the IA map. Returns
   * true when the map is done (`onParseIAComplete`); the caller then checks `onDataReady`.
   */
  parseCurrentIA(): boolean {
    let n = 0;
    let cx = this.iteration.cx;
    let cy = this.iteration.cy;
    while (n < Data.MAX_ITERATION && cy < Data.LEVEL_HEIGHT) {
      this.parseCase(cx, cy);
      cx++;
      if (cx >= Data.LEVEL_WIDTH) {
        cx = 0;
        cy++;
      }
      n++;
    }
    this.iteration = { cx, cy };
    if (n !== Data.MAX_ITERATION) {
      this.fl_parsing = false;
      this.flcurrentIA = true;
      return true;
    }
    return false;
  }

  /** Parses the whole IA map at once (tools and tests). */
  parseAllIA(): void {
    this.resetIA();
    while (!this.parseCurrentIA()) {
      // next cases
    }
  }

  /** One case of `parseCurrentIA`. */
  private parseCase(cx: number, cy: number): void {
    let flags = 0;

    if (this.getCase(cx, cy + 1) === Data.GROUND) {
      flags |= Data.IA_TILE_TOP;
      if (
        this.getCase(cx, cy - Data.IA_VJUMP) === Data.GROUND &&
        this.getCase(cx, cy - Data.IA_VJUMP - 1) <= 0
      ) {
        flags |= Data.IA_JUMP_UP;
      }
    }

    if (this.getCase(cx, cy) === Data.GROUND && this.getCase(cx, cy - 1) <= 0) {
      flags |= Data.IA_TILE;
    }

    const fallH = this.checkSecureFall(cx, cy);
    this.fallMap[cx][cy] = fallH;
    if (fallH >= 0) flags |= Data.IA_ALLOW_FALL;

    if (this.getCase(cx, cy) === 0 && this.getCase(cx, cy + 1) === Data.GROUND) {
      if (this.checkSecureFall(cx, cy + 2) >= 0) {
        flags |= Data.IA_JUMP_DOWN;
      }
    }

    if (
      this.getCase(cx, cy + 1) === Data.GROUND &&
      (this.getCase(cx - 1, cy + 1) <= 0 || this.getCase(cx + 1, cy + 1) <= 0)
    ) {
      flags |= Data.IA_BORDER;
      if (
        this.getCase(cx - 1, cy + 1) !== Data.GROUND &&
        this.getCase(cx + 1, cy + 1) !== Data.GROUND
      ) {
        flags |= Data.IA_SMALL_SPOT;
      }
    }

    if (
      this.getCase(cx, cy + 1) <= 0 &&
      (this.getCase(cx - 1, cy + 1) === Data.GROUND || this.getCase(cx + 1, cy + 1) === Data.GROUND)
    ) {
      flags |= Data.IA_FALL_SPOT;
    }

    // Climbable walls & steps left / right
    if ((flags & Data.IA_TILE_TOP) !== 0) {
      let maxHeight = 1;
      for (let d = 1; d <= 5; d++) {
        if (this.getCase(cx, cy - d) <= 0) maxHeight++;
        else break;
      }
      if (this.getCase(cx - 1, cy) > 0) {
        const h = this.getWallHeight(cx - 1, cy, Data.IA_CLIMB);
        if (h !== null && h < maxHeight && cy - h >= 0) flags |= Data.IA_CLIMB_LEFT;
      }
      if (this.getCase(cx + 1, cy) > 0) {
        const h = this.getWallHeight(cx + 1, cy, Data.IA_CLIMB);
        if (h !== null && h < maxHeight && cy - h >= 0) flags |= Data.IA_CLIMB_RIGHT;
      }
    }

    if ((flags & Data.IA_FALL_SPOT) !== 0) {
      let maxHeight = 1;
      for (let d = 1; d <= 5; d++) {
        if (this.getCase(cx, cy - d) <= 0) maxHeight++;
        else {
          maxHeight += 2;
          break;
        }
      }
      if (this.getCase(cx + 1, cy + 1) === Data.GROUND) {
        const h = this.getStepHeight(cx, cy, Data.IA_CLIMB);
        if (
          h !== null &&
          h < maxHeight &&
          this.checkFlag(cx, cy - h, Data.IA_BORDER) &&
          this.checkFlag(cx + 1, cy - h, Data.IA_FALL_SPOT)
        ) {
          flags |= Data.IA_CLIMB_LEFT;
        }
      }
      if (this.getCase(cx - 1, cy + 1) === Data.GROUND) {
        const h = this.getStepHeight(cx, cy, Data.IA_CLIMB);
        if (
          h !== null &&
          h < maxHeight &&
          this.checkFlag(cx, cy - h, Data.IA_BORDER) &&
          this.checkFlag(cx - 1, cy - h, Data.IA_FALL_SPOT)
        ) {
          flags |= Data.IA_CLIMB_RIGHT;
        }
      }

      if (
        this.getCase(cx + 1, cy + 1) === Data.GROUND &&
        this.getCase(cx - Data.IA_HJUMP, cy + 1) === Data.GROUND &&
        this.getCase(cx - 1, cy) <= 0
      ) {
        flags |= Data.IA_JUMP_LEFT;
      }
      if (
        this.getCase(cx - 1, cy + 1) === Data.GROUND &&
        this.getCase(cx + Data.IA_HJUMP, cy + 1) === Data.GROUND &&
        this.getCase(cx + 1, cy) <= 0
      ) {
        flags |= Data.IA_JUMP_RIGHT;
      }
    }

    this.flagMap[cx][cy] = flags;
  }

  getWallHeight(cx: number, cy: number, max: number): number | null {
    let h = 0;
    while (this.getCase(cx, cy - h) > 0 && h < max) {
      h++;
    }
    return h >= max ? null : h;
  }

  getStepHeight(cx: number, cy: number, max: number): number | null {
    let h = 0;
    while (this.getCase(cx, cy - h) <= 0 && h < max) {
      h++;
    }
    h++;
    return h >= max ? null : h;
  }

  /** Returns the first floor met going down from a cell (wrapping to the top once). */
  getGround(cx: number, cy: number): { x: number; y: number } {
    for (let n = 0, ty = cy; n <= Data.LEVEL_HEIGHT; n++, ty++) {
      if (ty > 0 && this.getCase(cx, ty) === Data.GROUND) {
        return { x: cx, y: ty - 1 };
      }
      if (ty >= Data.LEVEL_HEIGHT) {
        ty = 0;
      }
    }
    return { x: cx, y: cy };
  }

  /** Fall height to the floor under a cell, or -1 over the void (`_checkSecureFall`). */
  private checkSecureFall(cx: number, cy: number): number {
    const map = this.current.map;
    if (map[cx][cy] === Data.GROUND) return -1;
    if (map[cx][cy] === Data.WALL) return -1;
    if (((this.flagMap[cx][cy - 1] ?? 0) & Data.IA_ALLOW_FALL) > 0) {
      return this.fallMap[cx][cy - 1] - 1;
    }

    let secure = false;
    let i = cy + 1;
    let h = 0;
    while (!secure && i < Data.LEVEL_HEIGHT && cx >= 0 && cx < Data.LEVEL_WIDTH) {
      if (map[cx][i] === Data.GROUND) {
        secure = true;
      } else {
        i++;
        h++;
      }
    }
    return secure ? h : -1;
  }

  getTeleporter(cx: number, cy: number): TeleporterData | null {
    if (this.getCase(cx, cy) !== Data.FIELD_TELEPORT) return null;
    for (const td of this.teleporterList) {
      if (td.dir === Data.HORIZONTAL && cx >= td.cx && cx < td.cx + td.length && cy === td.cy) {
        return td;
      }
      if (td.dir === Data.VERTICAL && cy >= td.cy && cy < td.cy + td.length && cx === td.cx) {
        return td;
      }
    }
    return null;
  }

  getNextTeleporter(
    start: TeleporterData,
    rand: Random,
  ): { td: TeleporterData; fl_rand: boolean } | null {
    // 1. Face-to-face match (same alignment, coordinate, and length)
    for (const td of this.teleporterList) {
      if (td.cx !== start.cx || td.cy !== start.cy) {
        if (
          start.dir === Data.HORIZONTAL &&
          td.dir === start.dir &&
          td.cx === start.cx &&
          td.length === start.length
        ) {
          return { td, fl_rand: false };
        }
        if (
          start.dir === Data.VERTICAL &&
          td.dir === start.dir &&
          td.cy === start.cy &&
          td.length === start.length
        ) {
          return { td, fl_rand: false };
        }
      }
    }

    // 2. Same direction and length
    const sameShape = this.teleporterList.filter(
      (td) =>
        (td.cx !== start.cx || td.cy !== start.cy) &&
        td.dir === start.dir &&
        td.length === start.length,
    );
    if (sameShape.length > 0) {
      return {
        td: sameShape[rand.random(sameShape.length)],
        fl_rand: sameShape.length > 1,
      };
    }

    // 3. Random fallback among any other teleporter
    const anyOther = this.teleporterList.filter((td) => td.cx !== start.cx || td.cy !== start.cy);
    if (anyOther.length === 0) return null;
    return {
      td: anyOther[rand.random(anyOther.length)],
      fl_rand: true,
    };
  }

  showField(td: TeleporterData): void {
    if (td.fl_on) return;
    td.fl_on = true;
    td.mc?.getClip('skin')?.getClip('sub')?.gotoAndStop('2');
    td.podA?.gotoAndStop('2');
    td.podB?.gotoAndStop('2');
  }

  hideField(td: TeleporterData): void {
    if (!td.fl_on) return;
    td.fl_on = false;
    td.mc?.getClip('skin')?.getClip('sub')?.gotoAndStop('1');
    td.podA?.gotoAndStop('1');
    td.podB?.gotoAndStop('1');
  }
}
