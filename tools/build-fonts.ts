/**
 * Writes the fonts embedded in the game's SWF (`DefineFont3` glyph outlines of `_gfx.swf`) as
 * OpenType files in `public/fonts/`, so the browser draws the game's texts in its own fonts
 * instead of a fallback (Arial Black). Flash drew these fields with the embedded outlines; the
 * port's text fields (`SwfMovieClip`) and site screens (`Shell`) name the same families, and
 * `src/engine/Fonts.ts` registers the files under those names.
 *
 * Only the fonts with outlines are written, the fullest one per family: Franklin Gothic Heavy
 * (484 glyphs, accents included), Satans (ASCII only) and Impact. Verdana and Arial were device
 * fonts in the original, without outlines.
 *
 * Usage: `npx tsx tools/build-fonts.ts` (part of `npm run assets`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { parseSwf } from 'swf-parser';
import { ShapeRecordType } from 'swf-types';

const ROOT = join(import.meta.dirname, '..');
const SWF = join(ROOT, 'assets-src/original/swf/_gfx.swf');
const OUT = join(ROOT, 'public/fonts');

/** The families written, and their file names. */
export const FONT_FILES: Record<string, string> = {
  'Franklin Gothic Heavy': 'franklin-gothic-heavy.otf',
  Satans: 'satans.otf',
  Impact: 'impact.otf',
};

/** Units per em of the files: DefineFont3 outlines use 20480, divided by 20. */
const UPM = 1024;

interface Seg {
  x0: number;
  y0: number;
  cx?: number;
  cy?: number;
  x1: number;
  y1: number;
}

/**
 * The glyph's edges as closed contours, each edge directed so its fill is on the right (in the
 * SWF's y-down space), as `stitchFillPath` in `tools/lib/swfShapes.ts` does for static texts.
 */
function glyphPath(glyph: any, scale: number): opentype.Path {
  const segs: Seg[] = [];
  let x = 0;
  let y = 0;
  let lf = 0;
  let rf = 0;
  const p = (v: number) => Math.round(v * scale);
  for (const r of glyph?.records ?? []) {
    if (r.type === ShapeRecordType.StyleChange) {
      if (r.moveTo) {
        x = r.moveTo.x;
        y = r.moveTo.y;
      }
      if (r.leftFill !== undefined) lf = r.leftFill;
      if (r.rightFill !== undefined) rf = r.rightFill;
      continue;
    }
    const x1 = x + r.delta.x;
    const y1 = y + r.delta.y;
    const s: Seg = { x0: p(x), y0: p(y), x1: p(x1), y1: p(y1) };
    if (r.controlDelta) {
      s.cx = p(x + r.controlDelta.x);
      s.cy = p(y + r.controlDelta.y);
    }
    if (s.x0 !== s.x1 || s.y0 !== s.y1 || s.cx !== undefined) {
      if (rf > 0) segs.push(s);
      if (lf > 0) segs.push({ x0: s.x1, y0: s.y1, cx: s.cx, cy: s.cy, x1: s.x0, y1: s.y0 });
    }
    x = x1;
    y = y1;
  }

  // Chain the edges into contours. OpenType's y axis points up: flip.
  const byStart = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const k = `${s.x0},${s.y0}`;
    byStart.set(k, [...(byStart.get(k) ?? []), i]);
  });
  const used = new Uint8Array(segs.length);
  const path = new opentype.Path();
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let cur = segs[i];
    path.moveTo(cur.x0, -cur.y0);
    for (;;) {
      if (cur.cx !== undefined && cur.cy !== undefined) {
        path.quadTo(cur.cx, -cur.cy, cur.x1, -cur.y1);
      } else {
        path.lineTo(cur.x1, -cur.y1);
      }
      if (cur.x1 === segs[i].x0 && cur.y1 === segs[i].y0) break;
      const next = byStart.get(`${cur.x1},${cur.y1}`)?.find((n) => !used[n]);
      if (next === undefined) break;
      used[next] = 1;
      cur = segs[next];
    }
    path.close();
  }
  return path;
}

