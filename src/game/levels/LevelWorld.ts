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
 * Port of `levels.SetManager` + `levels.GameMechanics`:
 * manages the active level's mutable cell map, `parseWalls` (`GROUND` vs `WALL`),
 * AI navigation flags (`flagMap`, `fallMap`), teleporters, and portals.
 */
export class LevelWorld {
  set: LevelSet;
  currentId = 0;
  current!: LevelData;
  fl_mirror = false;
  fl_mainWorld = true;
  darknessFactor = 0;

  flagMap: number[][] = [];
  fallMap: number[][] = [];
  triggers: unknown[][][] = [];
  teleporterList: TeleporterData[] = [];
  portalList: PortalData[] = [];
  readonly visited = new Set<number>();
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
    this.fl_entered = false;
  }

  goto(id: number): boolean {
    if (id < 0 || id >= this.set.levels.length) return false;
    this.currentId = id;
    this.levels[id] ??= cloneLevel(this.set.levels[id]);
    this.current = this.levels[id];
    this.teleporterList = [];
    this.portalList = [];
    this.resetTriggers();
    this.parseWalls(this.current);
    this.rebuildIA();
    return true;
  }

  inBound(cx: number, cy: number): boolean {
    return cx >= 0 && cx < Data.LEVEL_WIDTH && cy >= 0 && cy < Data.LEVEL_HEIGHT;
  }

  /** Port of `SetManager.getCase`. */
  getCase(cx: number, cy: number): number {
    if (cx < 0 || cx >= Data.LEVEL_WIDTH) {
      return Data.OUT_WALL;
    }
    if (cy < 0) {
      return (this.current.map[cx]?.[0] ?? 0) > 0 ? Data.WALL : 0;
    }
    if (cy >= Data.LEVEL_HEIGHT) {
      return Data.OUT_WALL;
    }
    if (cy === 0) {
      return this.current.map[cx][0] > 0 ? Data.WALL : 0;
    }
    return this.current.map[cx][cy] ?? 0;
  }

  /** Dynamically mutates a map cell (used by level scripts `$e_add` / `$e_rem`). */
  forceCase(cx: number, cy: number, value: number): void {
    if (!this.inBound(cx, cy)) return;
    this.current.map[cx][cy] = value;
    this.parseWalls(this.current);
    this.rebuildIA();
  }

  checkFlag(cx: number, cy: number, flag: number): boolean {
    if (!this.inBound(cx, cy)) return false;
    return ((this.flagMap[cx]?.[cy] ?? 0) & flag) !== 0;
  }

  /** Marks cells with another solid cell directly above them as `Data.WALL` (`2`). */
  private parseWalls(level: LevelData): void {
    const map = level.map;
    for (let cx = 0; cx < Data.LEVEL_WIDTH; cx++) {
      for (let cy = 0; cy < Data.LEVEL_HEIGHT; cy++) {
        if (map[cx][cy] > 0) {
          map[cx][cy] = cy > 0 && map[cx][cy - 1] > 0 ? Data.WALL : Data.GROUND;
        }
      }
    }
  }

  /** Synchronous port of `GameMechanics.parseCurrentIA`. */
  rebuildIA(): void {
    this.flagMap = Array.from({ length: Data.LEVEL_WIDTH }, () =>
      new Array<number>(Data.LEVEL_HEIGHT).fill(0),
    );
    this.fallMap = Array.from({ length: Data.LEVEL_WIDTH }, () =>
      new Array<number>(Data.LEVEL_HEIGHT).fill(-1),
    );

    for (let cy = 0; cy < Data.LEVEL_HEIGHT; cy++) {
      for (let cx = 0; cx < Data.LEVEL_WIDTH; cx++) {
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
          (this.getCase(cx - 1, cy + 1) === Data.GROUND ||
            this.getCase(cx + 1, cy + 1) === Data.GROUND)
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
    }
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

  /** Finds a valid ground-top cell near `(cx, cy)` (port of `SetManager.getGround`). */
  getGround(cx: number, cy: number): { x: number; y: number } {
    const startX = Math.max(0, Math.min(Data.LEVEL_WIDTH - 1, cx));
    const startY = Math.max(0, Math.min(Data.LEVEL_HEIGHT - 2, cy));
    for (let dy = 0; dy < Data.LEVEL_HEIGHT; dy++) {
      const y = (startY + dy) % (Data.LEVEL_HEIGHT - 1);
      for (let dx = 0; dx < Data.LEVEL_WIDTH; dx++) {
        const x = (startX + dx) % Data.LEVEL_WIDTH;
        if (this.getCase(x, y) <= 0 && this.getCase(x, y + 1) === Data.GROUND) {
          return { x, y };
        }
      }
    }
    return { x: startX, y: startY };
  }

  private checkSecureFall(cx: number, cy: number): number {
    if (this.getCase(cx, cy) > 0) return -1;
    let h = 0;
    let y = cy;
    while (y < Data.LEVEL_HEIGHT) {
      const c = this.getCase(cx, y);
      if (c === Data.GROUND) return h;
      if (c > 0) return -1;
      h++;
      y++;
    }
    return -1;
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
