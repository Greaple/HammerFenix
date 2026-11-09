import type { BLEND_MODES, Filter, TextStyleOptions } from 'pixi.js';
import {
  AlphaFilter,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Graphics,
  type GraphicsContext,
  Matrix,
  Sprite,
  Text,
  TextStyle,
} from 'pixi.js';
import { type Avm1Clip, runAvm1 } from './Avm1';
import { GlowFilter } from './GlowFilter';
import { OverlayFilter } from './OverlayFilter';
import type { SwfLibrary } from './SwfLibrary';
import type {
  Cxform8,
  DynamicTextDef,
  Matrix6,
  PlaceCmd,
  SpriteDef,
  TimelineFilter,
} from './types';

const PROTECTED_PROPS = new Set<string>([
  'x',
  'y',
  'alpha',
  'scale',
  'pivot',
  'skew',
  'rotation',
  'angle',
  'width',
  'height',
  'visible',
  'parent',
  'children',
  'mask',
  'filters',
  'blendMode',
  'label',
  'zIndex',
  'destroy',
  'play',
  'stop',
]);

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * Flash HTML text to Pixi tagged text. `plain` is the text alone, `tagged` the text with Pixi
 * tags (`<b>`, `<c_f7e8d5>`), `tags` their styles. Unknown tags are dropped.
 */