type Cmd = opentype.PathCommand;

interface GlyphData {
  advance: number;
  cmds: Cmd[];
}

/** Applies `f` to every point of `cmds`. */
function mapCmds(cmds: Cmd[], f: (x: number, y: number) => [number, number]): Cmd[] {
  return cmds.map((c) => {
    const o: any = { ...c };
    if ('x' in c) [o.x, o.y] = f(c.x, c.y).map(Math.round);
    if ('x1' in c) [o.x1, o.y1] = f((c as any).x1, (c as any).y1).map(Math.round);
    return o as Cmd;
  });
}

function bbox(cmds: Cmd[]): { xMin: number; yMin: number; xMax: number; yMax: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of cmds) {
    if ('x' in c) (xs.push(c.x), ys.push(c.y));
    if ('x1' in c) (xs.push((c as any).x1), ys.push((c as any).y1));
  }
  if (xs.length === 0) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  return {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  };
}

/** A closed polygon, counter-clockwise like the glyphs' outer contours (fill on the left). */
function polygon(pts: [number, number][]): Cmd[] {
  let area = 0;
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  });
  const p = area < 0 ? [...pts].reverse() : pts;
  return [
    { type: 'M', x: p[0][0], y: p[0][1] },
    ...p.slice(1).map(([x, y]) => ({ type: 'L', x, y }) as Cmd),
    { type: 'Z' },
  ] as Cmd[];
}

/** A stroke from `a` (width `wa`) to `b` (width `wb`), the shape of a hand-drawn accent. */
function wedge(a: [number, number], b: [number, number], wa: number, wb: number): Cmd[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  return polygon([
    [a[0] + (nx * wa) / 2, a[1] + (ny * wa) / 2],
    [b[0] + (nx * wb) / 2, b[1] + (ny * wb) / 2],
    [b[0] - (nx * wb) / 2, b[1] - (ny * wb) / 2],
    [a[0] - (nx * wa) / 2, a[1] - (ny * wa) / 2],
  ]);
}

/**
 * Accent marks for fonts that have none (Satans maps its accents and quotes to placeholder
 * boxes), drawn around (0, 0) at the bottom center, in units of a 1024 em.
 */
const MARKS: Record<string, (dot: Cmd[]) => Cmd[]> = {
  acute: () => wedge([-45, 0], [45, 165], 26, 72),
  grave: () => wedge([45, 0], [-45, 165], 26, 72),
  circumflex: () => [...wedge([-100, 0], [0, 150], 30, 70), ...wedge([100, 0], [0, 150], 30, 70)],
  tilde: () => {
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const x = -115 + (230 * i) / 16;
      const y = 50 + 45 * Math.sin((i / 16) * Math.PI * 2);
      top.push([x, y + 28]);
      bottom.push([x, y - 28]);
    }
    return polygon([...top, ...bottom.reverse()]);
  },
  diaeresis: (dot) => {
    const b = bbox(dot);
    const cx = (b.xMin + b.xMax) / 2;
    const at = (dx: number) => mapCmds(dot, (x, y) => [x - cx + dx, y - b.yMin]);
    return [...at(-80), ...at(80)];
  },
};

/** Accented letters: base letter and mark. */
const COMPOSE: Record<string, [string, string]> = {};
for (const [marks, mark] of [
  ['àÀèÈìÌòÒùÙ', 'grave'],
  ['áÁéÉíÍóÓúÚ', 'acute'],
  ['âÂêÊîÎôÔûÛ', 'circumflex'],
  ['äÄëËïÏöÖüÜÿŸ', 'diaeresis'],
  ['ñÑ', 'tilde'],
] as const) {
  for (const ch of marks) COMPOSE[ch] = [ch.normalize('NFD')[0], mark];
}

/** A glyph that is only a box (Satans' placeholders for missing characters). */
function isPlaceholder(cmds: Cmd[]): boolean {
  const moves = cmds.filter((c) => c.type === 'M').length;
  return (
    moves === 2 &&
    cmds.every((c) => c.type !== 'Q') &&
    cmds.filter((c) => c.type === 'L').length <= 10
  );
}

