import { Container, Graphics, ImageSource, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type { PadLayout } from '../../engine/Gamepad';
import { PAD_ICON_DATA, type PadIconData } from './padIconData';

/**
 * Controller buttons as the screens show them (roadmap G.1). Port addition: the Flash game had
 * the keyboard only. Buttons are named by their place in the standard mapping (`a` is the
 * bottom face button, `b` the right one, `x` the left one, `y` the top one), and shown as the
 * controller in use labels them: Xbox letters, PlayStation shapes or Nintendo letters (which
 * swap A and B, X and Y).
 *
 * They are the icons of three Figma Community sheets (`assets-src/pad-icons/`), drawn in the
 * colors of the screen under them (`PadTheme`). A button with no icon is drawn here instead.
 */
export type PadButton = 'a' | 'b' | 'x' | 'y' | 'r2' | 'start' | 'back' | 'dpad' | 'stick';

type Face = 'a' | 'b' | 'x' | 'y';

/** Face button labels per layout. */
const XBOX: Record<Face, string> = { a: 'A', b: 'B', x: 'X', y: 'Y' };

const FACE: Record<PadLayout, Record<Face, string>> = {
  xbox: XBOX,
  generic: XBOX,
  playstation: { a: '✕', b: '○', x: '□', y: '△' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X' },
};

/** The other buttons' names, as each maker prints them. */
const OTHER: Record<PadLayout, Record<'r2' | 'start' | 'back' | 'stick', string>> = {
  xbox: { r2: 'RT', start: 'MENU', back: 'VIEW', stick: 'L' },
  generic: { r2: 'R2', start: 'START', back: 'SELECT', stick: 'L' },
  playstation: { r2: 'R2', start: 'OPTIONS', back: 'SHARE', stick: 'L' },
  nintendo: { r2: 'ZR', start: '+', back: '−', stick: 'L' },
};

/** The text label of a button (texts, and buttons with no icon). The D-pad has none. */
export function padLabel(button: PadButton, layout: PadLayout): string {
  if (button === 'dpad') return '';
  if (button in FACE[layout]) return FACE[layout][button as Face];
  return OTHER[layout][button as keyof (typeof OTHER)['xbox']];
}

/**
 * The colors of a button: `onDark` on the wood buttons (a parchment button with wood letters),
 * `onLight` on parchment (a wood button with parchment letters).
 */
export type PadTheme = 'onDark' | 'onLight';

export const PAD_THEMES: Record<PadTheme, { body: string; ink: string }> = {
  onDark: { body: '#fffaf0', ink: '#5f452c' },
  onLight: { body: '#3f2c1b', ink: '#f3e2bd' },
};

/**
 * The icon of a button. An unknown controller has Xbox's, but its own Start and Select; the
 * D-pad and the stick fall back to Xbox's, as all makers draw them alike.
 */
function iconOf(button: PadButton, layout: PadLayout): PadIconData | undefined {
  if (layout === 'generic') {
    return button === 'start' || button === 'back' ? undefined : PAD_ICON_DATA.xbox?.[button];
  }
  const own = PAD_ICON_DATA[layout]?.[button];
  if (own || (button !== 'dpad' && button !== 'stick')) return own;
  return PAD_ICON_DATA.xbox?.[button];
}

/** The icon's SVG in `body` and `ink` colors, `height` px tall for its button. */
function iconSvg(icon: PadIconData, body: string, ink: string, height: number): string {
  const s = height / icon.box;
  return icon.svg
    .replace(/__BODY__/g, body)
    .replace(/__INK__/g, ink)
    .replace(
      /^<svg width="[\d.]+" height="[\d.]+"/,
      `<svg width="${icon.w * s}" height="${icon.h * s}"`,
    );
}

/**
 * The SVG markup of a button for the page (the help dialog), its button `height` px tall, or
 * null when it has no icon.
 */
export function padIconHtml(
  button: PadButton,
  layout: PadLayout,
  height: number,
  theme: PadTheme = 'onLight',
): string | null {
  const icon = iconOf(button, layout);
  if (!icon) return null;
  const t = PAD_THEMES[theme];
  return iconSvg(icon, t.body, t.ink, height);
}

/** Icons are drawn this many times their frame size, so they stay sharp on a large frame. */
const ICON_RES = 6;
const textures = new Map<string, Texture>();

/**
 * Draws every icon once per theme, as textures (the browser draws the SVG: it has masks and
 * letters with holes). Until it is done, and in Node, the buttons are drawn by `padGlyph`.
 */
export async function loadPadIcons(): Promise<void> {
  if (typeof Image === 'undefined') return;
  const jobs: Promise<void>[] = [];
  for (const [layout, icons] of Object.entries(PAD_ICON_DATA)) {
    for (const [button, icon] of Object.entries(icons)) {
      for (const theme of Object.keys(PAD_THEMES) as PadTheme[]) {
        const t = PAD_THEMES[theme];
        const svg = iconSvg(icon, t.body, t.ink, icon.box * ICON_RES);
        const img = new Image();
        const done = new Promise<void>((resolve) => {
          img.onload = () => {
            const source = new ImageSource({ resource: img, autoGenerateMipmaps: true });
            textures.set(`${layout}/${button}/${theme}`, new Texture({ source }));
            resolve();
          };
          img.onerror = () => resolve();
        });
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        jobs.push(done);
      }
    }
  }
  await Promise.all(jobs);
}

/** A button whose own part is `size` px tall, centered on (0, 0). */
export function padGlyph(
  button: PadButton,
  layout: PadLayout,
  size: number,
  theme: PadTheme = 'onLight',
): Container {
  const icon = iconOf(button, layout);
  if (icon) {
    // The icon's layout: Xbox's for the shared ones
    const from = PAD_ICON_DATA[layout]?.[button] === icon ? layout : 'xbox';
    const tex = textures.get(`${from}/${button}/${theme}`);
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      const s = size / icon.box;
      sp.width = icon.w * s;
      sp.height = icon.h * s;
      const c = new Container();
      c.addChild(sp);
      return c;
    }
  }
  return drawGlyph(button, layout, size, theme);
}

/** A button drawn in the icons' style, for the ones with no icon. */
function drawGlyph(button: PadButton, layout: PadLayout, size: number, theme: PadTheme): Container {
  const body = PAD_THEMES[theme].body;
  const ink = PAD_THEMES[theme].ink;
  const c = new Container();
  if (button === 'dpad') {
    const t = size / 3;
    const h = size / 2;
    c.addChild(
      new Graphics()
        .roundRect(-t / 2, -h, t, size, t * 0.15)
        .roundRect(-h, -t / 2, size, t, t * 0.15)
        .fill(body),
    );
    return c;
  }
  const label = padLabel(button, layout);
  if (button === 'start' || button === 'back' || button === 'r2') {
    const txt = text(label, size * (label.length > 2 ? 0.42 : 0.6), ink);
    const h = size * (button === 'r2' ? 1 : 0.7);
    const w = Math.max(h * 1.2, txt.width + size * 0.5);
    c.addChild(new Graphics().roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill(body), txt);
    return c;
  }
  const r = size / 2;
  c.addChild(new Graphics().circle(0, 0, r).fill(body));
  if (layout === 'playstation' && button !== 'stick')
    c.addChild(psShape(button as Face, r * 0.42, ink));
  else c.addChild(text(label, size * 0.56, ink));
  return c;
}

/** The PlayStation shapes, `s` px from the center to their edge. */
function psShape(button: Face, s: number, color: string): Graphics {
  const w = Math.max(1.5, s * 0.4);
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
  return g.stroke({ color, width: w, join: 'round' });
}

const FONT = '"Franklin Gothic Heavy", "Arial Black", Impact, sans-serif';

function text(s: string, size: number, color: string): Text {
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