export function parseFlashHtml(html: string): {
  plain: string;
  tagged: string;
  tags: Record<string, TextStyleOptions>;
} {
  const tags: Record<string, TextStyleOptions> = {};
  const fontStack: (string | null)[] = [];
  let plain = '';
  let tagged = '';
  const decode = (s: string) =>
    s.replace(/&(#\d+|\w+);/g, (m, e: string) =>
      e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : (HTML_ENTITIES[e] ?? m),
    );
  for (const part of html.split(/(<[^>]*>)/)) {
    if (!part.startsWith('<')) {
      const t = decode(part);
      plain += t;
      tagged += t;
      continue;
    }
    const m = /^<\s*(\/?)\s*(\w+)([^>]*)>$/.exec(part);
    if (!m) continue;
    const [, close, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (name === 'br') {
      plain += '\n';
      tagged += '\n';
    } else if (name === 'b') {
      tags.b = { fontWeight: 'bold' };
      tagged += close ? '</b>' : '<b>';
    } else if (name === 'font') {
      if (close) {
        const t = fontStack.pop();
        if (t) tagged += `</${t}>`;
      } else {
        const color = /color\s*=\s*["']?#([0-9a-f]{6})/i.exec(attrs)?.[1]?.toLowerCase();
        const t = color ? `c_${color}` : null;
        if (t && color) {
          tags[t] = { fill: `#${color}` };
          tagged += `<${t}>`;
        }
        fontStack.push(t);
      }
    }
  }
  return { plain, tagged, tags };
}

/** Flash-compatible dynamic text field (`DefineDynamicText`). */
export class SwfTextField extends Container {
  private readonly pixiText: Text;
  private readonly boxX0: number;
  private readonly boxWidth: number;
  private readonly align: DynamicTextDef['align'];
  private readonly fontSize: number;
  /** The variable the field shows (`DynamicTextDef.variable`). */
  readonly variable: string | undefined;
  /** Without a canvas, text size is estimated instead of measured (headless runs). */
  private readonly headless: boolean;
  private rawText = '';

  constructor(def: DynamicTextDef, headless = false) {
    super();
    this.fontSize = def.size;
    this.variable = def.variable;
    this.headless = headless;
    const [x0, y0, x1] = def.bounds;
    this.boxX0 = x0;
    this.boxWidth = Math.max(4, x1 - x0);
    this.align = def.align;

    const style = new TextStyle({
      fontFamily: `${def.font}, "Arial Black", Impact, system-ui, sans-serif`,
      fontSize: def.size,
      fontWeight: def.bold || /heavy|black|bold/i.test(def.font) ? 'bold' : 'normal',
      fill: def.color,
      align: def.align === 'justify' ? 'left' : def.align,
      wordWrap: Boolean(def.multiline) || this.boxWidth > 60,
      wordWrapWidth: this.boxWidth,
      dropShadow: {
        color: '#000000',
        alpha: 0.65,
        blur: 1,
        distance: 1,
      },
    });

    this.pixiText = new Text({ text: '', style });
    this.pixiText.position.set(x0, y0);
    this.addChild(this.pixiText);
    // An HTML field's text is its markup (`<p align="center"></p>`): show only the text
    if (def.html) this.htmlText = def.text;
    else this.text = def.text;
  }

  get text(): string {
    return this.rawText;
  }

  set text(v: string) {
    this.rawText = String(v ?? '');
    this.pixiText.style.tagStyles = undefined;
    this.pixiText.text = this.rawText;
    this.realign();
  }

  get htmlText(): string {
    return this.rawText;
  }

  /**
   * The HTML subset the game uses: `<b>`, `<font color>` and `<br>`, drawn with Pixi's tag
   * styles; other tags (`<p>`, `<font>` without a color) are dropped, as before.
   */
  set htmlText(v: string) {
    const { plain, tagged, tags } = parseFlashHtml(String(v ?? ''));
    this.rawText = plain;
    this.pixiText.style.tagStyles = Object.keys(tags).length > 0 ? tags : undefined;
    this.pixiText.text = Object.keys(tags).length > 0 ? tagged : plain;
    this.realign();
  }

  get textColor(): number {
    const f = this.pixiText.style.fill;
    return typeof f === 'number' ? f : 0xffffff;
  }

  set textColor(hex: number) {
    this.pixiText.style.fill = hex;
  }

  get textWidth(): number {
    if (this.headless) {
      const longest = Math.max(0, ...this.rawText.split('\n').map((l) => l.length));
      return Math.min(this.boxWidth, longest * this.fontSize * 0.55);
    }
    return this.pixiText.width;
  }

  get textHeight(): number {
    if (this.headless) return (this.rawText.split('\n').length || 1) * this.fontSize * 1.2;
    return this.pixiText.height;
  }

  get _x(): number {
    return this.x;
  }
  set _x(v: number) {
    this.x = v;
  }
  get _y(): number {
    return this.y;
  }
  set _y(v: number) {
    this.y = v;
  }
  get _visible(): boolean {
    return this.visible;
  }
  set _visible(v: boolean) {
    this.visible = v;
  }

  private realign(): void {
    if (this.align === 'center') {
      this.pixiText.anchor.set(0.5, 0);
      this.pixiText.x = this.boxX0 + this.boxWidth * 0.5;
    } else if (this.align === 'right') {
      this.pixiText.anchor.set(1, 0);
      this.pixiText.x = this.boxX0 + this.boxWidth;
    } else {
      this.pixiText.anchor.set(0, 0);
      this.pixiText.x = this.boxX0;
    }
  }
}

/**
 * A `clipDepth` mask layer: the mask character's filled outline as a vector stencil, so the
 * layers it clips show only inside its real shape. `_width` / `_height` scale it, as in Flash.
 */
export class SwfMaskClip extends Container {
  readonly gfx: Graphics;
  /** Unscaled size of the mask character in pixels. */
  private readonly baseWidth: number;
  private readonly baseHeight: number;

  /**
   * @param context Outline in twips from `SwfLibrary.getMaskContext` (`null` when headless).
   * @param bounds `[xMin, yMin, width, height]` of the character in pixels.
   */
  constructor(context: GraphicsContext | null, bounds: [number, number, number, number]) {
    super();
    this.baseWidth = Math.max(0.1, bounds[2]);
    this.baseHeight = Math.max(0.1, bounds[3]);
    this.gfx = context ? new Graphics(context) : new Graphics();
    this.gfx.scale.set(1 / 20);
    this.addChild(this.gfx);
  }

  get _x(): number {
    return this.x;
  }
  set _x(v: number) {
    this.x = v;
  }
  get _y(): number {
    return this.y;
  }
  set _y(v: number) {
    this.y = v;
  }
  get _width(): number {
    return this.baseWidth * Math.abs(this.scale.x);
  }
  set _width(v: number) {
    if (Number.isFinite(v)) this.scale.x = v / this.baseWidth;
  }
  get _height(): number {
    return this.baseHeight * Math.abs(this.scale.y);
  }
  set _height(v: number) {
    if (Number.isFinite(v)) this.scale.y = v / this.baseHeight;
  }
  get _xscale(): number {
    return this.scale.x * 100;
  }
  set _xscale(v: number) {
    if (Number.isFinite(v)) this.scale.x = v / 100;
  }
  get _yscale(): number {
    return this.scale.y * 100;
  }
  set _yscale(v: number) {
    if (Number.isFinite(v)) this.scale.y = v / 100;
  }
}

interface DepthSlot {
  depth: number;
  charId: number;
  node: Container;
  name?: string;
  clipDepth?: number;
  /** The last color transform placed, kept to rebuild the filters when the timeline's change. */
  cx?: Cxform8;
  cxFilter?: ColorMatrixFilter;
  /** The timeline's filters (`PlaceObject3`). */
  tlFilters?: Filter[];
  /** `BlendMode.OVERLAY`, drawn as a filter that reads the backdrop. */
  blendFilter?: OverlayFilter;
  /** `BlendMode.LAYER`: the children drawn together, then the alpha applied to the result. */
  layerFilter?: AlphaFilter;
}

const TMP_MAT = new Matrix();
const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];
const IDENTITY_CXFORM: Cxform8 = [1, 1, 1, 1, 0, 0, 0, 0];

/** AVM1 `GetProperty` / `SetProperty` indexes. */
const PROP_INDEX: Record<string, number> = {
  _x: 0,
  _y: 1,
  _xscale: 2,
  _yscale: 3,
  _currentframe: 4,
  _totalframes: 5,
  _alpha: 6,
  _visible: 7,
  _width: 8,
  _height: 9,
  _rotation: 10,
  _name: 13,
};

/** Bounds `b` mapped through `node`'s local matrix (with or without its translation). */
function transformRect(
  node: Container,
  [x0, y0, x1, y1]: [number, number, number, number],
  withTranslation: boolean,
): [number, number, number, number] {
  node.updateLocalTransform();
  const { a, b, c, d } = node.localTransform;
  const tx = withTranslation ? node.localTransform.tx : 0;
  const ty = withTranslation ? node.localTransform.ty : 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]) {
    const gx = a * px + c * py + tx;
    const gy = b * px + d * py + ty;
    if (gx < minX) minX = gx;
    if (gy < minY) minY = gy;
    if (gx > maxX) maxX = gx;
    if (gy > maxY) maxY = gy;
  }
  return [minX, minY, maxX, maxY];
}

function unionBounds(
  acc: [number, number, number, number] | null,
  b: [number, number, number, number],
): [number, number, number, number] {
  if (!acc) return b;
  return [
    Math.min(acc[0], b[0]),
    Math.min(acc[1], b[1]),
    Math.max(acc[2], b[2]),
    Math.max(acc[3], b[3]),
  ];
}

