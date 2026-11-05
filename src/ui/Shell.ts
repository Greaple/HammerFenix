/**
 * The screens that replace the hammerfest.fr site (roadmap 3.1): the mode menu and the results
 * page after a game. They are drawn inside the game frame with the game's own graphics: a level
 * background (`hammer_bg`), the parchment and keys of the pause screen
 * (`hammer_interf_instructions`), the item clips, and the site's logo banner and mode icons
 * (`public/site/`, copied by `tools/build-site.ts`). Texts use the game's fonts and colors.
 *
 * Not a port: the original showed these as web pages (PORT_STATUS.md, "Site screens"). The
 * mode list and texts follow the site guide; the results show what the game sends the site.
 */
import { Container, Graphics, Sprite, Text, TextStyle, Texture, Rectangle } from 'pixi.js';
import { PersistCodec } from '../engine/codec/PersistCodec';
import type { InputController } from '../engine/Input';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import type { GameResult } from '../game/Loader';

/** The game's lang texts the screens reuse. */
export interface ShellTexts {
  readonly langId: string;
  /** `$statics` text `id` of the current language. */
  getStatic(id: number): string;
  /** Item name by item id (score items from 1000). */
  getItemName(id: number): string;
  /** `Lang.getSectorName`: the name of the area of level `lid` in dimension `did`. */
  getSectorName(did: number, lid: number): string;
}

type Lang = 'fr' | 'en' | 'es';

interface ModeEntry {
  /** The site's menu icon (`menu/<icon>.gif`) and `$mode`. */
  icon: string;
  mode: string;
  /** Ported in the game; the others are listed but cannot start. */
  enabled: boolean;
}

/** The modes a new player has: Adventure and the free Learning mode (site guide, section 3). */
const MODES: ModeEntry[] = [
  { icon: 'iadv', mode: 'solo', enabled: true },
  { icon: 'itutorial', mode: 'tutorial', enabled: false },
];

/**
 * Texts. Mode names and descriptions are the site guide's (`guide.html` of hammerfest.fr,
 * hfest.net and hammerfest.es); the others are the port's own.
 */
const TEXT: Record<Lang, Record<string, string>> = {
  fr: {
    modes: 'Modes de jeu',
    solo: 'Aventure',
    tutorial: 'Apprentissage',
    soloDesc:
      'Faites des quêtes, débloquez de nouveaux modes de jeu et gagnez des points pour monter la Pyramide !',
    tutorialDesc:
      'Apprenez les techniques de base avant de vous lancer dans l’Aventure. Illimité et gratuit.',
    start: 'Commencer',
    soon: 'bientôt',
    gameOver: 'Partie terminée',
    endGame: 'Fin de l’aventure !',
    collected: 'Objets trouvés',
    none: 'Aucun objet trouvé',
  },
  en: {
    modes: 'Game modes',
    solo: 'Adventure',
    tutorial: 'Learning',
    soloDesc: 'Find quests, unblock new game modes and obtain points to climb up the pyramid!',
    tutorialDesc:
      'Learn the basic techniques before playing the Adventure mode. Free and unlimited.',
    start: 'Start game',
    soon: 'soon',
    gameOver: 'Game over',
    endGame: 'End of the adventure!',
    collected: 'Items found',
    none: 'No item found',
  },
  es: {
    modes: 'Modos de juego',
    solo: 'Aventura',
    tutorial: 'Aprendizaje',
    soloDesc:
      '¡Haz exploraciones, desbloquea nuevos modos de juego y gana puntos para subir en la pirámide!',
    tutorialDesc:
      'Aprende las técnicas básicas antes de lanzarte al modo Aventura. Ilimitado y gratuito.',
    start: 'Comenzar',
    soon: 'pronto',
    gameOver: 'Fin de la partida',
    endGame: '¡Fin de la aventura!',
    collected: 'Objetos encontrados',
    none: 'Ningún objeto',
  },
};

const W = 420;
const H = 520;
/** The parchment bitmap of `hammer_interf_instructions` (300 x 250 px, in shape 376). */
const PARCHMENT_BITMAP = 22;
/** The wide key of the same clip (the space bar). */
const KEY_ID = 389;
/** `hammer_bg` frame behind the screens: the stone wall of the first caverns. */
const BG_FRAME = 3;