/**
 * Fills the gaps of a font with no accents: accented letters, apostrophes and quotes, `¡` and
 * `¿`, from its own letters, comma, period and marks. Fonts that have them keep theirs.
 */
function completeFont(g: Map<number, GlyphData>): void {
  const get = (ch: string) => g.get(ch.codePointAt(0)!);
  const has = (ch: string) => {
    const x = get(ch);
    return x !== undefined && !isPlaceholder(x.cmds);
  };
  const comma = get(',');
  const dot = get('.');
  const capTop = bbox(get('E')?.cmds ?? []).yMax;
  const lowTop = bbox(get('e')?.cmds ?? []).yMax;
  if (!comma || !dot || !capTop) return;
  const set = (ch: string, data: GlyphData) => g.set(ch.codePointAt(0)!, data);

  // Apostrophes and quotes: the comma raised to the cap height (‘ turned around)
  const cb = bbox(comma.cmds);
  const raised = (dx: number, turn = false) =>
    mapCmds(comma.cmds, (x, y) =>
      turn
        ? [cb.xMax - (x - cb.xMin) + dx, capTop - (y - cb.yMin) - (cb.yMax - cb.yMin)]
        : [x + dx, y - cb.yMax + capTop],
    );
  const quoteW = comma.advance;
  for (const ch of ["'", '’']) if (!has(ch)) set(ch, { advance: quoteW, cmds: raised(0) });
  if (!has('‘')) set('‘', { advance: quoteW, cmds: raised(0, true) });
  if (!has('"')) set('"', { advance: quoteW * 1.6, cmds: [...raised(0), ...raised(quoteW * 0.6)] });

  // Spacing marks
  const spacing: [string, string][] = [
    ['`', 'grave'],
    ['^', 'circumflex'],
    ['~', 'tilde'],
  ];
  for (const [ch, mark] of spacing) {
    if (has(ch)) continue;
    const adv = get(ch)?.advance ?? 400;
    set(ch, {
      advance: adv,
      cmds: mapCmds(MARKS[mark](dot.cmds), (x, y) => [x + adv / 2, y + lowTop]),
    });
  }

  // Accented letters
  for (const [ch, [base, mark]] of Object.entries(COMPOSE)) {
    const b = get(base);
    if (has(ch) || !b) continue;
    const bb = bbox(b.cmds);
    const lower = base !== base.toUpperCase();
    const k = lower ? 0.85 : 1;
    const cx = (bb.xMin + bb.xMax) / 2;
    const y0 = bb.yMax + (lower ? 50 : 60);
    const m = mapCmds(MARKS[mark](dot.cmds), (x, y) => [cx + x * k, y0 + y * k]);
    set(ch, { advance: b.advance, cmds: [...b.cmds, ...m] });
  }
  // ç: the comma under the c
  for (const [ch, base] of [
    ['ç', 'c'],
    ['Ç', 'C'],
  ]) {
    const b = get(base);
    if (has(ch) || !b) continue;
    const bb = bbox(b.cmds);
    const cx = (bb.xMin + bb.xMax) / 2 - (cb.xMin + cb.xMax) / 2;
    const m = mapCmds(comma.cmds, (x, y) => [x + cx, y - cb.yMax + 20]);
    set(ch, { advance: b.advance, cmds: [...b.cmds, ...m] });
  }
  // ¡ ¿: ! and ? turned around, hanging from the small letters' top
  for (const [ch, base] of [
    ['¡', '!'],
    ['¿', '?'],
  ]) {
    const b = get(base);
    if (has(ch) || !b) continue;
    const bb = bbox(b.cmds);
    const turned = mapCmds(b.cmds, (x, y) => [bb.xMax - (x - bb.xMin), lowTop - (y - bb.yMin)]);
    set(ch, { advance: b.advance, cmds: turned });
  }
}

