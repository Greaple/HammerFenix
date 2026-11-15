import { CanvasSource, Texture } from 'pixi.js';
import type { Matrix6, ShapeDef, ShapeFill } from './types';

export interface RasterizedShape {
  texture: Texture;
  /** Offset in pixels where the sprite's top-left sits in shape space. */
  offsetX: number;
  offsetY: number;
  /** Exact unpadded Flash bounds `[xMin, yMin, width, height]` in pixels. */
  naturalBounds: [number, number, number, number];
}

function invertMatrix([a, b, c, d, tx, ty]: Matrix6): Matrix6 | null {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  const ia = d * inv;
  const ib = -b * inv;
  const ic = -c * inv;
  const id = a * inv;
  return [ia, ib, ic, id, -(ia * tx + ic * ty), -(ib * tx + id * ty)];
}

function transformBounds(
  m: Matrix6,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number, number] {
  const [a, b, c, d, tx, ty] = m;
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of corners) {
    const gx = a * px + c * py + tx;
    const gy = b * px + d * py + ty;
    if (gx < minX) minX = gx;
    if (gy < minY) minY = gy;
    if (gx > maxX) maxX = gx;
    if (gy > maxY) maxY = gy;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Rasterizes compiled SWF vector shapes onto HiDPI canvases and caches them
 * as GPU `PIXI.Texture` instances.
 */
export class ShapeRasterizer {
  private readonly cache = new Map<number, RasterizedShape>();
  private readonly bitmaps: ReadonlyMap<number, HTMLCanvasElement | HTMLImageElement>;
  private readonly baseResolution: number;
  /** Bitmaps loaded bigger than their SWF size (an HD set), by id: how many times. */
  private readonly bitmapScales: ReadonlyMap<number, number>;

  constructor(
    bitmaps: ReadonlyMap<number, HTMLCanvasElement | HTMLImageElement>,
    baseResolution = 2,
    bitmapScales: ReadonlyMap<number, number> = new Map(),
  ) {
    this.bitmaps = bitmaps;
    this.baseResolution = baseResolution;
    this.bitmapScales = bitmapScales;
  }

  /**
   * A bitmap fill's pattern: the SWF's matrix maps the bitmap's own pixels, so an HD bitmap
   * (`k` times bigger) is first scaled down by `k`. Smoothed then, as it was made to be.
   */
  private pattern(
    ctx: CanvasRenderingContext2D,
    fill: { id: number; m: Matrix6; repeat: boolean },
  ): { pattern: CanvasPattern; hd: boolean } | null {
    const img = this.bitmaps.get(fill.id);
    const pat = img ? ctx.createPattern(img, fill.repeat ? 'repeat' : 'no-repeat') : null;
    if (!pat) return null;
    const k = this.bitmapScales.get(fill.id) ?? 1;
    const [a, b, c, d, tx, ty] = fill.m;
    pat.setTransform(new DOMMatrix(k === 1 ? fill.m : [a / k, b / k, c / k, d / k, tx, ty]));
    return { pattern: pat, hd: k > 1 };
  }

  get(id: number, def: ShapeDef): RasterizedShape {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const [bx0, by0, bx1, by1] = def.bounds;
    const naturalBounds: [number, number, number, number] = [
      bx0 / 20,
      by0 / 20,
      Math.max(0.05, (bx1 - bx0) / 20),
      Math.max(0.05, (by1 - by0) / 20),
    ];

    // 1 px (20 twips) anti-aliasing margin so edge strokes aren't clipped.
    const pad = 20;
    const x0 = bx0 - pad;
    const y0 = by0 - pad;
    const x1 = bx1 + pad;
    const y1 = by1 + pad;
    const wPx = Math.max(1, Math.ceil((x1 - x0) / 20));
    const hPx = Math.max(1, Math.ceil((y1 - y0) / 20));

    // Canvas size cap: 2048, or 4096 at resolution 4 (an HD set on a big screen, where a
    // level background, 420 x 500, needs 1680 x 2000)
    const maxDim = Math.max(wPx, hPx);
    const cap = this.baseResolution >= 4 ? 4096 : 2048;
    const res =
      maxDim * this.baseResolution > cap
        ? Math.max(1, Math.floor(cap / maxDim))
        : this.baseResolution;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(wPx * res));
    canvas.height = Math.max(1, Math.ceil(hPx * res));
    const ctx = canvas.getContext('2d');

    if (ctx && def.cmds.length > 0) {
      ctx.save();
      ctx.scale(res / 20, res / 20);
      ctx.translate(-x0, -y0);

      for (const cmd of def.cmds) {
        const path = new Path2D(cmd.d);
        if (cmd.op === 'fill') {
          this.applyFill(ctx, path, cmd.fill, cmd.evenodd ? 'evenodd' : 'nonzero', x0, y0, x1, y1);
        } else {
          ctx.save();
          ctx.lineWidth = cmd.stroke.w;
          ctx.lineCap = cmd.stroke.cap;
          ctx.lineJoin = cmd.stroke.join;
          if (cmd.stroke.miter !== undefined) ctx.miterLimit = cmd.stroke.miter;
          const sf = cmd.stroke.fill;
          if (sf.t === 'solid') {
            ctx.strokeStyle = sf.c;
            ctx.stroke(path);
          } else if (sf.t === 'bitmap') {
            const pat = this.pattern(ctx, sf);
            if (pat) {
              ctx.strokeStyle = pat.pattern;
              ctx.stroke(path);
            }
          } else {
            // Gradient stroke fallback: use mid stop color
            ctx.strokeStyle = sf.stops[0]?.[1] ?? '#fff';
            ctx.stroke(path);
          }
          ctx.restore();
        }
      }
      ctx.restore();
    }

    const texture = new Texture({
      source: new CanvasSource({
        resource: canvas,
        resolution: res,
        scaleMode: 'linear',
      }),
    });

    const entry: RasterizedShape = {
      texture,
      offsetX: x0 / 20,
      offsetY: y0 / 20,
      naturalBounds,
    };
    this.cache.set(id, entry);
    return entry;
  }

  private applyFill(
    ctx: CanvasRenderingContext2D,
    path: Path2D,
    fill: ShapeFill,
    rule: CanvasFillRule,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    if (fill.t === 'solid') {
      ctx.fillStyle = fill.c;
      ctx.fill(path, rule);
      return;
    }

    if (fill.t === 'bitmap') {
      const pat = this.pattern(ctx, fill);
      if (!pat) return;
      ctx.save();
      ctx.imageSmoothingEnabled = fill.smooth || pat.hd;
      ctx.fillStyle = pat.pattern;
      ctx.fill(path, rule);
      ctx.restore();
      return;
    }

    // Linear or radial/focal gradient in canonical [-16384..16384] gradient space.
    const inv = invertMatrix(fill.m);
    if (!inv) return;
    const [gx0, gy0, gx1, gy1] = transformBounds(inv, x0, y0, x1, y1);

    ctx.save();
    ctx.clip(path, rule);
    const [a, b, c, d, tx, ty] = fill.m;
    ctx.transform(a, b, c, d, tx, ty);

    let grad: CanvasGradient;
    if (fill.t === 'linear') {
      grad = ctx.createLinearGradient(-16384, 0, 16384, 0);
    } else {
      const fx = Math.max(-0.99, Math.min(0.99, fill.focal)) * 16384;
      grad = ctx.createRadialGradient(fx, 0, 0, 0, 0, 16384);
    }
    for (const [stop, color] of fill.stops) {
      grad.addColorStop(Math.max(0, Math.min(1, stop)), color);
    }
    ctx.fillStyle = grad;
    const margin = 256;
    ctx.fillRect(gx0 - margin, gy0 - margin, gx1 - gx0 + margin * 2, gy1 - gy0 + margin * 2);
    ctx.restore();
  }

  destroy(): void {
    for (const r of this.cache.values()) r.texture.destroy(true);
    this.cache.clear();
  }
}
