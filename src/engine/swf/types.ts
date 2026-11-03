/**
 * Runtime schema for the compiled SWF symbol library (`public/gfx/library.json`),
 * generated at build time by `tools/build-swf.ts`.
 */

/** 2D affine matrix `[a, b, c, d, tx, ty]`: `x' = a*x + c*y + tx`, `y' = b*x + d*y + ty`. */
export type Matrix6 = [number, number, number, number, number, number];

/** Color transform `[rMult, gMult, bMult, aMult, rAdd, gAdd, bAdd, aAdd]`. Multipliers ~1, offsets -255..255. */
export type Cxform8 = [number, number, number, number, number, number, number, number];

export interface BitmapDef {
  kind: 'bitmap';
  file: string;
  alphaFile?: string;
  w: number;
  h: number;
}

export type GradientStop = [ratio01: number, cssRgba: string];

export type ShapeFill =
  | { t: 'solid'; c: string }
  | { t: 'linear'; m: Matrix6; stops: GradientStop[]; spread?: number }
  | { t: 'radial'; m: Matrix6; stops: GradientStop[]; focal: number; spread?: number }
  | { t: 'bitmap'; id: number; m: Matrix6; repeat: boolean; smooth: boolean };

export interface ShapeStroke {
  w: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  miter?: number;
  fill: ShapeFill;
}

export type ShapeDrawCmd =
  | { op: 'fill'; fill: ShapeFill; d: string; evenodd: boolean }
  | { op: 'stroke'; stroke: ShapeStroke; d: string };

/** Vector shape in twip coordinates (`1 px = 20 twips`). */
export interface ShapeDef {
  kind: 'shape';
  /** Bounding box `[xMin, yMin, xMax, yMax]` in twips. */
  bounds: [number, number, number, number];
  cmds: ShapeDrawCmd[];
}

export interface DynamicTextDef {
  kind: 'text';
  /** Bounding box `[xMin, yMin, xMax, yMax]` in pixels. */
  bounds: [number, number, number, number];
  font: string;
  size: number;
  color: string;
  align: 'left' | 'right' | 'center' | 'justify';
  bold?: boolean;
  text: string;
  html?: boolean;
  multiline?: boolean;
}

export type FrameAction =
  | { op: 'stop' }
  | { op: 'play' }
  | { op: 'removeSelf' }
  | { op: 'gotoFrame'; frame: number; play: boolean }
  | { op: 'gotoLabel'; label: string; play: boolean }
  /** A frame script too rich for the ops above, run by `Avm1.ts`. `code` is base64 AVM1 bytecode. */
  | { op: 'avm1'; code: string };

export interface PlaceCmd {
  op: 'place';
  d: number;
  /** True when updating an existing depth (`PlaceObject` move flag). */
  u?: boolean;
  /** Character ID (in `characters`). */
  id?: number;
  /** Matrix with translation in pixels. */
  m?: Matrix6;
  /** Color transform (omitted when identity). */
  cx?: Cxform8;
  /** Instance name (e.g. `"sub"`, `"skin"`, `"score0"`). */
  n?: string;
  /** Clipping mask upper depth (inclusive). */
  clip?: number;
  /** Blend mode id (Flash BlendMode enum). */
  blend?: number;
  visible?: boolean;
}

export interface RemoveCmd {
  op: 'remove';
  d: number;
}

export type TimelineCmd = PlaceCmd | RemoveCmd;

export interface SpriteFrame {
  cmds: TimelineCmd[];
  actions?: FrameAction[];
}

export interface SpriteDef {
  kind: 'sprite';
  frameCount: number;
  /** 1-based frame index by frame label name. */
  labels?: Record<string, number>;
  frames: SpriteFrame[];
}

export type CharacterDef = BitmapDef | ShapeDef | DynamicTextDef | SpriteDef;

export interface SwfLibraryData {
  version: number;
  characters: Record<number, CharacterDef>;
  /** Exported linkage symbol name → global character ID. */
  exports: Record<string, number>;
  /** Available sound linkage names → relative URL under `sfx/`. */
  sounds: Record<string, string>;
}