/** Colors and fonts of `hammer_interf_instructions` (`title`, `move`, `tip`, `click`). */
const STYLE = {
  title: { font: 'Satans', size: 24, color: 'rgb(95,69,44)' },
  label: { font: 'Franklin Gothic Heavy', size: 18, color: 'rgb(230,197,146)' },
  tip: { font: 'Verdana', size: 10, color: 'rgb(230,190,134)' },
  click: { font: 'Franklin Gothic Heavy', size: 13, color: 'rgb(208,174,113)' },
  sector: { font: 'Franklin Gothic Heavy', size: 15, color: 'rgb(255,255,255)' },
  key: { font: 'Franklin Gothic Heavy', size: 14, color: 'rgb(102,102,102)' },
};

type TextKind = keyof typeof STYLE;

export class Shell {
  readonly root = new Container();
  private readonly lib: SwfLibrary;
  private readonly input: InputController;
  private readonly texts: ShellTexts;
  private readonly images = new Map<string, Texture>();
  private screen: 'menu' | 'result' | null = null;
  private result: GameResult | null = null;
  private selected = 0;

  /** "Start game" on Adventure: the site loads the game page with `$mode`. */
  onStart?: (mode: string) => void;

  constructor(lib: SwfLibrary, input: InputController, texts: ShellTexts) {
    this.lib = lib;
    this.input = input;
    this.texts = texts;
    this.root.visible = false;
    this.root.eventMode = 'static';
  }

  /** Loads the site images the screens use. */
  async load(baseUrl: string): Promise<void> {
    const files = [
      'img/design/headers/fr/header.jpg',
      ...MODES.map((m) => `img/design/menu/${m.icon}.gif`),
    ];
    await Promise.all(
      files.map(async (f) => {
        const img = new Image();
        img.src = `${baseUrl}site/${f}`;
        await img.decode();
        this.images.set(f, Texture.from(img));
      }),
    );
  }

  get visible(): boolean {
    return this.root.visible;
  }

  showMenu(): void {
    this.screen = 'menu';
    this.result = null;
    this.render();
  }

  /** The page the site loaded once the game was saved: the results of `result`. */
  showResult(result: GameResult): void {
    this.screen = 'result';
    this.result = result;
    this.render();
  }

  hide(): void {
    this.screen = null;
    this.root.visible = false;
    this.clear();
  }

  /** Redraws the current screen, e.g. after a language change. */
  refresh(): void {
    if (this.screen) this.render();
  }

  /** Keys, once per frame while a screen shows: up/down choose, space confirms. */
  update(): void {
    if (!this.screen) return;
    this.input.poll();
    if (this.screen === 'menu') {
      if (this.input.consumePress('jump')) this.select(this.selected - 1);
      if (this.input.consumePress('down')) this.select(this.selected + 1);
      if (this.input.consumePress('attack')) this.confirm();
    } else if (this.input.consumePress('attack') || this.input.consumePress('jump')) {
      this.showMenu();
    }
  }

  private select(i: number): void {
    const n = (i + MODES.length) % MODES.length;
    if (n === this.selected) return;
    this.selected = n;
    this.render();
  }

  private confirm(): void {
    const m = MODES[this.selected];
    if (m.enabled) this.onStart?.(m.mode);
  }

  private get t(): Record<string, string> {
    const l = this.texts.langId;
    return TEXT[l === 'en' || l === 'es' ? l : 'fr'];
  }

  private clear(): void {
    for (const c of this.root.removeChildren()) c.destroy({ children: true });
  }

  private render(): void {
    this.clear();
    this.root.visible = true;
    this.root.parent?.addChild(this.root); // above the Loader's clip
    this.drawBackground();
    if (this.screen === 'menu') this.drawMenu();
    else if (this.result) this.drawResult(this.result);
  }

