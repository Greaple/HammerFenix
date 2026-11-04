import { DepthManager } from '../../engine/DepthManager';
import type { SwfMovieClip } from '../../engine/swf/SwfMovieClip';
import { Data } from '../Data';
import type { LevelData } from '../data/types';
import { LevelWorld, PortalData, TeleporterData } from './LevelWorld';

/**
 * Port of `levels.View` (`class/hammer/levels/View.mt`).
 *
 * Renders the level background (`hammer_bg`), horizontal tile platforms (`tile`
 * with `maskTile` stencil clipping + `endTile` endcaps + drop shadows),
 * vertical stone columns (`attachColumn`), energy fields (`field` + `hammer_pod`),
 * stone borders (`hammer_sides`), and scripted foreground/background decor MCs.
 */
export class LevelView {
  readonly world: LevelWorld;
  readonly depthMan: DepthManager;
  readonly xOffset = 10;

  viewX: number | null = null;
  viewY: number | null = null;
  fl_attach = false;
  fl_shadow = true;
  fl_hideTiles = false;
  fl_hideBorders = false;
  levelId: number | null = null;

  private data!: LevelData;
  private top: SwfMovieClip | null = null;
  private back: SwfMovieClip | null = null;
  private field: SwfMovieClip | null = null;
  private tiles: SwfMovieClip | null = null;
  private bg: SwfMovieClip | null = null;
  specialBg: SwfMovieClip | null = null;
  private leftBorder: SwfMovieClip | null = null;
  private rightBorder: SwfMovieClip | null = null;

  private topDm: DepthManager | null = null;
  private backDm: DepthManager | null = null;
  private fieldDm: DepthManager | null = null;

  private readonly spriteTop: SwfMovieClip;
  private readonly spriteBack: SwfMovieClip;
  private readonly spriteTopDm: DepthManager;
  private readonly spriteBackDm: DepthManager;

  private tileList: SwfMovieClip[] = [];
  private mcList: SwfMovieClip[] = [];
  private fieldMap: boolean[][] = [];

  constructor(world: LevelWorld, dm: DepthManager) {
    this.world = world;
    this.depthMan = dm;

    this.spriteTop = dm.empty(Data.DP_SPRITE_TOP_LAYER);
    this.spriteTop._x = -this.xOffset;
    this.spriteBack = dm.empty(Data.DP_SPRITE_BACK_LAYER);
    this.spriteBack._x = -this.xOffset;
    this.spriteTopDm = new DepthManager(this.spriteTop);
    this.spriteBackDm = new DepthManager(this.spriteBack);
  }

  static getTileSkinId(id: number): number {
    return id >= 100 ? id - Math.floor(id / 100) * 100 : id;
  }

  static getColumnSkinId(id: number): number {
    return id >= 100 ? Math.floor(id / 100) : id;
  }

  /** Shows a level of the world's set (`world.levels[id]`). */
  display(id: number): void {
    this.data = this.world.getLevel(id);
    this.levelId = id;
    this.attach();
  }

  displayCurrent(): void {
    this.display(this.world.currentId);
  }

  removeShadows(): void {
    this.fl_shadow = false;
  }

  private isWall(cx: number, cy: number): boolean {
    if (cy < 0 || cy >= Data.LEVEL_HEIGHT || cx < 0 || cx >= Data.LEVEL_WIDTH) return false;
    const map = this.data.map;
    return (
      (map[cx]?.[cy] ?? 0) > 0 && (map[cx - 1]?.[cy] ?? 0) <= 0 && (map[cx + 1]?.[cy] ?? 0) <= 0
    );
  }

