import { FillStyleType, ShapeRecordType } from 'swf-types';
import type {
  FrameAction,
  GradientStop,
  Matrix6,
  ShapeDef,
  ShapeDrawCmd,
  ShapeFill,
  ShapeStroke,
} from '../../src/engine/swf/types';

interface SwfColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface DirectedSeg {
  x0: number;
  y0: number;
  cx?: number;
  cy?: number;
  x1: number;
  y1: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function rgbaCss(c: SwfColor): string {
  const a = c.a === undefined ? 1 : round4(c.a / 255);
  return a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${a})`;
}

function fpVal(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'valueOf' in v)
    return Number((v as { valueOf(): number }).valueOf());
  return 0;
}

/** Converts an SWF Matrix to `[a, b, c, d, tx, ty]`, dividing translation by `transDiv`. */
export function convertMatrix(m: any, transDiv = 1): Matrix6 {
  if (!m) return [1, 0, 0, 1, 0, 0];
  return [
    round4(fpVal(m.scaleX ?? 1)),
    round4(fpVal(m.rotateSkew0 ?? 0)),
    round4(fpVal(m.rotateSkew1 ?? 0)),
    round4(fpVal(m.scaleY ?? 1)),
    round2((m.translateX ?? 0) / transDiv),
    round2((m.translateY ?? 0) / transDiv),
  ];
}

function convertFill(f: any, idOffset: number): ShapeFill {
  switch (f.type as FillStyleType) {
    case FillStyleType.Solid:
      return { t: 'solid', c: rgbaCss(f.color) };
    case FillStyleType.LinearGradient: {
      const stops: GradientStop[] = (f.gradient?.colors ?? []).map((s: any) => [
        round4((s.ratio ?? 0) / 255),
        rgbaCss(s.color),
      ]);
      return {
        t: 'linear',
        m: convertMatrix(f.matrix, 1),
        stops,
        ...(f.gradient?.spread ? { spread: f.gradient.spread } : {}),
      };
    }
    case FillStyleType.RadialGradient:
    case FillStyleType.FocalGradient: {
      const stops: GradientStop[] = (f.gradient?.colors ?? []).map((s: any) => [
        round4((s.ratio ?? 0) / 255),
        rgbaCss(s.color),
      ]);
      return {
        t: 'radial',
        m: convertMatrix(f.matrix, 1),
        stops,
        focal: f.focalPoint !== undefined ? round4(fpVal(f.focalPoint)) : 0,
        ...(f.gradient?.spread ? { spread: f.gradient.spread } : {}),
      };
    }
    case FillStyleType.Bitmap:
      return {
        t: 'bitmap',
        id: (f.bitmapId ?? 0) + idOffset,
        m: convertMatrix(f.matrix, 1),
        repeat: Boolean(f.repeating),
        smooth: f.smoothed !== false,
      };
    default:
      return { t: 'solid', c: 'rgba(0,0,0,0)' };
  }
}

function convertStroke(l: any, idOffset: number): ShapeStroke | null {
  const fill = l.fill
    ? convertFill(l.fill, idOffset)
    : l.color
      ? ({ t: 'solid', c: rgbaCss(l.color) } as ShapeFill)
      : null;
  if (!fill) return null;
  // Hairline strokes in SWF have width 0 -> 1 pixel (20 twips).
  const w = Math.max(20, l.width ?? 20);
  const capMap: CanvasLineCap[] = ['round', 'butt', 'square'];
  const joinType = l.join?.type ?? 0;
  const joinMap: CanvasLineJoin[] = ['round', 'bevel', 'miter'];
  return {
    w,
    cap: capMap[l.startCap ?? 0] ?? 'round',
    join: joinMap[joinType] ?? 'round',
    ...(l.join?.limit ? { miter: round2(fpVal(l.join.limit)) } : {}),
    fill,
  };
}

function stitchFillPath(segs: DirectedSeg[]): string {
  const byStart = new Map<string, number[]>();
  for (let i = 0; i < segs.length; i++) {
    const k = `${segs[i].x0},${segs[i].y0}`;
    let list = byStart.get(k);
    if (!list) {
      list = [];
      byStart.set(k, list);
    }
    list.push(i);
  }
  const used = new Uint8Array(segs.length);
  const parts: string[] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const first = segs[i];
    const sx = first.x0;
    const sy = first.y0;
    parts.push(`M${sx} ${sy}`);
    let cur = first;
    for (;;) {
      if (cur.cx !== undefined && cur.cy !== undefined) {
        parts.push(`Q${cur.cx} ${cur.cy} ${cur.x1} ${cur.y1}`);
      } else {
        parts.push(`L${cur.x1} ${cur.y1}`);
      }
      if (cur.x1 === sx && cur.y1 === sy) break;
      const list = byStart.get(`${cur.x1},${cur.y1}`);
      const nextIdx = list?.find((idx) => !used[idx]);
      if (nextIdx === undefined) break;
      used[nextIdx] = 1;
      cur = segs[nextIdx];
    }
    parts.push('Z');
  }
  return parts.join('');
}

function stitchStrokePath(segs: DirectedSeg[]): string {
  const parts: string[] = [];
  let lastX = NaN;
  let lastY = NaN;
  for (const s of segs) {
    if (s.x0 !== lastX || s.y0 !== lastY) {
      parts.push(`M${s.x0} ${s.y0}`);
    }
    if (s.cx !== undefined && s.cy !== undefined) {
      parts.push(`Q${s.cx} ${s.cy} ${s.x1} ${s.y1}`);
    } else {
      parts.push(`L${s.x1} ${s.y1}`);
    }
    lastX = s.x1;
    lastY = s.y1;
  }
  return parts.join('');
}

/**
 * Compiles a Flash `DefineShape` (or start-state `DefineMorphShape`) into
 * stitched closed fill contours and stroke paths in twip coordinates.
 */
export function compileSwfShape(tag: any, idOffset: number): ShapeDef {
  const b = tag.bounds ?? { xMin: 0, yMin: 0, xMax: 20, yMax: 20 };
  const evenodd = !tag.hasFillWinding;
  const cmds: ShapeDrawCmd[] = [];

  let fills: any[] = tag.shape?.initialStyles?.fill ?? [];
  let lines: any[] = tag.shape?.initialStyles?.line ?? [];
  let fillSegs = new Map<number, DirectedSeg[]>();
  let lineSegs = new Map<number, DirectedSeg[]>();

  const flush = () => {
    const fillKeys = [...fillSegs.keys()].sort((a, b) => a - b);
    for (const idx of fillKeys) {
      const style = fills[idx - 1];
      const segs = fillSegs.get(idx)!;
      if (!style || segs.length === 0) continue;
      const d = stitchFillPath(segs);
      if (d) cmds.push({ op: 'fill', fill: convertFill(style, idOffset), d, evenodd });
    }
    const lineKeys = [...lineSegs.keys()].sort((a, b) => a - b);
    for (const idx of lineKeys) {
      const style = lines[idx - 1];
      const segs = lineSegs.get(idx)!;
      if (!style || segs.length === 0) continue;
      const stroke = convertStroke(style, idOffset);
      if (!stroke) continue;
      const d = stitchStrokePath(segs);
      if (d) cmds.push({ op: 'stroke', stroke, d });
    }
    fillSegs = new Map();
    lineSegs = new Map();
  };

  let x = 0;
  let y = 0;
  let lf = 0;
  let rf = 0;
  let ls = 0;

  for (const r of tag.shape?.records ?? []) {
    if (r.type === ShapeRecordType.StyleChange) {
      if (r.newStyles) {
        flush();
        fills = r.newStyles.fill ?? [];
        lines = r.newStyles.line ?? [];
        lf = 0;
        rf = 0;
        ls = 0;
      }
      if (r.moveTo) {
        x = r.moveTo.x;
        y = r.moveTo.y;
      }
      if (r.leftFill !== undefined) lf = r.leftFill;
      if (r.rightFill !== undefined) rf = r.rightFill;
      if (r.lineStyle !== undefined) ls = r.lineStyle;
    } else {
      const x1 = x + r.delta.x;
      const y1 = y + r.delta.y;
      const hasCtrl = r.controlDelta !== undefined;
      const cx = hasCtrl ? x + r.controlDelta.x : undefined;
      const cy = hasCtrl ? y + r.controlDelta.y : undefined;
      if (x1 !== x || y1 !== y || hasCtrl) {
        if (rf > 0) {
          let arr = fillSegs.get(rf);
          if (!arr) {
            arr = [];
            fillSegs.set(rf, arr);
          }
          arr.push({ x0: x, y0: y, cx, cy, x1, y1 });
        }
        if (lf > 0) {
          let arr = fillSegs.get(lf);
          if (!arr) {
            arr = [];
            fillSegs.set(lf, arr);
          }
          // Reverse leftFill edge so interior is consistently on the right.
          arr.push({ x0: x1, y0: y1, cx, cy, x1: x, y1: y });
        }
        if (ls > 0) {
          let arr = lineSegs.get(ls);
          if (!arr) {
            arr = [];
            lineSegs.set(ls, arr);
          }
          arr.push({ x0: x, y0: y, cx, cy, x1, y1 });
        }
      }
      x = x1;
      y = y1;
    }
  }
  flush();

  return {
    kind: 'shape',
    bounds: [b.xMin, b.yMin, b.xMax, b.yMax],
    cmds,
  };
}

/** Bakes a `DefineText` tag using embedded `DefineFont` vector glyph outlines into a `ShapeDef`. */
export function compileStaticText(tag: any, fonts: Map<number, any>): ShapeDef {
  const b = tag.bounds ?? { xMin: 0, yMin: 0, xMax: 20, yMax: 20 };
  const [ma, mb, mc, md, mtx, mty] = convertMatrix(tag.matrix, 1);
  const txPt = (px: number, py: number): [number, number] => [
    Math.round(ma * px + mc * py + mtx),
    Math.round(mb * px + md * py + mty),
  ];

  const cmds: ShapeDrawCmd[] = [];
  let curX = 0;
  let curY = 0;
  let curFontId = 0;
  let curSize = 240;
  let curColor: SwfColor = { r: 255, g: 255, b: 255, a: 255 };

  for (const rec of tag.records ?? []) {
    if (rec.fontId !== undefined) curFontId = rec.fontId;
    if (rec.fontSize !== undefined) curSize = rec.fontSize;
    if (rec.color !== undefined) curColor = rec.color;
    if (rec.offsetX !== undefined) curX = rec.offsetX;
    if (rec.offsetY !== undefined) curY = rec.offsetY;

    const font = fonts.get(curFontId);
    const em = font?.emSquareSize || 1024;
    const scale = curSize / em;
    const segs: DirectedSeg[] = [];

    for (const entry of rec.entries ?? []) {
      const glyph = font?.glyphs?.[entry.index];
      if (glyph?.records?.length) {
        let gx = 0;
        let gy = 0;
        let lf = 0;
        let rf = 0;
        for (const r of glyph.records) {
          if (r.type === ShapeRecordType.StyleChange) {
            if (r.moveTo) {
              gx = r.moveTo.x;
              gy = r.moveTo.y;
            }
            if (r.leftFill !== undefined) lf = r.leftFill;
            if (r.rightFill !== undefined) rf = r.rightFill;
          } else {
            const gx1 = gx + r.delta.x;
            const gy1 = gy + r.delta.y;
            const [x0, y0] = txPt(curX + gx * scale, curY + gy * scale);
            const [x1, y1] = txPt(curX + gx1 * scale, curY + gy1 * scale);
            let cx: number | undefined;
            let cy: number | undefined;
            if (r.controlDelta) {
              [cx, cy] = txPt(
                curX + (gx + r.controlDelta.x) * scale,
                curY + (gy + r.controlDelta.y) * scale,
              );
            }
            if (x0 !== x1 || y0 !== y1 || cx !== undefined) {
              if (rf > 0) segs.push({ x0, y0, cx, cy, x1, y1 });
              if (lf > 0) segs.push({ x0: x1, y0: y1, cx, cy, x1: x0, y1: y0 });
            }
            gx = gx1;
            gy = gy1;
          }
        }
      }
      curX += entry.advance ?? 0;
    }

    if (segs.length > 0) {
      const d = stitchFillPath(segs);
      if (d)
        cmds.push({ op: 'fill', fill: { t: 'solid', c: rgbaCss(curColor) }, d, evenodd: true });
    }
  }

  return {
    kind: 'shape',
    bounds: [b.xMin, b.yMin, b.xMax, b.yMax],
    cmds,
  };
}

/** Extracts timeline control actions (`stop`, `play`, `gotoFrame`, `gotoLabel`, `removeSelf`) from AVM1 bytecode. */
export function parseFrameActions(raw: Uint8Array): FrameAction[] {
  const actions: FrameAction[] = [];
  const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);

  // Skip complex scripted MovieClips (ConstantPool 0x88 / DefineFunction 0x9b / 0x8e) except simple removeMovieClip.
  let hasComplexBranch = false;
  let i = 0;
  while (i < buf.length) {
    const op = buf[i++];
    if (op === 0x00) break;
    const len = op >= 0x80 ? buf.readUInt16LE(i) : 0;
    if (op >= 0x80) i += 2;
    const payloadStart = i;
    i += len;

    if (op === 0x9d || op === 0x99 || op === 0x8e || op === 0x9b) {
      hasComplexBranch = true;
    } else if (op === 0x07 && !hasComplexBranch) {
      actions.push({ op: 'stop' });
    } else if (op === 0x06 && !hasComplexBranch) {
      const prev = actions[actions.length - 1];
      if (prev && (prev.op === 'gotoFrame' || prev.op === 'gotoLabel')) {
        prev.play = true;
      } else {
        actions.push({ op: 'play' });
      }
    } else if (op === 0x81 && len >= 2 && !hasComplexBranch) {
      const frame0 = buf.readUInt16LE(payloadStart);
      actions.push({ op: 'gotoFrame', frame: frame0 + 1, play: false });
    } else if (op === 0x8c && len >= 1 && !hasComplexBranch) {
      const end = buf.indexOf(0, payloadStart);
      const label = buf.toString(
        'utf8',
        payloadStart,
        end > payloadStart ? end : payloadStart + len,
      );
      actions.push({ op: 'gotoLabel', label, play: false });
    }
  }

  if (!hasComplexBranch && buf.includes('removeMovieClip')) {
    actions.push({ op: 'removeSelf' });
  }
  return actions;
}
