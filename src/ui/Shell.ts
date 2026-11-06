/**
 * The screens that replace the hammerfest.fr site (roadmap 3.1 and 3.2d): the mode menu, the
 * results page after a game, the quests and the fridge. They are drawn inside the game frame
 * with the game's own graphics: a level background (`hammer_bg`), the parchment and keys of the
 * pause screen (`hammer_interf_instructions`), the item clips, and the site's logo banner, mode
 * icons and tab icons (`public/site/`, copied by `tools/build-site.ts`). Texts use the game's
 * fonts and colors.
 *
 * Not a port: the original showed these as web pages (PORT_STATUS.md, "Site screens"). The
 * mode list and texts follow the site guide; the results show what the game sends the site;
 * the quest and fridge pages show the profile (3.2b) as the site's pages did: quests done and
 * in progress with their items, and the items found with their count. The selected mode's
 * options are checkboxes under its text, the locked ones greyed, as the site's `.mopt` box
 * and `.lidis` rule drew them (3.3).
 */
import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import type { InputController } from '../engine/Input';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import { Data } from '../game/Data';
import type { GameResult } from '../game/Loader';
import { type GameRecord, MODE_OPTIONS, type Profile, resultPicks } from '../game/Profile';

/** The game's lang texts the screens reuse. */
export interface ShellTexts {
  readonly langId: string;
  /** `$statics` text `id` of the current language. */
  getStatic(id: number): string;
  /** Item name by item id (score items from 1000). */
  getItemName(id: number): string;
  /** `Lang.getSectorName`: the name of the area of level `lid` in dimension `did`. */
  getSectorName(did: number, lid: number): string;
  getFamilyName(id: number): string;
  getQuestName(id: number): string;
  getQuestDesc(id: number): string;
}

type Lang = 'fr' | 'en' | 'es';
type Screen = 'menu' | 'result' | 'quests' | 'fridge';

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

interface TabEntry {
  screen: 'quests' | 'fridge';
  icon: string;
}

/** The site's tabs under the mode menu: its "Quêtes" and "Réfrigérateur" icons. */
const TABS: TabEntry[] = [
  { screen: 'quests', icon: 'icon_quests' },
  { screen: 'fridge', icon: 'icon_inventory' },
];

/** What the menu's arrows move through: the modes, each with its unlocked options, the tabs. */
type MenuEntry =
  | { kind: 'mode'; mode: ModeEntry }
  | { kind: 'option'; mode: ModeEntry; oid: string }
  | { kind: 'tab'; tab: TabEntry };

/**
 * Texts. Mode names and descriptions, "Quêtes" and "Réfrigérateur" are the site guide's
 * (`guide.html` of hammerfest.fr, hfest.net and hammerfest.es), "N objets sur 353" and
 * "Aucune ! Il va falloir jouer plus !" the public profile's, the option names those of the
 * quests that unlock them (`xml/lang`, quests 62 to 74; "Tornado" is the port's own, as only
 * the French text names it); the others are the port's own.
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
    quests: 'Quêtes',
    fridge: 'Réfrigérateur',
    questsDesc: '{0} quêtes terminées sur {1}, {2} en cours.',
    fridgeDesc: '{0} objets sur {1}',
    noQuest: 'Aucune ! Il va falloir jouer plus !',
    done: 'terminée',
    questDone: 'Quête terminée : {0}',
    moreQuests: 'et {0} autres quêtes terminées',
    newFridge: '{0} nouveaux objets dans le réfrigérateur',
    newFridge1: 'Un nouvel objet dans le réfrigérateur',
    unknown: 'Objet inconnu',
    found: 'Trouvé {0} fois',
    back: 'Retour',
    options: 'Options',
    mirror: 'Miroir',
    nightmare: 'Cauchemar',
    ninja: 'Ninjutsu',
    bombexpert: 'Explosifs instables',
    boost: 'Tornade',
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
    quests: 'Quests',
    fridge: 'Fridge',
    questsDesc: '{0} quests done out of {1}, {2} in progress.',
    fridgeDesc: '{0} items out of {1}',
    noQuest: 'None! You will have to play more!',
    done: 'done',
    questDone: 'Quest done: {0}',
    moreQuests: 'and {0} more quests done',
    newFridge: '{0} new items in the fridge',
    newFridge1: 'One new item in the fridge',
    unknown: 'Unknown item',
    found: 'Found {0} times',
    back: 'Back',
    options: 'Options',
    mirror: 'Mirror',
    nightmare: 'Nightmare',
    ninja: 'Ninjutsu',
    bombexpert: 'Unstable explosives',
    boost: 'Tornado',
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
    quests: 'Exploraciones',
    fridge: 'Frigorífico',
    questsDesc: '{0} exploraciones terminadas de {1}, {2} en curso.',
    fridgeDesc: '{0} objetos de {1}',
    noQuest: '¡Ninguna! ¡Tendrás que jugar más!',
    done: 'terminada',
    questDone: 'Exploración terminada: {0}',
    moreQuests: 'y {0} exploraciones más',
    newFridge: '{0} objetos nuevos en el frigorífico',
    newFridge1: 'Un objeto nuevo en el frigorífico',
    unknown: 'Objeto desconocido',
    found: 'Encontrado {0} veces',
    back: 'Volver',
    options: 'Opciones',
    mirror: 'Espejo',
    nightmare: 'Pesadilla',
    ninja: 'Ninjutsu',
    bombexpert: 'Explosivos inestables',
    boost: 'Tornado',
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
/** The site's color of a completed quest (`.statusCompleted`). */
const GREEN = '#51cc15';

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

