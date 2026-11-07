/**
 * The screens that replace the hammerfest.fr site (roadmap 3.1 and 3.2d): the mode menu, the
 * results page after a game, the quests and the fridge. They are drawn inside the game frame
 * with the game's own graphics: the village scene (`menu`, vector), the game's title logo
 * (`mainTitle.png` of the original, upscaled: the only raster), item clips as icons, the
 * pause screen's space key, and the game's fonts (Satans titles, Franklin Gothic Heavy labels,
 * extracted from `_gfx.swf` by `tools/build-fonts.ts`). Panels are drawn as vectors in the
 * parchment and wood colors, so they stay sharp at any size (UI batch U.2).
 *
 * Not a port: the original showed these as web pages (PORT_STATUS.md, "Site screens"). The
 * mode list and texts follow the site guide; the results show what the game sends the site;
 * the quest and fridge pages show the profile (3.2b): quests done, in progress and still to
 * discover, and the item collection with its "found N times" rule. The selected mode's options
 * are checkboxes under its text, the locked ones with the quest that unlocks them (3.3).
 */
import {
  BlurFilter,
  ColorMatrixFilter,
  Container,
  type FederatedWheelEvent,
  Graphics,
  ImageSource,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from 'pixi.js';
import type { InputController } from '../engine/Input';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import { Data } from '../game/Data';
import type { GameResult } from '../game/Loader';
import { type GameRecord, MODE_OPTIONS, type Profile, resultPicks } from '../game/Profile';
import type { Lang } from './Language';

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

/**
 * The game's title logo, the one image not in the SWFs: `mainTitle.png` of the original
 * (420 x 180) upscaled to 2000 x 857 by the maintainer (`assets-src/upscaled/`).
 */
export const TITLE_FILE = 'images/mainTitle.webp';

/**
 * The game over picture of the results page (a melted Igor), the site's `.artResult`: never
 * archived, given by the maintainer (1216 x 877, `assets-src/upscaled/`).
 */
export const GAME_OVER_FILE = 'images/gameOver.webp';

type Screen = 'menu' | 'result' | 'quests' | 'fridge';

/** An item clip used as an icon: special items below 1000, score items from 1000. */
type Icon = { item: number } | { clip: string };

interface ModeEntry {
  /** The site's `$mode`. */
  mode: string;
  icon: Icon;
  /** Ported in the game; the others are listed but cannot start. */
  enabled: boolean;
}

/** The modes a new player has: Adventure and the free Learning mode (site guide, section 3). */
const MODES: ModeEntry[] = [
  { mode: 'solo', icon: { clip: 'hammer_player' }, enabled: true },
  // Item 107, "Livre des étoiles"
  { mode: 'tutorial', icon: { item: 107 }, enabled: false },
];

interface TabEntry {
  screen: 'quests' | 'fridge';
  icon: Icon;
}

/** The quest and fridge pages: item 20 (a treasure chest) and item 1018 (strawberry ice). */
const TABS: TabEntry[] = [
  { screen: 'quests', icon: { item: 20 } },
  { screen: 'fridge', icon: { item: 1018 } },
];

/** What the menu's arrows move through: the modes, each with its options, the tabs. */
type MenuEntry =
  | { kind: 'mode'; mode: ModeEntry }
  | { kind: 'option'; mode: ModeEntry; oid: string }
  | { kind: 'tab'; tab: TabEntry };

/**
 * Texts. Mode names and descriptions, "Quêtes" and "Réfrigérateur" are the site guide's
 * (`guide.html` of hammerfest.fr, hfest.net and hammerfest.es), the fridge rule its section 4,
 * the quest rule its section 6, the option names those of the quests that unlock them
 * (`xml/lang`, quests 62 to 74; "Tornado" is the port's own, as only the French text names it);
 * the others are the port's own.
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
    done: 'Terminée',
    progress: 'En cours',
    todo: 'À découvrir',
    questRule:
      'Une quête demande une série d’objets. Ils s’additionnent d’une partie d’Aventure à l’autre ; la quête est validée à la fin de la partie où vous les avez tous.',
    noQuest:
      'Aucune quête commencée. Ramassez des objets en mode Aventure : chacun peut lancer une quête !',
    moreQuests: '{0} quêtes à découvrir : trouvez un de leurs objets pour les commencer.',
    needed: 'Objets à réunir',
    reward: 'Récompense',
    rewardHidden:
      'Révélée à la fin de la partie où vous aurez réuni tous ces objets. Ils s’additionnent d’une partie d’Aventure à l’autre.',
    questDone: 'Quête terminée : {0}',
    moreDone: 'et {0} autres quêtes terminées',
    newFridge: '{0} nouveaux objets dans le réfrigérateur',
    newFridge1: 'Un nouvel objet dans le réfrigérateur',
    fridgeCount: '{0} objets sur {1}',
    fridgeRule:
      'Un objet entre au réfrigérateur quand vous l’avez trouvé assez de fois en Aventure : 10 fois pour la plupart.',
    unknown: 'Objet inconnu',
    inFridge: 'Au réfrigérateur, trouvé {0} fois',
    partial: 'Trouvé {0} fois sur {1} : encore {2} pour le réfrigérateur',
    never: 'Pas encore trouvé',
    back: 'Retour',
    continue: 'Continuer',
    options: 'Options',
    lockedBy: 'Se débloque avec la quête « {0} »',
    optionOn: 'Active pour vos prochaines parties',
    optionOff: 'Cochez-la pour l’activer',
    alwaysOn: 'Toujours active une fois débloquée',
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
    done: 'Done',
    progress: 'In progress',
    todo: 'To discover',
    questRule:
      'A quest asks for a series of items. They add up from one Adventure game to the next; the quest is done at the end of the game where you have them all.',
    noQuest:
      'No quest started yet. Pick up items in Adventure mode: any of them can start a quest!',
    moreQuests: '{0} quests to discover: find one of their items to start them.',
    needed: 'Items needed',
    reward: 'Reward',
    rewardHidden:
      'Revealed at the end of the game where you have all these items. They add up from one Adventure game to the next.',
    questDone: 'Quest done: {0}',
    moreDone: 'and {0} more quests done',
    newFridge: '{0} new items in the fridge',
    newFridge1: 'One new item in the fridge',
    fridgeCount: '{0} items out of {1}',
    fridgeRule:
      'An item goes into the fridge once you have found it enough times in Adventure: 10 times for most of them.',
    unknown: 'Unknown item',
    inFridge: 'In the fridge, found {0} times',
    partial: 'Found {0} times out of {1}: {2} more for the fridge',
    never: 'Not found yet',
    back: 'Back',
    continue: 'Continue',
    options: 'Options',
    lockedBy: 'Unlocked by the quest “{0}”',
    optionOn: 'On for your next games',
    optionOff: 'Tick it to turn it on',
    alwaysOn: 'Always on once unlocked',
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
    done: 'Terminada',
    progress: 'En curso',
    todo: 'Por descubrir',
    questRule:
      'Una exploración pide una serie de objetos. Se suman de una partida de Aventura a otra; la exploración se valida al final de la partida en la que los tienes todos.',
    noQuest:
      'Ninguna exploración empezada. Recoge objetos en modo Aventura: ¡cualquiera puede empezar una!',
    moreQuests: '{0} exploraciones por descubrir: encuentra uno de sus objetos para empezarlas.',
    needed: 'Objetos necesarios',
    reward: 'Recompensa',
    rewardHidden:
      'Se revela al final de la partida en la que reúnas todos estos objetos. Se suman de una partida de Aventura a otra.',
    questDone: 'Exploración terminada: {0}',
    moreDone: 'y {0} exploraciones más',
    newFridge: '{0} objetos nuevos en el frigorífico',
    newFridge1: 'Un objeto nuevo en el frigorífico',
    fridgeCount: '{0} objetos de {1}',
    fridgeRule:
      'Un objeto entra en el frigorífico cuando lo has encontrado bastantes veces en Aventura: 10 veces para la mayoría.',
    unknown: 'Objeto desconocido',
    inFridge: 'En el frigorífico, encontrado {0} veces',
    partial: 'Encontrado {0} veces de {1}: faltan {2} para el frigorífico',
    never: 'Aún no encontrado',
    back: 'Volver',
    continue: 'Continuar',
    options: 'Opciones',
    lockedBy: 'Se desbloquea con la exploración «{0}»',
    optionOn: 'Activa para tus próximas partidas',
    optionOff: 'Márcala para activarla',
    alwaysOn: 'Siempre activa una vez desbloqueada',
    mirror: 'Espejo',
    nightmare: 'Pesadilla',
    ninja: 'Ninjutsu',
    bombexpert: 'Explosivos inestables',
    boost: 'Tornado',
  },
};

/** Every text key, for the test that each language has them all. */
export const SHELL_TEXT_KEYS: Record<Lang, string[]> = {
  fr: Object.keys(TEXT.fr),
  en: Object.keys(TEXT.en),
  es: Object.keys(TEXT.es),
};

const W = 420;
const H = 520;
/** Blur of the village behind the screens, in frame pixels. */
const BG_BLUR = 5;
/** Center of the screens' main button, at the bottom of their panel. */
const BUTTON_Y = 478;

/** Parchment and wood, as the page's help dialog (`src/style.css`). */
const C = {
  parchment: 0xf3e2bd,
  parchmentDark: 0xe6cf9f,
  wood: 0x5f452c,
  woodDark: 0x3f2c1b,
  ink: '#4a3520',
  inkSoft: '#7a5f44',
  gold: '#fff3c4',
  done: '#3f8f1a',
  progress: '#b8730f',
  todo: '#9a8670',
};

/** Fonts of the game (`hammer_interf_instructions`: Satans titles, Franklin Gothic labels). */
const FONT = {
  title: 'Satans, "Franklin Gothic Heavy", "Arial Black", sans-serif',
  label: '"Franklin Gothic Heavy", "Arial Black", Impact, sans-serif',
  body: 'Verdana, Geneva, "DejaVu Sans", sans-serif',
};

type TextKind = keyof typeof FONT;

/** Quest rows shown at once. */
const QUEST_ROWS = 7;
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
  private title: Texture | null = null;
  private gameOverArt: Texture | null = null;
  private readonly grey = new ColorMatrixFilter();
  private screen: Screen | null = null;
  /** When `fadeOut` started (`performance.now()`), while it runs. */
  private fadeFrom: number | null = null;
  private fadeMs = 700;
  /** Set by `fadeOut` until the level is drawn and the fade can start. */
  private fadeReady: (() => boolean) | null = null;
  private fadeAsked = 0;
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
    this.grey.desaturate();
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.root.hitArea = new Rectangle(0, 0, W, H);
    this.root.on('wheel', (e: FederatedWheelEvent) => this.onWheel(e.deltaY));
  }

  /** Loads the title logo and the game over picture. */
  async load(baseUrl: string): Promise<void> {
    [this.title, this.gameOverArt] = await Promise.all([
      loadTexture(`${baseUrl}${TITLE_FILE}`),
      loadTexture(`${baseUrl}${GAME_OVER_FILE}`),
    ]);
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
    this.fadeFrom = null;
    this.fadeReady = null;
    this.root.visible = false;
    this.root.alpha = 1;
    this.root.eventMode = 'static';
    this.clear();
  }

  /**
   * Fades the screen out over the game starting under it, then hides it. The menu's village
   * is the first level's, so it dissolves into the level. The fade waits until `ready()` says
   * the level is drawn (at most 2 s), so it never shows the black of the level being read.
   */
  fadeOut(ready: () => boolean = () => true, ms = 700): void {
    this.screen = null;
    this.root.eventMode = 'none';
    this.fadeReady = ready;
    this.fadeAsked = performance.now();
    this.fadeFrom = null;
    this.fadeMs = ms;
  }

  /** Redraws the current screen, e.g. after a language change. */
  refresh(): void {
    if (this.screen) this.render();
  }

  /** Keys, once per frame while a screen shows: arrows choose, space confirms. */
  update(): void {
    if (this.fadeReady) {
      const now = performance.now();
      if (this.fadeReady() || now - this.fadeAsked > 2000) {
        this.fadeReady = null;
        this.fadeFrom = now;
      }
      return;
    }
    if (this.fadeFrom !== null) {
      const a = 1 - (performance.now() - this.fadeFrom) / this.fadeMs;
      if (a <= 0) this.hide();
      else this.root.alpha = a;
      return;
    }
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

  private onWheel(dy: number): void {
    if (dy === 0) return;
    const d = Math.sign(dy);
    if (this.screen === 'quests') this.selectQuest(this.questSel + d);
    else if (this.screen === 'fridge') {
      const page = Math.floor(this.fridgeSel / FRIDGE_PAGE) + d;
      if (page >= 0 && page * FRIDGE_PAGE < this.profile.quests.itemIds.length) {
        this.selectItem(page * FRIDGE_PAGE);
      }
    }
  }

  /** The modes, the options of each enabled mode (locked ones too, for their hint), the tabs. */
  private menuEntries(): MenuEntry[] {
    const out: MenuEntry[] = [];
    for (const mode of MODES) {
      out.push({ kind: 'mode', mode });
      if (!mode.enabled) continue;
      for (const oid of this.modeOptions(mode)) out.push({ kind: 'option', mode, oid });
    }
    for (const tab of TABS) out.push({ kind: 'tab', tab });
    return out;
  }

  /** The mode's options on the menu; the Tornade boost, which applies to every game, last. */
  private modeOptions(mode: ModeEntry): string[] {
    const list = MODE_OPTIONS[mode.mode];
    return list ? [...list, Data.OPT_BOOST] : [];
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
      if (e.oid === Data.OPT_BOOST) return; // no box to untick (quest 62)
      this.profile.toggleOption(e.oid);
      this.render();
    } else if (e.mode.enabled) {
      this.onStart?.(e.mode.mode);
    }
  }

  /**
   * A click on menu entry `i`: tabs open and options tick at once; a mode is selected, and
   * started when it already was.
   */
  private clickEntry(i: number): void {
    const e = this.menuEntries()[i];
    if (e.kind === 'mode' && this.selected !== i) {
      this.select(i);
      return;
    }
    this.selected = i;
    this.confirm();
    if (this.screen === 'menu') this.render();
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

  private get lang(): Lang {
    const l = this.texts.langId;
    return l === 'en' || l === 'es' ? l : 'fr';
  }

  private get t(): Record<string, string> {
    return TEXT[this.lang];
  }

  private clear(): void {
    for (const c of this.root.removeChildren()) c.destroy({ children: true });
  }

  private render(): void {
    this.clear();
    this.fadeFrom = null;
    this.fadeReady = null;
    this.root.alpha = 1;
    this.root.eventMode = 'static';
    this.root.visible = true;
    this.root.parent?.addChild(this.root); // above the Loader's clip
    this.drawBackground(this.screen === 'quests' || this.screen === 'fridge');
    if (this.screen === 'menu') this.drawMenu();
    else if (this.screen === 'quests') this.drawQuests();
    else if (this.screen === 'fridge') this.drawFridge();
    else if (this.result) this.drawResult(this.result);
  }

  // ------------------------------------------------------------ drawing kit

  /** The village of the first level (`menu`, vector), dimmed under the full-page panels. */
  private drawBackground(dim: boolean): void {
    const bg = this.lib.attach('menu');
    const b = bg.getLocalBounds();
    // Blurred, so the menu reads as a backdrop and its fade into the first level does not show
    // that the two villages are not drawn at the same place. A little larger than the frame,
    // so the blur does not darken its edges.
    const m = BG_BLUR * 3;
    const s = Math.max((W + 2 * m) / b.width, (H + 2 * m) / b.height);
    bg.scale.set(s);
    bg.position.set((W - b.width * s) / 2 - b.x * s, (H - b.height * s) / 2 - b.y * s);
    bg.filters = [new BlurFilter({ strength: BG_BLUR, quality: 4 })];
    // Drawn once into a texture: a blurred picture needs no more than the frame's resolution
    const layer = new Container();
    layer.addChild(bg);
    layer.cacheAsTexture({ resolution: 1.5 });
    this.root.addChild(layer);
    if (dim)
      this.root.addChild(new Graphics().rect(0, 0, W, H).fill({ color: 0x0b1530, alpha: 0.35 }));
  }

  /** The game's title logo, `w` px wide, its top at `y`. */
  private drawTitle(y: number, w: number): void {
    if (!this.title) {
      this.text('Hammerfest', 'title', W / 2, y + 20, { size: 34, color: C.gold, shadow: true });
      return;
    }
    const s = new Sprite(this.title);
    s.scale.set(w / this.title.width);
    s.anchor.set(0.5, 0);
    s.position.set(W / 2, y);
    // A soft shade, so the thin "Les Cavernes de" reads over the village
    const shade = new Graphics()
      .ellipse(W / 2, y + s.height * 0.52, w * 0.5, s.height * 0.36)
      .fill({ color: 0x0b1530, alpha: 0.45 });
    shade.filters = [new BlurFilter({ strength: 18, quality: 3 })];
    this.root.addChild(shade, s);
  }

  /** A parchment panel in a wood frame. */
  private panel(x: number, y: number, w: number, h: number): void {
    const g = new Graphics();
    g.roundRect(x + 2, y + 5, w, h, 14).fill({ color: 0x0b1530, alpha: 0.35 });
    g.roundRect(x, y, w, h, 14).fill(C.parchment).stroke({ color: C.wood, width: 3 });
    g.roundRect(x + 5, y + 5, w - 10, h - 10, 10).stroke({ color: C.wood, width: 1, alpha: 0.25 });
    this.root.addChild(g);
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
      shadow?: boolean;
      italic?: boolean;
      parent?: Container;
    } = {},
  ): Text {
    const align = opts.align ?? 'center';
    const size = opts.size ?? (kind === 'title' ? 24 : kind === 'label' ? 15 : 11);
    const t = new Text({
      text: s,
      style: new TextStyle({
        fontFamily: FONT[kind],
        fontSize: size,
        fontStyle: opts.italic ? 'italic' : 'normal',
        fill: opts.color ?? C.ink,
        align,
        lineHeight: kind === 'body' ? Math.round(size * 1.35) : undefined,
        wordWrap: opts.width !== undefined,
        wordWrapWidth: opts.width ?? 0,
        dropShadow: opts.shadow
          ? { color: '#0b1530', alpha: 0.8, blur: 2, distance: 1.5, angle: Math.PI / 2 }
          : undefined,
      }),
    });
    t.anchor.set(align === 'center' ? 0.5 : align === 'right' ? 1 : 0, 0);
    t.position.set(x, y);
    (opts.parent ?? this.root).addChild(t);
    return t;
  }

  /**
   * An item count on a wood pill whose bottom right corner is (`right`, `bottom`), so it reads
   * over any item.
   */
  private countBadge(s: string, right: number, bottom: number, parent = this.root): void {
    const padX = 4;
    const h = 13;
    const c = this.text(s, 'label', 0, 0, { align: 'right', size: 10, color: C.gold, parent });
    const w = c.width + padX * 2;
    c.position.set(right - padX, bottom - h / 2 - c.height / 2);
    const pill = new Graphics()
      .roundRect(right - w, bottom - h, w, h, h / 2)
      .fill({ color: C.wood, alpha: 0.9 })
      .stroke({ color: 0x3f2c1b, alpha: 0.5, width: 1 });
    parent.addChildAt(pill, parent.getChildIndex(c));
  }

  /**
   * A clickable area (`x`, `y`, `w`, `h`) holding its children: wood when selected, a light
   * wash under the pointer.
   */
  private button(
    rect: [number, number, number, number],
    action: () => void,
    selected = false,
    radius = 8,
  ): Container {
    const [x, y, w, h] = rect;
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.hitArea = new Rectangle(x, y, w, h);
    const bg = new Graphics().roundRect(x, y, w, h, radius);
    if (selected) bg.fill({ color: C.wood, alpha: 0.92 });
    else bg.fill({ color: C.wood, alpha: 0.12 });
    bg.alpha = selected ? 1 : 0;
    c.addChild(bg);
    if (!selected) {
      c.on('pointerover', () => (bg.alpha = 1));
      c.on('pointerout', () => (bg.alpha = 0));
    }
    c.on('pointertap', action);
    this.root.addChild(c);
    return c;
  }

  /**
   * The screen's main action: a wood button at the bottom of the panel, centered on `cy`, as
   * the help dialog's (`.parchment-btn`). With a keyboard, a keycap says the space bar does it
   * too. `action` null draws it disabled.
   */
  private actionButton(label: string, cy: number, action: (() => void) | null, w = 220): void {
    const h = 36;
    const x = W / 2 - w / 2;
    const y = cy - h / 2;
    const c = new Container();
    const face = new Container();
    const on = action !== null;
    c.addChild(new Graphics().roundRect(x, y + 3, w, h, h / 2).fill(on ? C.woodDark : 0xc9b48c));
    face.addChild(new Graphics().roundRect(x, y, w, h, h / 2).fill(on ? C.wood : 0xd8c59c));
    const glow = new Graphics().roundRect(x, y, w, h, h / 2).fill({ color: 0xffffff, alpha: 0.12 });
    glow.visible = false;
    face.addChild(glow);
    const lbl = this.text(label, 'label', 0, 0, {
      align: 'left',
      size: 17,
      color: on ? C.gold : C.todo,
      parent: face,
    });
    // The keycap, sized to its text
    let capW = 0;
    const cap = new Container();
    if (on && hasKeyboard()) {
      const k = this.text(this.texts.getStatic(10) || 'SPACE', 'label', 0, 0, {
        align: 'left',
        size: 9,
        color: '#5f452c',
        parent: cap,
      });
      capW = k.width + 12;
      cap.addChildAt(
        new Graphics()
          .roundRect(0, 1.5, capW, 17, 4)
          .fill(0xc8a878)
          .roundRect(0, 0, capW, 17, 4)
          .fill(0xfffaf0),
        0,
      );
      k.position.set(6, (17 - k.height) / 2);
      face.addChild(cap);
    }
    const gap = capW > 0 ? 10 : 0;
    const left = W / 2 - (lbl.width + gap + capW) / 2;
    lbl.position.set(left, cy - lbl.height / 2);
    cap.position.set(left + lbl.width + gap, cy - 9);
    c.addChild(face);
    if (on) {
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.hitArea = new Rectangle(x, y, w, h + 3);
      c.on('pointerover', () => (glow.visible = true));
      c.on('pointerout', () => {
        glow.visible = false;
        face.y = 0;
      });
      c.on('pointerdown', () => (face.y = 2));
      c.on('pointerup', () => (face.y = 0));
      c.on('pointertap', action);
    }
    this.root.addChild(c);
  }

  /** An item or other clip fitted in a `size` px cell centered on (x, y). */
  private icon(icon: Icon, x: number, y: number, size: number, parent?: Container): Container {
    let mc;
    if ('item' in icon) {
      const id = icon.item;
      mc = this.lib.attach(id >= 1000 ? 'hammer_item_score' : 'hammer_item_special');
      mc.gotoAndStop(String(id >= 1000 ? id - 999 : id + 1));
    } else {
      mc = this.lib.attach(icon.clip);
      mc.gotoAndStop('1');
    }
    const b = mc.getLocalBounds();
    const fit = Math.min(1.6, size / Math.max(b.width, b.height, 1));
    mc.scale.set(fit);
    mc.position.set(x - (b.x + b.width / 2) * fit, y - (b.y + b.height / 2) * fit);
    (parent ?? this.root).addChild(mc);
    return mc;
  }

  /** Item `id` as a dark silhouette: one not found yet. */
  private silhouette(id: number, x: number, y: number, size: number, parent?: Container): void {
    const mc = this.icon({ item: id }, x, y, size, parent);
    mc.tint = 0x3f2c1b;
    mc.alpha = 0.2;
  }

  /** Item `id` greyed out: found, but not enough times for the fridge. */
  private greyed(id: number, x: number, y: number, size: number, parent?: Container): void {
    const mc = this.icon({ item: id }, x, y, size, parent);
    mc.filters = [this.grey];
    mc.alpha = 0.75;
  }

  /** A progress bar, `f` from 0 to 1. */
  private bar(x: number, y: number, w: number, h: number, f: number, color: string): void {
    const g = new Graphics()
      .roundRect(x, y, w, h, h / 2)
      .fill({ color: C.wood, alpha: 0.18 })
      .roundRect(x, y, Math.max(h, w * Math.min(1, f)), h, h / 2)
      .fill(f > 0 ? color : 'rgba(0,0,0,0)');
    this.root.addChild(g);
  }

  /** A small closed padlock, its top left at (x, y). */
  private padlock(x: number, y: number, parent: Container, color: string): void {
    const g = new Graphics()
      .roundRect(x + 1.5, y, 6, 7, 3)
      .stroke({ color, width: 1.4 })
      .roundRect(x, y + 4, 9, 7, 1.5)
      .fill(color);
    parent.addChild(g);
  }

  // ------------------------------------------------------------------ menu

  private drawMenu(): void {
    const t = this.t;
    const entries = this.menuEntries();
    const cur = entries[this.selected];
    this.drawTitle(2, 290);
    const top = 124;
    this.panel(26, top, 368, H - 8 - top);
    this.text(t.modes, 'title', W / 2, top + 10, { color: '#5f452c' });

    MODES.forEach((m, i) => {
      const y = top + 46 + i * 38;
      const n = entries.findIndex((e) => e.kind === 'mode' && e.mode === m);
      const sel = n === this.selected;
      const row = this.button([42, y, 336, 34], () => this.clickEntry(n), sel);
      const ic = this.icon(m.icon, 66, y + 17, 26, row);
      if (!m.enabled) ic.alpha = 0.45;
      this.text(t[m.mode], 'label', 90, y + 7, {
        align: 'left',
        size: 18,
        color: sel ? C.gold : m.enabled ? C.ink : C.todo,
        parent: row,
      });
      if (!m.enabled) {
        this.text(t.soon, 'label', 364, y + 10, {
          align: 'right',
          size: 12,
          color: sel ? C.gold : C.todo,
          parent: row,
        });
      }
    });

    const mode = cur.kind === 'tab' ? null : cur.mode;
    const shown = mode ?? MODES[0];
    this.text(t[shown.mode + 'Desc'], 'body', W / 2, top + 128, { width: 320, color: C.inkSoft });
    if (shown.enabled) this.drawOptions(shown, entries, top + 166);

    // The quest and fridge pages
    const counts = this.counts();
    TABS.forEach((tb, i) => {
      const n = entries.findIndex((e) => e.kind === 'tab' && e.tab === tb);
      const sel = n === this.selected;
      const x = i === 0 ? 42 : 214;
      const y = top + 270;
      const btn = this.button([x, y, 164, 50], () => this.clickEntry(n), sel, 10);
      if (!sel) {
        btn.addChildAt(
          new Graphics()
            .roundRect(x, y, 164, 50, 10)
            .stroke({ color: C.wood, width: 1, alpha: 0.35 }),
          1,
        );
      }
      this.icon(tb.icon, x + 26, y + 25, 32, btn);
      this.text(t[tb.screen], 'label', x + 48, y + 8, {
        align: 'left',
        size: 15,
        color: sel ? C.gold : C.ink,
        parent: btn,
      });
      const [have, all] = tb.screen === 'quests' ? counts.quests : counts.fridge;
      this.text(`${have} / ${all}`, 'body', x + 48, y + 29, {
        align: 'left',
        size: 11,
        color: sel ? C.gold : C.inkSoft,
        parent: btn,
      });
    });

    if (cur.kind === 'tab') this.actionButton(t[cur.tab.screen], BUTTON_Y, () => this.confirm());
    else if (shown.enabled) this.actionButton(t.start, BUTTON_Y, () => this.onStart?.(shown.mode));
    else this.actionButton(t.start, BUTTON_Y, null);
  }

  /** Quests done and items in the fridge, each out of all. */
  private counts(): { quests: [number, number]; fridge: [number, number] } {
    const p = this.profile.data;
    const q = this.profile.quests;
    const ids = q.itemIds;
    return {
      quests: [p.quests.length, q.quests.length],
      fridge: [ids.filter((id) => q.inFridge(p, id)).length, ids.length],
    };
  }

  /**
   * The mode's options (the site's `.mopt` box): a checkbox each, a padlock while locked. The
   * selected one says what it does, or which quest unlocks it. The Tornade boost has no box to
   * untick: once unlocked it applies to every game (quest 62).
   */
  private drawOptions(mode: ModeEntry, entries: MenuEntry[], y0: number): void {
    const t = this.t;
    this.text(t.options.toUpperCase(), 'label', W / 2, y0, { size: 11, color: C.inkSoft });
    const list = this.modeOptions(mode);
    let hint = '';
    list.forEach((oid, k) => {
      const x = k < 3 ? 52 : 222;
      const y = y0 + 18 + (k % 3) * 20;
      const unlocked = this.profile.hasOption(oid);
      const fixed = oid === Data.OPT_BOOST;
      const ticked = fixed ? unlocked : this.profile.isChosen(oid);
      const n = entries.findIndex((e) => e.kind === 'option' && e.oid === oid);
      const sel = n === this.selected;
      const row = this.button([x - 8, y - 2, 162, 19], () => this.clickEntry(n), sel, 5);
      const ink = sel ? C.gold : unlocked ? C.ink : C.todo;
      if (unlocked) {
        const box = new Graphics()
          .roundRect(x, y + 2, 11, 11, 2)
          .fill({ color: 0xffffff, alpha: sel ? 0.15 : 0.6 })
          .stroke({ color: sel ? 0xfff3c4 : C.wood, width: 1.4 });
        if (ticked) {
          box
            .moveTo(x + 2.5, y + 7.5)
            .lineTo(x + 5, y + 10)
            .lineTo(x + 9.5, y + 4)
            .stroke({ color: sel ? 0xfff3c4 : C.wood, width: 2 });
        }
        row.addChild(box);
      } else {
        this.padlock(x + 1, y + 2, row, sel ? C.gold : C.inkSoft);
      }
      this.text(t[oid], 'label', x + 18, y + 1, {
        align: 'left',
        size: 13,
        color: ink,
        parent: row,
      });
      if (sel) {
        if (!unlocked) hint = fmt(t.lockedBy, this.questForOption(oid));
        else if (fixed) hint = t.alwaysOn;
        else hint = ticked ? t.optionOn : t.optionOff;
      }
    });
    if (hint) this.text(hint, 'body', W / 2, y0 + 82, { size: 10, italic: true, color: C.inkSoft });
  }

  /** The name of the quest that gives option `oid` (`give option=` in `quests.xml`). */
  private questForOption(oid: string): string {
    const q = this.profile.quests.quests.find((x) =>
      x.actions.some((a) => a.type === 'give' && a.attrs.option === oid),
    );
    return q ? this.texts.getQuestName(q.id) : '?';
  }

  // ---------------------------------------------------------------- quests

  /** Quests in progress, then quests done, each in id order. */
  private questList(): number[] {
    const q = this.profile.quests;
    const p = this.profile.data;
    const ids = q.quests.map((x) => x.id);
    return [
      ...ids.filter((id) => q.status(p, id) === 'progress'),
      ...ids.filter((id) => q.status(p, id) === 'done'),
    ];
  }

  private drawQuests(): void {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    this.panel(12, 12, 396, H - 20);
    this.text(t.quests, 'title', W / 2, 22, { size: 26, color: '#5f452c' });

    // The three states, counted
    const ids = q.quests.map((x) => x.id);
    const count = (s: string) => ids.filter((id) => q.status(p, id) === s).length;
    const chips: [string, number, string][] = [
      [t.progress, count('progress'), C.progress],
      [t.done, count('done'), C.done],
      [t.todo, count('none'), C.todo],
    ];
    chips.forEach(([label, n, color], i) => {
      const cx = W / 2 + (i - 1) * 124;
      this.root.addChild(new Graphics().circle(cx - 46, 66, 4.5).fill(color));
      const sep = this.lang === 'fr' ? '\u00a0: ' : ': ';
      this.text(`${label}${sep}${n}`, 'label', cx - 38, 59, {
        align: 'left',
        size: 12,
        color: C.ink,
      });
    });

    const list = this.questList();
    const listTop = 84;
    if (list.length === 0) {
      this.text(t.noQuest, 'body', W / 2, listTop + 30, { width: 320, size: 12 });
    }
    list.slice(this.questTop, this.questTop + QUEST_ROWS).forEach((id, k) => {
      const i = this.questTop + k;
      const y = listTop + k * 24;
      const sel = i === this.questSel;
      const row = this.button([24, y, 372, 22], () => this.selectQuest(i), sel, 6);
      const done = q.status(p, id) === 'done';
      row.addChild(new Graphics().circle(36, y + 11, 4).fill(done ? C.done : C.progress));
      this.text(this.texts.getQuestName(id), 'label', 48, y + 3, {
        align: 'left',
        size: 13,
        color: sel ? C.gold : C.ink,
        parent: row,
      });
      if (done) {
        this.text('✓', 'label', 384, y + 2, {
          align: 'right',
          size: 14,
          color: sel ? C.gold : C.done,
          parent: row,
        });
      } else {
        // Items gathered out of all the quest needs
        const reqs = q.requirements(id);
        const need = reqs.reduce((a, r) => a + r.qty, 0);
        const have = reqs.reduce((a, r) => a + Math.min(p.items[r.item] ?? 0, r.qty), 0);
        this.text(`${have}/${need}`, 'body', 384, y + 4, {
          align: 'right',
          size: 11,
          color: sel ? C.gold : C.inkSoft,
          parent: row,
        });
        row.addChild(
          new Graphics()
            .roundRect(296, y + 9, 50, 4, 2)
            .fill({ color: sel ? 0xfff3c4 : C.wood, alpha: 0.25 })
            .roundRect(296, y + 9, Math.max(4, (50 * have) / need), 4, 2)
            .fill(sel ? C.gold : C.progress),
        );
      }
    });
    const listBottom = listTop + QUEST_ROWS * 24;
    // Scroll bar when the list is longer than the rows
    if (list.length > QUEST_ROWS) {
      const trackH = QUEST_ROWS * 24 - 2;
      const thumbH = Math.max(16, (trackH * QUEST_ROWS) / list.length);
      const thumbY = listTop + ((trackH - thumbH) * this.questTop) / (list.length - QUEST_ROWS);
      this.root.addChild(
        new Graphics()
          .roundRect(400, listTop, 3, trackH, 1.5)
          .fill({ color: C.wood, alpha: 0.15 })
          .roundRect(400, thumbY, 3, thumbH, 1.5)
          .fill({ color: C.wood, alpha: 0.6 }),
      );
    }
    const none = count('none');
    if (list.length > 0 && none > 0) {
      const shownRows = Math.min(list.length, QUEST_ROWS);
      this.text(fmt(t.moreQuests, none), 'body', W / 2, listTop + shownRows * 24 + 6, {
        width: 360,
        size: 10,
        italic: true,
        color: C.inkSoft,
      });
    }

    const sepY = listBottom + 36;
    this.root.addChild(
      new Graphics()
        .moveTo(36, sepY)
        .lineTo(384, sepY)
        .stroke({ color: C.wood, width: 1, alpha: 0.25 }),
    );
    const id = list[this.questSel];
    if (id !== undefined) this.drawQuestDetail(id, sepY + 8);
    else
      this.text(t.questRule, 'body', W / 2, sepY + 20, { width: 340, size: 11, color: C.inkSoft });

    this.actionButton(t.back, BUTTON_Y, () => this.showMenu(), 170);
  }

  /** The selected quest: its items with "found / needed", and its reward once done. */
  private drawQuestDetail(id: number, y0: number): void {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const done = q.status(p, id) === 'done';
    this.text(this.texts.getQuestName(id), 'label', W / 2, y0, { size: 16 });
    this.text(t.needed.toUpperCase(), 'label', W / 2, y0 + 22, { size: 10, color: C.inkSoft });

    const reqs = q.requirements(id);
    const cell = Math.min(40, 356 / reqs.length);
    const x0 = W / 2 - (reqs.length * cell) / 2;
    const y = y0 + 54;
    reqs.forEach((r, i) => {
      const x = x0 + i * cell + cell / 2;
      const have = p.items[r.item] ?? 0;
      const size = Math.min(28, cell - 8);
      if (have >= r.qty) this.icon({ item: r.item }, x, y, size);
      else if (have > 0) this.greyed(r.item, x, y, size);
      else this.silhouette(r.item, x, y, size);
      this.text(`${Math.min(have, r.qty)}/${r.qty}`, 'body', x, y + 17, {
        size: 9,
        color: have >= r.qty ? C.done : C.inkSoft,
      });
    });

    const ry = y0 + 92;
    this.text(t.reward.toUpperCase(), 'label', W / 2, ry, { size: 10, color: C.inkSoft });
    if (done)
      this.text(this.texts.getQuestDesc(id), 'body', W / 2, ry + 15, { width: 350, size: 11 });
    else
      this.text(t.rewardHidden, 'body', W / 2, ry + 15, {
        width: 350,
        size: 11,
        italic: true,
        color: C.inkSoft,
      });
  }

  // ---------------------------------------------------------------- fridge

  private drawFridge(): void {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const ids = q.itemIds;
    this.panel(12, 12, 396, H - 20);
    this.text(t.fridge, 'title', W / 2, 22, { size: 26, color: '#5f452c' });
    const [have, all] = this.counts().fridge;
    this.text(fmt(t.fridgeCount, have, all), 'label', W / 2, 56, { size: 13 });
    this.bar(110, 75, 200, 6, have / all, C.done);
    this.text(t.fridgeRule, 'body', W / 2, 88, { width: 360, size: 10, color: C.inkSoft });

    const page = Math.floor(this.fridgeSel / FRIDGE_PAGE);
    const pages = Math.ceil(ids.length / FRIDGE_PAGE);
    const x0 = W / 2 - (FRIDGE_COLS * FRIDGE_CELL) / 2;
    const y0 = 122;
    ids.slice(page * FRIDGE_PAGE, (page + 1) * FRIDGE_PAGE).forEach((id, k) => {
      const i = page * FRIDGE_PAGE + k;
      const cx = x0 + (k % FRIDGE_COLS) * FRIDGE_CELL;
      const cy = y0 + Math.floor(k / FRIDGE_COLS) * FRIDGE_CELL;
      const sel = i === this.fridgeSel;
      const cellBtn = this.button(
        [cx + 1, cy + 1, FRIDGE_CELL - 2, FRIDGE_CELL - 2],
        () => this.selectItem(i),
        sel,
        6,
      );
      const mx = cx + FRIDGE_CELL / 2;
      const my = cy + FRIDGE_CELL / 2;
      const n = p.items[id] ?? 0;
      if (q.inFridge(p, id)) {
        this.icon({ item: id }, mx, my, FRIDGE_CELL - 10, cellBtn);
        if (n > 1) this.countBadge(`${n}`, cx + FRIDGE_CELL - 2, cy + FRIDGE_CELL - 2, cellBtn);
      } else if (n > 0) {
        this.greyed(id, mx, my, FRIDGE_CELL - 12, cellBtn);
        const f = n / q.unlockCount(id);
        cellBtn.addChild(
          new Graphics()
            .roundRect(cx + 6, cy + FRIDGE_CELL - 6, FRIDGE_CELL - 12, 3, 1.5)
            .fill({ color: C.wood, alpha: 0.2 })
            .roundRect(cx + 6, cy + FRIDGE_CELL - 6, (FRIDGE_CELL - 12) * f, 3, 1.5)
            .fill(C.progress),
        );
      } else {
        this.silhouette(id, mx, my, FRIDGE_CELL - 12, cellBtn);
      }
    });

    // Pages
    const py = y0 + FRIDGE_ROWS * FRIDGE_CELL + 6;
    this.text(`${page + 1} / ${pages}`, 'label', W / 2, py, { size: 13, color: C.inkSoft });
    if (page > 0) {
      const b = this.button([W / 2 - 92, py - 4, 44, 24], () =>
        this.selectItem((page - 1) * FRIDGE_PAGE),
      );
      this.text('◀', 'label', W / 2 - 70, py, { size: 13, parent: b });
    }
    if (page < pages - 1) {
      const b = this.button([W / 2 + 48, py - 4, 44, 24], () =>
        this.selectItem((page + 1) * FRIDGE_PAGE),
      );
      this.text('▶', 'label', W / 2 + 70, py, { size: 13, parent: b });
    }

    // The selected item: picture, name, family and how far it is from the fridge
    const sepY = py + 28;
    this.root.addChild(
      new Graphics()
        .moveTo(36, sepY)
        .lineTo(384, sepY)
        .stroke({ color: C.wood, width: 1, alpha: 0.25 }),
    );
    const id = ids[this.fridgeSel];
    const n = p.items[id] ?? 0;
    const need = q.unlockCount(id);
    const known = q.inFridge(p, id);
    const dy = sepY + 12;
    if (known) this.icon({ item: id }, 64, dy + 30, 46);
    else if (n > 0) this.greyed(id, 64, dy + 30, 46);
    else this.silhouette(id, 64, dy + 30, 46);
    this.text(n > 0 ? this.texts.getItemName(id) : t.unknown, 'label', 104, dy, {
      align: 'left',
      size: 16,
      width: 280,
    });
    const fid = q.familyOf(id);
    if (fid !== undefined) {
      const fam = q.itemsOf(fid);
      const famHave = fam.filter((x) => q.inFridge(p, x)).length;
      this.text(
        `${this.texts.getFamilyName(fid)} (${famHave}/${fam.length})`,
        'body',
        104,
        dy + 24,
        {
          align: 'left',
          size: 11,
          color: C.inkSoft,
        },
      );
    }
    const status = known ? fmt(t.inFridge, n) : n > 0 ? fmt(t.partial, n, need, need - n) : t.never;
    this.text(status, 'body', 104, dy + 42, {
      align: 'left',
      size: 11,
      width: 280,
      color: known ? C.done : n > 0 ? C.progress : C.inkSoft,
    });
    if (!known && n > 0) this.bar(104, dy + 60, 160, 5, n / need, C.progress);

    this.actionButton(t.back, BUTTON_Y, () => this.showMenu(), 170);
  }

  // --------------------------------------------------------------- results

  /**
   * What the game sent the site: the reached level and score for a game over, and the items
   * found. The end of the set sends no score (`GameMode.exitGame`). Then what the game added
   * to the profile: the quests it completed and the new fridge items.
   */
  private drawResult(r: GameResult): void {
    const t = this.t;
    // A game over shows its picture, which says "GAME OVER", spilling onto the panel; the end
    // of the set shows the logo and its title
    const art = r.kind === 'gameOver' ? this.gameOverArt : null;
    let y: number;
    if (art) {
      const top = 150;
      this.panel(26, top, 368, H - 8 - top);
      const s = new Sprite(art);
      s.scale.set(250 / art.width);
      s.anchor.set(0.5, 0);
      s.position.set(W / 2, -4);
      this.root.addChild(s);
      y = top + 30;
    } else {
      this.drawTitle(4, 250);
      const top = 112;
      this.panel(26, top, 368, H - 8 - top);
      this.text(r.kind === 'gameOver' ? t.gameOver : t.endGame, 'title', W / 2, top + 12, {
        color: '#5f452c',
      });
      y = top + 50;
    }
    if (r.kind === 'gameOver') {
      const lvl = r.stats.reachedLevel;
      this.text(`${this.texts.getStatic(1)} ${lvl}`, 'label', W / 2, y, { size: 17 });
      const sector = this.texts.getSectorName(0, lvl);
      if (sector) this.text(sector, 'body', W / 2, y + 22, { color: C.inkSoft });
      this.text(`${formatScore(r.score)} pts`, 'label', W / 2, y + 40, {
        size: 26,
        color: '#5f452c',
      });
      y += 82;
    }

    // Quest lines at the bottom of the panel
    const lines: { s: string; color: string }[] = [];
    const done = this.record?.quests ?? [];
    for (const id of done.slice(0, done.length > 3 ? 2 : 3)) {
      lines.push({ s: fmt(t.questDone, this.texts.getQuestName(id)), color: C.done });
    }
    if (done.length > 3) lines.push({ s: fmt(t.moreDone, done.length - 2), color: C.done });
    const fridge = this.record?.fridge.length ?? 0;
    if (fridge > 0) {
      const s = fridge === 1 ? t.newFridge1 : fmt(t.newFridge, fridge);
      lines.push({ s, color: C.progress });
    }
    const panelBottom = BUTTON_Y - 24;
    const linesTop = panelBottom - 16 - lines.length * 18;
    lines.forEach((l, i) => {
      this.text(l.s, 'label', W / 2, linesTop + i * 18, { size: 13, color: l.color });
    });

    const picks = resultPicks(r);
    this.text((picks.length > 0 ? t.collected : t.none).toUpperCase(), 'label', W / 2, y, {
      size: 11,
      color: C.inkSoft,
    });
    y += 20;
    const bottom = lines.length > 0 ? linesTop - 6 : panelBottom - 14;
    this.drawItems(picks, y, bottom);

    this.actionButton(t.continue, BUTTON_Y, () => this.showMenu());
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
      this.icon({ item: id }, x, y, size - 8 * (size / cell));
      if (n > 1) this.countBadge(`x${n}`, x + size / 2, y + size / 2 - 1);
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

/** A keyboard is likely: not a touch screen (`html.touch`, set by main.ts). */
function hasKeyboard(): boolean {
  return typeof document === 'undefined' || !document.documentElement.classList.contains('touch');
}

/** An image as a mipmapped texture (it shows smaller than its size), or null if it fails. */
async function loadTexture(url: string): Promise<Texture | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return new Texture({ source: new ImageSource({ resource: img, autoGenerateMipmaps: true }) });
  } catch {
    return null;
  }
}