function buildFont(tag: any): opentype.Font {
  const scale = UPM / (tag.emSquareSize || 1024);
  const layout = tag.layout;
  const data = new Map<number, GlyphData>();
  tag.codeUnits.forEach((code: number, i: number) => {
    if (data.has(code)) return;
    data.set(code, {
      advance: Math.round((layout?.advances?.[i] ?? tag.emSquareSize / 2) * scale),
      cmds: glyphPath(tag.glyphs[i], scale).commands,
    });
  });
  completeFont(data);
  // A no-break space shares the space's width, so French texts ("Quêtes :") don't fall back
  const space = data.get(0x20);
  if (space && !data.has(0xa0)) data.set(0xa0, { advance: space.advance, cmds: [] });

  const glyphs: opentype.Glyph[] = [
    new opentype.Glyph({
      name: '.notdef',
      unicode: 0,
      advanceWidth: UPM / 2,
      path: new opentype.Path(),
    }),
  ];
  for (const [code, g] of [...data].sort((a, b) => a[0] - b[0])) {
    const path = new opentype.Path();
    path.commands = g.cmds;
    glyphs.push(
      new opentype.Glyph({
        name: `uni${code.toString(16).toUpperCase().padStart(4, '0')}`,
        unicode: code,
        advanceWidth: Math.round(g.advance),
        path,
      }),
    );
  }
  // The SWF layout's few kerning pairs (7 in Satans) are left out: opentype.js cannot write them
  return new opentype.Font({
    familyName: tag.fontName,
    styleName: 'Regular',
    unitsPerEm: UPM,
    ascender: Math.round((layout?.ascent ?? tag.emSquareSize * 0.8) * scale),
    descender: -Math.round((layout?.descent ?? tag.emSquareSize * 0.2) * scale),
    glyphs,
  });
}

/**
 * opentype.js writes the time of the build in the `head` table (`created`, `modified`), so each
 * build made new files: the offline cache (5.3) then saw a new version at every deploy. Sets both
 * to 0 and recomputes the table's checksum and the font's `checkSumAdjustment`.
 */
function fixTimestamps(font: Buffer): Buffer {
  const sum = (buf: Buffer, from: number, length: number) => {
    let s = 0;
    for (let i = 0; i < length; i += 4) {
      const word = Buffer.alloc(4);
      buf.copy(word, 0, from + i, Math.min(from + i + 4, from + length));
      s = (s + word.readUInt32BE(0)) >>> 0;
    }
    return s;
  };
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const entry = 12 + i * 16;
    if (font.toString('ascii', entry, entry + 4) !== 'head') continue;
    const head = font.readUInt32BE(entry + 8);
    const length = font.readUInt32BE(entry + 12);
    font.fill(0, head + 20, head + 36); // created, modified (LONGDATETIME each)
    font.writeUInt32BE(0, head + 8); // checkSumAdjustment
    font.writeUInt32BE(sum(font, head, length), entry + 4);
    font.writeUInt32BE((0xb1b0afba - sum(font, 0, font.length)) >>> 0, head + 8);
  }
  return font;
}

function main(): void {
  const swf = parseSwf(readFileSync(SWF));
  // The fullest font of each family (the SWF has a 95-glyph bold copy of Franklin Gothic)
  const best = new Map<string, any>();
  for (const t of swf.tags as any[]) {
    if (!t.glyphs?.length || !t.codeUnits || !FONT_FILES[t.fontName]) continue;
    const prev = best.get(t.fontName);
    if (!prev || t.glyphs.length > prev.glyphs.length) best.set(t.fontName, t);
  }
  mkdirSync(OUT, { recursive: true });
  for (const [name, tag] of best) {
    const font = buildFont(tag);
    const bytes = fixTimestamps(Buffer.from(font.toArrayBuffer()));
    writeFileSync(join(OUT, FONT_FILES[name]), bytes);
    console.log(`fonts: ${name}, ${tag.glyphs.length} glyphs -> public/fonts/${FONT_FILES[name]}`);
  }
}

main();
