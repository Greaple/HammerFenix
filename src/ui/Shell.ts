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
 * are checkboxes under its text, the locked ones with the quest that unlocks them (3.3). The
 * settings page is the site's "Options" link at the bottom of its menu (2C.5): the five
 * settings with the guide's texts (section 8 of `guide.html`, typos fixed; the volume hint
 * names the sound, as the volume sets the sounds and the music).
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
import {
  BINDABLE_BUTTONS,
  type Bindings,
  bindButton,
  bindKey,
  DEFAULT_BINDINGS,
  isReservedKey,
  keyName,
} from '../engine/Bindings';
import { PAD } from '../engine/Gamepad';
import { type InputController, Key, type PlayerAction } from '../engine/Input';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import { Data } from '../game/Data';
import { padButtonOf, padGlyph, padLabel } from '../game/gui/PadGlyphs';
import { DEFAULT_SETTINGS, type PlayerSettings, VOLUME_STEP } from '../game/GameParameters';
import type { GameResult } from '../game/Loader';
import {
  BOSS_RUSH_FAMILY,
  type GameRecord,
  MODE_OPTIONS,
  NO_TIME,
  type Profile,
  resultPicks,
  type TimeResult,
} from '../game/Profile';
import { INTRO_FPS, INTRO_H, INTRO_W, IntroMovie } from './Intro';
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

type Screen = 'menu' | 'result' | 'quests' | 'fridge' | 'settings' | 'sound' | 'controls' | 'intro';

/**
 * An item clip used as an icon: special items below 1000, score items from 1000; `twice` draws
 * two, one behind the other (the two-player Time Attack, as the site's two clocks).
 */
type Icon = { item: number; twice?: boolean } | { clip: string };

interface ModeEntry {
  /** The site's `$mode`. */
  mode: string;
  icon: Icon;
  /** Ported in the game; the others are listed but cannot start. */
  enabled: boolean;
}

/**
 * The modes of the menu, as a grid read row by row: one-player modes on the left, two-player
 * ones on the right, so each row pairs related modes (the port's layout; the site listed them in
 * one column). A new player has the Adventure and the free Learning mode (site guide, section
 * 3); quests unlock the others (`give mode=` in `quests.xml`). The modes not ported yet show as
 * coming soon. Icons echo the site's (`menu/i*.gif`: a clock, two clocks, a ball, a bolt).
 */
const MODES: ModeEntry[] = [
  { mode: 'solo', icon: { clip: 'hammer_player' }, enabled: true },
  // Unlocked by quest 67 ("Sandy commence l'aventure !"); item 1221 is one of Sandy's kit
  { mode: 'multicoop', icon: { item: 1221 }, enabled: true },
  // Item 7, the shoe that speeds Igor up; unlocked by quest 73 (4.1)
  { mode: 'timeattack', icon: { item: 7 }, enabled: true },
  // No quest gives it: the port's guess, with the Time Attack and the co-op (4.3)
  { mode: 'multitime', icon: { item: 7, twice: true }, enabled: true },
  // Item 113, Tuberculoz's cape; no quest gives the mode: unlocked with the cape (quest 48, 4.5)
  { mode: 'bossrush', icon: { item: 113 }, enabled: true },
  // The soccer ball (`entity.bomb.player.SoccerBall`, 4.4); free for everyone
  { mode: 'soccer', icon: { clip: 'hammer_bomb_soccer' }, enabled: true },
  // Item 107, "Livre des étoiles"
  { mode: 'tutorial', icon: { item: 107 }, enabled: true },
];

/** Mode cards: two columns. */
const CARD = { x: [42, 214], y: 138, w: 164, h: 38, gap: 5 };
/** Top of the area under the cards: the selected mode's options or description. */
const DETAIL_Y = 309;
/** The quest and fridge cards. */
const TAB_Y = 410;
const TAB_H = 40;

interface TabEntry {
  screen: 'quests' | 'fridge';
  icon: Icon;
}

/** The quest and fridge pages: item 20 (a treasure chest) and item 1018 (strawberry ice). */
const TABS: TabEntry[] = [
  { screen: 'quests', icon: { item: 20 } },
  { screen: 'fridge', icon: { item: 1018 } },
];

/** What the menu's arrows move through: the modes, each with its options, the tabs, the settings. */
type MenuEntry =
  | { kind: 'mode'; mode: ModeEntry }
  | { kind: 'option'; mode: ModeEntry; oid: string }
  /** A level set the mode can play (`Profile.runChoices`: the soccer's fields). */
  | { kind: 'run'; mode: ModeEntry; oid: string }
  | { kind: 'tab'; tab: TabEntry }
  /** The site's intro (3.5): the last card of the grid. */
  | { kind: 'intro' }
  | { kind: 'settings' };

/**
 * The intro's card, in the grid's free slot after the modes: Tuberculoz, whose plan it tells.
 * The site's home page had an "Intro" button for visitors, beside "Essayer" (the free trial).
 */
const INTRO_ICON: Icon = { clip: 'hammer_boss_human' };
/** Top of the intro's movie in the frame: centered above the skip button. */
const INTRO_Y = 66;
/** Most movie frames played in one display frame, after the page was slow or hidden. */
const INTRO_CATCH_UP = 4;

/**
 * The rows of the settings page, in the guide's order, then the controls page (G.4) and the
 * back button.
 */
const SETTING_ROWS = ['detail', 'shake', 'sound', 'music', 'volume', 'controls', 'back'] as const;
type SettingRow = (typeof SETTING_ROWS)[number];

/**
 * The controls page (G.4): the moves in the order of the SWF's key setup screen (`#910`:
 * `labLeft`, `labRight`, `labJump`, `labDown`, `labFire1`), then the reset and back rows.
 */
const MOVES: readonly PlayerAction[] = ['left', 'right', 'jump', 'down', 'attack'];
const CTRL_RESET = MOVES.length;
const CTRL_BACK = MOVES.length + 1;
/** The controls page's columns: two keyboard slots and the controller's, as `[x, w]`. */
const CTRL_COLS: readonly [number, number][] = [
  [124, 90],
  [218, 90],
  [312, 76],
];
const CTRL_TOP = 96;
const CTRL_ROW_H = 42;

/** A slot of the controls page waiting for its key or button, and what the last press was. */
interface Capture {
  row: number;
  col: number;
  /** A press that could not be used: shown under the prompt. */
  note: string | null;
}

/**
 * The rows of the sound panel opened from the pause (port addition): details and shaking stay
 * on the menu's page, as they change the random draws of the game under way.
 */
const SOUND_ROWS: readonly SettingRow[] = ['sound', 'music', 'volume', 'back'];

/**
 * The settings button, at the bottom right of the menu's panel: as tall as the action button
 * (36), its right edge on the fridge card's (378).
 */
const GEAR = { x: 360, y: 478, r: 18 };

/** Center of the pause screen's sound button, under the instructions. */
const PAUSE_BUTTON_Y = 392;

/**
 * Texts. The names and descriptions of the Adventure and Learning, "Quêtes" and "Réfrigérateur"
 * are the site guide's (`guide.html` of hammerfest.fr, hfest.net and hammerfest.es), the fridge
 * rule its section 4, the quest rule its section 6, the option names those of the quests that
 * unlock them (`xml/lang`, quests 62 to 74; "Tornado" is the port's own, as only the French text
 * names it). From the game's lang files: "Time Attack" (static 20, quest 73), the SoccerFest's
 * name (quest 66) and description (static 32), and the boss rush's name (static 36, its pause
 * screen's title). The others, the cards' short texts among them, are the port's own.
 */