  attach(): void {
    this.world.teleporterList = [];
    this.world.portalList = [];

    this.top = this.depthMan.empty(Data.DP_TOP_LAYER);
    this.field = this.depthMan.empty(Data.DP_FIELD_LAYER);
    this.back = this.depthMan.empty(Data.DP_BACK_LAYER);
    this.topDm = new DepthManager(this.top);
    this.fieldDm = new DepthManager(this.field);
    this.backDm = new DepthManager(this.back);

    this.top._x = this.xOffset;

    this.attachBg();

    this.tiles = this.backDm.empty(2);
    this.tiles._x = this.xOffset;
    this.tiles._visible = !this.fl_hideTiles;

    this.fieldMap = Array.from({ length: Data.LEVEL_WIDTH }, () =>
      new Array<boolean>(Data.LEVEL_HEIGHT).fill(false),
    );

    // Trace horizontal platforms & vertical 1-wide columns (exact port of View.attach)
    let startX = 0;
    let startY = 0;
    let tracing = false;

    for (let y = 0; y < Data.LEVEL_HEIGHT; y++) {
      for (let x = 0; x <= Data.LEVEL_WIDTH; x++) {
        const cell = x < Data.LEVEL_WIDTH ? (this.data.map[x]?.[y] ?? 0) : 0;
        if (!tracing && cell > 0) {
          startX = x;
          startY = y;
          tracing = true;
        }
        if (tracing && (cell <= 0 || x === Data.LEVEL_WIDTH)) {
          const wid = x - startX;
          if (wid === 1 && this.isWall(x - 1, y)) {
            const vtx = x - 1;
            let vty = y;
            let hei = 0;
            if (!this.isWall(vtx, vty - 1)) {
              while (this.isWall(vtx, vty)) {
                hei++;
                vty++;
              }
              if (hei === 1) {
                this.attachTile(startX, startY, 1, this.data.skinTiles);
              } else {
                this.attachColumn(startX, startY, hei, this.data.skinTiles);
              }
            }
          } else {
            this.attachTile(startX, startY, wid, this.data.skinTiles);
          }
          tracing = false;
        }
      }
    }

    // Energy fields (teleporters, portals, bumpers, peace fields, goals)
    for (let y = 0; y < Data.LEVEL_HEIGHT; y++) {
      for (let x = 0; x < Data.LEVEL_WIDTH; x++) {
        if ((this.data.map[x]?.[y] ?? 0) < 0 && !this.fieldMap[x][y]) {
          this.attachField(x, y);
        }
      }
    }

    // Left and right stone borders
    this.leftBorder = this.topDm.attach('hammer_sides', 2);
    this.leftBorder._x = 5;
    this.rightBorder = this.topDm.attach('hammer_sides', 2);
    this.rightBorder._x = Data.GAME_WIDTH + 15;
    this.leftBorder._visible = !this.fl_hideBorders;
    this.rightBorder._visible = !this.fl_hideBorders;

    // With a special background up, the level is drawn without its own background
    // (the original's Flash 8 path draws the back layer from `tileCache`).
    if (this.specialBg && this.bg) {
      this.bg._visible = false;
    }

    this.fl_attach = true;
  }

  private attachBg(): void {
    if (!this.backDm) return;
    this.bg?.removeMovieClip();
    this.bg = this.backDm.attach('hammer_bg', 0);
    this.bg._x = this.xOffset;
    this.bg.gotoAndStop(String(this.data.skinBg));
    if (this.world.fl_mirror) {
      this.bg._xscale *= -1;
      this.bg._x += Data.GAME_WIDTH;
    }
  }

  /**
   * Shows a special background (`hammer_special_bg`, frame `id + 1`) in place of the level's.
   * The original's Flash 8 path (`fl_cache`) swaps the cached back layer for one drawn without
   * `_bg`; hiding `_bg` (its other path) gives the same picture.
   */
  attachSpecialBg(id: number, subId: number | null): SwfMovieClip {
    this.specialBg = this.depthMan.attach('hammer_special_bg', Data.DP_SPECIAL_BG);
    this.specialBg.gotoAndStop(String(id + 1));

    if (subId !== null) {
      this.specialBg.getClip('sub')?.gotoAndStop(String(subId + 1));
    }
    if (this.bg) {
      this.bg._visible = false;
    }

    return this.specialBg;
  }

