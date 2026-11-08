/**
 * Build-time SWF asset & audio extractor.
 *
 * Parses the original Hammerfest SWF bundles (`_gfx.swf`, `_editor.swf`,
 * `_anims.swf`, `_ending.swf`, `_loader.swf`, `_sounds.swf`) and emits:
 *   - `public/sfx/*.mp3`          (21 extracted sound effects + 3 music tracks)
 *   - `public/gfx/bitmaps/*`      (all 199 embedded bitmaps decoded to PNG/JPG)
 *   - `public/gfx/library.json`   (vector shapes, texts, and MovieClip timelines)
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { parseSwf } from 'swf-parser';
import { TagType } from 'swf-types';
import type {
  BitmapDef,
  CharacterDef,
  Cxform8,
  DynamicTextDef,
  PlaceCmd,
  SpriteDef,
  SpriteFrame,
  SwfLibraryData,
  TimelineCmd,
} from '../src/engine/swf/types';
import { encodePngRgba } from './lib/png';
import {
  compileStaticText,
  compileSwfShape,
  convertMatrix,
  parseFrameActions,
  rgbaCss,
} from './lib/swfShapes';

const ROOT = new URL('..', import.meta.url).pathname;
const SWF_DIR = join(ROOT, 'assets-src/original/swf');
const SFX_SRC_DIR = join(ROOT, 'assets-src/original/sfx');
const GFX_OUT = join(ROOT, 'public/gfx');
const BMP_OUT = join(GFX_OUT, 'bitmaps');
const SFX_OUT = join(ROOT, 'public/sfx');

function fpVal(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'valueOf' in v)
    return Number((v as { valueOf(): number }).valueOf());
  return 0;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Removes Flash's erroneous `FF D9 FF D8` (EOI+SOI) marker pairs inside JPEG2/JPEG3 streams. */
function cleanFlashJpeg(src: Uint8Array): Buffer {
  let b = Buffer.from(src.buffer, src.byteOffset, src.byteLength);
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd9 && b[2] === 0xff && b[3] === 0xd8) {
    b = b.subarray(2);
  }
  const parts: Buffer[] = [];
  let start = 0;
  for (let i = 2; i <= b.length - 4; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xd9 && b[i + 2] === 0xff && b[i + 3] === 0xd8) {
      parts.push(b.subarray(start, i));
      start = i + 4;
      i += 3;
    }
  }
  if (parts.length === 0) return b;
  parts.push(b.subarray(start));
  return Buffer.concat(parts);
}

function mergePartialJpeg(tables: Uint8Array | undefined, body: Uint8Array): Buffer {
  const b = cleanFlashJpeg(body);
  if (!tables || tables.length < 4) return b;
  let t = cleanFlashJpeg(tables);
  if (t.length >= 2 && t[t.length - 2] === 0xff && t[t.length - 1] === 0xd9) {
    t = t.subarray(0, t.length - 2);
  }
  const rest = b.length >= 2 && b[0] === 0xff && b[1] === 0xd8 ? b.subarray(2) : b;
  return Buffer.concat([t, rest]);
}

function decodeLosslessBitmap(tag: any, hasAlpha: boolean): Buffer {
  const d = Buffer.from(tag.data.buffer, tag.data.byteOffset, tag.data.byteLength);
  const fmt = d[0];
  const w: number = tag.width;
  const h: number = tag.height;
  const rgba = new Uint8Array(w * h * 4);

  if (fmt === 5) {
    const raw = inflateSync(d.subarray(5));
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const a = hasAlpha ? raw[p] : 255;
      let r = raw[p + 1];
      let g = raw[p + 2];
      let b = raw[p + 3];
      if (hasAlpha && a > 0 && a < 255) {
        r = Math.min(255, Math.round((r * 255) / a));
        g = Math.min(255, Math.round((g * 255) / a));
        b = Math.min(255, Math.round((b * 255) / a));
      }
      rgba[p] = r;
      rgba[p + 1] = g;
      rgba[p + 2] = b;
      rgba[p + 3] = a;
    }
  } else if (fmt === 3) {
    const tableSize = d[5] + 1;
    const raw = inflateSync(d.subarray(6));
    const entryBytes = hasAlpha ? 4 : 3;
    const palOffset = tableSize * entryBytes;
    const rowStride = (w + 3) & ~3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = raw[palOffset + y * rowStride + x];
        const cOff = idx * entryBytes;
        let r = raw[cOff];
        let g = raw[cOff + 1];
        let b = raw[cOff + 2];
        const a = hasAlpha ? raw[cOff + 3] : 255;
        if (hasAlpha && a > 0 && a < 255) {
          r = Math.min(255, Math.round((r * 255) / a));
          g = Math.min(255, Math.round((g * 255) / a));
          b = Math.min(255, Math.round((b * 255) / a));
        }
        const out = (y * w + x) * 4;
        rgba[out] = r;
        rgba[out + 1] = g;
        rgba[out + 2] = b;
        rgba[out + 3] = a;
      }
    }
  } else {
    throw new Error(`Unsupported SWF lossless format ${fmt} on bitmap #${tag.id}`);
  }

  return encodePngRgba(w, h, rgba);
}