  private drawBackground(): void {
    const bg = this.lib.attach('hammer_bg');
    bg.gotoAndStop(String(BG_FRAME));
    // Levels show it at 400 x 500 under the interface; the screens fill the whole frame
    const b = bg.getLocalBounds();
    bg.scale.set(W / b.width, H / b.height);
    bg.position.set(-b.x * bg.scale.x, -b.y * bg.scale.y);
    this.root.addChild(bg);
    // The banner: the site's logo with Tuberculoz, without its purple bar
    const tex = this.images.get('img/design/headers/fr/header.jpg');
    if (tex) {
      const banner = new Sprite(
        new Texture({ source: tex.source, frame: new Rectangle(0, 0, 762, 176) }),
      );
      banner.scale.set(W / 762);
      banner.y = 4;
      this.root.addChild(banner);
    }
  }

  /** The parchment of the pause screen, scaled to `w` x `h` and centered on (`x`, `y`). */
  private parchment(x: number, y: number, w: number, h: number): void {
    const tex = this.lib.bitmapTexture(PARCHMENT_BITMAP);
    if (!tex) return;
    const p = new Sprite(tex);
    p.anchor.set(0.5);
    p.scale.set(w / tex.width, h / tex.height);
    p.position.set(x, y);
    this.root.addChild(p);
  }

  private text(
    s: string,
    kind: TextKind,
    x: number,
    y: number,
    opts: {
      width?: number;
      align?: 'left' | 'center' | 'right';
      size?: number;
      color?: string;
    } = {},
  ): Text {
    const st = STYLE[kind];
    const align = opts.align ?? 'center';
    const t = new Text({
      text: s,
      style: new TextStyle({
        fontFamily: `${st.font}, "Arial Black", Impact, system-ui, sans-serif`,
        fontSize: opts.size ?? st.size,
        fontWeight: kind === 'tip' ? 'normal' : 'bold',
        fill: opts.color ?? st.color,
        align,
        wordWrap: opts.width !== undefined,
        wordWrapWidth: opts.width ?? 0,
        dropShadow:
          kind === 'title' || kind === 'key'
            ? undefined
            : { color: '#000000', alpha: 0.65, blur: 1, distance: 1 },
      }),
    });
    t.anchor.set(align === 'center' ? 0.5 : align === 'right' ? 1 : 0, 0);
    t.position.set(x, y);
    this.root.addChild(t);
    return t;
  }

  /** The space bar key of the pause screen, with `label` beside it; clicking runs `action`. */
  private keyButton(label: string, y: number, action: () => void, size?: number): void {
    const key = this.lib.instantiateCharacter(KEY_ID);
    const group = new Container();
    if (key) group.addChild(key);
    this.root.addChild(group);
    const keyText = this.text(this.texts.getStatic(10) || 'SPACE', 'key', 0, 0);
    group.addChild(keyText);
    const b = group.getLocalBounds();
    keyText.position.set(b.x + b.width / 2, b.y + (b.height - keyText.height) / 2 - 1);
    const lbl = this.text(label, 'label', 0, 0, { align: 'left', size });
    group.addChild(lbl);
    lbl.position.set(b.x + b.width + 12, b.y + (b.height - lbl.height) / 2);
    const gb = group.getLocalBounds();
    group.position.set(W / 2 - gb.x - gb.width / 2, y - gb.y);
    group.eventMode = 'static';
    group.cursor = 'pointer';
    group.on('pointertap', action);
  }