/** Timeline state of one depth while replaying frames for a backward seek. */
interface DepthRecord {
  id: number;
  m?: Matrix6;
  cx?: Cxform8;
  n?: string;
  clip?: number;
  blend?: number;
  f?: TimelineFilter[];
  visible?: boolean;
}

/** `swf-types`' `BlendMode` numbers (see `PlaceCmd.blend`). */
const BLEND_LAYER = 1;
const BLEND_OVERLAY = 12;

/**
 * Blend modes Pixi draws itself. Layer and Overlay are filters (`applyLook`); the others the
 * game's SWFs never place (Lighten, Darken, Difference, Subtract, Invert, Alpha, Erase, Hardlight)
 * draw as normal.
 */
function mapFlashBlendMode(mode?: number): BLEND_MODES {
  switch (mode) {
    case 2:
      return 'multiply';
    case 3:
      return 'screen';
    case 7:
      return 'add';
    default:
      return 'normal';
  }
}

/** Pixi filters for timeline filters, at the resolution of the surface they draw on. */
function makeTimelineFilters(list: TimelineFilter[]): Filter[] {
  return list.map((f) => {
    if (f.t === 'glow') {
      const g = new GlowFilter();
      g.color = f.color;
      g.alpha = f.alpha;
      g.blurX = f.blurX;
      g.blurY = f.blurY;
      g.strength = f.strength;
      g.quality = f.passes;
      return g;
    }
    const cm = new ColorMatrixFilter({ resolution: 'inherit', antialias: 'inherit' });
    cm.matrix = f.m as ColorMatrixFilter['matrix'];
    return cm;
  });
}

/**
 * Frame scripts of frames reached by `gotoAndStop`, `nextFrame` or `prevFrame` from game code.
 * Flash queues them and runs them once the running script ends, so the code still sees the frame
 * it asked for. E.g. `Animation.update` reads the shield's last frame and goes back to frame 1, and
 * only then does that frame's `gotoAndPlay("loop")` run, which skips the intro.
 */
const queuedActions: { clip: SwfMovieClip; frame: number }[] = [];

/** Runs the queued frame scripts. Call it after each piece of game code (a tick, a step). */
export function runQueuedFrameActions(): void {
  // A script can queue more; the cap stops two frames that send the clip to each other
  for (let i = 0; i < queuedActions.length && i < 10000; i++) {
    const { clip, frame } = queuedActions[i];
    clip.runQueuedActions(frame);
  }
  queuedActions.length = 0;
}

/**
 * Flash AVM1-compatible `MovieClip` runtime built on PixiJS v8 `Container`.
 *
 * Replays `DefineSprite` timelines, supports nested named clips (`mc.sub`,
 * `mc.skin`, `mc.maskTile`, etc.), `clipDepth` stencil masks, color transforms,
 * frame labels, frame actions, and AS2 underscore properties.
 */
export class SwfMovieClip extends Container implements Avm1Clip {
  readonly lib: SwfLibrary;
  readonly def: SpriteDef;

  /**
   * Object whose fields frame scripts see as this clip's variables. In the original, entities
   * *are* their MovieClip, so a body part reads `_parent._parent.head` straight off the player.
   */
  scriptHost: Record<string, any> | null = null;
  private readonly avmVars = new Map<string, unknown>();
  /**
   * Frame scripts (`avm1` actions) wait until the clip is live: in the display tree and
   * reached by an animation step, so `_parent` and `scriptHost` are set when they run.
   */
  private live = false;
  private pendingFrame = 0;
  private actionHop = 0;
  private removed = false;

  private curFrame = 0; // 0 = not yet initialized; 1..frameCount once constructed
  private playing = true;
  private depthSlots = new Map<number, DepthSlot>();
  private namedChildren = new Map<string, Container>();
  private tintFilter: ColorMatrixFilter | null = null;
  private glowFilter: GlowFilter | null = null;
  /** Set by `setOverlayBlend`. */
  private overlayFilter: OverlayFilter | null = null;
  /** Set by `setLayerBlend`: carries `_alpha`, applied to the composited layer. */
  private layerFilter: AlphaFilter | null = null;
  mcDepth = 0;
  mcName = '';

  /** Allow dynamic child references (`(mc as any).sub`) matching AS2 semantics. */
  [key: string]: any;

  constructor(lib: SwfLibrary, def?: SpriteDef) {
    super();
    this.sortableChildren = true;
    this.lib = lib;
    this.def = def ?? { kind: 'sprite', frameCount: 1, frames: [{ cmds: [] }] };
    this.playing = this.def.frameCount > 1;
    this.seekToFrame(1, true);
  }

  // --------------------------------------------------- AS2 MovieClip properties

  get _x(): number {
    return this.x;
  }
  set _x(v: number) {
    this.x = v;
  }

  get _y(): number {
    return this.y;
  }
  set _y(v: number) {
    this.y = v;
  }

  get _xscale(): number {
    return (this.scale.x || 1) * 100;
  }
  set _xscale(v: number) {
    if (!Number.isFinite(v)) return;
    this.scale.x = v / 100;
  }

  get _yscale(): number {
    return (this.scale.y || 1) * 100;
  }
  set _yscale(v: number) {
    if (!Number.isFinite(v)) return;
    this.scale.y = v / 100;
  }

  get rotationDeg(): number {
    return this.angle;
  }
  set rotationDeg(v: number) {
    this.angle = v;
  }

  get _alpha(): number {
    return (this.layerFilter ? this.layerFilter.alpha : this.alpha) * 100;
  }
  set _alpha(v: number) {
    const a = Math.max(0, Math.min(1, v / 100));
    if (this.layerFilter) {
      this.layerFilter.alpha = a;
    } else {
      this.alpha = a;
    }
  }