function extractBitmap(tag: any, gid: number, jpegTables: Uint8Array | undefined): BitmapDef {
  const w: number = tag.width;
  const h: number = tag.height;
  const media: string = tag.mediaType;

  if (media === 'image/x-swf-lossless1' || media === 'image/x-swf-lossless2') {
    const png = decodeLosslessBitmap(tag, media === 'image/x-swf-lossless2');
    const file = `b${gid}.png`;
    writeFileSync(join(BMP_OUT, file), png);
    return { kind: 'bitmap', file, w, h };
  }

  if (media === 'image/x-swf-jpeg3') {
    const d = Buffer.from(tag.data.buffer, tag.data.byteOffset, tag.data.byteLength);
    const alphaOff = d.readUInt32LE(0);
    const jpg = cleanFlashJpeg(d.subarray(4, 4 + alphaOff));
    const alpha = inflateSync(d.subarray(4 + alphaOff));
    const maskRgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      maskRgba[i * 4] = 255;
      maskRgba[i * 4 + 1] = 255;
      maskRgba[i * 4 + 2] = 255;
      maskRgba[i * 4 + 3] = alpha[i];
    }
    const file = `b${gid}.jpg`;
    const alphaFile = `b${gid}.a.png`;
    writeFileSync(join(BMP_OUT, file), jpg);
    writeFileSync(join(BMP_OUT, alphaFile), encodePngRgba(w, h, maskRgba));
    return { kind: 'bitmap', file, alphaFile, w, h };
  }

  if (media === 'image/x-swf-partial-jpeg') {
    const jpg = mergePartialJpeg(jpegTables, tag.data);
    const file = `b${gid}.jpg`;
    writeFileSync(join(BMP_OUT, file), jpg);
    return { kind: 'bitmap', file, w, h };
  }

  // Standard image/jpeg
  const jpg = cleanFlashJpeg(tag.data);
  const file = `b${gid}.jpg`;
  writeFileSync(join(BMP_OUT, file), jpg);
  return { kind: 'bitmap', file, w, h };
}

function convertCxform(cx: any): Cxform8 | undefined {
  if (!cx) return undefined;
  const rm = round4(fpVal(cx.redMult ?? 1));
  const gm = round4(fpVal(cx.greenMult ?? 1));
  const bm = round4(fpVal(cx.blueMult ?? 1));
  const am = round4(fpVal(cx.alphaMult ?? 1));
  const ra = cx.redAdd ?? 0;
  const ga = cx.greenAdd ?? 0;
  const ba = cx.blueAdd ?? 0;
  const aa = cx.alphaAdd ?? 0;
  if (
    rm === 1 &&
    gm === 1 &&
    bm === 1 &&
    am === 1 &&
    ra === 0 &&
    ga === 0 &&
    ba === 0 &&
    aa === 0
  ) {
    return undefined;
  }
  return [rm, gm, bm, am, ra, ga, ba, aa];
}

function isIdentityMatrix(m: [number, number, number, number, number, number]): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