  private drawMenu(): void {
    const t = this.t;
    this.parchment(W / 2, 288, 380, 230);
    this.text(t.modes, 'title', W / 2, 190);

    MODES.forEach((m, i) => {
      const y = 232 + i * 36;
      const sel = i === this.selected;
      const row = new Container();
      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointertap', () => {
        if (this.selected === i) this.confirm();
        else this.select(i);
      });
      this.root.addChild(row);
      const hl = new Graphics()
        .roundRect(70, y - 4, 280, 31, 6)
        .fill({ color: 0x5f452c, alpha: sel ? 0.55 : 0 });
      row.addChild(hl);
      const icon = this.images.get(`img/design/menu/${m.icon}.gif`);
      if (icon) {
        const s = new Sprite(icon);
        s.position.set(82, y);
        s.alpha = m.enabled ? 1 : 0.5;
        row.addChild(s);
      }
      const name = m.enabled ? t[m.mode] : `${t[m.mode]} (${t.soon})`;
      const lbl = this.text(name, 'label', 116, y, {
        align: 'left',
        color: m.enabled ? (sel ? '#ffffff' : STYLE.label.color) : 'rgb(170,140,100)',
      });
      row.addChild(lbl);
    });

    const m = MODES[this.selected];
    this.text(t[m.mode + 'Desc'], 'tip', W / 2, 312, { width: 300, size: 11 });

    if (m.enabled) this.keyButton(t.start, 420, () => this.confirm());
  }

  /**
   * What the game sent the site: the reached level and score for a game over, and the items
   * found. The end of the set sends no score (`GameMode.exitGame`).
   */
  private drawResult(r: GameResult): void {
    const t = this.t;
    this.parchment(W / 2, 318, 400, 330);
    this.text(r.kind === 'gameOver' ? t.gameOver : t.endGame, 'title', W / 2, 168);

    let y = 206;
    if (r.kind === 'gameOver') {
      const lvl = r.stats.reachedLevel;
      this.text(`${this.texts.getStatic(1)} ${lvl}`, 'label', W / 2, y);
      const sector = this.texts.getSectorName(0, lvl);
      if (sector) this.text(sector, 'click', W / 2, y + 22);
      this.text(`${formatScore(r.score)} pts`, 'label', W / 2, y + 42, {
        size: 22,
        color: '#ffffff',
      });
      y += 76;
    }

    const picks = resultPicks(r);
    this.text(picks.length > 0 ? t.collected : t.none, 'click', W / 2, y);
    y += 22;
    this.drawItems(picks, y, r.kind === 'gameOver' ? 425 : 455);

    this.keyButton(this.texts.getStatic(6) || '...', 458, () => this.showMenu(), 14);
  }

  /** The items in rows, as they look in the game, with their count. */
  private drawItems(picks: [number, number][], top: number, bottom: number): void {
    const cols = 8;
    const cell = 40;
    const rows = Math.max(1, Math.ceil(picks.length / cols));
    const size = Math.min(cell, (bottom - top) / rows);
    const scale = size / cell;
    const x0 = W / 2 - (Math.min(cols, picks.length) * size) / 2;
    picks.forEach(([id, n], i) => {
      const mc = this.lib.attach(id >= 1000 ? 'hammer_item_score' : 'hammer_item_special');
      mc.gotoAndStop(String(id >= 1000 ? id - 999 : id + 1));
      const holder = new Container();
      holder.addChild(mc);
      const b = mc.getLocalBounds();
      const fit = Math.min(1, (cell - 8) / Math.max(b.width, b.height, 1));
      mc.scale.set(fit);
      mc.position.set(-(b.x + b.width / 2) * fit, -(b.y + b.height / 2) * fit);
      holder.scale.set(scale);
      holder.position.set(
        x0 + (i % cols) * size + size / 2,
        top + Math.floor(i / cols) * size + size / 2,
      );
      this.root.addChild(holder);
      if (n > 1) {
        const c = this.text(`x${n}`, 'tip', 0, 0, { size: 10, color: '#ffffff' });
        c.anchor.set(1, 1);
        c.position.set(holder.x + size / 2 - 1, holder.y + size / 2);
      }
    });
  }
}

/**
 * The items found in the game, as `[item id, count]` in id order. A game over sends `$item2`
 * (count per id, score items at id + 1000); the end of the set sends the special and score
 * pick arrays, `PersistCodec` encoded (`GameMode.exitGame`).
 */
export function resultPicks(r: GameResult): [number, number][] {
  let counts: number[] = [];
  if (r.kind === 'gameOver') {
    counts = r.stats.item2;
  } else if (r.params) {
    const codec = new PersistCodec();
    const [special, score] = (codec.decode<string>(r.params) ?? '').split(':');
    (codec.decode<number[]>(special ?? '') ?? []).forEach((n, id) => (counts[id] = n));
    (codec.decode<number[]>(score ?? '') ?? []).forEach((n, id) => (counts[id + 1000] = n));
  }
  const out: [number, number][] = [];
  counts.forEach((n, id) => {
    if (n > 0) out.push([id, n]);
  });
  return out;
}

/** Scores with dot thousands, as the site wrote them: `8.684.323`. */
function formatScore(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