  /** Removes the current special background. */
  detachSpecialBg(): void {
    this.specialBg?.removeMovieClip();
    this.specialBg = null;
    if (this.bg) {
      this.bg._visible = true;
    }
  }

  private attachTile(sx: number, sy: number, wid: number, rawSkin: number): void {
    if (!this.tiles) return;
    const skin = LevelView.getTileSkinId(rawSkin);
    const tile = this.depthMan.lib.attach('tile');
    const depth = sy * Data.LEVEL_WIDTH + sx;
    tile.mcDepth = depth;
    tile.zIndex = depth;
    this.tiles.addChild(tile);

    tile._x = sx * Data.CASE_WIDTH;
    tile._y = sy * Data.CASE_HEIGHT;
    if (tile.maskTile) tile.maskTile._width = wid * Data.CASE_WIDTH;
    if (tile.endTile) {
      tile.endTile._x = wid * Data.CASE_WIDTH;
      tile.endTile.gotoAndStop(String(skin));
      if (!this.fl_shadow && tile.endTile.ombre) tile.endTile.ombre._visible = false;
    }
    tile.skin?.gotoAndStop(String(skin));
    if (!this.fl_shadow && tile.ombre) tile.ombre._visible = false;

    this.tileList.push(tile);
  }

  private attachColumn(sx: number, sy: number, hei: number, rawSkin: number): void {
    if (!this.tiles) return;
    const skin = LevelView.getColumnSkinId(rawSkin);
    const tile = this.depthMan.lib.attach('tile');
    const depth = sy * Data.LEVEL_WIDTH + sx;
    tile.mcDepth = depth;
    tile.zIndex = depth;
    this.tiles.addChild(tile);

    tile._yscale = -100;
    tile.rotationDeg = 90;
    tile._x = sx * Data.CASE_WIDTH;
    tile._y = sy * Data.CASE_HEIGHT;
    if (tile.maskTile) tile.maskTile._width = hei * Data.CASE_WIDTH;
    if (tile.endTile) {
      tile.endTile._x = hei * Data.CASE_WIDTH;
      tile.endTile.gotoAndStop(String(skin));
      if (!this.fl_shadow && tile.endTile.ombre) tile.endTile.ombre._visible = false;
    }
    tile.skin?.gotoAndStop(String(skin));
    if (!this.fl_shadow && tile.ombre) tile.ombre._visible = false;

    this.tileList.push(tile);
  }