function compileSprite(tag: any, idOffset: number): SpriteDef {
  const frames: SpriteFrame[] = [];
  const labels: Record<string, number> = {};
  let cmds: TimelineCmd[] = [];
  let actions = [] as ReturnType<typeof parseFrameActions>;

  for (const st of tag.tags ?? []) {
    switch (st.type as TagType) {
      case TagType.FrameLabel:
        if (!st.isAnchor && st.name) labels[st.name] = frames.length + 1;
        break;
      case TagType.PlaceObject: {
        const place: PlaceCmd = { op: 'place', d: st.depth };
        if (st.isUpdate) place.u = true;
        if (st.characterId !== undefined) place.id = st.characterId + idOffset;
        if (st.matrix) {
          const m = convertMatrix(st.matrix, 20);
          if (!isIdentityMatrix(m) || st.isUpdate) place.m = m;
        }
        // An update with an identity color transform still resets the previous one (a fade
        // that ends at normal color), so it is kept there, as the matrix is
        const cx = convertCxform(st.colorTransform);
        if (cx) place.cx = cx;
        else if (st.colorTransform && st.isUpdate) place.cx = [1, 1, 1, 1, 0, 0, 0, 0];
        if (st.name) place.n = st.name;
        if (st.clipDepth !== undefined && st.clipDepth > 0) place.clip = st.clipDepth;
        if (st.blendMode !== undefined && st.blendMode > 1) place.blend = st.blendMode;
        if (st.visible === false) place.visible = false;
        cmds.push(place);
        break;
      }
      case TagType.RemoveObject:
        cmds.push({ op: 'remove', d: st.depth });
        break;
      case TagType.DoAction:
        actions.push(...parseFrameActions(st.actions));
        break;
      case TagType.ShowFrame:
        frames.push({
          cmds,
          ...(actions.length > 0 ? { actions } : {}),
        });
        cmds = [];
        actions = [];
        break;
    }
  }
  if (frames.length === 0) {
    frames.push({ cmds, ...(actions.length > 0 ? { actions } : {}) });
  }

  return {
    kind: 'sprite',
    frameCount: Math.max(tag.frameCount ?? frames.length, frames.length),
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    frames,
  };
}

function compileButton(tag: any, idOffset: number): SpriteDef {
  const cmds: TimelineCmd[] = [];
  for (const r of tag.records ?? []) {
    if (!r.stateUp) continue;
    const m = convertMatrix(r.matrix, 20);
    const cx = convertCxform(r.colorTransform);
    cmds.push({
      op: 'place',
      d: r.depth,
      id: r.characterId + idOffset,
      ...(!isIdentityMatrix(m) ? { m } : {}),
      ...(cx ? { cx } : {}),
    });
  }
  return { kind: 'sprite', frameCount: 1, frames: [{ cmds }] };
}

function compileDynamicText(tag: any, fonts: Map<number, any>): DynamicTextDef {
  const b = tag.bounds ?? { xMin: 0, yMin: 0, xMax: 2000, yMax: 400 };
  const font = tag.fontId !== undefined ? fonts.get(tag.fontId) : undefined;
  const aligns: DynamicTextDef['align'][] = ['left', 'right', 'center', 'justify'];
  return {
    kind: 'text',
    bounds: [b.xMin / 20, b.yMin / 20, b.xMax / 20, b.yMax / 20],
    font: font?.fontName || 'Arial Black, Impact, sans-serif',
    size: Math.max(8, Math.round((tag.fontSize ?? 240) / 20)),
    color: tag.color ? rgbaCss(tag.color) : 'rgb(255,255,255)',
    align: aligns[tag.align ?? 0] ?? 'left',
    ...(font?.isBold ? { bold: true } : {}),
    text: tag.text ?? '',
    ...(tag.html ? { html: true } : {}),
    ...(tag.multiline ? { multiline: true } : {}),
    ...(tag.variableName ? { variable: tag.variableName } : {}),
  };
}

