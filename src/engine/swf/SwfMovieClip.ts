import type { BLEND_MODES } from 'pixi.js';
import { ColorMatrixFilter, Container, Graphics, Matrix, Sprite, Text, TextStyle } from 'pixi.js';
import type { SwfLibrary } from './SwfLibrary';
import type { Cxform8, DynamicTextDef, Matrix6, PlaceCmd, SpriteDef } from './types';

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

/** Flash-compatible dynamic text field (`DefineDynamicText`). */
export class SwfTextField extends Container {
  private readonly pixiText: Text;
  private readonly boxX0: number;
  private readonly boxWidth: number;
  private readonly align: DynamicTextDef['align'];
  private rawText = '';

  constructor(def: DynamicTextDef) {
    super();
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
    this.text = def.text;
  }

  get text(): string {
    return this.rawText;
  }

  set text(v: string) {
    this.rawText = String(v ?? '');
    this.pixiText.text = this.rawText;
    this.realign();
  }

  get htmlText(): string {
    return this.rawText;
  }

  set htmlText(v: string) {
    const stripped = String(v ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    this.text = stripped;
  }

  get textColor(): number {
    const f = this.pixiText.style.fill;
    return typeof f === 'number' ? f : 0xffffff;
  }

  set textColor(hex: number) {
    this.pixiText.style.fill = hex;
  }

  get textWidth(): number {
    return this.pixiText.width;
  }

  get textHeight(): number {
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

/** Unpadded vector stencil mask container used for SWF `clipDepth` layers. */
export class SwfMaskClip extends Container {
  readonly gfx: Graphics;

  constructor(bounds: [number, number, number, number]) {
    super();
    this.gfx = new Graphics();
    this.gfx.rect(bounds[0], bounds[1], bounds[2], bounds[3]).fill(0xffffff);
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
    return this.width;
  }
  set _width(v: number) {
    this.width = v;
  }
  get _height(): number {
    return this.height;
  }
  set _height(v: number) {
    this.height = v;
  }
  get _xscale(): number {
    return this.scale.x * 100;
  }
  set _xscale(v: number) {
    this.scale.x = v / 100;
  }
  get _yscale(): number {
    return this.scale.y * 100;
  }
  set _yscale(v: number) {
    this.scale.y = v / 100;
  }
}

interface DepthSlot {
  depth: number;
  charId: number;
  node: Container;
  name?: string;
  clipDepth?: number;
  cxFilter?: ColorMatrixFilter;
}

const TMP_MAT = new Matrix();

function mapFlashBlendMode(mode?: number): BLEND_MODES {
  switch (mode) {
    case 3:
      return 'multiply';
    case 4:
      return 'screen';
    case 8:
      return 'add';
    default:
      return 'normal';
  }
}

/**
 * Flash AVM1-compatible `MovieClip` runtime built on PixiJS v8 `Container`.
 *
 * Replays `DefineSprite` timelines, supports nested named clips (`mc.sub`,
 * `mc.skin`, `mc.maskTile`, etc.), `clipDepth` stencil masks, color transforms,
 * frame labels, frame actions, and AS2 underscore properties.
 */
export class SwfMovieClip extends Container {
  readonly lib: SwfLibrary;
  readonly def: SpriteDef;

  private curFrame = 0; // 0 = not yet initialized; 1..frameCount once constructed
  private playing = true;
  private depthSlots = new Map<number, DepthSlot>();
  private namedChildren = new Map<string, Container>();
  private tintFilter: ColorMatrixFilter | null = null;
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
    return this.scale.x * 100;
  }
  set _xscale(v: number) {
    this.scale.x = v / 100;
  }

  get _yscale(): number {
    return this.scale.y * 100;
  }
  set _yscale(v: number) {
    this.scale.y = v / 100;
  }

  get rotationDeg(): number {
    return this.angle;
  }
  set rotationDeg(v: number) {
    this.angle = v;
  }

  get _alpha(): number {
    return this.alpha * 100;
  }
  set _alpha(v: number) {
    this.alpha = Math.max(0, Math.min(1, v / 100));
  }

  get _visible(): boolean {
    return this.visible;
  }
  set _visible(v: boolean) {
    this.visible = v;
  }

  get _width(): number {
    return this.width;
  }
  set _width(v: number) {
    this.width = v;
  }

  get _height(): number {
    return this.height;
  }
  set _height(v: number) {
    this.height = v;
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
    this.seekToFrame(target, false);
  }

  gotoAndPlay(frameOrLabel: number | string): void {
    const target = this.resolveFrame(frameOrLabel);
    this.playing = this.def.frameCount > 1;
    this.seekToFrame(target, true);
  }

  nextFrame(): void {
    this.playing = false;
    if (this.curFrame < this.def.frameCount) {
      this.seekToFrame(this.curFrame + 1, false);
    }
  }

  prevFrame(): void {
    this.playing = false;
    if (this.curFrame > 1) {
      this.seekToFrame(this.curFrame - 1, false);
    }
  }

  removeMovieClip(): void {
    this.playing = false;
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
      this.tintFilter = new ColorMatrixFilter();
      this.filters = [this.tintFilter];
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

  resetColor(): void {
    if (this.tintFilter) {
      this.filters = [];
      this.tintFilter = null;
    }
  }

  /** Advances this clip and all playing descendant MovieClips by one timeline frame. */
  stepAnimation(guardDepth = 0): void {
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

    if (target < this.curFrame || this.curFrame === 0) {
      this.clearAllSlots();
      for (let f = 1; f <= target; f++) {
        this.applyFrameCmds(f);
      }
    } else {
      for (let f = this.curFrame + 1; f <= target; f++) {
        this.applyFrameCmds(f);
      }
    }
    this.curFrame = target;
    this.refreshClipMasks();

    if (runActions && actionHop < 4) {
      const frameDef = this.def.frames[target - 1];
      if (frameDef?.actions) {
        for (const act of frameDef.actions) {
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
          }
        }
      }
    }
  }

  private clearAllSlots(): void {
    for (const slot of this.depthSlots.values()) {
      if (slot.name) this.unregisterName(slot.name, slot.node);
      this.removeChild(slot.node);
    }
    this.depthSlots.clear();
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
      if (cmd.cx) this.applyCxform(existing, cmd.cx);
      if (cmd.visible !== undefined) existing.node.visible = cmd.visible;
      if (cmd.blend !== undefined) existing.node.blendMode = mapFlashBlendMode(cmd.blend);
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
        ? new SwfMaskClip(this.lib.getCharacterBounds(cmd.id))
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
    if (cmd.blend !== undefined) node.blendMode = mapFlashBlendMode(cmd.blend);

    const slot: DepthSlot = {
      depth: cmd.d,
      charId: cmd.id,
      node,
      name: cmd.n,
      clipDepth: cmd.clip,
    };
    if (cmd.cx) this.applyCxform(slot, cmd.cx);

    this.depthSlots.set(cmd.d, slot);
    this.addChild(node);
    if (cmd.n) this.registerName(cmd.n, node);
  }

  private applyMatrix(node: Container, [a, b, c, d, tx, ty]: Matrix6): void {
    TMP_MAT.set(a, b, c, d, tx, ty);
    node.setFromMatrix(TMP_MAT);
  }

  private applyCxform(slot: DepthSlot, [rm, gm, bm, am, ra, ga, ba, aa]: Cxform8): void {
    const pureAlpha =
      rm === 1 && gm === 1 && bm === 1 && ra === 0 && ga === 0 && ba === 0 && aa === 0;
    if (pureAlpha) {
      slot.node.alpha = Math.max(0, Math.min(1, am));
      if (slot.cxFilter) {
        slot.node.filters = [];
        slot.cxFilter = undefined;
      }
      return;
    }
    slot.node.alpha = 1;
    if (!slot.cxFilter) {
      slot.cxFilter = new ColorMatrixFilter();
      slot.node.filters = [slot.cxFilter];
    }
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