  /**
   * Flash `blendMode = BlendMode.LAYER`: the children are drawn offscreen first, so a child in
   * `erase` blend mode only erases this clip, and `_alpha` applies to the result instead of to
   * each child. Replaces the clip's filters; skipped when headless.
   */
  setLayerBlend(): void {
    if (this.lib.headless || this.layerFilter) return;
    this.layerFilter = new AlphaFilter({ alpha: this.alpha });
    this.alpha = 1;
    this.filters = [this.layerFilter];
  }

  get _visible(): boolean {
    return this.visible;
  }
  set _visible(v: boolean) {
    this.visible = v;
  }

  /**
   * Flash `_width`: the exact vector bounds of the content, scaled and rotated by this clip.
   * Not the rendered size (that has anti-aliasing padding), and hidden children count, as in
   * Flash. Entities use it for hit boxes, so it must not depend on rendering.
   */
  get _width(): number {
    const b = this.ownSwfBounds();
    return b ? b[2] - b[0] : 0;
  }
  set _width(v: number) {
    const b = this.swfBounds();
    const w = b ? b[2] - b[0] : 0;
    if (w > 0) this.scale.x = (v / w) * (this.scale.x < 0 ? -1 : 1);
  }

  get _height(): number {
    const b = this.ownSwfBounds();
    return b ? b[3] - b[1] : 0;
  }
  set _height(v: number) {
    const b = this.swfBounds();
    const h = b ? b[3] - b[1] : 0;
    if (h > 0) this.scale.y = (v / h) * (this.scale.y < 0 ? -1 : 1);
  }

  /** Vector bounds `[xMin, yMin, xMax, yMax]` of the content, in this clip's own space. */
  swfBounds(): [number, number, number, number] | null {
    let acc: [number, number, number, number] | null = null;
    const slotNodes = new Set<Container>();
    for (const slot of this.depthSlots.values()) {
      slotNodes.add(slot.node);
      if (slot.clipDepth !== undefined) continue; // mask layers
      const node = slot.node;
      let b: [number, number, number, number] | null;
      if (node instanceof SwfMovieClip) {
        b = node.swfBounds();
      } else {
        const [x, y, w, h] = this.lib.getCharacterBounds(slot.charId);
        b = [x, y, x + w, y + h];
      }
      if (b) acc = unionBounds(acc, transformRect(node, b, true));
    }
    // Clips attached by code rather than by the timeline
    for (const child of this.children) {
      if (slotNodes.has(child) || !(child instanceof SwfMovieClip)) continue;
      const b = child.swfBounds();
      if (b) acc = unionBounds(acc, transformRect(child, b, true));
    }
    return acc;
  }

  /** `swfBounds()` after this clip's own scale and rotation (not its position). */
  private ownSwfBounds(): [number, number, number, number] | null {
    const b = this.swfBounds();
    return b ? transformRect(this, b, false) : null;
  }

  get _currentframe(): number {
    return this.curFrame;
  }

  get _totalframes(): number {
    return this.def.frameCount;
  }

  get _name(): string {
    return this.mcName;
  }
  set _name(v: string) {
    this.mcName = v;
  }

  getDepth(): number {
    return this.mcDepth;
  }

  /** The display object the timeline placed at `depth`, if any. */
  childAtDepth(depth: number): Container | undefined {
    return this.depthSlots.get(depth)?.node;
  }

  swapDepths(target: number | SwfMovieClip): void {
    if (typeof target === 'number') {
      this.mcDepth = target;
      this.zIndex = target;
    } else {
      const tmp = this.mcDepth;
      this.mcDepth = target.mcDepth;
      this.zIndex = this.mcDepth;
      target.mcDepth = tmp;
      target.zIndex = tmp;
    }
  }

  // ----------------------------------------------------- Timeline control API