function buildSounds(): Record<string, string> {
  mkdirSync(SFX_OUT, { recursive: true });
  const sounds: Record<string, string> = {};

  const swf = parseSwf(readFileSync(join(SWF_DIR, '_sounds.swf')));
  const namesById = new Map<number, string>();
  for (const t of swf.tags as any[]) {
    if (t.type === TagType.ExportAssets) {
      for (const a of t.assets) namesById.set(a.id, a.name);
    }
  }
  for (const t of swf.tags as any[]) {
    if (t.type !== TagType.DefineSound) continue;
    const name = namesById.get(t.id) ?? `sound_${t.id}`;
    // Format 2 = MP3: first 2 bytes are SI16 seekSamples, followed by raw MP3 frames.
    const mp3 = Buffer.from(t.data.buffer, t.data.byteOffset + 2, t.data.byteLength - 2);
    const file = `${name}.mp3`;
    writeFileSync(join(SFX_OUT, file), mp3);
    sounds[name] = `sfx/${file}`;
  }

  // Copy external music tracks from sfx/
  const musicMap: [string, string][] = [
    ['music_ingame', 'music.mp3'],
    ['music_boss', 'boss.mp3'],
    ['music_hurry', 'hurryUp.mp3'],
  ];
  for (const [alias, srcFile] of musicMap) {
    copyFileSync(join(SFX_SRC_DIR, srcFile), join(SFX_OUT, srcFile));
    sounds[alias] = `sfx/${srcFile}`;
  }

  console.log(`  sfx/  (${Object.keys(sounds).length} audio tracks extracted)`);
  return sounds;
}

function buildSwfLibrary(): void {
  mkdirSync(BMP_OUT, { recursive: true });
  const sounds = buildSounds();

  const characters: Record<number, CharacterDef> = {};
  const exports: Record<string, number> = {};

  // Order matches swfmake.xml so later includes override earlier linkage names.
  const bundles: [string, number][] = [
    ['_gfx.swf', 0],
    ['_editor.swf', 10000],
    ['_anims.swf', 20000],
    ['_ending.swf', 30000],
    // The Loader's own clips (`loading`: the fades and the save screen after a game over)
    ['_loader.swf', 40000],
  ];

  let bmpCount = 0;
  let shapeCount = 0;
  let spriteCount = 0;

  for (const [file, offset] of bundles) {
    const swf = parseSwf(readFileSync(join(SWF_DIR, file)));
    let jpegTables: Uint8Array | undefined;
    const fonts = new Map<number, any>();

    for (const t of swf.tags as any[]) {
      switch (t.type as TagType) {
        case TagType.DefineJpegTables:
          jpegTables = t.data;
          break;
        case TagType.DefineFont:
          fonts.set(t.id, t);
          break;
        case TagType.DefineBitmap:
          characters[t.id + offset] = extractBitmap(t, t.id + offset, jpegTables);
          bmpCount++;
          break;
        case TagType.DefineShape:
        case TagType.DefineMorphShape:
          characters[t.id + offset] = compileSwfShape(t, offset);
          shapeCount++;
          break;
        case TagType.DefineText:
          characters[t.id + offset] = compileStaticText(t, fonts);
          shapeCount++;
          break;
        case TagType.DefineDynamicText:
          characters[t.id + offset] = compileDynamicText(t, fonts);
          break;
        case TagType.DefineButton:
          characters[t.id + offset] = compileButton(t, offset);
          spriteCount++;
          break;
        case TagType.DefineSprite:
          characters[t.id + offset] = compileSprite(t, offset);
          spriteCount++;
          break;
        case TagType.ExportAssets:
          for (const a of t.assets ?? []) {
            exports[a.name] = a.id + offset;
            // Also register without leading `$` so de-obfuscated lookups match seamlessly.
            if (a.name.startsWith('$')) {
              exports[a.name.slice(1)] = a.id + offset;
            }
          }
          break;
      }
    }
    console.log(`  parsed ${file} (offset +${offset})`);
  }

  const lib: SwfLibraryData = {
    version: 1,
    characters,
    exports,
    sounds,
  };
  writeFileSync(join(GFX_OUT, 'library.json'), JSON.stringify(lib));
  console.log(
    `  gfx/library.json  (${bmpCount} bitmaps, ${shapeCount} shapes, ${spriteCount} sprites, ${Object.keys(exports).length} exports)`,
  );
}

console.log('Building SWF graphics & audio → public/gfx, public/sfx');
buildSwfLibrary();
console.log('Done.');