/** Quest rows shown at once. */
const QUEST_ROWS = 8;
/** Fridge grid. */
const FRIDGE_COLS = 10;
const FRIDGE_ROWS = 6;
const FRIDGE_PAGE = FRIDGE_COLS * FRIDGE_ROWS;
const FRIDGE_CELL = 34;

export class Shell {
  readonly root = new Container();
  private readonly lib: SwfLibrary;
  private readonly input: InputController;
  private readonly texts: ShellTexts;
  private readonly profile: Profile;
  private readonly images = new Map<string, Texture>();
  private screen: Screen | null = null;
  private result: GameResult | null = null;
  private record: GameRecord | null = null;
  /** Index in `menuEntries()`. */
  private selected = 0;
  private questSel = 0;
  private questTop = 0;
  private fridgeSel = 0;

  /** "Start game" on Adventure: the site loads the game page with `$mode`. */
  onStart?: (mode: string) => void;

  constructor(lib: SwfLibrary, input: InputController, texts: ShellTexts, profile: Profile) {
    this.lib = lib;
    this.input = input;
    this.texts = texts;
    this.profile = profile;
    this.root.visible = false;
    this.root.eventMode = 'static';
  }

  /** Loads the site images the screens use. */
  async load(baseUrl: string): Promise<void> {
    const files = [
      'img/design/headers/fr/header.jpg',
      'img/items/small/a.gif',
      ...MODES.map((m) => `img/design/menu/${m.icon}.gif`),
      ...TABS.flatMap((t) => [`img/design/${t.icon}.png`, `img/design/${t.icon}_on.png`]),
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

  /** The screen showing, if any. */
  get current(): Screen | null {
    return this.screen;
  }

  showMenu(): void {
    this.screen = 'menu';
    this.selected = Math.min(this.selected, this.menuEntries().length - 1);
    this.result = null;
    this.record = null;
    this.render();
  }

  /**
   * The page the site loaded once the game was saved: the results of `result`, and what it
   * added to the profile (`record`, for an Adventure game).
   */
  showResult(result: GameResult, record: GameRecord | null = null): void {
    this.screen = 'result';
    this.result = result;
    this.record = record;
    this.render();
  }

  showQuests(): void {
    this.screen = 'quests';
    this.questSel = 0;
    this.questTop = 0;
    this.render();
  }

  showFridge(): void {
    this.screen = 'fridge';
    this.fridgeSel = 0;
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

  /** Keys, once per frame while a screen shows: arrows choose, space confirms. */
  update(): void {
    if (!this.screen) return;
    const inp = this.input;
    inp.poll();
    const up = inp.consumePress('jump');
    const down = inp.consumePress('down');
    const left = inp.consumePress('left');
    const right = inp.consumePress('right');
    const ok = inp.consumePress('attack');
    const esc = inp.consumePress('pause');
    switch (this.screen) {
      case 'menu': {
        const entries = this.menuEntries();
        if (up) this.select(this.selected - 1);
        if (down) this.select(this.selected + 1);
        if (entries[this.selected].kind === 'tab' && (left || right)) {
          // the two tabs side by side, last in the list
          const first = entries.length - TABS.length;
          this.select(this.selected === first ? first + 1 : first);
        }
        if (ok) this.confirm();
        break;
      }
      case 'result':
        if (ok || up) this.showMenu();
        break;
      case 'quests':
        if (up) this.selectQuest(this.questSel - 1);
        if (down) this.selectQuest(this.questSel + 1);
        if (ok || esc) this.showMenu();
        break;
      case 'fridge':
        if (left) this.selectItem(this.fridgeSel - 1);
        if (right) this.selectItem(this.fridgeSel + 1);
        if (up) this.selectItem(this.fridgeSel - FRIDGE_COLS);
        if (down) this.selectItem(this.fridgeSel + FRIDGE_COLS);
        if (ok || esc) this.showMenu();
        break;
    }
  }

  private menuEntries(): MenuEntry[] {
    const out: MenuEntry[] = [];
    for (const mode of MODES) {
      out.push({ kind: 'mode', mode });
      if (!mode.enabled) continue;
      for (const oid of MODE_OPTIONS[mode.mode] ?? []) {
        if (this.profile.hasOption(oid)) out.push({ kind: 'option', mode, oid });
      }
    }
    for (const tab of TABS) out.push({ kind: 'tab', tab });
    return out;
  }

  private select(i: number): void {
    const count = this.menuEntries().length;
    const n = (i + count) % count;
    if (n === this.selected) return;
    this.selected = n;
    this.render();
  }

  private confirm(): void {
    const e = this.menuEntries()[this.selected];
    if (e.kind === 'tab') {
      if (e.tab.screen === 'quests') this.showQuests();
      else this.showFridge();
    } else if (e.kind === 'option') {
      this.profile.toggleOption(e.oid);
      this.render();
    } else if (e.mode.enabled) {
      this.onStart?.(e.mode.mode);
    }
  }

  /** Selects menu entry `i`, or confirms it when it is already selected (a click). */
  private clickEntry(i: number): void {
    if (this.selected === i) this.confirm();
    else this.select(i);
  }

  private selectQuest(i: number): void {
    const n = Math.max(0, Math.min(this.questList().length - 1, i));
    if (n === this.questSel) return;
    this.questSel = n;
    if (n < this.questTop) this.questTop = n;
    if (n >= this.questTop + QUEST_ROWS) this.questTop = n - QUEST_ROWS + 1;
    this.render();
  }

  private selectItem(i: number): void {
    const n = Math.max(0, Math.min(this.profile.quests.itemIds.length - 1, i));
    if (n === this.fridgeSel) return;
    this.fridgeSel = n;
    this.render();
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
    else if (this.screen === 'quests') this.drawQuests();
    else if (this.screen === 'fridge') this.drawFridge();
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
      parent?: Container;
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
    (opts.parent ?? this.root).addChild(t);
    return t;
  }

  /** A clickable area holding its children. */
  private button(action: () => void): Container {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.on('pointertap', action);
    this.root.addChild(c);
    return c;
  }

  /** The space bar key of the pause screen, with `label` beside it; clicking runs `action`. */
  private keyButton(label: string, y: number, action: () => void, size?: number): void {
    const key = this.lib.instantiateCharacter(KEY_ID);
    const group = this.button(action);
    if (key) group.addChild(key);
    const keyText = this.text(this.texts.getStatic(10) || 'SPACE', 'key', 0, 0, { parent: group });
    const b = group.getLocalBounds();
    keyText.position.set(b.x + b.width / 2, b.y + (b.height - keyText.height) / 2 - 1);
    const lbl = this.text(label, 'label', 0, 0, { align: 'left', size, parent: group });
    lbl.position.set(b.x + b.width + 12, b.y + (b.height - lbl.height) / 2);
    const gb = group.getLocalBounds();
    group.position.set(W / 2 - gb.x - gb.width / 2, y - gb.y);
  }

  /** The item's clip as it looks in the game, fitted in a `size` px cell centered on (x, y). */
  private itemIcon(id: number, x: number, y: number, size: number, parent?: Container): void {
    const mc = this.lib.attach(id >= 1000 ? 'hammer_item_score' : 'hammer_item_special');
    mc.gotoAndStop(String(id >= 1000 ? id - 999 : id + 1));
    const b = mc.getLocalBounds();
    const fit = Math.min(1, size / Math.max(b.width, b.height, 1));
    mc.scale.set(fit);
    mc.position.set(x - (b.x + b.width / 2) * fit, y - (b.y + b.height / 2) * fit);
    (parent ?? this.root).addChild(mc);
  }

  /** The site's icon of an item not in the fridge yet (`img/items/small/a.gif`). */
  private unknownIcon(x: number, y: number, size: number, parent?: Container): void {
    const tex = this.images.get('img/items/small/a.gif');
    if (!tex) return;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.scale.set(size / tex.width);
    s.position.set(x, y);
    (parent ?? this.root).addChild(s);
  }

  private highlight(
    x: number,
    y: number,
    w: number,
    h: number,
    on: boolean | number,
    parent?: Container,
  ) {
    const alpha = on === true ? 0.55 : on === false ? 0 : on;
    const g = new Graphics().roundRect(x, y, w, h, 6).fill({ color: 0x5f452c, alpha });
    (parent ?? this.root).addChild(g);
  }

  // ------------------------------------------------------------------ menu

  private drawMenu(): void {
    const t = this.t;
    const entries = this.menuEntries();
    const cur = entries[this.selected];
    this.parchment(W / 2, 300, 380, 296);
    this.text(t.modes, 'title', W / 2, 172);

    MODES.forEach((m, i) => {
      const y = 212 + i * 36;
      const n = entries.findIndex((e) => e.kind === 'mode' && e.mode === m);
      const sel = n === this.selected;
      // An option of the mode is selected: the mode stays lit, less
      const lit = sel ? true : cur.kind === 'option' && cur.mode === m ? 0.3 : false;
      const row = this.button(() => this.clickEntry(n));
      this.highlight(70, y - 4, 280, 31, lit, row);
      const icon = this.images.get(`img/design/menu/${m.icon}.gif`);
      if (icon) {
        const s = new Sprite(icon);
        s.position.set(82, y);
        s.alpha = m.enabled ? 1 : 0.5;
        row.addChild(s);
      }
      const name = m.enabled ? t[m.mode] : `${t[m.mode]} (${t.soon})`;
      this.text(name, 'label', 116, y, {
        align: 'left',
        color: m.enabled ? (sel ? '#ffffff' : STYLE.label.color) : 'rgb(170,140,100)',
        parent: row,
      });
    });

    const mode = cur.kind === 'tab' ? null : cur.mode;
    const desc = cur.kind === 'tab' ? this.tabSummary(cur.tab.screen) : t[cur.mode.mode + 'Desc'];
    this.text(desc, 'tip', W / 2, 284, { width: 300, size: 11 });
    if (mode) this.drawOptions(mode, entries);

    if (cur.kind === 'tab') this.keyButton(t[cur.tab.screen], 458, () => this.confirm());
    else if (cur.mode.enabled) {
      this.keyButton(t.start, 458, () => this.onStart?.(cur.mode.mode));
    }

    // The site's tabs, its quest and fridge icons
    TABS.forEach((tb, i) => {
      const n = entries.findIndex((e) => e.kind === 'tab' && e.tab === tb);
      const sel = n === this.selected;
      const x = W / 2 + (i === 0 ? -62 : 62);
      const btn = this.button(() => this.clickEntry(n));
      const tex = this.images.get(`img/design/${tb.icon}${sel ? '_on' : ''}.png`);
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0.5, 0);
        s.scale.set(0.6);
        s.position.set(x, 384);
        btn.addChild(s);
      }
      this.text(t[tb.screen], 'click', x, 418, {
        size: 12,
        color: sel ? '#ffffff' : STYLE.click.color,
        parent: btn,
      });
    });
  }

  /**
   * The mode's options (the site's `.mopt` box): a checkbox each, greyed while locked. The
   * Tornade boost has no box to untick: once unlocked it applies to every game (quest 62).
   */
  private drawOptions(mode: ModeEntry, entries: MenuEntry[]): void {
    const list = MODE_OPTIONS[mode.mode];
    if (!mode.enabled || !list) return;
    const t = this.t;
    this.text(t.options.toUpperCase(), 'tip', W / 2, 318, { size: 9, color: STYLE.click.color });
    [...list, Data.OPT_BOOST].forEach((oid, k) => {
      const x = k < 3 ? 76 : 226;
      const y = 334 + (k % 3) * 16;
      const unlocked = this.profile.hasOption(oid);
      const fixed = oid === Data.OPT_BOOST;
      const ticked = fixed ? unlocked : this.profile.isChosen(oid);
      const n = entries.findIndex((e) => e.kind === 'option' && e.oid === oid);
      const sel = n >= 0 && n === this.selected;
      const row = n >= 0 ? this.button(() => this.clickEntry(n)) : this.root;
      this.highlight(x - 6, y - 2, 140, 16, sel, row);
      const box = new Graphics().rect(x, y + 2, 9, 9).stroke({
        color: 0xe6c592,
        width: 1,
        alpha: unlocked ? 1 : 0.35,
      });
      if (ticked) {
        box
          .moveTo(x + 1.5, y + 6.5)
          .lineTo(x + 4, y + 9)
          .lineTo(x + 8.5, y + 3)
          .stroke({ color: sel ? 0xffffff : 0xe6c592, width: 2 });
      }
      row.addChild(box);
      this.text(t[oid], 'click', x + 15, y, {
        align: 'left',
        size: 11,
        color: !unlocked ? 'rgb(140,112,80)' : sel ? '#ffffff' : STYLE.click.color,
        parent: row,
      });
    });
  }

  private tabSummary(screen: 'quests' | 'fridge'): string {
    const p = this.profile.data;
    const q = this.profile.quests;
    if (screen === 'quests') {
      const progress = q.quests.filter((x) => q.status(p, x.id) === 'progress').length;
      return fmt(this.t.questsDesc, p.quests.length, q.quests.length, progress);
    }
    const ids = q.itemIds;
    return fmt(this.t.fridgeDesc, ids.filter((id) => q.inFridge(p, id)).length, ids.length);
  }

  // ---------------------------------------------------------------- quests

  /** Quests done, then quests in progress, each in id order, as on the site's profile. */
  private questList(): number[] {
    const q = this.profile.quests;
    const p = this.profile.data;
    const ids = q.quests.map((x) => x.id);
    return [
      ...ids.filter((id) => q.status(p, id) === 'done'),
      ...ids.filter((id) => q.status(p, id) === 'progress'),
    ];
  }

  private drawQuests(): void {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    this.parchment(W / 2, 318, 404, 392);
    this.text(t.quests, 'title', W / 2, 130);
    this.text(this.tabSummary('quests'), 'tip', W / 2, 160, { size: 11 });

    const list = this.questList();
    if (list.length === 0) {
      this.text(t.noQuest, 'click', W / 2, 240, { width: 320 });
    }
    list.slice(this.questTop, this.questTop + QUEST_ROWS).forEach((id, k) => {
      const i = this.questTop + k;
      const y = 182 + k * 20;
      const sel = i === this.questSel;
      const row = this.button(() => this.selectQuest(i));
      this.highlight(36, y - 2, 348, 20, sel, row);
      const done = q.status(p, id) === 'done';
      this.text(this.texts.getQuestName(id), 'click', 46, y, {
        align: 'left',
        size: 13,
        color: sel ? '#ffffff' : done ? GREEN : STYLE.click.color,
        parent: row,
      });
      const reqs = q.requirements(id);
      const met = reqs.filter((r) => (p.items[r.item] ?? 0) >= r.qty).length;
      this.text(done ? t.done : `${met} / ${reqs.length}`, 'tip', 374, y + 2, {
        align: 'right',
        color: done ? GREEN : STYLE.tip.color,
        parent: row,
      });
    });
    if (this.questTop > 0) this.text('▲', 'tip', W / 2, 171, { size: 9 });
    if (this.questTop + QUEST_ROWS < list.length) {
      this.text('▼', 'tip', W / 2, 182 + QUEST_ROWS * 20 - 2, { size: 9 });
    }

    const id = list[this.questSel];
    if (id !== undefined) this.drawQuestDetail(id);

    this.keyButton(t.back, 470, () => this.showMenu(), 14);
  }

  /** The quest's items with "found / needed" (`.itemQuest`), and its text once done. */
  private drawQuestDetail(id: number): void {
    const q = this.profile.quests;
    const p = this.profile.data;
    const reqs = q.requirements(id);
    const cell = Math.min(34, 360 / reqs.length);
    const x0 = W / 2 - (reqs.length * cell) / 2;
    const y = 362;
    reqs.forEach((r, i) => {
      const x = x0 + i * cell + cell / 2;
      const have = p.items[r.item] ?? 0;
      if (have > 0) this.itemIcon(r.item, x, y, cell - 8);
      else this.unknownIcon(x, y, Math.min(20, cell - 10));
      this.text(`${Math.min(have, r.qty)}/${r.qty}`, 'tip', x, y + 14, {
        size: 9,
        color: have >= r.qty ? GREEN : STYLE.tip.color,
      });
    });
    if (q.status(p, id) === 'done') {
      this.text(this.texts.getQuestDesc(id), 'tip', W / 2, 394, { width: 350, size: 10 });
    }
  }

  // ---------------------------------------------------------------- fridge

  private drawFridge(): void {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const ids = q.itemIds;
    this.parchment(W / 2, 318, 404, 392);
    this.text(t.fridge, 'title', W / 2, 130);
    this.text(this.tabSummary('fridge'), 'tip', W / 2, 160, { size: 11 });

    const page = Math.floor(this.fridgeSel / FRIDGE_PAGE);
    const pages = Math.ceil(ids.length / FRIDGE_PAGE);
    const x0 = W / 2 - (FRIDGE_COLS * FRIDGE_CELL) / 2;
    const y0 = 178;
    ids.slice(page * FRIDGE_PAGE, (page + 1) * FRIDGE_PAGE).forEach((id, k) => {
      const i = page * FRIDGE_PAGE + k;
      const cx = x0 + (k % FRIDGE_COLS) * FRIDGE_CELL;
      const cy = y0 + Math.floor(k / FRIDGE_COLS) * FRIDGE_CELL;
      const cellBtn = this.button(() => this.selectItem(i));
      this.highlight(cx, cy, FRIDGE_CELL - 2, FRIDGE_CELL - 2, i === this.fridgeSel, cellBtn);
      const mx = cx + FRIDGE_CELL / 2 - 1;
      const my = cy + FRIDGE_CELL / 2 - 1;
      if (q.inFridge(p, id)) {
        this.itemIcon(id, mx, my, FRIDGE_CELL - 8, cellBtn);
        const n = p.items[id] ?? 0;
        if (n > 1) {
          const c = this.text(`${n}`, 'tip', 0, 0, { size: 9, color: '#ffffff', parent: cellBtn });
          c.anchor.set(1, 1);
          c.position.set(cx + FRIDGE_CELL - 3, cy + FRIDGE_CELL - 2);
        }
      } else {
        this.unknownIcon(mx, my, 20, cellBtn);
      }
    });

    // Pages
    const py = y0 + FRIDGE_ROWS * FRIDGE_CELL + 4;
    this.text(`${page + 1} / ${pages}`, 'tip', W / 2, py, { size: 11 });
    if (page > 0) {
      const b = this.button(() => this.selectItem((page - 1) * FRIDGE_PAGE));
      this.text('◀', 'click', W / 2 - 50, py - 2, { parent: b });
    }
    if (page < pages - 1) {
      const b = this.button(() => this.selectItem((page + 1) * FRIDGE_PAGE));
      this.text('▶', 'click', W / 2 + 50, py - 2, { parent: b });
    }

    // The selected item: name, family and count (the site's `table.fridge` columns)
    const id = ids[this.fridgeSel];
    const n = p.items[id] ?? 0;
    const known = q.inFridge(p, id);
    this.text(known ? this.texts.getItemName(id) : t.unknown, 'label', W / 2, 402, { size: 15 });
    const fid = q.familyOf(id);
    if (fid !== undefined) {
      const fam = q.itemsOf(fid);
      const have = fam.filter((x) => q.inFridge(p, x)).length;
      const name = this.texts.getFamilyName(fid);
      this.text(`${name} (${have}/${fam.length})`, 'click', W / 2, 422, { size: 12 });
    }
    if (n > 0) {
      const s = known ? fmt(t.found, n) : `${fmt(t.found, n)} (${n}/${q.unlockCount(id)})`;
      this.text(s, 'tip', W / 2, 440, { size: 10 });
    }

    this.keyButton(t.back, 470, () => this.showMenu(), 14);
  }

  // --------------------------------------------------------------- results

  /**
   * What the game sent the site: the reached level and score for a game over, and the items
   * found. The end of the set sends no score (`GameMode.exitGame`). Then what the game added
   * to the profile: the quests it completed and the new fridge items.
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

    // Quest lines above the key
    const lines: { s: string; color: string }[] = [];
    const done = this.record?.quests ?? [];
    for (const id of done.slice(0, done.length > 3 ? 2 : 3)) {
      lines.push({ s: fmt(t.questDone, this.texts.getQuestName(id)), color: GREEN });
    }
    if (done.length > 3) lines.push({ s: fmt(t.moreQuests, done.length - 2), color: GREEN });
    const fridge = this.record?.fridge.length ?? 0;
    if (fridge > 0) {
      const s = fridge === 1 ? t.newFridge1 : fmt(t.newFridge, fridge);
      lines.push({ s, color: STYLE.click.color });
    }
    const linesTop = 446 - lines.length * 17;
    lines.forEach((l, i) => {
      this.text(l.s, 'click', W / 2, linesTop + i * 17, { size: 12, color: l.color });
    });

    const picks = resultPicks(r);
    this.text(picks.length > 0 ? t.collected : t.none, 'click', W / 2, y);
    y += 22;
    const bottom = lines.length > 0 ? linesTop - 4 : r.kind === 'gameOver' ? 425 : 455;
    this.drawItems(picks, y, bottom);

    this.keyButton(this.texts.getStatic(6) || '...', 458, () => this.showMenu(), 14);
  }

  /** The items in rows, as they look in the game, with their count. */
  private drawItems(picks: [number, number][], top: number, bottom: number): void {
    const cols = 8;
    const cell = 40;
    const rows = Math.max(1, Math.ceil(picks.length / cols));
    const size = Math.min(cell, (bottom - top) / rows);
    const x0 = W / 2 - (Math.min(cols, picks.length) * size) / 2;
    picks.forEach(([id, n], i) => {
      const x = x0 + (i % cols) * size + size / 2;
      const y = top + Math.floor(i / cols) * size + size / 2;
      this.itemIcon(id, x, y, size - 8 * (size / cell));
      if (n > 1) {
        const c = this.text(`x${n}`, 'tip', 0, 0, { size: 10, color: '#ffffff' });
        c.anchor.set(1, 1);
        c.position.set(x + size / 2 - 1, y + size / 2);
      }
    });
  }
}

/** Replaces `{0}`, `{1}`... with the arguments. */
function fmt(s: string, ...args: (string | number)[]): string {
  return s.replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)]));
}

/** Scores with dot thousands, as the site wrote them: `8.684.323`. */
function formatScore(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
