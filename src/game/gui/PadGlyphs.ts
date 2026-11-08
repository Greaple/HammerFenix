import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { PadLayout } from '../../engine/Gamepad';

/**
 * Controller buttons as the screens show them (roadmap G.1). Port addition: the Flash game had
 * the keyboard only. Buttons are named by their place in the standard mapping (`a` is the
 * bottom face button, `b` the right one, `x` the left one, `y` the top one), and drawn with the
 * labels of the controller in use: Xbox letters, PlayStation shapes or Nintendo letters (which
 * swap A and B, X and Y).
 */
export type PadButton = 'a' | 'b' | 'x' | 'y' | 'start' | 'back' | 'dpad';

type Face = 'a' | 'b' | 'x' | 'y';

/** Face button label and color per layout. PlayStation labels are drawn as shapes. */
const XBOX = {
  a: { label: 'A', color: 0x6cc24a },
  b: { label: 'B', color: 0xe5484d },
  x: { label: 'X', color: 0x3e8ed0 },
  y: { label: 'Y', color: 0xf2c230 },
};

const FACE: Record<PadLayout, Record<Face, { label: string; color: number }>> = {
  xbox: XBOX,
  generic: XBOX,
  playstation: {
    a: { label: '✕', color: 0x8fb4f0 },
    b: { label: '○', color: 0xf07a80 },
    x: { label: '□', color: 0xe59ad8 },
    y: { label: '△', color: 0x52c9a8 },
  },
  nintendo: {
    a: { label: 'B', color: 0xe8e8e8 },
    b: { label: 'A', color: 0xe8e8e8 },
    x: { label: 'Y', color: 0xe8e8e8 },
    y: { label: 'X', color: 0xe8e8e8 },
  },
};

/** Start and Back / Select, as each maker names them. */
const MENU: Record<PadLayout, { start: string; back: string }> = {
  xbox: { start: 'MENU', back: 'VIEW' },
  generic: { start: 'START', back: 'SELECT' },
  playstation: { start: 'OPTIONS', back: 'SHARE' },
  nintendo: { start: '+', back: '−' },
};

/** The text label of a button (the help dialog). The D-pad has none. */
export function padLabel(button: PadButton, layout: PadLayout): string {
  if (button === 'start' || button === 'back') return MENU[layout][button];
  if (button === 'dpad') return '';
  return FACE[layout][button].label;
}

/** The color of a face button's label. */
export function padColor(button: PadButton, layout: PadLayout): number {
  return button in FACE[layout] ? FACE[layout][button as Face].color : 0xffffff;
}

const BODY = 0x2b2622;
const RIM = 0x14110f;
const FONT = '"Franklin Gothic Heavy", "Arial Black", Impact, sans-serif';

/**
 * A button drawn `size` px tall, centered on (0, 0). `rim` outlines it, so it reads on a dark
 * background.
 */
export function padGlyph(
  button: PadButton,
  layout: PadLayout,
  size: number,
  rim: number = RIM,
): Container {
  const c = new Container();
  const rimW = Math.max(1, size / (rim === RIM ? 16 : 10));
  if (button === 'dpad') {
    const t = size / 3;
    const h = size / 2;
    const g = new Graphics()
      .roundRect(-t / 2, -h, t, size, t * 0.25)
      .roundRect(-h, -t / 2, size, t, t * 0.25)
      .fill(BODY)
      .stroke({ color: rim, width: rimW });
    // An arrow tip on each arm
    const a = t * 0.28;
    const e = h - t * 0.3;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const tipX = dx * e;
      const tipY = dy * e;
      const baseX = dx * (e - a * 1.3);
      const baseY = dy * (e - a * 1.3);
      g.poly([tipX, tipY, baseX - dy * a, baseY - dx * a, baseX + dy * a, baseY + dx * a]).fill(
        0xd9d0c4,
      );
    }
    c.addChild(g);
    return c;
  }
  if (button === 'start' || button === 'back') {
    const label = MENU[layout][button];
    const txt = text(label, size * 0.42, 0xffffff);
    const h = size * 0.7;
    const w = Math.max(h * 1.4, txt.width + size * 0.5);
    c.addChild(
      new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, h / 2)
        .fill(BODY)
        .stroke({ color: rim, width: rimW }),
      txt,
    );
    return c;
  }
  const r = size / 2;
  const { label, color } = FACE[layout][button];
  c.addChild(new Graphics().circle(0, 0, r).fill(BODY).stroke({ color: rim, width: rimW }));
  if (layout === 'playstation') c.addChild(psShape(button, r * 0.42, color));
  else c.addChild(text(label, size * 0.56, color));
  return c;
}

/** The PlayStation shapes, `s` px from the center to their edge. */
function psShape(button: Face, s: number, color: number): Graphics {
  const w = Math.max(1.5, s * 0.34);
  const g = new Graphics();
  if (button === 'a') {
    g.moveTo(-s, -s).lineTo(s, s).moveTo(s, -s).lineTo(-s, s);
  } else if (button === 'b') {
    g.circle(0, 0, s);
  } else if (button === 'x') {
    g.rect(-s * 0.85, -s * 0.85, s * 1.7, s * 1.7);
  } else {
    g.poly([0, -s, s, s * 0.75, -s, s * 0.75]);
  }
  return g.stroke({ color, width: w, cap: 'round', join: 'round' });
}

function text(s: string, size: number, color: number): Text {
  const t = new Text({
    text: s,
    style: new TextStyle({ fontFamily: FONT, fontSize: size, fill: color }),
  });
  t.anchor.set(0.5);
  return t;
}

/** The port's own texts for controller players, in the game's languages. */
const TEXT: Record<'fr' | 'en' | 'es', { start: string }> = {
  // As `Lang` static 53 ("Cliquez pour commencer..."), with the confirm button
  fr: { start: 'Appuyez sur {0} pour commencer...' },
  en: { start: 'Press {0} to start...' },
  es: { start: 'Pulsa {0} para comenzar...' },
};

/** "Press A to start...", in language `langId`, with the controller's confirm button. */
export function padStartText(langId: string, layout: PadLayout): string {
  const t = TEXT[langId === 'en' || langId === 'es' ? langId : 'fr'];
  return t.start.replace('{0}', padLabel('a', layout));
}