  private attachField(sx: number, sy: number): void {
    if (!this.fieldDm) return;
    const id = this.data.map[sx][sy];
    const mc = this.fieldDm.attach('field', 1);
    mc._x = sx * Data.CASE_WIDTH;
    mc._y = sy * Data.CASE_HEIGHT;

    let flFlip = false;
    let td: TeleporterData | null = null;

    if ((this.data.map[sx + 1]?.[sy] ?? 0) === id) {
      // Horizontal field
      mc.gotoAndStop('2');
      let i = sx;
      while (i < Data.LEVEL_WIDTH && this.data.map[i][sy] === id) {
        this.fieldMap[i][sy] = true;
        i++;
      }
      if (id === Data.FIELD_TELEPORT) {
        td = new TeleporterData(sx, sy, i - sx, Data.HORIZONTAL);
        td.mc = mc;
      }
      mc._width = Data.CASE_WIDTH * (i - sx);
    } else if ((this.data.map[sx]?.[sy + 1] ?? 0) === id) {
      // Vertical field
      mc.gotoAndStop('1');
      let i = sy;
      while (i < Data.LEVEL_HEIGHT && this.data.map[sx][i] === id) {
        this.fieldMap[sx][i] = true;
        i++;
      }
      if (id === Data.FIELD_TELEPORT) {
        td = new TeleporterData(sx, sy, i - sy, Data.VERTICAL);
        td.mc = mc;
      }
      if (id === Data.FIELD_PORTAL && (this.data.map[sx + 1]?.[sy] ?? 0) > 0) {
        flFlip = true;
      }
      mc._height = Data.CASE_HEIGHT * (i - sy);
    } else {
      this.fieldMap[sx][sy] = true;
      mc.gotoAndStop('2');
      mc._width = Data.CASE_WIDTH;
    }

    const skinClip = mc.getClip('skin');
    skinClip?.gotoAndStop(String(Math.abs(id)));
    const subClip = skinClip?.getClip('sub');
    subClip?.stop();
    if (flFlip && subClip) {
      subClip._xscale *= -1;
    }

    if (id === Data.FIELD_TELEPORT && td) {
      td.podA = this.fieldDm.attach('hammer_pod', Data.DP_INTERF);
      td.podA._x = td.startX;
      td.podA._y = td.startY;
      td.podA.stop();

      td.podB = this.fieldDm.attach('hammer_pod', Data.DP_INTERF);
      td.podB._x = td.endX;
      td.podB._y = td.endY;
      td.podB.rotationDeg = 180;
      td.podB.stop();

      td.mc?.stop();
      if (td.dir === Data.HORIZONTAL) {
        td.podA._y -= Data.CASE_HEIGHT * 0.5;
        td.podB._y -= Data.CASE_HEIGHT * 0.5;
      } else {
        td.podA.rotationDeg += 90;
        td.podB.rotationDeg += 90;
      }
      this.world.teleporterList.push(td);
    }

    if (id === Data.FIELD_PORTAL) {
      this.world.portalList.push(new PortalData(mc, sx, sy));
    }
  }

  /** Attaches a static or animated decor sprite (`ScriptEngine` `$e_mc`). */
  attachSprite(link: string, x: number, y: number, flBack: boolean): SwfMovieClip {
    const dm = flBack ? this.spriteBackDm : this.spriteTopDm;
    const mc = dm.attach(link, 10);
    mc._x = x;
    mc._y = y;
    this.mcList.push(mc);
    return mc;
  }

  detachLevel(): void {
    for (const t of this.tileList) t.removeMovieClip();
    this.tileList = [];
    this.top?.removeMovieClip();
    this.back?.removeMovieClip();
    this.field?.removeMovieClip();
    this.top = null;
    this.back = null;
    this.field = null;
  }

  detachSprites(): void {
    for (const m of this.mcList) m.removeMovieClip();
    this.mcList = [];
    this.spriteBackDm.destroy();
    this.spriteTopDm.destroy();
  }

  detach(): void {
    this.detachLevel();
    this.detachSprites();
    this.fl_attach = false;
  }

  /** Moves the level to a given point. */
  moveTo(x: number, y: number): void {
    this.viewX = x;
    this.viewY = y;
    if (!this.top || !this.back || !this.field) return;
    this.top._x = x - this.xOffset;
    this.top._y = y;
    this.back._x = this.top._x;
    this.back._y = this.top._y;
    this.field._x = this.top._x + this.xOffset;
    this.field._y = this.top._y;
    this.spriteBack._x = this.top._x;
    this.spriteBack._y = this.top._y;
    this.spriteTop._x = this.top._x;
    this.spriteTop._y = this.top._y;
  }

  /** Puts the view back in place. */
  moveToPreviousPos(): void {
    if (this.viewX !== null && this.viewY !== null) {
      this.moveTo(this.viewX, this.viewY);
    } else {
      this.moveTo(0, 0);
    }
  }

  destroy(): void {
    this.detach();
    // Port only: the special background sits on the game's depth manager, which the original
    // drops whole with its game; `changeSet` here destroys the view before the effects clear.
    this.specialBg?.removeMovieClip();
    this.specialBg = null;
    this.spriteBack.removeMovieClip();
    this.spriteTop.removeMovieClip();
  }
}
