import { CanvasSource, Container, ImageSource, Sprite, Texture } from 'pixi.js';
import { ShapeRasterizer } from './ShapeRasterizer';
import { SwfMovieClip, SwfTextField } from './SwfMovieClip';
import type { BitmapDef, CharacterDef, Matrix6, SwfLibraryData } from './types';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load bitmap ${url}`));
    img.src = url;
  });
}

async function decodeBitmapAsset(
  baseUrl: string,
  def: BitmapDef,
): Promise<HTMLCanvasElement | HTMLImageElement> {
  if (!def.alphaFile) {
    return loadImage(`${baseUrl}gfx/bitmaps/${def.file}`);
  }
  const [rgb, alpha] = await Promise.all([
    loadImage(`${baseUrl}gfx/bitmaps/${def.file}`),
    loadImage(`${baseUrl}gfx/bitmaps/${def.alphaFile}`),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = def.w;
  canvas.height = def.h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(rgb, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(alpha, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Runtime symbol library loaded from `public/gfx/library.json`.
 * Manages bitmap textures, lazy HiDPI vector rasterization, and MovieClip instantiation.
 */
export class SwfLibrary {
  readonly data: SwfLibraryData;
  /**
   * No bitmaps, no rasterized shapes, no filters: clips keep their timelines, names, scripts and
   * vector bounds. Used to run the game in Node (replay tests).
   */
  readonly headless: boolean;
  /** Random source of frame scripts (`random(n)`). The game session seeds it. */
  random: () => number = Math.random;
  private readonly bitmaps: Map<number, HTMLCanvasElement | HTMLImageElement>;
  private readonly bitmapTextures = new Map<number, Texture>();
  private readonly rasterizer: ShapeRasterizer;
  private readonly boundsCache = new Map<number, [number, number, number, number]>();

  private constructor(
    data: SwfLibraryData,
    bitmaps: Map<number, HTMLCanvasElement | HTMLImageElement>,
    headless = false,
  ) {
    this.data = data;
    this.bitmaps = bitmaps;
    this.headless = headless;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.rasterizer = new ShapeRasterizer(bitmaps, Math.min(3, Math.max(2, Math.ceil(dpr))));
  }

  static async load(
    baseUrl = './',
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<SwfLibrary> {
    const res = await fetch(`${baseUrl}gfx/library.json`);
    if (!res.ok) throw new Error(`Failed to load SWF library (${res.status})`);
    const data = (await res.json()) as SwfLibraryData;

    const bmpEntries: [number, BitmapDef][] = [];
    for (const [idStr, def] of Object.entries(data.characters)) {
      if (def.kind === 'bitmap') bmpEntries.push([Number(idStr), def]);
    }

    const bitmaps = new Map<number, HTMLCanvasElement | HTMLImageElement>();
    let done = 0;
    const total = bmpEntries.length;
    onProgress?.(0, total);

    // Load in batches of 32 to avoid saturating connections while staying fast.
    const batchSize = 32;
    for (let i = 0; i < bmpEntries.length; i += batchSize) {
      const slice = bmpEntries.slice(i, i + batchSize);
      await Promise.all(
        slice.map(async ([id, def]) => {
          const surface = await decodeBitmapAsset(baseUrl, def);
          bitmaps.set(id, surface);
          done++;
          onProgress?.(done, total);
        }),
      );
    }

    return new SwfLibrary(data, bitmaps);
  }

  /** A library that never renders, for running the game outside a browser. */
  static headless(data: SwfLibraryData): SwfLibrary {
    return new SwfLibrary(data, new Map(), true);
  }

  hasSymbol(name: string): boolean {
    const clean = name.startsWith('$') ? name.slice(1) : name;
    return this.data.exports[name] !== undefined || this.data.exports[clean] !== undefined;
  }

  listExports(): string[] {
    // Filter out duplicate aliases where both `$foo` and `foo` exist.
    const raw = Object.keys(this.data.exports);
    const set = new Set(raw);
    return raw.filter((k) => !(k.startsWith('$') && set.has(k.slice(1)))).sort();
  }

  createEmptyClip(): SwfMovieClip {
    return new SwfMovieClip(this);
  }

  /** Instantiates an exported symbol by linkage name (e.g. `"hammer_player"`, `"tile"`). */
  attach(linkageName: string): SwfMovieClip {
    const id =
      this.data.exports[linkageName] ??
      (linkageName.startsWith('$')
        ? this.data.exports[linkageName.slice(1)]
        : this.data.exports['$' + linkageName]);

    if (id === undefined) {
      return this.createEmptyClip();
    }

    const def = this.data.characters[id];
    if (!def) return this.createEmptyClip();

    if (def.kind === 'sprite') {
      const mc = new SwfMovieClip(this, def);
      mc.mcName = linkageName;
      return mc;
    }

    // Wrap standalone exported shapes/bitmaps/texts in a 1-frame MovieClip.
    const wrapper: CharacterDef = {
      kind: 'sprite',
      frameCount: 1,
      frames: [{ cmds: [{ op: 'place', d: 1, id }] }],
    };
    const mc = new SwfMovieClip(this, wrapper);
    mc.mcName = linkageName;
    return mc;
  }

  /** Internal helper used by `SwfMovieClip` to instantiate child characters. */
  instantiateCharacter(id: number): Container | null {
    const def = this.data.characters[id];
    if (!def) return null;

    switch (def.kind) {
      case 'sprite':
        return new SwfMovieClip(this, def);
      case 'shape': {
        if (this.headless) return new Container();
        const ras = this.rasterizer.get(id, def);
        const container = new Container();
        const sp = new Sprite(ras.texture);
        sp.position.set(ras.offsetX, ras.offsetY);
        container.addChild(sp);
        return container;
      }
      case 'bitmap': {
        if (this.headless) return new Container();
        const tex = this.getBitmapTexture(id, def);
        return tex ? new Sprite(tex) : null;
      }
      case 'text':
        return new SwfTextField(def, this.headless);
    }
  }

  /** Computes exact unpadded `[xMin, yMin, width, height]` in pixels for `clipDepth` stencil masks. */
  getCharacterBounds(id: number, depth = 0): [number, number, number, number] {
    const cached = this.boundsCache.get(id);
    if (cached) return cached;
    if (depth > 8) return [0, 0, 20, 20];

    const def = this.data.characters[id];
    let result: [number, number, number, number] = [0, 0, 20, 20];

    if (def?.kind === 'shape') {
      const [x0, y0, x1, y1] = def.bounds;
      result = [x0 / 20, y0 / 20, Math.max(0.1, (x1 - x0) / 20), Math.max(0.1, (y1 - y0) / 20)];
    } else if (def?.kind === 'bitmap') {
      result = [0, 0, def.w, def.h];
    } else if (def?.kind === 'text') {
      const [x0, y0, x1, y1] = def.bounds;
      result = [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
    } else if (def?.kind === 'sprite') {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const cmd of def.frames[0]?.cmds ?? []) {
        if (cmd.op !== 'place' || cmd.id === undefined) continue;
        const [cx, cy, cw, ch] = this.getCharacterBounds(cmd.id, depth + 1);
        const m: Matrix6 = cmd.m ?? [1, 0, 0, 1, 0, 0];
        const corners: [number, number][] = [
          [cx, cy],
          [cx + cw, cy],
          [cx + cw, cy + ch],
          [cx, cy + ch],
        ];
        for (const [px, py] of corners) {
          const tx = m[0] * px + m[2] * py + m[4];
          const ty = m[1] * px + m[3] * py + m[5];
          if (tx < minX) minX = tx;
          if (ty < minY) minY = ty;
          if (tx > maxX) maxX = tx;
          if (ty > maxY) maxY = ty;
        }
      }
      if (Number.isFinite(minX)) {
        result = [minX, minY, Math.max(0.1, maxX - minX), Math.max(0.1, maxY - minY)];
      }
    }

    this.boundsCache.set(id, result);
    return result;
  }

  private getBitmapTexture(id: number, def: BitmapDef): Texture | null {
    const existing = this.bitmapTextures.get(id);
    if (existing) return existing;
    const surface = this.bitmaps.get(id);
    if (!surface) return null;
    const source =
      surface instanceof HTMLCanvasElement
        ? new CanvasSource({ resource: surface })
        : new ImageSource({ resource: surface });
    void def;
    const tex = new Texture({ source });
    this.bitmapTextures.set(id, tex);
    return tex;
  }

  destroy(): void {
    this.rasterizer.destroy();
    for (const t of this.bitmapTextures.values()) t.destroy(true);
    this.bitmapTextures.clear();
  }
}