const TEXT: Record<Lang, Record<string, string>> = {
  fr: {
    solo: 'Aventure',
    tutorial: 'Apprentissage',
    soloDesc:
      'Faites des quêtes, débloquez de nouveaux modes de jeu et gagnez des points pour monter la Pyramide !',
    tutorialDesc:
      'Apprenez les techniques de base avant de vous lancer dans l’Aventure. Illimité et gratuit.',
    multicoop: 'Multi Coopératif',
    multicoopDesc:
      'L’Aventure à deux sur le même ordinateur, avec Sandy. La partie s’arrête dès qu’un joueur n’a plus de vie.',
    timeattack: 'Time Attack',
    timeattackDesc: 'Traversez les niveaux le plus vite possible : chaque seconde compte.',
    multitime: 'Time Attack à deux',
    multitimeDesc: 'Le Time Attack à deux sur le même ordinateur.',
    bossrush: 'Tubercourse',
    bossrushDesc:
      'L’Aventure contre la montre, avec un Igor plus rapide qui pose deux bombes à la fois.',
    soccer: 'SoccerFest',
    soccerDesc:
      'Amenez le ballon dans le but adverse. Tous les coups sont permis ! Ce mode se joue à 2 sur le même ordinateur.',
    soloShort: 'La grande aventure',
    tutorialShort: 'Les bases, gratuit',
    multicoopShort: 'L’Aventure à deux',
    timeattackShort: 'Contre la montre',
    multitimeShort: 'La course à deux',
    bossrushShort: 'L’Aventure express',
    soccerShort: 'Le football à deux',
    // The site's home button and the guide's link to the intro ("terrible plan que fomentait le
    // sorcier"); the page's link was "Passer l'intro et essayer le jeu"
    intro: 'Intro',
    introShort: 'Le plan du sorcier',
    introSkip: 'Passer l’intro',
    modeLockedBy: 'Ce mode se débloque avec la quête « {0} »',
    modeLockedBy2: 'Ce mode se débloque avec les quêtes « {0} » et « {1} »',
    bestTime: 'Record : {0}',
    noTime: 'Pas encore de temps sur ce parcours',
    newBest: 'Nouveau record !',
    lostRun: 'Partie perdue : pas de temps',
    start: 'Commencer',
    soon: 'Bientôt',
    soonNote: 'Ce mode n’est pas encore disponible dans HammerFenix.',
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
    mirrormulti: 'Miroir',
    nightmaremulti: 'Cauchemar',
    lifesharing: 'Partage de vies',
    ninja: 'Ninjutsu',
    bombexpert: 'Explosifs instables',
    boost: 'Tornade',
    kickcontrol: 'Contrôle du ballon',
    field: 'Terrain',
    fieldOn: 'Le terrain de vos prochains matchs',
    fieldOff: 'Choisissez ce terrain pour vos prochains matchs',
    settings: 'Options de jeu',
    settingsNote: 'Les réglages s’appliquent à la prochaine partie.',
    soundNote: 'Les détails et les vibrations se règlent depuis le menu, entre deux parties.',
    soundKey: 'Son',
    detail: 'Détails graphiques élevés',
    detailHint: 'Pour améliorer la rapidité du jeu, décochez la case.',
    shake: 'Vibrations fréquentes',
    shakeHint:
      'Si vous trouvez que les vibrations pendant le jeu sont saccadées, décochez cette case.',
    sound: 'Son',
    soundHint:
      'Les effets de son (les sauts, les explosions) sont activés si vous cochez cette case.',
    music: 'Musique',
    musicHint: 'Cochez cette case pour écouter la musique du jeu pendant votre aventure.',
    volume: 'Volume sonore',
    volumeHint: 'Réglez l’intensité du volume sonore avec cette option.',
    controls: 'Touches et manette',
    controlsHint: 'Choisissez les touches et les boutons de vos déplacements.',
    controlsTitle: 'Commandes',
    keyboard: 'Clavier',
    pad: 'Manette',
    mv_left: 'Gauche',
    mv_right: 'Droite',
    mv_jump: 'Sauter',
    mv_down: 'Bas',
    mv_attack: 'Bombe',
    resetKeys: 'Touches par défaut',
    controlsHelp:
      'Choisissez une case, puis appuyez sur la touche ou le bouton voulu. Une touche ne sert qu’à un déplacement.',
    controlsNote: 'Le stick suit la croix. À deux joueurs, les touches restent celles du mode.',
    capKey: 'Appuyez sur la touche souhaitée',
    capKeyCancel: '[ ECHAP pour annuler ]',
    capPad: 'Appuyez sur le bouton souhaité',
    capPadCancel: '[ {0} pour annuler ]',
    capReserved: 'Cette touche sert déjà au jeu (pause, musique, carte…).',
    capReservedPad: 'Ce bouton sert déjà au jeu (pause, musique, carte…).',
    capUnknown: 'Le jeu ne peut pas lire cette touche.',
  },
  en: {
    solo: 'Adventure',
    tutorial: 'Learning',
    soloDesc: 'Find quests, unblock new game modes and obtain points to climb up the pyramid!',
    tutorialDesc:
      'Learn the basic techniques before playing the Adventure mode. Free and unlimited.',
    multicoop: 'Two Players',
    multicoopDesc:
      'The Adventure for two at the same computer, with Sandy. The game ends as soon as a player has no life left.',
    timeattack: 'Time Attack',
    timeattackDesc: 'Clear the levels as fast as you can: every second counts.',
    multitime: 'Time Attack for Two',
    multitimeDesc: 'Time Attack for two at the same computer.',
    bossrush: 'Tuberace',
    bossrushDesc:
      'The Adventure against the clock, with a faster Igor who can drop two bombs at once.',
    soccer: 'Soccerfest',
    soccerDesc:
      'Kick the ball into your opponent’s goal. Everything’s allowed! This mode is for 2 players at the same computer.',
    soloShort: 'The great adventure',
    tutorialShort: 'The basics, for free',
    multicoopShort: 'The Adventure for two',
    timeattackShort: 'Against the clock',
    multitimeShort: 'A race for two',
    bossrushShort: 'The express Adventure',
    soccerShort: 'Football for two',
    // hfest.net's home button was "See Intro"; its guide, "the evil sorcerer's plan"
    intro: 'Intro',
    introShort: 'The evil sorcerer’s plan',
    introSkip: 'Skip the intro',
    modeLockedBy: 'This mode is unlocked by the quest “{0}”',
    modeLockedBy2: 'This mode is unlocked by the quests “{0}” and “{1}”',
    bestTime: 'Best time: {0}',
    noTime: 'No time on this run yet',
    newBest: 'New best time!',
    lostRun: 'Game lost: no time',
    start: 'Start game',
    soon: 'Soon',
    soonNote: 'This mode is not in HammerFenix yet.',
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
    mirrormulti: 'Mirror',
    nightmaremulti: 'Nightmare',
    lifesharing: 'Lives sharing',
    ninja: 'Ninjutsu',
    bombexpert: 'Unstable explosives',
    boost: 'Tornado',
    kickcontrol: 'Advanced Ball Control',
    field: 'Field',
    fieldOn: 'The field of your next matches',
    fieldOff: 'Choose this field for your next matches',
    settings: 'Game options',
    settingsNote: 'The settings apply to the next game.',
    soundNote: 'Details and vibrations are set from the menu, between games.',
    soundKey: 'Sound',
    detail: 'High quality graphics',
    detailHint: 'To get a better game performance, disable the box.',
    shake: 'Frequent vibrations',
    shakeHint: 'If you think the vibrations are slowing down the game, disable this box.',
    sound: 'Sound',
    soundHint: 'Sound effects (jumps, explosions, etc.) are activated if you enable this box.',
    music: 'Music',
    musicHint: 'Enable this box to listen to the music of the game during your adventure.',
    volume: 'Volume',
    volumeHint: 'Turn up or down the volume with this option.',
    controls: 'Keys and controller',
    controlsHint: 'Choose the keys and buttons you move with.',
    controlsTitle: 'Controls',
    keyboard: 'Keyboard',
    pad: 'Controller',
    mv_left: 'Left',
    mv_right: 'Right',
    mv_jump: 'Jump',
    mv_down: 'Down',
    mv_attack: 'Bomb',
    resetKeys: 'Default keys',
    controlsHelp: 'Choose a box, then press the key or button you want. A key does one move only.',
    controlsNote: 'The stick follows the D-pad. In two-player games the keys stay the mode’s.',
    capKey: 'Press the key you want',
    capKeyCancel: '[ ESC to cancel ]',
    capPad: 'Press the button you want',
    capPadCancel: '[ {0} to cancel ]',
    capReserved: 'The game already uses this key (pause, music, map…).',
    capReservedPad: 'The game already uses this button (pause, music, map…).',
    capUnknown: 'The game cannot read this key.',
  },
  es: {
    solo: 'Aventura',
    tutorial: 'Aprendizaje',
    soloDesc:
      '¡Haz exploraciones, desbloquea nuevos modos de juego y gana puntos para subir en la pirámide!',
    tutorialDesc:
      'Aprende las técnicas básicas antes de lanzarte al modo Aventura. Ilimitado y gratuito.',
    multicoop: 'Cooperativo',
    multicoopDesc:
      'La Aventura para dos en el mismo ordenador, con Sandy. La partida termina en cuanto un jugador se queda sin vidas.',
    timeattack: 'Contrarreloj',
    timeattackDesc: 'Supera los niveles lo más rápido posible: cada segundo cuenta.',
    multitime: 'Contrarreloj a dos',
    multitimeDesc: 'La Contrarreloj para dos en el mismo ordenador.',
    bossrush: 'Tubercarrera',
    bossrushDesc: 'La Aventura contrarreloj, con un Igor más rápido que pone dos bombas a la vez.',
    soccer: 'Fútbolfest',
    soccerDesc:
      'Lleva el balón a la portería contraria. ¡Todo está permitido! Este modo es para 2 jugadores en el mismo ordenador.',
    soloShort: 'La gran aventura',
    tutorialShort: 'Lo básico, gratis',
    multicoopShort: 'La Aventura a dos',
    timeattackShort: 'Contra el reloj',
    multitimeShort: 'Una carrera a dos',
    bossrushShort: 'La Aventura exprés',
    soccerShort: 'Fútbol a dos',
    // The Spanish site's home button was "Ver la Intro"; its guide, "el malvado plan del
    // hechicero"
    intro: 'Intro',
    introShort: 'El plan del hechicero',
    introSkip: 'Saltar la intro',
    modeLockedBy: 'Este modo se desbloquea con la exploración «{0}»',
    modeLockedBy2: 'Este modo se desbloquea con las exploraciones «{0}» y «{1}»',
    bestTime: 'Récord: {0}',
    noTime: 'Aún no hay tiempo en este recorrido',
    newBest: '¡Nuevo récord!',
    lostRun: 'Partida perdida: sin tiempo',
    start: 'Comenzar',
    soon: 'Pronto',
    soonNote: 'Este modo aún no está en HammerFenix.',
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
    mirrormulti: 'Espejo',
    nightmaremulti: 'Pesadilla',
    lifesharing: 'Compartir vidas',
    ninja: 'Ninjutsu',
    bombexpert: 'Explosivos inestables',
    boost: 'Tornado',
    kickcontrol: 'Control avanzado del balón',
    field: 'Terreno',
    fieldOn: 'El terreno de tus próximos partidos',
    fieldOff: 'Elige este terreno para tus próximos partidos',
    settings: 'Opciones de juego',
    settingsNote: 'Los ajustes se aplican a la próxima partida.',
    soundNote: 'Los detalles y las vibraciones se ajustan desde el menú, entre partidas.',
    soundKey: 'Sonido',
    detail: 'Detalles gráficos elevados',
    detailHint: 'Para mejorar la rapidez del juego, desactiva la casilla.',
    shake: 'Vibraciones frecuentes',
    shakeHint:
      'Si te parece que las vibraciones en el juego entorpecen tu juego, desactiva esta casilla.',
    sound: 'Sonido',
    soundHint:
      'Los efectos de sonido (los saltos, las explosiones, etc.) están activados si activas esta casilla.',
    music: 'Música',
    musicHint: 'Activa esta casilla para escuchar la música del juego durante tu aventura.',
    volume: 'Volumen del sonido',
    volumeHint: 'Puedes cambiar el volumen del sonido con esta opción.',
    controls: 'Teclas y mando',
    controlsHint: 'Elige las teclas y los botones con los que te mueves.',
    controlsTitle: 'Controles',
    keyboard: 'Teclado',
    pad: 'Mando',
    mv_left: 'Izquierda',
    mv_right: 'Derecha',
    mv_jump: 'Saltar',
    mv_down: 'Abajo',
    mv_attack: 'Bomba',
    resetKeys: 'Teclas por defecto',
    controlsHelp:
      'Elige una casilla y pulsa la tecla o el botón que quieras. Cada tecla sirve para un solo movimiento.',
    controlsNote: 'El stick sigue a la cruceta. A dos jugadores, las teclas son las del modo.',
    capKey: 'Pulsa la tecla que quieras',
    capKeyCancel: '[ ESC para cancelar ]',
    capPad: 'Pulsa el botón que quieras',
    capPadCancel: '[ {0} para cancelar ]',
    capReserved: 'El juego ya usa esta tecla (pausa, música, mapa…).',
    capReservedPad: 'El juego ya usa este botón (pausa, música, mapa…).',
    capUnknown: 'El juego no puede leer esta tecla.',
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
  /** Page titles and keycap letters: the wood, as text. */
  heading: '#5f452c',
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
  /** A Time Attack game's time against the best one, for its results page. */
  private time: TimeResult | null = null;
  /** Index in `menuEntries()`. */
  private selected = 0;
  /**
   * The mode chosen on the menu (`$mode`): its options or description show under the cards, and
   * the action button starts it. The arrows only move the focus (`selected`); confirming a card
   * chooses it, and confirming the chosen card starts it, as two clicks do.
   */
  private chosen = MODES[0].mode;
  /** Where each menu entry was drawn (`[x, y, w, h]`), for the arrows. */
  private readonly navRects = new Map<number, [number, number, number, number]>();
  private questSel = 0;
  private questTop = 0;
  private fridgeSel = 0;
  private settingSel = 0;
  /** The player's settings, as the settings page shows them. */
  settings: PlayerSettings = { ...DEFAULT_SETTINGS };
  /** The player's keys and buttons, as the controls page shows them (G.4). */
  bindings: Bindings = DEFAULT_BINDINGS;
  /** The controls page's selected row and column. */
  private ctrlRow = 0;
  private ctrlCol = 0;
  /** Set while a slot waits for its key or button. */
  private capture: Capture | null = null;
  /** A key or button changed on the controls page. */
  onBindings?: (b: Bindings) => void;
  private baseUrl = './';
  /** The intro's library (`gfx/intro.json`), loaded the first time it plays. */
  private introLib: Promise<SwfLibrary | null> | null = null;
  /** The intro playing, once its library is loaded. */
  private intro: IntroMovie | null = null;
  /** Holds the intro's movie, kept when the screen is drawn again. */
  private readonly introLayer = new Container();
  /** `performance.now()` of the intro's last frame. */
  private introClock = 0;

  /** "Start game" on Adventure: the site loads the game page with `$mode`. */
  onStart?: (mode: string) => void;
  /** A setting changed on the settings page. */
  onSettings?: (s: PlayerSettings) => void;
  /** Set while the sound panel shows over the game. */
  private onSoundClose: (() => void) | null = null;
  /**
   * The button under the pause screen that opens the sound panel (port addition), above the
   * game: the page adds it to the stage.
   */
  readonly pauseLayer = new Container();
  /** What the pause button was drawn for (device, layout, language), or null when hidden. */
  private pauseDrawn: string | null = null;
  /** The pause button was clicked. */
  onPauseSound?: () => void;

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
    // The intro's movie, masked to its stage. A press on it is its button's (`IntroMovie.click`);
    // Flash showed the hand over a button
    this.introLayer.position.set(0, INTRO_Y);
    this.introLayer.mask = this.introLayer.addChild(
      new Graphics().rect(0, 0, INTRO_W, INTRO_H).fill(0xffffff),
    );
    this.introLayer.eventMode = 'static';
    this.introLayer.cursor = 'pointer';
    this.introLayer.hitArea = new Rectangle(0, 0, INTRO_W, INTRO_H);
    this.introLayer.on('pointerdown', () => this.intro?.click());
  }

  /** Loads the title logo and the game over picture. */
  async load(baseUrl: string): Promise<void> {
    this.baseUrl = baseUrl;
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
  showResult(
    result: GameResult,
    record: GameRecord | null = null,
    time: TimeResult | null = null,
  ): void {
    this.screen = 'result';
    this.result = result;
    this.record = record;
    this.time = time;
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

  showSettings(): void {
    this.screen = 'settings';
    this.settingSel = 0;
    this.render();
  }

  /** The controls page (G.4), from the settings page. */
  showControls(): void {
    this.screen = 'controls';
    this.ctrlRow = 0;
    this.ctrlCol = 0;
    this.endCapture();
    this.render();
  }

  /**
   * The sound panel over the paused game (port addition): sound, music and volume, which the
   * game applies at once. `onClose` runs when it closes.
   */
  showSound(onClose: () => void): void {
    this.screen = 'sound';
    this.settingSel = 0;
    this.onSoundClose = onClose;
    this.render();
  }

  /**
   * The site's intro (3.5), from the menu's card or on the first launch. It plays in the game
   * frame and ends at its end, on a click, or with the confirm or back key; the menu then shows
   * with the Learning mode chosen, the free trial the movie led to (`INTRO_URL`).
   */
  showIntro(): void {
    this.screen = 'intro';
    this.dropIntro();
    this.render();
    this.introLib ??= IntroMovie.load(this.baseUrl).catch(() => null);
    void this.introLib.then((lib) => {
      if (this.screen !== 'intro' || this.intro) return;
      if (!lib) {
        this.introLib = null; // try again next time (offline before it was cached)
        this.endIntro();
        return;
      }
      this.intro = new IntroMovie(lib, this.lang, (code) => this.input.keyHeld(code));
      this.introLayer.addChildAt(this.intro.root, 0);
      this.introClock = performance.now();
    });
  }

  /** The intro is over: back to the menu, the Learning mode chosen. */
  private endIntro(): void {
    this.dropIntro();
    const tutorial = MODES.find((m) => m.mode === 'tutorial')!;
    this.chosen = tutorial.mode;
    this.selected = Math.max(
      0,
      this.menuEntries().findIndex((e) => e.kind === 'mode' && e.mode === tutorial),
    );
    this.showMenu();
  }

  private dropIntro(): void {
    if (!this.intro) return;
    this.intro.root.destroy({ children: true });
    this.intro = null;
  }

  hide(): void {
    this.dropIntro();
    this.endCapture();
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
    if (this.pauseDrawn !== null) this.pauseDrawn = '';
  }

  /**
   * Shows or hides the pause screen's sound button: a wood pill with a gear, "Son" and the key
   * that opens it too (O, or the controller's R1). Called every frame; redrawn only on a change.
   */
  setPauseButton(on: boolean): void {
    const key = on ? `${this.input.device}:${this.input.padLayout}:${this.lang}` : null;
    if (key === this.pauseDrawn) return;
    this.pauseDrawn = key;
    for (const c of this.pauseLayer.removeChildren()) c.destroy({ children: true });
    if (!on) return;
    const cx = W / 2;
    const cy = PAUSE_BUTTON_Y;
    const h = 30;
    const face = new Container();
    const lbl = this.text(this.t.soundKey, 'label', 0, 0, {
      align: 'left',
      size: 15,
      color: C.gold,
      parent: face,
    });
    const cap = new Container();
    let capW = 0;
    if (this.input.device === 'keyboard') {
      const k = this.text('O', 'label', 0, 0, {
        align: 'left',
        size: 10,
        color: '#5f452c',
        parent: cap,
      });
      capW = Math.max(17, k.width + 10);
      cap.addChildAt(
        new Graphics()
          .roundRect(0, 1.5, capW, 17, 4)
          .fill(0xc8a878)
          .roundRect(0, 0, capW, 17, 4)
          .fill(0xfffaf0),
        0,
      );
      k.position.set((capW - k.width) / 2, (17 - k.height) / 2);
    } else if (this.input.device === 'gamepad') {
      const g = padGlyph('r1', this.input.padLayout, 18, 'onDark');
      g.position.set(g.width / 2, 9);
      cap.addChild(g);
      capW = g.width;
    }
    face.addChild(cap);
    const gearR = 8;
    const gap = 8;
    const w = 14 + gearR * 2 + gap + lbl.width + (capW > 0 ? gap + capW : 0) + 14;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const bg = new Graphics()
      .roundRect(x, y + 3, w, h, h / 2)
      .fill(C.woodDark)
      .roundRect(x, y, w, h, h / 2)
      .fill(C.wood);
    const glow = new Graphics().roundRect(x, y, w, h, h / 2).fill({ color: 0xffffff, alpha: 0.12 });
    glow.visible = false;
    face.addChildAt(gear(x + 14 + gearR, cy, gearR, C.gold), 0);
    lbl.position.set(x + 14 + gearR * 2 + gap, cy - lbl.height / 2);
    cap.position.set(lbl.x + lbl.width + gap, cy - 9);
    const btn = new Container();
    btn.addChild(bg, glow, face);
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.hitArea = new Rectangle(x, y, w, h + 3);
    btn.on('pointerover', () => (glow.visible = true));
    btn.on('pointerout', () => (glow.visible = false));
    btn.on('pointertap', () => this.onPauseSound?.());
    this.pauseLayer.addChild(btn);
  }

  /**
   * Keys, once per frame while a screen shows: arrows choose, space confirms. A controller
   * moves with its D-pad or stick, confirms with A and goes back with B.
   */
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
    if (this.capture) {
      this.updateCapture();
      return;
    }
    const up = inp.consumeMenu('up');
    const down = inp.consumeMenu('down');
    const left = inp.consumeMenu('left');
    const right = inp.consumeMenu('right');
    const ok = inp.consumeMenu('ok');
    const esc = inp.consumeMenu('back');
    switch (this.screen) {
      case 'intro':
        if (ok || esc) this.endIntro();
        else this.stepIntro();
        break;
      case 'menu':
        if (up) this.navigate(0, -1);
        if (down) this.navigate(0, 1);
        if (left) this.navigate(-1, 0);
        if (right) this.navigate(1, 0);
        if (ok) this.confirm();
        break;
      case 'result':
        if (ok || up || esc) this.showMenu();
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
      case 'settings':
      case 'sound':
        if (up) this.selectSetting(this.settingSel - 1);
        if (down) this.selectSetting(this.settingSel + 1);
        if (this.settingRows[this.settingSel] === 'volume') {
          if (left) this.setVolume(this.settings.volume - VOLUME_STEP);
          if (right) this.setVolume(this.settings.volume + VOLUME_STEP);
        }
        if (ok) this.confirmSetting();
        if (esc) this.leaveSettings();
        break;
      case 'controls':
        if (up) this.selectControl(this.ctrlRow - 1, this.ctrlCol);
        if (down) this.selectControl(this.ctrlRow + 1, this.ctrlCol);
        if (left && this.ctrlRow < CTRL_RESET) this.selectControl(this.ctrlRow, this.ctrlCol - 1);
        if (right && this.ctrlRow < CTRL_RESET) this.selectControl(this.ctrlRow, this.ctrlCol + 1);
        if (ok) this.confirmControl();
        if (esc) this.leaveControls();
        break;
    }
  }

  /** The intro's frames due since the last display frame, at its 40 fps. */
  private stepIntro(): void {
    const movie = this.intro;
    if (!movie) return;
    const now = performance.now();
    const frame = 1000 / INTRO_FPS;
    let n = Math.floor((now - this.introClock) / frame);
    if (n > INTRO_CATCH_UP) {
      n = INTRO_CATCH_UP;
      this.introClock = now - frame * n;
    }
    for (let i = 0; i < n && !movie.ended; i++) movie.step();
    this.introClock += n * frame;
    if (movie.ended) this.endIntro();
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
      if (!mode.enabled || this.isLocked(mode)) continue;
      for (const oid of this.modeOptions(mode)) out.push({ kind: 'option', mode, oid });
      for (const oid of this.profile.runChoices(mode.mode)) out.push({ kind: 'run', mode, oid });
    }
    out.push({ kind: 'intro' });
    for (const tab of TABS) out.push({ kind: 'tab', tab });
    out.push({ kind: 'settings' });
    return out;
  }

  /** A mode the profile does not have yet: a quest gives it (`Profile.hasMode`). */
  private isLocked(mode: ModeEntry): boolean {
    return !this.profile.hasMode(mode.mode);
  }

  /** The run a Time Attack mode would play (`Profile.runOption`), null for another mode. */
  private runOf(mode: string): number | null {
    const run = this.profile.runOption(mode);
    return run === null ? null : Number(run.charAt(run.length - 1));
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
    if (e.kind === 'settings') {
      this.showSettings();
    } else if (e.kind === 'intro') {
      this.showIntro();
    } else if (e.kind === 'tab') {
      if (e.tab.screen === 'quests') this.showQuests();
      else this.showFridge();
    } else if (e.kind === 'option') {
      if (e.oid === Data.OPT_BOOST) return; // no box to untick (quest 62)
      this.profile.toggleOption(e.oid);
      this.render();
    } else if (e.kind === 'run') {
      this.profile.chooseRun(e.mode.mode, e.oid);
      this.render();
    } else if (e.mode.mode !== this.chosen) {
      this.chosen = e.mode.mode;
      this.render();
    } else if (e.mode.enabled && !this.isLocked(e.mode)) {
      this.onStart?.(e.mode.mode);
    }
  }

  /**
   * A click on menu entry `i`: tabs open, options tick and fields are chosen at once; a mode is
   * chosen, and started when it already was.
   */
  private clickEntry(i: number): void {
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

  /** The rows of the settings page showing. */
  private get settingRows(): readonly SettingRow[] {
    return this.screen === 'sound' ? SOUND_ROWS : SETTING_ROWS;
  }

  private selectSetting(i: number): void {
    const count = this.settingRows.length;
    const n = (i + count) % count;
    if (n === this.settingSel) return;
    this.settingSel = n;
    this.render();
  }

  /** Space or a click on a row: ticks or unticks it; on the volume, the next step (wrapping). */
  private confirmSetting(): void {
    const row = this.settingRows[this.settingSel];
    if (row === 'back') {
      this.leaveSettings();
      return;
    }
    if (row === 'controls') {
      this.showControls();
      return;
    }
    if (row === 'volume') {
      const v = this.settings.volume;
      this.setVolume(v >= 100 ? 0 : v + VOLUME_STEP);
      return;
    }
    this.changeSettings({ [row]: this.settings[row] ? 0 : 1 });
  }

  /**
   * Back to the menu, with Adventure selected again (the gear is only a way in); or, from the
   * sound panel, back to the paused game.
   */
  private leaveSettings(): void {
    if (this.screen === 'sound') {
      const close = this.onSoundClose;
      this.onSoundClose = null;
      this.hide();
      close?.();
      return;
    }
    this.selected = 0;
    this.showMenu();
  }

  private setVolume(v: number): void {
    const vol = Math.max(0, Math.min(100, Math.round(v / VOLUME_STEP) * VOLUME_STEP));
    if (vol !== this.settings.volume) this.changeSettings({ volume: vol });
  }

  // ---------------------------------------------------------- controls (G.4)

  private selectControl(row: number, col: number): void {
    const rows = CTRL_BACK + 1;
    const r = (row + rows) % rows;
    const c = Math.max(0, Math.min(CTRL_COLS.length - 1, col));
    if (r === this.ctrlRow && c === this.ctrlCol) return;
    this.ctrlRow = r;
    this.ctrlCol = c;
    this.render();
  }

  /** Space, A or a click: a slot waits for its key or button; the other rows act. */
  private confirmControl(): void {
    if (this.ctrlRow === CTRL_BACK) {
      this.leaveControls();
    } else if (this.ctrlRow === CTRL_RESET) {
      this.changeBindings(DEFAULT_BINDINGS);
    } else {
      this.capture = { row: this.ctrlRow, col: this.ctrlCol, note: null };
      this.input.startCapture();
      this.render();
    }
  }

  /** Back to the settings page, on its controls row. */
  private leaveControls(): void {
    this.endCapture();
    this.screen = 'settings';
    this.settingSel = SETTING_ROWS.indexOf('controls');
    this.render();
  }

  /**
   * While a slot waits: Escape (or the controller's Start) cancels, as the SWF's screen says;
   * a key goes in a keyboard slot, a button in the controller's. Keys and buttons the game
   * keeps, or cannot read, leave a note and the slot waits on.
   */
  private updateCapture(): void {
    const cap = this.capture!;
    const got = this.input.pollCapture();
    if (!got) return;
    const action = MOVES[cap.row];
    const t = this.t;
    const onPad = cap.col === 2;
    if (got.kind === 'key') {
      if (got.code === Key.ESCAPE) return this.stopCapture();
      if (onPad) return;
      if (isReservedKey(got.code)) return this.captureNote(t.capReserved);
      if (got.code < 0 || keyName(got.code) === null) return this.captureNote(t.capUnknown);
      this.stopCapture();
      this.changeBindings(bindKey(this.bindings, action, cap.col as 0 | 1, got.code));
    } else {
      if (got.button === PAD.START) return this.stopCapture();
      if (!onPad) return;
      if (!BINDABLE_BUTTONS.includes(got.button)) return this.captureNote(t.capReservedPad);
      this.stopCapture();
      this.changeBindings(bindButton(this.bindings, action, got.button));
    }
  }

  private captureNote(note: string): void {
    if (this.capture) this.capture.note = note;
    this.render();
  }

  /** Ends the wait: the key or button that ended it does not move the page too. */
  private stopCapture(): void {
    this.endCapture();
    this.input.lockMenuHeld();
    this.render();
  }

  private endCapture(): void {
    if (!this.capture) return;
    this.capture = null;
    this.input.stopCapture();
  }

  private changeBindings(b: Bindings): void {
    this.bindings = b;
    this.onBindings?.(b);
    this.render();
  }

  private changeSettings(change: Partial<PlayerSettings>): void {
    this.settings = { ...this.settings, ...change };
    this.onSettings?.(this.settings);
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
    for (const c of this.root.removeChildren()) {
      if (c !== this.introLayer) c.destroy({ children: true });
    }
  }

  private render(): void {
    this.clear();
    this.fadeFrom = null;
    this.fadeReady = null;
    this.root.alpha = 1;
    this.root.eventMode = 'static';
    this.root.visible = true;
    this.root.parent?.addChild(this.root); // above the Loader's clip
    if (this.screen === 'sound') {
      // Over the paused game
      this.root.addChild(new Graphics().rect(0, 0, W, H).fill({ color: 0x0b1530, alpha: 0.45 }));
    } else if (this.screen === 'intro') {
      // The movie's background color
      this.root.addChild(new Graphics().rect(0, 0, W, H).fill(0x000000));
    } else {
      this.drawBackground(
        this.screen === 'quests' ||
          this.screen === 'fridge' ||
          this.screen === 'settings' ||
          this.screen === 'controls',
      );
    }
    if (this.screen === 'intro') this.drawIntro();
    else if (this.screen === 'menu') this.drawMenu();
    else if (this.screen === 'settings' || this.screen === 'sound') this.drawSettings();
    else if (this.screen === 'controls') this.drawControls();
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
    // Not clipped to the screen: Pixi clips a filter to the screen's size in pixels divided by
    // the target's resolution, which inside the 1.5x cache below cuts the picture short when
    // the canvas is drawn at resolution 1 (a small frame on a phone), leaving it partly black
    bg.filters = [new BlurFilter({ strength: BG_BLUR, quality: 4, clipToViewport: false })];
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
   * too (not with `cap` 'pad', where space does something else); with a controller, its A
   * button (B for `back`). `action` null draws it disabled.
   */
  private actionButton(
    label: string,
    cy: number,
    action: (() => void) | null,
    w = 220,
    back = false,
    capMode: 'auto' | 'pad' = 'auto',
  ): void {
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
    // The keycap, sized to its text, or the controller's button
    let capW = 0;
    const cap = new Container();
    const device = this.input.device;
    if (on && device === 'keyboard' && capMode === 'auto') {
      const k = this.text(this.texts.getStatic(10) || 'SPACE', 'label', 0, 0, {
        align: 'left',
        size: 9,
        color: C.heading,
        parent: cap,
      });
      capW = k.width + 12;
      cap.addChildAt(
        new Graphics()
          .roundRect(0, 1.5, capW, 18, 4)
          .fill(0xc8a878)
          .roundRect(0, 0, capW, 18, 4)
          .fill(0xfffaf0),
        0,
      );
      k.position.set(6, (18 - k.height) / 2);
      face.addChild(cap);
    } else if (on && device === 'gamepad') {
      const g = padGlyph(back ? 'b' : 'a', this.input.padLayout, 18, 'onDark');
      g.position.set(g.width / 2, 9);
      cap.addChild(g);
      capW = g.width;
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
    if ('item' in icon && icon.twice) {
      const pair = new Container();
      const one = { item: icon.item };
      this.icon(one, x - size * 0.18, y - size * 0.12, size * 0.8, pair).alpha = 0.8;
      this.icon(one, x + size * 0.14, y + size * 0.1, size * 0.8, pair);
      (parent ?? this.root).addChild(pair);
      return pair;
    }
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
    this.navRects.clear();
    this.drawTitle(2, 290);
    const top = 124;
    this.panel(26, top, 368, H - 8 - top);

    MODES.forEach((m, i) => this.drawModeCard(m, i, entries));
    this.drawIntroCard(MODES.length, entries);

    // Under the cards: the options of the chosen mode, else its description
    const shown = MODES.find((m) => m.mode === this.chosen) ?? MODES[0];
    const canStart = shown.enabled && !this.isLocked(shown);
    if (canStart && this.modeOptions(shown).length > 0) {
      this.drawOptions(shown, entries, DETAIL_Y);
    } else {
      const desc = this.text(t[shown.mode + 'Desc'], 'body', W / 2, DETAIL_Y + 4, {
        width: 320,
        color: C.inkSoft,
      });
      const note = !shown.enabled
        ? t.soonNote
        : canStart
          ? ''
          : shown.mode === 'multitime'
            ? fmt(t.modeLockedBy2, this.questForMode('timeattack'), this.questForMode('multicoop'))
            : fmt(t.modeLockedBy, this.questForMode(shown.mode));
      if (note) {
        this.text(note, 'body', W / 2, desc.y + desc.height + 6, {
          width: 320,
          size: 11,
          italic: true,
          color: C.inkSoft,
        });
      }
      // The Time Attack modes: the best time of the run they play
      const run = canStart ? this.runOf(shown.mode) : null;
      if (run !== null) {
        const best = this.profile.bestTime(shown.mode, run);
        this.text(
          best === null ? t.noTime : fmt(t.bestTime, formatRunTime(best)),
          'label',
          W / 2,
          desc.y + desc.height + 10,
          { size: best === null ? 13 : 16, color: best === null ? C.inkSoft : C.heading },
        );
      }
    }

    // The quest and fridge pages
    const counts = this.counts();
    TABS.forEach((tb, i) => {
      const n = entries.findIndex((e) => e.kind === 'tab' && e.tab === tb);
      const sel = n === this.selected;
      const x = CARD.x[i];
      const y = TAB_Y;
      const btn = this.button([x, y, CARD.w, TAB_H], () => this.clickEntry(n), sel, 10);
      this.navRects.set(n, [x, y, CARD.w, TAB_H]);
      if (!sel) {
        btn.addChildAt(
          new Graphics()
            .roundRect(x, y, CARD.w, TAB_H, 10)
            .stroke({ color: C.wood, width: 1, alpha: 0.35 }),
          1,
        );
      }
      this.icon(tb.icon, x + 24, y + TAB_H / 2, 28, btn);
      this.text(t[tb.screen], 'label', x + 46, y + 4, {
        align: 'left',
        size: 15,
        color: sel ? C.gold : C.ink,
        parent: btn,
      });
      const [have, all] = tb.screen === 'quests' ? counts.quests : counts.fridge;
      this.text(`${have} / ${all}`, 'body', x + 46, y + 23, {
        align: 'left',
        size: 11,
        color: sel ? C.gold : C.inkSoft,
        parent: btn,
      });
    });

    this.drawGear(entries);

    if (cur.kind === 'tab') this.actionButton(t[cur.tab.screen], BUTTON_Y, () => this.confirm());
    else if (cur.kind === 'intro') this.actionButton(t.intro, BUTTON_Y, () => this.confirm());
    else if (cur.kind === 'settings') this.actionButton(t.settings, BUTTON_Y, () => this.confirm());
    else if (canStart) this.actionButton(t.start, BUTTON_Y, () => this.onStart?.(shown.mode));
    else this.actionButton(t.start, BUTTON_Y, null);
  }

  /**
   * Mode card `i` of the grid: its icon, name and short text, a padlock while a quest has yet to
   * give it, "Soon" for a mode not ported yet. Wood when focused; the chosen one has a darker
   * frame.
   */
  private drawModeCard(m: ModeEntry, i: number, entries: MenuEntry[]): void {
    const t = this.t;
    const x = CARD.x[i % 2];
    const y = CARD.y + Math.floor(i / 2) * (CARD.h + CARD.gap);
    const n = entries.findIndex((e) => e.kind === 'mode' && e.mode === m);
    const sel = n === this.selected;
    const chosen = m.mode === this.chosen;
    const locked = m.enabled && this.isLocked(m);
    const open = m.enabled && !locked;
    const card = this.button([x, y, CARD.w, CARD.h], () => this.clickEntry(n), sel, 8);
    this.navRects.set(n, [x, y, CARD.w, CARD.h]);
    if (!sel) {
      const b = chosen ? 2 : 1;
      card.addChildAt(
        new Graphics()
          .roundRect(x + b / 2, y + b / 2, CARD.w - b, CARD.h - b, 8)
          .fill({ color: C.wood, alpha: chosen ? 0.14 : 0.05 })
          .stroke({ color: C.wood, width: b, alpha: chosen ? 0.9 : 0.35 }),
        1,
      );
    }
    const ic = this.icon(m.icon, x + 20, y + CARD.h / 2, 26, card);
    if (!open) ic.alpha = 0.45;
    const textX = x + 38;
    // Room for the text, and for the padlock beside the name
    const room = x + CARD.w - 6 - textX;
    const name = this.text(t[m.mode], 'label', textX, y + 4, {
      align: 'left',
      size: 14,
      color: sel ? C.gold : open ? C.ink : C.todo,
      parent: card,
    });
    fitWidth(name, locked ? room - 14 : room);
    if (locked) this.padlock(x + CARD.w - 15, y + 6, card, sel ? C.gold : C.inkSoft);
    const line = this.text(m.enabled ? t[m.mode + 'Short'] : t.soon, 'body', textX, y + 21, {
      align: 'left',
      size: 10,
      italic: !m.enabled,
      color: sel ? C.gold : open ? C.inkSoft : C.todo,
      parent: card,
    });
    fitWidth(line, room);
  }

  /** The intro's card, slot `i` of the grid: it plays the intro at once, as a tab opens. */
  private drawIntroCard(i: number, entries: MenuEntry[]): void {
    const t = this.t;
    const x = CARD.x[i % 2];
    const y = CARD.y + Math.floor(i / 2) * (CARD.h + CARD.gap);
    const n = entries.findIndex((e) => e.kind === 'intro');
    const sel = n === this.selected;
    const card = this.button([x, y, CARD.w, CARD.h], () => this.clickEntry(n), sel, 8);
    this.navRects.set(n, [x, y, CARD.w, CARD.h]);
    if (!sel) {
      card.addChildAt(
        new Graphics()
          .roundRect(x + 0.5, y + 0.5, CARD.w - 1, CARD.h - 1, 8)
          .fill({ color: C.wood, alpha: 0.05 })
          .stroke({ color: C.wood, width: 1, alpha: 0.35 }),
        1,
      );
    }
    this.icon(INTRO_ICON, x + 20, y + CARD.h / 2, 26, card);
    const textX = x + 38;
    const room = x + CARD.w - 6 - textX;
    const name = this.text(t.intro, 'label', textX, y + 4, {
      align: 'left',
      size: 14,
      color: sel ? C.gold : C.ink,
      parent: card,
    });
    fitWidth(name, room);
    const line = this.text(t.introShort, 'body', textX, y + 21, {
      align: 'left',
      size: 10,
      color: sel ? C.gold : C.inkSoft,
      parent: card,
    });
    fitWidth(line, room);
  }

  /** The intro's screen: the movie on black, and the site page's link to skip it, as a button. */
  private drawIntro(): void {
    this.root.addChild(this.introLayer);
    this.actionButton(this.t.introSkip, BUTTON_Y, () => this.endIntro());
  }

  /**
   * Arrows on the menu: the nearest entry in that direction, as drawn (cards, options, tabs,
   * gear), favoring the same row or column. Up and down wrap around; left and right stop at
   * the edge.
   */
  private navigate(dx: number, dy: number): void {
    const from = this.navRects.get(this.selected);
    if (!from) {
      this.select(0);
      return;
    }
    const center = ([x, y, w, h]: [number, number, number, number]) => [x + w / 2, y + h / 2];
    const best = (fx: number, fy: number): number => {
      let pick = -1;
      let score = Infinity;
      for (const [n, r] of this.navRects) {
        if (n === this.selected) continue;
        const [cx, cy] = center(r);
        const along = dx !== 0 ? (cx - fx) * dx : (cy - fy) * dy;
        const across = dx !== 0 ? Math.abs(cy - fy) : Math.abs(cx - fx);
        // Within 60 degrees of the direction: nothing far to the side
        if (along <= 1 || across > along * 1.75) continue;
        const sc = along + across * 3;
        if (sc < score) {
          score = sc;
          pick = n;
        }
      }
      return pick;
    };
    const [fx, fy] = center(from);
    let n = best(fx, fy);
    // Wrap: as if coming from beyond the other edge
    if (n < 0 && dy !== 0) n = best(fx, dy > 0 ? -1000 : H + 1000);
    if (n >= 0) this.select(n);
  }

  /** The settings button: a gear on a round wood button, as the tabs when selected. */
  private drawGear(entries: MenuEntry[]): void {
    const n = entries.findIndex((e) => e.kind === 'settings');
    const sel = n === this.selected;
    const { x, y, r } = GEAR;
    const btn = this.button([x - r, y - r, 2 * r, 2 * r], () => this.clickEntry(n), sel, r);
    this.navRects.set(n, [x - r, y - r, 2 * r, 2 * r]);
    if (!sel) {
      btn.addChildAt(
        new Graphics().circle(x, y, r - 0.5).stroke({ color: C.wood, width: 1, alpha: 0.35 }),
        1,
      );
    }
    btn.addChild(gear(x, y, r * 0.62, sel ? C.gold : C.wood));
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
      this.navRects.set(n, [x - 8, y - 2, 162, 19]);
      const ink = sel ? C.gold : unlocked ? C.ink : C.todo;
      if (unlocked) {
        const box = new Graphics()
          .roundRect(x, y + 2, 11, 11, 2)
          .fill({ color: 0xffffff, alpha: sel ? 0.15 : 0.6 })
          .stroke({ color: sel ? C.gold : C.wood, width: 1.4 });
        if (ticked) {
          box
            .moveTo(x + 2.5, y + 7.5)
            .lineTo(x + 5, y + 10)
            .lineTo(x + 9.5, y + 4)
            .stroke({ color: sel ? C.gold : C.wood, width: 2 });
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

    // The fields to choose from (the site's select): a numbered button each, in the right column
    const runs = this.profile.runChoices(mode.mode);
    if (runs.length > 0) {
      const x = 222;
      this.text(t.field, 'label', x, y0 + 19, { align: 'left', size: 13, color: C.ink });
      const chosen = this.profile.runOption(mode.mode);
      runs.forEach((oid, k) => {
        const rect: [number, number, number, number] = [x - 8 + k * 41, y0 + 38, 36, 20];
        const n = entries.findIndex((e) => e.kind === 'run' && e.oid === oid);
        const sel = n === this.selected;
        const on = oid === chosen;
        const btn = this.button(rect, () => this.clickEntry(n), sel, 5);
        this.navRects.set(n, rect);
        if (!sel) {
          const b = on ? 2 : 1;
          btn.addChildAt(
            new Graphics()
              .roundRect(rect[0] + b / 2, rect[1] + b / 2, rect[2] - b, rect[3] - b, 5)
              .fill({ color: C.wood, alpha: on ? 0.14 : 0.05 })
              .stroke({ color: C.wood, width: b, alpha: on ? 0.9 : 0.35 }),
            1,
          );
        }
        this.text(String(k + 1), 'label', rect[0] + rect[2] / 2, rect[1] + 2, {
          size: 13,
          color: sel ? C.gold : on ? C.ink : C.inkSoft,
          parent: btn,
        });
        if (sel) hint = this.fieldHint(k, on);
      });
    }

    if (hint) this.text(hint, 'body', W / 2, y0 + 80, { size: 10, italic: true, color: C.inkSoft });
  }

  /**
   * What a soccer field button says: whether it is the field of the next match; for the third,
   * the text its level script shows instead (`Lang` 130, "dedicated to VolleyFest", without its
   * `*` marks).
   */
  private fieldHint(k: number, chosen: boolean): string {
    const volley = k === 2 ? this.texts.getStatic(130).replace(/\*/g, '') : '';
    if (volley) return volley;
    return chosen ? this.t.fieldOn : this.t.fieldOff;
  }

  /**
   * The name of the quest that gives mode `mode` (`give mode=` in `quests.xml`). The boss rush
   * comes with Tuberculoz's cape (`BOSS_RUSH_FAMILY`), so the quest that gives that family.
   */
  private questForMode(mode: string): string {
    const q = this.profile.quests.quests.find((x) =>
      x.actions.some((a) =>
        a.type !== 'give'
          ? false
          : mode === 'bossrush'
            ? a.attrs.family === String(BOSS_RUSH_FAMILY)
            : a.attrs.mode === mode,
      ),
    );
    return q ? this.texts.getQuestName(q.id) : '?';
  }

  /** The name of the quest that gives option `oid` (`give option=` in `quests.xml`). */
  private questForOption(oid: string): string {
    const q = this.profile.quests.quests.find((x) =>
      x.actions.some((a) => a.type === 'give' && a.attrs.option === oid),
    );
    return q ? this.texts.getQuestName(q.id) : '?';
  }

  // -------------------------------------------------------------- settings

  /**
   * The settings page: a checkbox each for details, shaking, sound and music, a gauge for the
   * volume. The selected row shows the guide's text for it.
   */
  private drawSettings(): void {
    const t = this.t;
    const st = this.settings;
    const rows = this.settingRows;
    // The sound panel is smaller, over the game
    const inGame = this.screen === 'sound';
    const y0 = inGame ? 50 : 12;
    const buttonY = inGame ? 414 : BUTTON_Y;
    this.panel(12, y0, 396, inGame ? 400 : H - 20);
    this.text(t.settings, 'title', W / 2, y0 + 10, { size: 26, color: C.heading });
    this.gearAt(W / 2, y0 + 62);

    const top = y0 + 98;
    const rowH = inGame ? 46 : 42;
    const count = rows.length - 1;
    rows.forEach((row, i) => {
      if (row === 'back') return;
      const y = top + i * rowH;
      const sel = i === this.settingSel;
      const btn = this.button(
        [40, y, 340, rowH - 6],
        () => {
          this.settingSel = i;
          if (row !== 'volume') this.confirmSetting();
          else this.render();
        },
        sel,
        8,
      );
      const ink = sel ? C.gold : C.ink;
      const cy = y + (rowH - 6) / 2;
      const label = this.text(t[row], 'label', 82, cy - 9, {
        align: 'left',
        size: 15,
        color: ink,
        parent: btn,
      });
      if (row === 'volume') {
        btn.addChild(speaker(56, cy, st.volume > 0, sel ? C.gold : C.wood));
        this.volumeGauge(btn, cy, sel, label.x + label.width);
        return;
      }
      if (row === 'controls') {
        // The device in use, and a chevron: the row opens a page
        const color = sel ? C.gold : C.heading;
        if (this.input.device === 'gamepad') {
          const g = padGlyph('a', this.input.padLayout, 16, sel ? 'onDark' : 'onLight');
          g.position.set(63, cy);
          btn.addChild(g);
        } else {
          btn.addChild(keycapIcon(63, cy, color));
        }
        this.text('›', 'label', 368, cy - 15, { align: 'right', size: 26, color, parent: btn });
        return;
      }
      const x = 56;
      const box = new Graphics()
        .roundRect(x, cy - 7, 14, 14, 3)
        .fill({ color: 0xffffff, alpha: sel ? 0.15 : 0.6 })
        .stroke({ color: sel ? C.gold : C.wood, width: 1.6 });
      if (st[row]) {
        box
          .moveTo(x + 3, cy)
          .lineTo(x + 6.5, cy + 3.5)
          .lineTo(x + 12, cy - 4)
          .stroke({ color: sel ? C.gold : C.wood, width: 2.4 });
      }
      btn.addChild(box);
    });

    const row = rows[this.settingSel];
    const hintY = top + count * rowH + 10;
    if (row !== 'back') {
      this.text(t[row + 'Hint'], 'body', W / 2, hintY, {
        width: 330,
        size: 11,
        italic: true,
        color: C.inkSoft,
      });
    }
    this.text(inGame ? t.soundNote : t.settingsNote, 'body', W / 2, buttonY - (inGame ? 62 : 46), {
      width: 330,
      size: 10,
      color: C.todo,
    });

    // Back: space only when it is the selected row, as space ticks the others
    const back = row === 'back';
    this.actionButton(
      t.back,
      buttonY,
      () => this.leaveSettings(),
      170,
      true,
      back ? 'auto' : 'pad',
    );
  }

  /**
   * The volume: a gauge in steps of `VOLUME_STEP`, set by a click at its place, with the
   * value. Left and right change it when its row is selected.
   */
  private volumeGauge(parent: Container, cy: number, sel: boolean, labelRight: number): void {
    // After the label (and its knob's room), up to the value
    const x0 = Math.max(214, labelRight + 16);
    const w = 326 - x0;
    const v = this.settings.volume;
    const g = new Graphics()
      .roundRect(x0, cy - 4, w, 8, 4)
      .fill({ color: sel ? C.gold : C.wood, alpha: sel ? 0.3 : 0.18 })
      .roundRect(x0, cy - 4, Math.max(8, (w * v) / 100), 8, 4)
      .fill(v > 0 ? (sel ? C.gold : C.progress) : 'rgba(0,0,0,0)')
      .circle(x0 + (w * v) / 100, cy, 7)
      .fill(sel ? C.gold : C.wood);
    const track = new Container();
    track.eventMode = 'static';
    track.cursor = 'pointer';
    track.hitArea = new Rectangle(x0 - 10, cy - 14, w + 20, 28);
    track.on('pointertap', (e) => {
      e.stopPropagation();
      this.settingSel = this.settingRows.indexOf('volume');
      this.setVolume((100 * (track.toLocal(e.global).x - x0)) / w);
      this.render();
    });
    track.addChild(g);
    parent.addChild(track);
    this.text(`${v} %`, 'label', 372, cy - 8, {
      align: 'right',
      size: 13,
      color: sel ? C.gold : C.inkSoft,
      parent,
    });
  }

  /**
   * The controls page (G.4): each move's two keyboard slots and controller slot, as the SWF's
   * key setup screen (`#910`) has a key per move; then the default keys and back. A slot that
   * waits shows the SWF's prompt instead of the help, and the page under it waits too (a
   * click anywhere cancels).
   */
  private drawControls(): void {
    const t = this.t;
    const b = this.bindings;
    const cap = this.capture;
    this.panel(12, 12, 396, H - 20);
    this.text(t.controlsTitle, 'title', W / 2, 22, { size: 26, color: C.heading });

    // Column heads
    const headY = CTRL_TOP - 24;
    const [k0] = CTRL_COLS[0];
    const [k1, kw] = CTRL_COLS[1];
    const [px, pw] = CTRL_COLS[2];
    this.text(t.keyboard, 'label', (k0 + k1 + kw) / 2, headY, { size: 12, color: C.inkSoft });
    this.text(t.pad, 'label', px + pw / 2, headY, { size: 12, color: C.inkSoft });

    MOVES.forEach((action, row) => {
      const y = CTRL_TOP + row * CTRL_ROW_H;
      const h = CTRL_ROW_H - 6;
      const cy = y + h / 2;
      const rowSel = row === this.ctrlRow;
      this.text(t[`mv_${action}`], 'label', 36, cy - 9, {
        align: 'left',
        size: 15,
        color: rowSel ? C.heading : C.ink,
      });
      CTRL_COLS.forEach(([x, w], col) => {
        const sel = rowSel && col === this.ctrlCol;
        const waiting = cap?.row === row && cap.col === col;
        const btn = this.button(
          [x, y, w - 4, h],
          () => {
            this.ctrlRow = row;
            this.ctrlCol = col;
            this.confirmControl();
          },
          sel || waiting,
          8,
        );
        if (!sel && !waiting) {
          // An empty well, so the slots read as boxes
          btn.addChildAt(
            new Graphics()
              .roundRect(x, y, w - 4, h, 8)
              .stroke({ color: C.wood, width: 1, alpha: 0.25 }),
            0,
          );
        }
        const mid = x + (w - 4) / 2;
        if (waiting) {
          this.text('…', 'label', mid, cy - 11, { size: 18, color: C.gold, parent: btn });
          return;
        }
        if (col < 2) this.keySlot(btn, b.keys[action][col], mid, cy, sel);
        else this.padSlot(btn, b.pad[action], mid, cy, sel);
      });
    });

    // The default keys, a smaller row
    const resetY = CTRL_TOP + MOVES.length * CTRL_ROW_H + 2;
    const resetSel = this.ctrlRow === CTRL_RESET;
    const reset = this.button(
      [W / 2 - 90, resetY, 180, 30],
      () => {
        this.ctrlRow = CTRL_RESET;
        this.confirmControl();
      },
      resetSel,
      15,
    );
    this.text(t.resetKeys, 'label', W / 2, resetY + 7, {
      size: 13,
      color: resetSel ? C.gold : C.heading,
      parent: reset,
    });

    // The help, or the prompt of a slot that waits
    const helpY = resetY + 46;
    if (cap) {
      const onPad = cap.col === 2;
      this.text(onPad ? t.capPad : t.capKey, 'label', W / 2, helpY, {
        size: 16,
        color: C.heading,
      });
      const cancel = onPad
        ? t.capPadCancel.replace('{0}', padLabel('start', this.input.padLayout))
        : t.capKeyCancel;
      this.text(cancel, 'label', W / 2, helpY + 24, { size: 12, color: C.inkSoft });
      if (cap.note) {
        this.text(cap.note, 'body', W / 2, helpY + 46, {
          width: 330,
          size: 11,
          italic: true,
          color: C.progress,
        });
      }
    } else {
      this.text(t.controlsHelp, 'body', W / 2, helpY, {
        width: 330,
        size: 11,
        italic: true,
        color: C.inkSoft,
      });
    }
    this.text(t.controlsNote, 'body', W / 2, BUTTON_Y - 58, {
      width: 330,
      size: 10,
      color: C.todo,
    });

    const backSel = this.ctrlRow === CTRL_BACK;
    this.actionButton(
      t.back,
      BUTTON_Y,
      () => this.leaveControls(),
      170,
      true,
      backSel ? 'auto' : 'pad',
    );

    if (cap) {
      // Over the page: a click cancels the wait
      const veil = new Container();
      veil.eventMode = 'static';
      veil.hitArea = new Rectangle(0, 0, W, H);
      veil.on('pointertap', () => this.stopCapture());
      this.root.addChild(veil);
    }
  }

  /** A keyboard slot's keys, as keycaps side by side, or a dash. */
  private keySlot(
    parent: Container,
    codes: readonly number[],
    cx: number,
    cy: number,
    sel: boolean,
  ): void {
    if (codes.length === 0) {
      this.text('—', 'label', cx, cy - 9, { size: 14, color: sel ? C.gold : C.todo, parent });
      return;
    }
    const caps = codes.map((kc) => {
      const c = new Container();
      const k = this.text(keyName(kc, this.lang) ?? '?', 'label', 0, 0, {
        align: 'left',
        size: 10,
        color: C.heading,
        parent: c,
      });
      const w = Math.max(18, k.width + 10);
      c.addChildAt(
        new Graphics()
          .roundRect(0, 1.5, w, 18, 4)
          .fill(0xc8a878)
          .roundRect(0, 0, w, 18, 4)
          .fill(0xfffaf0),
        0,
      );
      k.position.set((w - k.width) / 2, (18 - k.height) / 2);
      return { c, w };
    });
    const gap = 4;
    let x = cx - (caps.reduce((n, k) => n + k.w, 0) + gap * (caps.length - 1)) / 2;
    for (const k of caps) {
      k.c.position.set(x, cy - 10);
      parent.addChild(k.c);
      x += k.w + gap;
    }
  }

  /** A controller slot's buttons, as the controller in use shows them, or a dash. */
  private padSlot(
    parent: Container,
    buttons: readonly number[],
    cx: number,
    cy: number,
    sel: boolean,
  ): void {
    const glyphs = buttons
      .map((i) => padButtonOf(i))
      .filter((p) => p !== null)
      .map((p) => padGlyph(p, this.input.padLayout, 17, sel ? 'onDark' : 'onLight'));
    if (glyphs.length === 0) {
      this.text('—', 'label', cx, cy - 9, { size: 14, color: sel ? C.gold : C.todo, parent });
      return;
    }
    const gap = 4;
    let x = cx - (glyphs.reduce((n, g) => n + g.width, 0) + gap * (glyphs.length - 1)) / 2;
    for (const g of glyphs) {
      g.position.set(x + g.width / 2, cy);
      parent.addChild(g);
      x += g.width + gap;
    }
  }

  /** A big gear under the settings title. */
  private gearAt(x: number, y: number): void {
    const g = gear(x, y, 13, C.wood);
    g.alpha = 0.55;
    this.root.addChild(g);
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
    this.text(t.quests, 'title', W / 2, 22, { size: 26, color: C.heading });

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
            .fill({ color: sel ? C.gold : C.wood, alpha: 0.25 })
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

    this.actionButton(t.back, BUTTON_Y, () => this.showMenu(), 170, true);
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
    this.text(t.fridge, 'title', W / 2, 22, { size: 26, color: C.heading });
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
      const b = this.button(
        [W / 2 - 92, py - 4, 44, 24],
        () => this.selectItem((page - 1) * FRIDGE_PAGE),
        false,
        6,
      );
      this.text('◀', 'label', W / 2 - 70, py, { size: 13, parent: b });
    }
    if (page < pages - 1) {
      const b = this.button(
        [W / 2 + 48, py - 4, 44, 24],
        () => this.selectItem((page + 1) * FRIDGE_PAGE),
        false,
        6,
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

    this.actionButton(t.back, BUTTON_Y, () => this.showMenu(), 170, true);
  }

  // --------------------------------------------------------------- results

  /**
   * What the game sent the site: the reached level and score for a game over, and the items
   * found. The end of the set sends no score (`GameMode.exitGame`). Then what the game added
   * to the profile: the quests it completed and the new fridge items.
   */
  private drawResult(r: GameResult): void {
    if (this.time) {
      this.drawTimeResult(this.time);
      return;
    }
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
        color: C.heading,
      });
      y = top + 50;
    }
    if (r.kind === 'gameOver') {
      const lvl = r.stats.reachedLevel;
      this.text(`${this.texts.getStatic(1)} ${lvl}`, 'label', W / 2, y, { size: 17 });
      const sector = this.texts.getSectorName(0, lvl);
      if (sector) this.text(sector, 'body', W / 2, y + 22, { color: C.inkSoft });
      const data = r.stats.data;
      // Only the Time Attack sends no data, and it has its own page
      if (Array.isArray(data) || data === null) {
        this.text(`${formatScore(r.score)} pts`, 'label', W / 2, y + 40, {
          size: 26,
          color: C.heading,
        });
      } else {
        // The co-op mode sends no score, only each player's (`MultiCoop.saveScore`)
        [
          `Igor : ${formatScore(data.s0 ?? 0)} pts`,
          `Sandy : ${formatScore(data.s1 ?? 0)} pts`,
        ].forEach((line, i) => {
          this.text(line, 'label', W / 2, y + 40 + i * 20, { size: 17, color: C.heading });
        });
      }
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

  /**
   * The results of a Time Attack game (port's own page: the site's is unknown, and it had a
   * ranking of all players instead of a personal best). A finished run shows its time under
   * the mode's name, and the best time or "new best time"; a lost game shows the game over
   * picture. These games send no items.
   */
  private drawTimeResult(tr: TimeResult): void {
    const t = this.t;
    const lost = tr.time >= NO_TIME;
    const art = lost ? this.gameOverArt : null;
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
      y = top + 12;
    }
    this.text(t[tr.mode], 'title', W / 2, y, { color: C.heading });
    y += 46;
    if (lost) {
      this.text(t.lostRun, 'label', W / 2, y, { size: 17 });
      y += 30;
    } else {
      this.text(formatRunTime(tr.time), 'label', W / 2, y, { size: 34, color: C.heading });
      y += 50;
      if (tr.isNew) {
        this.text(t.newBest, 'label', W / 2, y, { size: 18, color: C.done });
        y += 30;
      }
    }
    if (tr.best !== null) {
      this.text(fmt(t.bestTime, formatRunTime(tr.best)), 'body', W / 2, y, {
        size: 13,
        color: C.inkSoft,
      });
    }

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

/** A gear of radius `r` centered on (x, y): 8 teeth and a hole. */
function gear(x: number, y: number, r: number, color: number | string): Graphics {
  const teeth = 8;
  const inner = r * 0.74;
  const pts: number[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const step = Math.PI / teeth;
    for (const [da, rad] of [
      [-step * 0.95, inner],
      [-step * 0.45, r],
      [step * 0.45, r],
      [step * 0.95, inner],
    ] as const) {
      pts.push(x + Math.cos(a + da) * rad, y + Math.sin(a + da) * rad);
    }
  }
  return new Graphics()
    .poly(pts)
    .fill(color)
    .circle(x, y, r * 0.34)
    .cut();
}

/** A small keyboard 18 px wide centered on (`cx`, `cy`): the controls row's icon (G.4). */
function keycapIcon(cx: number, cy: number, color: number | string): Graphics {
  const g = new Graphics().roundRect(cx - 9, cy - 6, 18, 12, 2.5).stroke({ color, width: 1.6 });
  for (const [dx, dy] of [
    [-5, -2],
    [-1.5, -2],
    [2, -2],
    [5.5, -2],
  ]) {
    g.rect(cx + dx - 1, cy + dy - 1, 2, 2);
  }
  g.rect(cx - 4, cy + 2, 8, 1.8);
  return g.fill(color);
}

/**
 * A speaker 14 px wide, its left edge at `x` and centered on `cy`, in the checkboxes' column;
 * with sound waves unless `on` is false.
 */
function speaker(x: number, cy: number, on: boolean, color: number | string): Graphics {
  const g = new Graphics()
    .rect(x, cy - 3, 4, 6)
    .fill(color)
    .poly([x + 3, cy - 3, x + 8, cy - 7, x + 8, cy + 7, x + 3, cy + 3])
    .fill(color);
  if (on) {
    // Each wave starts where its arc does, or the path joins it to the last point
    for (const r of [3.5, 6.5]) {
      g.moveTo(x + 8 + r * Math.cos(-0.9), cy + r * Math.sin(-0.9))
        .arc(x + 8, cy, r, -0.9, 0.9)
        .stroke({ color, width: 1.6 });
    }
  } else {
    g.moveTo(x + 10, cy - 3)
      .lineTo(x + 14, cy + 3)
      .moveTo(x + 14, cy - 3)
      .lineTo(x + 10, cy + 3)
      .stroke({ color, width: 1.6 });
  }
  return g;
}

/** Replaces `{0}`, `{1}`... with the arguments. */
/** Shrinks a one-line text that would be wider than `w`. */
function fitWidth(t: Text, w: number): void {
  if (t.width > w) t.scale.set(w / t.width);
}

function fmt(s: string, ...args: (string | number)[]): string {
  return s.replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)]));
}

/**
 * A Time Attack time as the site's ranking wrote it (`scores_timeattack.html`): minutes `'`,
 * seconds `"`, milliseconds, `0' 06" 597`. The site did not pad the milliseconds (`0' 11" 34`
 * for 11.034 s); they are padded here. The game's own chrono reads `MM" SS' mmm`.
 */
export function formatRunTime(ms: number): string {
  const t = Math.max(0, Math.floor(ms));
  const sec = Math.floor(t / 1000) % 60;
  return `${Math.floor(t / 60000)}' ${String(sec).padStart(2, '0')}" ${String(t % 1000).padStart(3, '0')}`;
}

/** Scores with dot thousands, as the site wrote them: `8.684.323`. */
function formatScore(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * An image as a mipmapped texture (it shows smaller than its size), or null if it fails.
 * Waits for `load`, not `img.decode()`: in a hidden tab Chrome can fail or never settle a
 * decode, and the page then stayed on the loading screen.
 */
async function loadTexture(url: string): Promise<Texture | null> {
  const img = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
  img.src = url;
  if (!(await loaded)) return null;
  return new Texture({ source: new ImageSource({ resource: img, autoGenerateMipmaps: true }) });
}