  play(): void {
    if (this.def.frameCount > 1) this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  gotoAndStop(frameOrLabel: number | string): void {
    const target = this.resolveFrame(frameOrLabel);
    this.playing = false;
    this.seekAndQueue(target);
  }

  gotoAndPlay(frameOrLabel: number | string): void {
    const target = this.resolveFrame(frameOrLabel);
    this.playing = this.def.frameCount > 1;
    this.seekToFrame(target, true);
  }

  nextFrame(): void {
    this.playing = false;
    if (this.curFrame < this.def.frameCount) {
      this.seekAndQueue(this.curFrame + 1);
    }
  }

  prevFrame(): void {
    this.playing = false;
    if (this.curFrame > 1) {
      this.seekAndQueue(this.curFrame - 1);
    }
  }

  /** A goto from game code: the target frame's scripts run later (`runQueuedFrameActions`). */
  private seekAndQueue(target: number): void {
    if (target === this.curFrame) return;
    this.seekToFrame(target, false);
    if (this.def.frames[target - 1]?.actions) queuedActions.push({ clip: this, frame: target });
  }

  /** Runs a queued frame's scripts, as Flash does, even if the clip has left that frame since. */
  runQueuedActions(frame: number): void {
    if (this.removed || this.destroyed) return;
    this.runFrameActions(frame, 0);
  }

  removeMovieClip(): void {
    this.playing = false;
    this.removed = true;
    if (this.parent) {
      this.parent.removeChild(this);
    }
    this.mcName = '';
  }

  /** Typed lookup for a named child MovieClip (`sub`, `skin`, `maskTile`, etc.). */
  getClip(name: string): SwfMovieClip | null {
    const n = this.namedChildren.get(name);
    return n instanceof SwfMovieClip ? n : null;
  }

  /** Typed lookup for a named child that masks others (`clipDepth`), e.g. a bar's fill. */
  getMask(name: string): SwfMaskClip | null {
    const n = this.namedChildren.get(name);
    return n instanceof SwfMaskClip ? n : null;
  }

  /** Typed lookup for a named child dynamic text field (`score0`, `level`, etc.). */
  getText(name: string): SwfTextField | null {
    const n = this.namedChildren.get(name);
    return n instanceof SwfTextField ? n : null;
  }

  /** Recursively locates the first `SwfTextField` inside this MovieClip subtree. */
  findFirstText(maxDepth = 4): SwfTextField | null {
    if (maxDepth < 0) return null;
    for (const child of this.children) {
      if (child instanceof SwfTextField) return child;
      if (child instanceof SwfMovieClip) {
        const found = child.findFirstText(maxDepth - 1);
        if (found) return found;
      }
    }
    return null;
  }

  /** Tints the MovieClip towards a solid hex color (`percent` 0..100), matching Entity.setColorHex. */
  setColorHex(percent: number, hex: number): void {
    const p = Math.max(0, Math.min(1, percent / 100));
    const q = 1 - p;
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    if (!this.tintFilter) {
      if (this.lib.headless) return;
      this.tintFilter = new ColorMatrixFilter();
      this.applyEntityFilters();
    }
    this.tintFilter.matrix = [
      q,
      0,
      0,
      0,
      r * p,
      0,
      q,
      0,
      0,
      g * p,
      0,
      0,
      q,
      0,
      b * p,
      0,
      0,
      0,
      1,
      0,
    ];
  }

  /**
   * Flash `BlurFilter` (default quality 1, a box blur `blurX` px wide). Approximated with Pixi's
   * gaussian blur at half that strength. Replaces the clip's filters; skipped when headless.
   */
  setBlur(blurX: number, blurY: number): void {
    if (this.lib.headless) return;
    const f = new BlurFilter({ quality: 1 });
    f.strengthX = blurX / 2;
    f.strengthY = blurY / 2;
    this.filters = [f];
  }

  resetColor(): void {
    if (this.tintFilter) {
      this.tintFilter = null;
      this.applyEntityFilters();
    }
  }

  /**
   * Flash `filters = [new GlowFilter(...)]`, kept alongside the `setColorHex` tint. Skipped when
   * headless.
   */
  setGlow(color: number, alpha: number, blurX: number, blurY: number, strength: number): void {
    if (this.lib.headless) return;
    if (!this.glowFilter) {
      this.glowFilter = new GlowFilter();
      this.applyEntityFilters();
    }
    const g = this.glowFilter;
    g.color = color;
    g.alpha = alpha;
    g.blurX = blurX;
    g.blurY = blurY;
    g.strength = strength;
  }

  /** Flash `blendMode = BlendMode.OVERLAY`, kept with the glow and tint. Skipped when headless. */
  setOverlayBlend(): void {
    if (this.lib.headless || this.overlayFilter) return;
    this.overlayFilter = new OverlayFilter();
    this.applyEntityFilters();
  }

  /** Flash `filters = null` for a glow set by `setGlow`. */
  clearGlow(): void {
    if (this.glowFilter) {
      this.glowFilter = null;
      this.applyEntityFilters();
    }
  }

  private applyEntityFilters(): void {
    const l = [];
    if (this.glowFilter) l.push(this.glowFilter);
    if (this.tintFilter) l.push(this.tintFilter);
    if (this.overlayFilter) l.push(this.overlayFilter);
    this.filters = l;
  }

  /** Advances this clip and all playing descendant MovieClips by one timeline frame. */
  stepAnimation(guardDepth = 0): void {
    this.goLive();
    if (!this.visible || guardDepth > 32) return;

    if (this.playing && this.def.frameCount > 1) {
      const next = this.curFrame >= this.def.frameCount ? 1 : this.curFrame + 1;
      this.seekToFrame(next, true);
    }

    for (const child of this.children) {
      if (child instanceof SwfMovieClip) {
        child.stepAnimation(guardDepth + 1);
      }
    }
  }

  // ------------------------------------------------------ Internal timeline

  private resolveFrame(frameOrLabel: number | string): number {
    if (typeof frameOrLabel === 'number') {
      return Math.max(1, Math.min(this.def.frameCount, Math.floor(frameOrLabel)));
    }
    const asNum = Number(frameOrLabel);
    if (Number.isFinite(asNum) && frameOrLabel.trim() !== '') {
      return Math.max(1, Math.min(this.def.frameCount, Math.floor(asNum)));
    }
    const labeled = this.def.labels?.[frameOrLabel];
    if (labeled !== undefined) {
      return Math.max(1, Math.min(this.def.frameCount, labeled));
    }
    return 1;
  }

  private seekToFrame(target: number, runActions: boolean, actionHop = 0): void {
    if (target === this.curFrame) return;

    if (this.curFrame === 0) {
      for (let f = 1; f <= target; f++) {
        this.applyFrameCmds(f);
      }
    } else if (target < this.curFrame) {
      this.rewindTo(target);
    } else {
      for (let f = this.curFrame + 1; f <= target; f++) {
        this.applyFrameCmds(f);
      }
    }
    this.curFrame = target;
    this.refreshClipMasks();

    if (runActions && actionHop < 4) {
      this.runFrameActions(target, actionHop);
    }
  }

  private runFrameActions(frame: number, actionHop: number): void {
    const actions = this.def.frames[frame - 1]?.actions;
    if (!actions) return;
    for (const act of actions) {
      switch (act.op) {
        case 'stop':
          this.playing = false;
          break;
        case 'play':
          if (this.def.frameCount > 1) this.playing = true;
          break;
        case 'removeSelf':
          this.removeMovieClip();
          return;
        case 'gotoFrame':
          this.playing = act.play && this.def.frameCount > 1;
          this.seekToFrame(this.resolveFrame(act.frame), true, actionHop + 1);
          return;
        case 'gotoLabel':
          this.playing = act.play && this.def.frameCount > 1;
          this.seekToFrame(this.resolveFrame(act.label), true, actionHop + 1);
          return;
        case 'avm1':
          if (!this.live) {
            this.pendingFrame = frame;
            break;
          }
          this.actionHop = actionHop;
          runAvm1(act.code, this);
          if (this.curFrame !== frame || this.removed) return;
          break;
      }
    }
  }

  /** Runs the frame scripts that waited for this clip to be live, then does the same below it. */
  goLive(): void {
    if (this.live) return;
    this.live = true;
    const frame = this.pendingFrame;
    this.pendingFrame = 0;
    if (frame !== 0 && frame === this.curFrame) {
      for (const act of this.def.frames[frame - 1]?.actions ?? []) {
        if (act.op !== 'avm1') continue;
        this.actionHop = 0;
        runAvm1(act.code, this);
        if (this.curFrame !== frame || this.removed) break;
      }
    }
    for (const child of [...this.children]) {
      if (child instanceof SwfMovieClip) child.goLive();
    }
  }

  /**
   * Backward seek. Like Flash, children still on the same depth with the same character are kept
   * (with their own state, text and running animations); only the others are replaced.
   */
  private rewindTo(target: number): void {
    const sim = new Map<number, DepthRecord>();
    for (let f = 1; f <= target; f++) {
      for (const cmd of this.def.frames[f - 1]?.cmds ?? []) {
        if (cmd.op === 'remove') {
          sim.delete(cmd.d);
          continue;
        }
        const prev = sim.get(cmd.d);
        if (cmd.u && prev && (cmd.id === undefined || cmd.id === prev.id)) {
          if (cmd.m) prev.m = cmd.m;
          if (cmd.cx) prev.cx = cmd.cx;
          if (cmd.visible !== undefined) prev.visible = cmd.visible;
          if (cmd.blend !== undefined) prev.blend = cmd.blend;
          if (cmd.f !== undefined) prev.f = cmd.f;
          if (cmd.n) prev.n = cmd.n;
        } else if (cmd.id !== undefined) {
          sim.set(cmd.d, {
            id: cmd.id,
            m: cmd.m ?? (cmd.u ? prev?.m : undefined),
            cx: cmd.cx,
            n: cmd.n,
            clip: cmd.clip,
            blend: cmd.blend,
            f: cmd.f,
            visible: cmd.visible,
          });
        } else if (!cmd.u) {
          sim.delete(cmd.d);
        }
      }
    }

    for (const [depth, slot] of [...this.depthSlots]) {
      const rec = sim.get(depth);
      if (!rec || rec.id !== slot.charId || rec.clip !== slot.clipDepth) this.removeSlot(depth);
    }
    for (const [depth, rec] of sim) {
      const slot = this.depthSlots.get(depth);
      if (!slot) {
        this.applyPlace({ op: 'place', d: depth, ...rec });
        continue;
      }
      this.applyMatrix(slot.node, rec.m ?? IDENTITY_MATRIX);
      this.applyLook(slot, rec.cx ?? IDENTITY_CXFORM, rec.blend ?? 0, rec.f ?? []);
      if (rec.visible !== undefined) slot.node.visible = rec.visible;
      if (rec.n !== slot.name) {
        if (slot.name) this.unregisterName(slot.name, slot.node);
        slot.name = rec.n;
        if (rec.n) this.registerName(rec.n, slot.node);
      }
    }
  }

  // ------------------------------------------------------ AVM1 script access

  avmGet(name: string): unknown {
    if (name === '_parent') return this.parent instanceof SwfMovieClip ? this.parent : undefined;
    const index = PROP_INDEX[name];
    if (index !== undefined) return this.avmGetProp(index);
    const child = this.namedChildren.get(name);
    if (child) return child;
    if (this.avmVars.has(name)) return this.avmVars.get(name);
    const host = this.scriptHost;
    if (host && name in host) return host[name];
    return undefined;
  }

  avmSet(name: string, value: unknown): void {
    const index = PROP_INDEX[name];
    if (index !== undefined) {
      this.avmSetProp(index, value);
    } else if (
      this.scriptHost &&
      name in this.scriptHost &&
      typeof this.scriptHost[name] !== 'function'
    ) {
      this.scriptHost[name] = value;
    } else {
      this.avmVars.set(name, value);
    }
    this.updateBoundFields(name);
  }

  /**
   * Sets a variable of this clip, as `mc.label = text` in the original: the text fields bound
   * to it (`DynamicTextDef.variable`) show it, now and when the timeline places them later.
   */
  setVariable(name: string, value: unknown): void {
    this.avmSet(name, value);
  }

  /** Shows variable `name` of this clip in the fields of its subtree bound to it. */
  private updateBoundFields(name: string): void {
    const value = this.avmGet(name);
    if (value === undefined || value instanceof Container) return;
    const visit = (c: Container) => {
      for (const child of c.children) {
        if (child instanceof SwfTextField) {
          if (child.variable && child.parent instanceof SwfMovieClip) {
            const b = child.parent.resolveVariable(child.variable);
            if (b && b[0] === this && b[1] === name) child.text = String(value);
          }
        } else if (child instanceof Container) {
          visit(child);
        }
      }
    };
    visit(this);
  }

  /**
   * The clip and name of variable `path` seen from this clip: `label` is this clip's,
   * `_parent.label` its parent's. Null for a path the game's clips do not use.
   */
  private resolveVariable(path: string): [SwfMovieClip, string] | null {
    const parts = path.split('.');
    let target: SwfMovieClip = this;
    while (parts.length > 1 && parts[0] === '_parent') {
      parts.shift();
      if (!(target.parent instanceof SwfMovieClip)) return null;
      target = target.parent;
    }
    return parts.length === 1 ? [target, parts[0]] : null;
  }

  /** A field just placed shows its variable, if set; else it keeps its own text. */
  private bindField(field: SwfTextField): void {
    const b = this.resolveVariable(field.variable!);
    const value = b?.[0].avmGet(b[1]);
    if (value !== undefined && !(value instanceof Container)) field.text = String(value);
  }

  avmGetProp(index: number): unknown {
    switch (index) {
      case 0:
        return this._x;
      case 1:
        return this._y;
      case 2:
        return this._xscale;
      case 3:
        return this._yscale;
      case 4:
        return this._currentframe;
      case 5:
        return this._totalframes;
      case 6:
        return this._alpha;
      case 7:
        return this._visible;
      case 8:
        return this._width;
      case 9:
        return this._height;
      case 10:
        return this.rotationDeg;
      case 13:
        return this._name;
      default:
        return undefined;
    }
  }

  avmSetProp(index: number, value: unknown): void {
    const n = Number(value);
    switch (index) {
      case 0:
        if (Number.isFinite(n)) this._x = n;
        break;
      case 1:
        if (Number.isFinite(n)) this._y = n;
        break;
      case 2:
        if (Number.isFinite(n)) this._xscale = n;
        break;
      case 3:
        if (Number.isFinite(n)) this._yscale = n;
        break;
      case 6:
        if (Number.isFinite(n)) this._alpha = n;
        break;
      case 7:
        this._visible = Boolean(value);
        break;
      case 8:
        if (Number.isFinite(n)) this._width = n;
        break;
      case 9:
        if (Number.isFinite(n)) this._height = n;
        break;
      case 10:
        if (Number.isFinite(n)) this.rotationDeg = n;
        break;
      case 13:
        this._name = String(value);
        break;
    }
  }

  avmCall(name: string, args: unknown[]): unknown {
    switch (name) {
      case 'gotoAndStop':
        this.avmGoto(args[0], false);
        return undefined;
      case 'gotoAndPlay':
        this.avmGoto(args[0], true);
        return undefined;
      case 'play':
        this.play();
        return undefined;
      case 'stop':
        this.stop();
        return undefined;
      case 'nextFrame':
        this.avmGoto(this.curFrame + 1, false);
        return undefined;
      case 'prevFrame':
        this.avmGoto(this.curFrame - 1, false);
        return undefined;
      case 'removeMovieClip':
        this.removeMovieClip();
        return undefined;
    }
    const host = this.scriptHost;
    if (host && typeof host[name] === 'function') return host[name](...args);
    const fn = this.avmVars.get(name);
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  avmRandom(): number {
    return this.lib.random();
  }

  /** Script goto: unknown labels and invalid numbers are ignored, as in Flash. */
  avmGoto(frame: unknown, play: boolean): void {
    let target: number;
    if (typeof frame === 'number') {
      if (!Number.isFinite(frame)) return;
      target = this.resolveFrame(frame);
    } else if (typeof frame === 'string') {
      const asNum = Number(frame);
      if (frame.trim() !== '' && Number.isFinite(asNum)) target = this.resolveFrame(asNum);
      else if (this.def.labels?.[frame] !== undefined) target = this.resolveFrame(frame);
      else return;
    } else {
      return;
    }
    this.playing = play && this.def.frameCount > 1;
    this.seekToFrame(target, true, this.actionHop + 1);
  }

  private applyFrameCmds(frame1: number): void {
    const frameDef = this.def.frames[frame1 - 1];
    if (!frameDef) return;

    for (const cmd of frameDef.cmds) {
      if (cmd.op === 'remove') {
        this.removeSlot(cmd.d);
      } else {
        this.applyPlace(cmd);
      }
    }
  }

  private removeSlot(depth: number): void {
    const slot = this.depthSlots.get(depth);
    if (!slot) return;
    if (slot.name) this.unregisterName(slot.name, slot.node);
    this.removeChild(slot.node);
    this.depthSlots.delete(depth);
  }

  private applyPlace(cmd: PlaceCmd): void {
    const existing = this.depthSlots.get(cmd.d);

    // Update existing display object at depth
    if (cmd.u && existing && (cmd.id === undefined || cmd.id === existing.charId)) {
      if (cmd.m) this.applyMatrix(existing.node, cmd.m);
      if (cmd.cx || cmd.blend !== undefined || cmd.f !== undefined) {
        this.applyLook(existing, cmd.cx, cmd.blend, cmd.f);
      }
      if (cmd.visible !== undefined) existing.node.visible = cmd.visible;
      if (cmd.n && cmd.n !== existing.name) {
        if (existing.name) this.unregisterName(existing.name, existing.node);
        existing.name = cmd.n;
        this.registerName(cmd.n, existing.node);
      }
      return;
    }

    // Replace or create display object at depth
    const prevMatrix = cmd.u && existing && !cmd.m ? existing.node.localTransform.clone() : null;
    if (existing) this.removeSlot(cmd.d);
    if (cmd.id === undefined) return;

    const node =
      cmd.clip !== undefined
        ? new SwfMaskClip(this.lib.getMaskContext(cmd.id), this.lib.getCharacterBounds(cmd.id))
        : this.lib.instantiateCharacter(cmd.id);
    if (!node) return;

    node.zIndex = cmd.d;
    if (node instanceof SwfMovieClip) {
      node.mcDepth = cmd.d;
      if (cmd.n) node.mcName = cmd.n;
    }

    if (cmd.m) {
      this.applyMatrix(node, cmd.m);
    } else if (prevMatrix) {
      node.setFromMatrix(prevMatrix);
    }

    if (cmd.visible === false) node.visible = false;

    const slot: DepthSlot = {
      depth: cmd.d,
      charId: cmd.id,
      node,
      name: cmd.n,
      clipDepth: cmd.clip,
    };
    if (cmd.cx || cmd.blend !== undefined || cmd.f !== undefined) {
      this.applyLook(slot, cmd.cx, cmd.blend, cmd.f);
    }

    this.depthSlots.set(cmd.d, slot);
    this.addChild(node);
    if (cmd.n) this.registerName(cmd.n, node);
    if (node instanceof SwfTextField && node.variable) this.bindField(node);
    if (this.live && node instanceof SwfMovieClip) node.goLive();
  }

  private applyMatrix(node: Container, [a, b, c, d, tx, ty]: Matrix6): void {
    TMP_MAT.set(a, b, c, d, tx, ty);
    node.setFromMatrix(TMP_MAT);
  }

  /**
   * A slot's color transform, blend mode and filters (each left as it is when undefined). Flash
   * draws a clip with filters as a bitmap, then applies its color transform and blends the
   * result: the Pixi filters follow that order. A pure alpha change is `alpha` (so it applies
   * before the filters, unlike Flash; no timeline fades a clip that has some). Filters are
   * skipped when headless.
   */
  private applyLook(
    slot: DepthSlot,
    cx: Cxform8 | undefined,
    blend: number | undefined,
    filters: TimelineFilter[] | undefined,
  ): void {
    const node = slot.node;
    if (cx) slot.cx = cx;
    if (blend !== undefined) node.blendMode = mapFlashBlendMode(blend);
    const [rm, gm, bm, am, ra, ga, ba, aa] = slot.cx ?? IDENTITY_CXFORM;
    const pureAlpha =
      rm === 1 && gm === 1 && bm === 1 && ra === 0 && ga === 0 && ba === 0 && aa === 0;
    node.alpha = pureAlpha ? Math.max(0, Math.min(1, am)) : 1;
    if (this.lib.headless) return;
    if (filters !== undefined) {
      slot.tlFilters = filters.length > 0 ? makeTimelineFilters(filters) : undefined;
    }
    if (blend !== undefined) {
      if (blend !== BLEND_OVERLAY) slot.blendFilter = undefined;
      else slot.blendFilter ??= new OverlayFilter();
      if (blend !== BLEND_LAYER) slot.layerFilter = undefined;
      else
        slot.layerFilter ??= new AlphaFilter({
          alpha: 1,
          resolution: 'inherit',
          antialias: 'inherit',
        });
    }
    if (slot.layerFilter) {
      slot.layerFilter.alpha = node.alpha;
      node.alpha = 1;
    }

    if (pureAlpha) {
      slot.cxFilter = undefined;
    } else {
      slot.cxFilter ??= new ColorMatrixFilter({ resolution: 'inherit', antialias: 'inherit' });
      slot.cxFilter.matrix = [
        rm,
        0,
        0,
        0,
        ra / 255,
        0,
        gm,
        0,
        0,
        ga / 255,
        0,
        0,
        bm,
        0,
        ba / 255,
        0,
        0,
        0,
        am,
        aa / 255,
      ];
    }

    const list: Filter[] = [...(slot.tlFilters ?? [])];
    if (slot.cxFilter) list.push(slot.cxFilter);
    if (slot.layerFilter) list.push(slot.layerFilter);
    if (slot.blendFilter) list.push(slot.blendFilter);
    node.filters = list.length > 0 ? list : null;
  }

  private refreshClipMasks(): void {
    const masks: { start: number; end: number; gfx: Graphics }[] = [];
    for (const slot of this.depthSlots.values()) {
      slot.node.mask = null;
      if (slot.clipDepth !== undefined && slot.node instanceof SwfMaskClip) {
        masks.push({ start: slot.depth, end: slot.clipDepth, gfx: slot.node.gfx });
      }
    }
    if (masks.length === 0) return;

    for (const slot of this.depthSlots.values()) {
      if (slot.clipDepth !== undefined) continue;
      for (const m of masks) {
        if (slot.depth > m.start && slot.depth <= m.end) {
          slot.node.mask = m.gfx;
          break;
        }
      }
    }
  }

  private registerName(name: string, node: Container): void {
    this.namedChildren.set(name, node);
    if (!PROTECTED_PROPS.has(name)) {
      this[name] = node;
    }
    if (name.startsWith('$')) {
      const clean = name.slice(1);
      this.namedChildren.set(clean, node);
      if (!PROTECTED_PROPS.has(clean)) {
        this[clean] = node;
      }
    }
  }

  private unregisterName(name: string, node: Container): void {
    if (this.namedChildren.get(name) === node) {
      this.namedChildren.delete(name);
      if (!PROTECTED_PROPS.has(name) && this[name] === node) {
        delete this[name];
      }
    }
    if (name.startsWith('$')) {
      const clean = name.slice(1);
      if (this.namedChildren.get(clean) === node) {
        this.namedChildren.delete(clean);
        if (!PROTECTED_PROPS.has(clean) && this[clean] === node) {
          delete this[clean];
        }
      }
    }
  }
}

export { Sprite };
