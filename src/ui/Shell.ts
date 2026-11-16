/**
 * The screens that replace the hammerfest.fr site (roadmap 3.1 and 3.2d, UI redesign of
 * 2026-11-16): the home page with the modes, the results page after a game, the quests, the
 * fridge, the settings and controls pages, and the sound panel over a paused game. They are
 * HTML pages around the game frame, as the original's were web pages around the game, in the
 * port's parchment and wood (`src/site.css`) with the game's own drawings: item clips drawn as
 * pictures (`site/ItemArt.ts`), the game's fonts (Satans titles, Franklin Gothic Heavy labels,
 * extracted from `_gfx.swf` by `tools/build-fonts.ts`), the title logo and the game over
 * picture. The frame keeps what the game draws: the village scene (`menu`, vector) and the
 * logo behind the home page, the site's intro, and the pause screen's sound button.
 *
 * Not a port: the original showed these as web pages (PORT_STATUS.md, "Site screens"). The
 * mode list and texts follow the site guide; the results show what the game sends the site;
 * the quest and fridge pages show the profile (3.2b): quests done and in progress, and the item
 * collection with its "found N times" rule. The chosen mode's options are checkboxes under its
 * text, the locked ones with the quest that unlocks them (3.3). The settings page is the site's
 * "Options" link (2C.5): the settings with the guide's texts (section 8 of `guide.html`, typos
 * fixed; the volume hint names the sound, as the volume sets the sounds and the music).
 */
import {
  BlurFilter,
  Container,
  Graphics,
  ImageSource,
  Rectangle,
  type Renderer,
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
import {
  type BitmapChoice,
  bitmapScaleOf,
  loadedBitmapScale,
  saveBitmapChoice,
  savedBitmapChoice,
} from '../engine/swf/BitmapDetail';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import { Data } from '../game/Data';
import {
  type PadButton,
  padButtonOf,
  padGlyph,
  padIconHtml,
  padLabel,
} from '../game/gui/PadGlyphs';
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
import { fill, h, ICON, svgIcon } from './site/dom';
import { type Icon, ItemArt } from './site/ItemArt';

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

/**
 * The intro's card, in the grid's free slot after the modes: Tuberculoz, whose plan it tells.
 * The site's home page had an "Intro" button for visitors, beside "Essayer" (the free trial).
 */
const INTRO_ICON: Icon = { clip: 'hammer_boss_human' };
/** Top of the intro's movie in the frame: centered above the skip button. */
const INTRO_Y = 66;
/** Most movie frames played in one display frame, after the page was slow or hidden. */
const INTRO_CATCH_UP = 4;

/** The HD pictures row's values, in the order Space and the arrows go through them. */
const HD_CHOICES: readonly BitmapChoice[] = ['auto', 1, 2, 4];

/**
 * The controls page (G.4): the moves in the order of the SWF's key setup screen (`#910`:
 * `labLeft`, `labRight`, `labJump`, `labDown`, `labFire1`).
 */
const MOVES: readonly PlayerAction[] = ['left', 'right', 'jump', 'down', 'attack'];

/** A slot of the controls page waiting for its key or button, and what the last press was. */
interface Capture {
  row: number;
  col: number;
  /** A press that could not be used: shown under the prompt. */
  note: string | null;
}

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
    hd: 'Images HD',
    hdHint:
      'Les décors agrandis pour les grands écrans (télé). Auto : selon votre écran. Le jeu se recharge en sortant.',
    hdAuto: 'Auto',
    hdOff: 'Non',
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
    modesTitle: 'Modes de jeu',
    introDesc: 'Revoir le film d’introduction du site : le terrible plan de Tuberculoz.',
    watchIntro: 'Voir l’intro',
    locked: 'Verrouillé',
    book: 'Mon carnet',
    questsNear: 'Quêtes en cours',
    itemsOf: '{0} / {1} objets',
    moreItems: '+ {0} autres',
    all: 'Toutes',
    fridgeAll: 'Tout',
    fridgeAlmost: 'Presque',
    fridgeNever: 'Pas encore trouvés',
    fridgeEmpty: 'Aucun objet ici pour l’instant.',
    pageOf: 'Page {0} sur {1}',
    prevPage: 'Page précédente',
    nextPage: 'Page suivante',
    famCount: '{0} / {1} au réfrigérateur',
    score: 'Score',
    levelReached: 'Niveau atteint',
    language: 'Langue',
    moveHint: 'Se déplacer',
    pauseHint: 'Pause',
    toolMap: 'Carte des cavernes',
    toolFull: 'Plein écran',
    toolQuit: 'Abandonner la partie',
    toolQuitSure: 'Encore une fois pour abandonner',
    tabPlay: 'Jouer',
    tabFridge: 'Frigo',
    filter: 'Filtre',
    lockedOptions: 'Options à débloquer : {0}',
    runTime: 'Temps',
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
    hd: 'HD pictures',
    hdHint:
      'The scenery upscaled for big screens (TV). Auto: from your screen. The game reloads as you leave.',
    hdAuto: 'Auto',
    hdOff: 'Off',
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
    modesTitle: 'Game modes',
    introDesc: 'Watch the site’s intro movie again: Tuberculoz’s terrible plan.',
    watchIntro: 'Watch the intro',
    locked: 'Locked',
    book: 'My notebook',
    questsNear: 'Quests in progress',
    itemsOf: '{0} / {1} items',
    moreItems: '+ {0} more',
    all: 'All',
    fridgeAll: 'All',
    fridgeAlmost: 'Almost',
    fridgeNever: 'Not found yet',
    fridgeEmpty: 'No item here yet.',
    pageOf: 'Page {0} of {1}',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    famCount: '{0} / {1} in the fridge',
    score: 'Score',
    levelReached: 'Level reached',
    language: 'Language',
    moveHint: 'Move',
    pauseHint: 'Pause',
    toolMap: 'Map of the caverns',
    toolFull: 'Full screen',
    toolQuit: 'Give up the game',
    toolQuitSure: 'Once more to give up',
    tabPlay: 'Play',
    tabFridge: 'Fridge',
    filter: 'Filter',
    lockedOptions: 'Options to unlock: {0}',
    runTime: 'Time',
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
    hd: 'Imágenes HD',
    hdHint:
      'Los decorados ampliados para pantallas grandes (tele). Auto: según tu pantalla. El juego se recarga al salir.',
    hdAuto: 'Auto',
    hdOff: 'No',
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
    modesTitle: 'Modos de juego',
    introDesc:
      'Vuelve a ver la película de introducción del sitio: el terrible plan de Tuberculoz.',
    watchIntro: 'Ver la intro',
    locked: 'Bloqueado',
    book: 'Mi cuaderno',
    questsNear: 'Exploraciones en curso',
    itemsOf: '{0} / {1} objetos',
    moreItems: '+ {0} más',
    all: 'Todas',
    fridgeAll: 'Todo',
    fridgeAlmost: 'Casi',
    fridgeNever: 'Aún no encontrados',
    fridgeEmpty: 'Aún no hay ningún objeto aquí.',
    pageOf: 'Página {0} de {1}',
    prevPage: 'Página anterior',
    nextPage: 'Página siguiente',
    famCount: '{0} / {1} en el frigorífico',
    score: 'Puntuación',
    levelReached: 'Nivel alcanzado',
    language: 'Idioma',
    moveHint: 'Moverse',
    pauseHint: 'Pausa',
    toolMap: 'Mapa de las cavernas',
    toolFull: 'Pantalla completa',
    toolQuit: 'Abandonar la partida',
    toolQuitSure: 'Otra vez para abandonar',
    tabPlay: 'Jugar',
    tabFridge: 'Frigo',
    filter: 'Filtro',
    lockedOptions: 'Opciones por desbloquear: {0}',
    runTime: 'Tiempo',
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

/** Parchment and wood (`src/site.css`), for what is still drawn in the frame. */
const C = {
  wood: 0x5f452c,
  woodDark: 0x3f2c1b,
  gold: '#fff3c4',
  heading: '#5f452c',
  todo: '#9a8670',
};

/** Fonts of the game (`hammer_interf_instructions`: Satans titles, Franklin Gothic labels). */
const FONT = {
  title: 'Satans, "Franklin Gothic Heavy", "Arial Black", sans-serif',
  label: '"Franklin Gothic Heavy", "Arial Black", Impact, sans-serif',
  body: 'Verdana, Geneva, "DejaVu Sans", sans-serif',
};

type TextKind = keyof typeof FONT;

/** Fridge shelves: items per row and rows per page (the redesign's glass shelves). */
const FRIDGE_COLS = 8;
const FRIDGE_ROWS = 3;
const FRIDGE_PAGE = FRIDGE_COLS * FRIDGE_ROWS;

/** The rewards' picture: item 8, "Etoile des neiges". */
const STAR: Icon = { item: 8 };

/** The page's width at most where the site takes the phone layout (`src/site.css`). */
const PHONE_QUERY = '(max-width: 640px)';
/** The page's width at least where the notebook has its own column (`src/site.css`). */
const WIDE_QUERY = '(min-width: 1100px)';

type QuestTab = 'progress' | 'done' | 'all';
type FridgeFilter = 'all' | 'almost' | 'never';

/** The page elements the site screens fill (`index.html`); absent in tests. */
interface SiteDom {
  /** Left of the frame: the modes board (home, wide screens). */
  modes: HTMLElement;
  /** Right of the frame: the player's notebook (home, wide screens). */
  book: HTMLElement;
  /** Over the frame: the modes on a phone, the sound panel over the paused game. */
  overlay: HTMLElement;
  /** Under the frame: the keys (wide screens), the chosen mode (phone). */
  below: HTMLElement;
  /** The full pages (quests, fridge, settings, controls, results), in place of the frame. */
  page: HTMLElement;
  /** The phone's tab bar. */
  tabbar: HTMLElement;
  /** The mode of the game under way, in the top bar. */
  chips: HTMLElement;
}

/**
 * The site around the game frame (UI redesign, after the "HammerFenix UI Redesign" canvas):
 * the home page (the modes beside the frame, the notebook on the other side), and the quest,
 * fridge, settings, controls and results pages, as HTML in the parchment and wood of the port.
 * The frame keeps what the game draws: the village and the title logo behind the home page,
 * the site's intro, and the sound button of the pause screen.
 *
 * Input: the keyboard's arrows, the bomb key and pause, a controller's D-pad, A and B
 * (`InputController.consumeMenu`) move the focus between the page's elements by where they
 * are on screen, press the focused one and go back; a click or a tap presses one too.
 */
export class Shell {
  readonly root = new Container();
  private readonly lib: SwfLibrary;
  private readonly input: InputController;
  private readonly texts: ShellTexts;
  private readonly profile: Profile;
  private title: Texture | null = null;
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
  /**
   * The mode chosen on the home page (`$mode`, or `intro`): its text and options show under the
   * modes, and the main button starts it. Pressing a mode chooses it; pressing the chosen one
   * starts it, as two clicks do.
   */
  private chosen = MODES[0].mode;
  /** The mode the menu started, for the top bar while it plays; null for the debug toolbar's. */
  private playing: string | null = null;
  /** `data-nav` of the focused element of the page. */
  private focusKey: string | null = null;
  /** The focus moved with the arrows: the next render scrolls it into view. */
  private navMoved = false;
  private questTab: QuestTab = 'progress';
  private questId: number | null = null;
  private fridgeFilter: FridgeFilter = 'all';
  private fridgePage = 0;
  private fridgeId: number | null = null;
  /** The home page shows an option's hint: moving the focus off it redraws the page. */
  private hintShown = false;
  /** The give up button was pressed once (`performance.now()`): a second press gives up. */
  private quitArmed = 0;
  /** The player's settings, as the settings page shows them. */
  settings: PlayerSettings = { ...DEFAULT_SETTINGS };
  /** The player's keys and buttons, as the controls page shows them (G.4). */
  bindings: Bindings = DEFAULT_BINDINGS;
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
  /** The game's drawings as pictures for the pages, once the page gave a renderer. */
  private art: ItemArt | null = null;
  private dom: SiteDom | null = null;
  private phone: MediaQueryList | null = null;
  private wide: MediaQueryList | null = null;

  /** "Start game" on Adventure: the site loads the game page with `$mode`. */
  onStart?: (mode: string) => void;
  /** A setting changed on the settings page. */
  onSettings?: (s: PlayerSettings) => void;
  /** A language chosen on the settings page. */
  onLang?: (lang: string) => void;
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
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.root.hitArea = new Rectangle(0, 0, W, H);
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

  /** Loads the title logo. */
  async load(baseUrl: string): Promise<void> {
    this.baseUrl = baseUrl;
    this.title = await loadTexture(`${baseUrl}${TITLE_FILE}`);
  }

  /**
   * Gives the shell the page around the frame (`index.html`) and the renderer that draws the
   * game's clips as pictures for it.
   */
  attachPage(renderer: Renderer): void {
    this.art = new ItemArt(this.lib, renderer);
    const el = (id: string) => document.getElementById(id) as HTMLElement;
    const dom: SiteDom = {
      modes: el('site-modes'),
      book: el('site-book'),
      overlay: el('frame-overlay'),
      below: el('site-below'),
      page: el('site-page'),
      tabbar: el('site-tabbar'),
      chips: el('play-chips'),
    };
    this.dom = dom;
    for (const box of Object.values(dom) as HTMLElement[]) {
      box.addEventListener('focusin', (e: FocusEvent) => this.onFocusIn(e.target as HTMLElement));
    }
    this.phone = window.matchMedia(PHONE_QUERY);
    this.phone.addEventListener('change', () => this.refresh());
    this.wide = window.matchMedia(WIDE_QUERY);
    this.wide.addEventListener('change', () => this.refresh());
    this.showLayout();
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
    this.result = null;
    this.record = null;
    this.playing = null;
    if (!this.focusKey?.startsWith('mode:')) this.focusKey = `mode:${this.chosen}`;
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
    this.focusKey = 'continue';
    this.render();
  }

  showQuests(): void {
    this.screen = 'quests';
    const p = this.profile.data;
    const q = this.profile.quests;
    const any = (s: string) => q.quests.some((x) => q.status(p, x.id) === s);
    this.questTab = any('progress') ? 'progress' : any('done') ? 'done' : 'progress';
    this.questId = this.questList()[0] ?? null;
    this.focusKey = this.questId === null ? `qtab:${this.questTab}` : `q:${this.questId}`;
    this.render();
  }

  showFridge(): void {
    this.screen = 'fridge';
    this.fridgeFilter = 'all';
    this.fridgePage = 0;
    this.fridgeId = this.fridgeIds()[0] ?? null;
    this.focusKey = this.fridgeId === null ? 'ftab:all' : `f:${this.fridgeId}`;
    this.render();
  }

  showSettings(): void {
    this.screen = 'settings';
    this.focusKey = 'set:detail';
    this.render();
  }

  /** The controls page (G.4), from the settings page. */
  showControls(): void {
    this.screen = 'controls';
    this.focusKey = 'ctl:0:0';
    this.endCapture();
    this.render();
  }

  /**
   * The sound panel over the paused game (port addition): sound, music and volume, which the
   * game applies at once. `onClose` runs when it closes.
   */
  showSound(onClose: () => void): void {
    this.screen = 'sound';
    this.focusKey = 'set:sound';
    this.onSoundClose = onClose;
    this.render();
  }

  /**
   * The site's intro (3.5), from the home page or on the first launch. It plays in the game
   * frame and ends at its end, on a click, or with the confirm or back key; the home page then
   * shows with the Learning mode chosen, the free trial the movie led to (`INTRO_URL`).
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

  /** The intro is over: back to the home page, the Learning mode chosen. */
  private endIntro(): void {
    this.dropIntro();
    this.chosen = 'tutorial';
    this.focusKey = 'mode:tutorial';
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
    this.showLayout();
  }

  /**
   * Fades the screen out over the game starting under it, then hides it. The menu's village
   * is the first level's, so it dissolves into the level. The fade waits until `ready()` says
   * the level is drawn (at most 2 s), so it never shows the black of the level being read.
   * The page around the frame takes its playing layout at once.
   */
  fadeOut(ready: () => boolean = () => true, ms = 700): void {
    this.screen = null;
    this.root.eventMode = 'none';
    this.fadeReady = ready;
    this.fadeAsked = performance.now();
    this.fadeFrom = null;
    this.fadeMs = ms;
    this.showLayout();
  }

  /** Redraws the current screen, e.g. after a language change. */
  refresh(): void {
    if (this.screen) this.render();
    else this.showLayout();
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
   * Keys, once per frame while a screen shows: the arrows move the focus, the bomb key presses
   * the focused element, pause goes back. A controller moves with its D-pad or stick, presses
   * with A and goes back with B.
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
    if (this.screen === 'intro') {
      if (ok || esc) this.endIntro();
      else this.stepIntro();
      return;
    }
    // A dialog over the page (help) takes the keys
    if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return;
    const key = this.focusKey ?? '';
    if ((left || right) && key === 'set:volume') {
      this.setVolume(this.settings.volume + (right ? VOLUME_STEP : -VOLUME_STEP));
    } else if ((left || right) && key === 'set:hd') {
      this.stepHd(right ? 1 : -1);
    } else {
      if (up) this.moveFocus(0, -1);
      if (down) this.moveFocus(0, 1);
      if (left) this.moveFocus(-1, 0);
      if (right) this.moveFocus(1, 0);
    }
    if (ok) this.focusedElement()?.click();
    if (esc) this.back();
  }

  /** Pause, Escape or B: the page's way back. */
  private back(): void {
    switch (this.screen) {
      case 'result':
      case 'quests':
      case 'fridge':
        this.showMenu();
        break;
      case 'settings':
      case 'sound':
        this.leaveSettings();
        break;
      case 'controls':
        this.leaveControls();
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

  // ------------------------------------------------------------ focus

  /** The page's elements the focus can go to, as laid out (hidden ones left out). */
  private navElements(): HTMLElement[] {
    const d = this.dom;
    if (!d) return [];
    const boxes = [d.modes, d.book, d.overlay, d.below, d.page, d.tabbar];
    return boxes.flatMap((b) =>
      [...b.querySelectorAll<HTMLElement>('[data-nav]')].filter(
        (el) => el.getClientRects().length > 0 && !el.closest('[hidden]'),
      ),
    );
  }

  private focusedElement(): HTMLElement | null {
    if (!this.focusKey) return null;
    return this.navElements().find((el) => el.dataset.nav === this.focusKey) ?? null;
  }

  /**
   * The arrows: the nearest element in that direction, as laid out, favoring the same row or
   * column. Up and down wrap around; left and right stop at the edge, where the fridge turns
   * its page.
   */
  private moveFocus(dx: number, dy: number): void {
    const els = this.navElements();
    if (els.length === 0) return;
    const from = els.find((el) => el.dataset.nav === this.focusKey);
    if (!from) {
      this.setFocus(els[0].dataset.nav!);
      return;
    }
    /** How far apart two spans are along one axis (0 when they overlap). */
    const gap = (a0: number, a1: number, b0: number, b1: number) =>
      Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
    const best = (fr: { left: number; right: number; top: number; bottom: number }) => {
      const fx = (fr.left + fr.right) / 2;
      const fy = (fr.top + fr.bottom) / 2;
      let pick: HTMLElement | null = null;
      let score = Infinity;
      for (const el of els) {
        if (el === from) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const along = dx !== 0 ? (cx - fx) * dx : (cy - fy) * dy;
        // Sideways: the gap between the two, so a wide element under a narrow one is in line
        const across =
          dx !== 0
            ? gap(fr.top, fr.bottom, r.top, r.bottom)
            : gap(fr.left, fr.right, r.left, r.right);
        // Within 60 degrees of the direction: nothing far to the side
        if (along <= 1 || across > along * 1.75) continue;
        const sc = along + across * 3;
        if (sc < score) {
          score = sc;
          pick = el;
        }
      }
      return pick;
    };
    const fr = from.getBoundingClientRect();
    let next = best(fr);
    if (!next && dx !== 0 && this.screen === 'fridge' && from.dataset.nav?.startsWith('f:')) {
      this.turnFridgePage(dx, from.dataset.nav);
      return;
    }
    // Wrap: as if coming from beyond the other edge
    if (!next && dy !== 0) {
      const y = dy > 0 ? -100000 : 100000;
      next = best({ left: fr.left, right: fr.right, top: y, bottom: y });
    }
    if (next) this.setFocus(next.dataset.nav!);
  }

  /** Moves the focus to the element `key`, and what the focus chooses (quest, item) with it. */
  private setFocus(key: string): void {
    this.navMoved = true;
    this.focusKey = key;
    if (!this.selectFocused(key)) this.applyFocus();
  }

  /** The focus came to an element by Tab or a click. */
  private onFocusIn(el: HTMLElement): void {
    const key = el.closest<HTMLElement>('[data-nav]')?.dataset.nav;
    if (!key || key === this.focusKey) return;
    this.focusKey = key;
    this.selectFocused(key);
  }

  /**
   * On the quest and fridge pages, the focus chooses the quest or item it is on, and the
   * focused option's hint shows on the home page. Returns whether the page was drawn again.
   */
  private selectFocused(key: string): boolean {
    if (key.startsWith('q:')) {
      const id = Number(key.slice(2));
      if (id !== this.questId) {
        this.questId = id;
        this.render();
        return true;
      }
    } else if (key.startsWith('f:')) {
      const id = Number(key.slice(2));
      if (id !== this.fridgeId) {
        this.fridgeId = id;
        this.render();
        return true;
      }
    } else if (this.screen === 'menu' && (/^(opt|run):/.test(key) || this.hintShown)) {
      // The hint under the options follows the focused option. Written in place: a redraw
      // here would replace the button a click is landing on
      this.showHint();
    }
    return false;
  }

  /** The hint of the focused option, under the options of the chosen mode. */
  private showHint(): void {
    const mode = MODES.find((m) => m.mode === this.chosen);
    const hint = mode ? this.optionHint(mode) : '';
    this.hintShown = hint !== '';
    this.dom?.modes.querySelectorAll('.opt-hint').forEach((el) => (el.textContent = hint));
    this.dom?.below.querySelectorAll('.opt-hint').forEach((el) => (el.textContent = hint));
  }

  /** Gives the DOM focus to the focused element, unless the page is used by touch. */
  private applyFocus(): void {
    if (typeof document === 'undefined') return;
    const el = this.focusedElement();
    const scroll = this.navMoved;
    this.navMoved = false;
    if (!el || this.input.device === 'touch') return;
    const active = document.activeElement;
    const d = this.dom;
    const inSite =
      !active ||
      active === document.body ||
      (d !== null &&
        [d.modes, d.book, d.overlay, d.below, d.page, d.tabbar].some((b) => b.contains(active)));
    if (!inSite) return;
    if (active !== el) el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ------------------------------------------------------------ menu logic

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

  /** A mode card pressed: chosen, or started when it already was. */
  private pressMode(mode: string): void {
    this.focusKey = `mode:${mode}`;
    if (mode !== this.chosen) {
      this.chosen = mode;
      this.render();
      return;
    }
    this.startChosen();
  }

  /** The main button: starts the chosen mode, or plays the intro. */
  private startChosen(): void {
    if (this.chosen === 'intro') {
      this.showIntro();
      return;
    }
    const m = MODES.find((x) => x.mode === this.chosen);
    if (m && m.enabled && !this.isLocked(m)) {
      this.playing = m.mode;
      this.onStart?.(m.mode);
    }
  }

  private toggleOption(oid: string): void {
    this.focusKey = `opt:${oid}`;
    if (oid === Data.OPT_BOOST || !this.profile.hasOption(oid)) {
      this.render(); // no box to untick (quest 62), or locked: the hint says why
      return;
    }
    this.profile.toggleOption(oid);
    this.render();
  }

  private chooseRun(mode: string, oid: string): void {
    this.focusKey = `run:${oid}`;
    this.profile.chooseRun(mode, oid);
    this.render();
  }

  /** The hint of the focused option or field, as the old menu showed it. */
  private optionHint(mode: ModeEntry): string {
    const t = this.t;
    const key = this.focusKey ?? '';
    if (key.startsWith('opt:')) {
      const oid = key.slice(4);
      if (!this.modeOptions(mode).includes(oid)) return '';
      if (!this.profile.hasOption(oid)) return fmt(t.lockedBy, this.questForOption(oid));
      if (oid === Data.OPT_BOOST) return t.alwaysOn;
      return this.profile.isChosen(oid) ? t.optionOn : t.optionOff;
    }
    if (key.startsWith('run:')) {
      const oid = key.slice(4);
      const runs = this.profile.runChoices(mode.mode);
      const k = runs.indexOf(oid);
      if (k < 0) return '';
      return this.fieldHint(k, oid === this.profile.runOption(mode.mode));
    }
    return '';
  }

  /** Back to the home page, or from the sound panel, back to the paused game. */
  private leaveSettings(): void {
    if (this.screen === 'sound') {
      const close = this.onSoundClose;
      this.onSoundClose = null;
      this.hide();
      close?.();
      return;
    }
    // The library holds one bitmap set: a new one needs the page loaded again (without a
    // `?hd=` that would override the choice)
    if (bitmapScaleOf(savedBitmapChoice()) !== loadedBitmapScale()) {
      const url = new URL(window.location.href);
      url.searchParams.delete('hd');
      window.location.replace(url.toString());
      return;
    }
    this.showMenu();
  }

  /** The next (`1`) or previous (`-1`) HD pictures choice, wrapping; kept at once. */
  private stepHd(dir: number): void {
    const i = HD_CHOICES.indexOf(savedBitmapChoice());
    const n = HD_CHOICES.length;
    saveBitmapChoice(HD_CHOICES[(i + dir + n) % n]);
    this.focusKey = 'set:hd';
    this.render();
  }

  private setVolume(v: number): void {
    const vol = Math.max(0, Math.min(100, Math.round(v / VOLUME_STEP) * VOLUME_STEP));
    this.focusKey = 'set:volume';
    if (vol !== this.settings.volume) this.changeSettings({ volume: vol });
  }

  /** The settings page's rows that tick: the guide's four checkboxes. */
  private toggleSetting(row: 'detail' | 'shake' | 'sound' | 'music'): void {
    this.focusKey = `set:${row}`;
    this.changeSettings({ [row]: this.settings[row] ? 0 : 1 });
  }

  // ---------------------------------------------------------- controls (G.4)

  /** A slot pressed: it waits for its key or button. */
  private startCapture(row: number, col: number): void {
    this.focusKey = `ctl:${row}:${col}`;
    this.capture = { row, col, note: null };
    this.input.startCapture();
    this.render();
  }

  /** Back to the settings page, on its controls button. */
  private leaveControls(): void {
    this.endCapture();
    this.screen = 'settings';
    this.focusKey = 'set:controls';
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

  private get lang(): Lang {
    const l = this.texts.langId;
    return l === 'en' || l === 'es' ? l : 'fr';
  }

  private get t(): Record<string, string> {
    return TEXT[this.lang];
  }

  // ------------------------------------------------------------ drawing

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
      // The movie's background color, the movie and the site page's link to skip it
      this.root.addChild(new Graphics().rect(0, 0, W, H).fill(0x000000));
      this.root.addChild(this.introLayer);
      this.actionButton(this.t.introSkip, BUTTON_Y, () => this.endIntro());
    } else {
      // The village and the logo: the home page's frame, and what the frame shows if a page
      // leaves it on screen
      this.drawBackground();
      this.drawTitle(2, 290);
    }
    this.renderPage();
  }

  /**
   * The village of the first level (`menu`, vector): the home page's frame, sharp now that no
   * panel covers it, and blurred behind the intro's skip and the sound panel.
   */
  private drawBackground(): void {
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
    if (this.screen !== 'menu') {
      bg.filters = [new BlurFilter({ strength: BG_BLUR, quality: 4, clipToViewport: false })];
    }
    // Drawn once into a texture: a blurred picture needs no more than the frame's resolution
    const layer = new Container();
    layer.addChild(bg);
    layer.cacheAsTexture({ resolution: 1.5 });
    this.root.addChild(layer);
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

  private text(
    s: string,
    kind: TextKind,
    x: number,
    y: number,
    opts: {
      align?: 'left' | 'center' | 'right';
      size?: number;
      color?: string;
      shadow?: boolean;
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
        fill: opts.color ?? C.heading,
        align,
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
   * The intro's skip button: a wood button at the bottom of the frame, with the space bar's
   * keycap or the controller's A button.
   */
  private actionButton(label: string, cy: number, action: () => void, w = 220): void {
    const h = 36;
    const x = W / 2 - w / 2;
    const y = cy - h / 2;
    const c = new Container();
    const face = new Container();
    c.addChild(new Graphics().roundRect(x, y + 3, w, h, h / 2).fill(C.woodDark));
    face.addChild(new Graphics().roundRect(x, y, w, h, h / 2).fill(C.wood));
    const glow = new Graphics().roundRect(x, y, w, h, h / 2).fill({ color: 0xffffff, alpha: 0.12 });
    glow.visible = false;
    face.addChild(glow);
    const lbl = this.text(label, 'label', 0, 0, {
      align: 'left',
      size: 17,
      color: C.gold,
      parent: face,
    });
    let capW = 0;
    const cap = new Container();
    const device = this.input.device;
    if (device === 'keyboard') {
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
    } else if (device === 'gamepad') {
      const g = padGlyph('a', this.input.padLayout, 18, 'onDark');
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
    this.root.addChild(c);
  }

  // ------------------------------------------------------------ the page

  /** Which layout the page takes (`body[data-page]`, `src/site.css`). */
  private pageKind(): string {
    switch (this.screen) {
      case null:
        return 'playing';
      case 'menu':
        return 'home';
      case 'intro':
        return 'intro';
      case 'sound':
        return 'playing'; // over the paused game, which keeps its layout
      default:
        return 'page';
    }
  }

  /** Sets the page's layout and empties what the current screen does not use. */
  private showLayout(): void {
    if (typeof document === 'undefined') return;
    const body = document.body;
    body.dataset.page = this.pageKind();
    body.dataset.screen = this.screen ?? 'playing';
    const d = this.dom;
    if (!d) return;
    if (this.screen === null) {
      for (const b of [d.modes, d.book, d.overlay, d.below, d.page, d.tabbar]) fill(b);
    }
    if (this.screen === null || this.screen === 'sound') this.fillChips();
    else fill(d.chips);
  }

  private get isPhone(): boolean {
    return this.phone?.matches ?? false;
  }

  /** Builds the page of the current screen around (or over) the frame. */
  private renderPage(): void {
    this.showLayout();
    const d = this.dom;
    if (!d || !this.screen) return;
    const empty = [d.modes, d.book, d.overlay, d.below, d.page, d.tabbar];
    for (const b of empty) fill(b);
    switch (this.screen) {
      case 'menu':
        this.pageHome(d);
        break;
      case 'quests':
        fill(d.page, this.pageQuests());
        break;
      case 'fridge':
        fill(d.page, this.pageFridge());
        break;
      case 'settings':
        fill(d.page, this.pageSettings());
        break;
      case 'controls':
        fill(d.page, this.pageControls());
        break;
      case 'result':
        fill(d.page, this.time ? this.pageTimeResult(this.time) : this.pageResult());
        break;
      case 'sound':
        fill(d.overlay, this.panelSound());
        break;
    }
    if (this.screen !== 'sound' && this.screen !== 'intro' && this.isPhone) {
      fill(d.tabbar, this.tabbar());
    }
    if (this.screen === 'quests' || this.screen === 'fridge' || this.screen === 'settings') {
      if (d.page.dataset.screen !== this.screen) d.page.scrollTop = 0;
    }
    d.page.dataset.screen = this.screen;
    this.applyFocus();
  }

  /** A picture of the game's clip, sized by CSS. */
  private img(icon: Icon, cls = '', alt = ''): HTMLElement {
    if ('item' in icon && icon.twice) {
      const one = { item: icon.item };
      return h('span', { class: `art twice ${cls}` }, this.img(one, 'a'), this.img(one, 'b'));
    }
    return h('img', {
      class: `art ${cls}`,
      src: this.art?.url(icon) ?? '',
      alt,
      draggable: 'false',
    });
  }

  /** An item as the player knows it: in color, grey (found, not enough), or a silhouette. */
  private itemImg(id: number, state: 'in' | 'part' | 'never', cls = ''): HTMLElement {
    return this.img({ item: id }, `${cls} is-${state}`);
  }

  /** The device's confirm button after a label: the space bar's keycap, or the controller's A. */
  private confirmCap(): HTMLElement | null {
    const dev = this.input.device;
    if (dev === 'keyboard') {
      return h('kbd', { class: 'cap' }, this.texts.getStatic(10) || 'SPACE');
    }
    if (dev === 'gamepad') return this.padCap('a');
    return null;
  }

  private padCap(b: PadButton): HTMLElement {
    const html = padIconHtml(b, this.input.padLayout, 22);
    const el = h('kbd', { class: 'cap pad', title: padLabel(b, this.input.padLayout) });
    if (html) el.innerHTML = html;
    else el.textContent = padLabel(b, this.input.padLayout);
    return el;
  }

  /** A title plank over the top edge of a board: the game's picture and the page's name. */
  private plank(title: string, icon: Icon | null, id: string, tilt = -1.5, level = 1): HTMLElement {
    const heading = level === 1 ? h('h1', { id }, title) : h('h2', { id }, title);
    return h(
      'div',
      { class: 'plank', style: `--tilt: ${tilt}deg` },
      icon ? this.img(icon, 'plank-art') : null,
      heading,
    );
  }

  /** The way back to the home page, at the top left of a page. */
  private backButton(action: () => void): HTMLElement {
    return h(
      'button',
      { type: 'button', class: 'btn-wood btn-back', 'data-nav': 'back', onclick: action },
      svgIcon(ICON.back, { size: 18 }),
      this.t.back,
    );
  }

  /** A progress bar, `f` from 0 to 1. */
  private bar(f: number, color: 'done' | 'progress' | 'fridge', cls = ''): HTMLElement {
    const w = Math.round(Math.max(0, Math.min(1, f)) * 100);
    return h(
      'span',
      { class: `bar ${cls}`, role: 'presentation' },
      h('span', { class: `bar-fill is-${color}`, style: `width: ${w}%` }),
    );
  }

  private lockIcon(): SVGSVGElement {
    const svg = svgIcon(ICON.lock, { size: 14 });
    svg.classList.add('lock');
    return svg;
  }

  // ------------------------------------------------------------ home

  /** The home page: the modes and the notebook beside the frame; on a phone, over and under it. */
  private pageHome(d: SiteDom): void {
    const t = this.t;
    this.hintShown = false;
    const shown = MODES.find((m) => m.mode === this.chosen) ?? null;
    if (this.isPhone) {
      fill(
        d.overlay,
        h(
          'section',
          { class: 'board board-phone-modes', 'aria-label': t.modesTitle },
          h(
            'div',
            { class: 'mode-grid', role: 'radiogroup', 'aria-label': t.modesTitle },
            this.modeCards(true),
          ),
        ),
      );
      fill(
        d.below,
        h(
          'section',
          { class: 'board board-detail', 'aria-live': 'polite' },
          this.modeDetail(shown, true),
        ),
      );
      return;
    }
    fill(
      d.modes,
      h(
        'section',
        { class: 'board board-modes', 'aria-labelledby': 'modes-h' },
        this.plank(t.modesTitle, null, 'modes-h', -1.5, 2),
        h(
          'div',
          { class: 'mode-grid', role: 'radiogroup', 'aria-labelledby': 'modes-h' },
          this.modeCards(false),
        ),
        h('div', { class: 'mode-detail', 'aria-live': 'polite' }, this.modeDetail(shown, false)),
        this.img({ clip: 'hammer_player' }, 'igor-peek'),
      ),
    );
    // Narrower screens have one column: the notebook goes under the modes
    if (this.wide?.matches ?? true) fill(d.book, this.notebook());
    else d.modes.append(this.notebook());
    fill(d.below, this.keysStrip());
  }

  /** The modes and the intro, as cards: icon, name, short text (not on a phone), padlock. */
  private modeCards(phone: boolean): HTMLElement[] {
    const t = this.t;
    const cards = MODES.map((m) => {
      const locked = m.enabled && this.isLocked(m);
      const on = m.mode === this.chosen;
      return h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(on),
          class: `mode-card${on ? ' is-chosen' : ''}${locked || !m.enabled ? ' is-locked' : ''}`,
          'data-nav': `mode:${m.mode}`,
          onclick: () => this.pressMode(m.mode),
        },
        h('span', { class: 'mode-icon' }, this.img(m.icon)),
        h(
          'span',
          { class: 'mode-text' },
          h('span', { class: 'mode-name' }, t[m.mode]),
          phone
            ? null
            : h('span', { class: 'mode-short' }, m.enabled ? t[m.mode + 'Short'] : t.soon),
        ),
        locked ? this.lockIcon() : null,
      );
    });
    const on = this.chosen === 'intro';
    cards.push(
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(on),
          class: `mode-card${on ? ' is-chosen' : ''}`,
          'data-nav': 'mode:intro',
          onclick: () => this.pressMode('intro'),
        },
        h('span', { class: 'mode-icon' }, this.img(INTRO_ICON)),
        h(
          'span',
          { class: 'mode-text' },
          h('span', { class: 'mode-name' }, t.intro),
          phone ? null : h('span', { class: 'mode-short' }, t.introShort),
        ),
      ),
    );
    return cards;
  }

  /**
   * The chosen mode: its text, the quest that unlocks it, its best time, its options (the
   * site's `.mopt` box) and fields, and the main button.
   */
  private modeDetail(mode: ModeEntry | null, phone: boolean): HTMLElement[] {
    const t = this.t;
    const out: HTMLElement[] = [];
    if (phone) {
      const name = mode ? t[mode.mode] : t.intro;
      const short = mode ? t[mode.mode + 'Short'] : t.introShort;
      out.push(
        h(
          'div',
          { class: 'detail-head' },
          h('span', { class: 'detail-name' }, name),
          h('span', { class: 'detail-short' }, short),
        ),
      );
    }
    if (!mode) {
      out.push(h('p', { class: 'mode-desc' }, t.introDesc));
      out.push(this.startButton(t.watchIntro, true));
      return out;
    }
    const canStart = mode.enabled && !this.isLocked(mode);
    out.push(h('p', { class: 'mode-desc' }, t[mode.mode + 'Desc']));
    const note = !mode.enabled
      ? t.soonNote
      : canStart
        ? ''
        : mode.mode === 'multitime'
          ? fmt(t.modeLockedBy2, this.questForMode('timeattack'), this.questForMode('multicoop'))
          : fmt(t.modeLockedBy, this.questForMode(mode.mode));
    if (note) out.push(h('p', { class: 'lock-note' }, this.lockIcon(), note));
    // The Time Attack modes: the best time of the run they play
    const run = canStart ? this.runOf(mode.mode) : null;
    if (run !== null) {
      const best = this.profile.bestTime(mode.mode, run);
      out.push(
        h(
          'p',
          { class: `best-time${best === null ? ' is-none' : ''}` },
          best === null ? t.noTime : fmt(t.bestTime, formatRunTime(best)),
        ),
      );
    }
    const all = canStart ? this.modeOptions(mode) : [];
    // On a phone the locked options fold into one line, so the main button stays in view
    const opts = phone ? all.filter((oid) => this.profile.hasOption(oid)) : all;
    const folded = all.length - opts.length;
    const runs = canStart ? this.profile.runChoices(mode.mode) : [];
    if (opts.length > 0 || runs.length > 0 || folded > 0) {
      const box = h('div', { class: 'mode-options' });
      if (opts.length > 0) {
        box.append(
          h('span', { class: 'opt-title' }, t.options),
          h(
            'div',
            { class: 'opt-grid' },
            opts.map((oid) => {
              const unlocked = this.profile.hasOption(oid);
              const fixed = oid === Data.OPT_BOOST;
              const ticked = unlocked && (fixed || this.profile.isChosen(oid));
              return h(
                'button',
                {
                  type: 'button',
                  role: 'checkbox',
                  'aria-checked': String(ticked),
                  'aria-disabled': unlocked && !fixed ? false : 'true',
                  class: `opt${ticked ? ' is-on' : ''}${unlocked ? '' : ' is-locked'}`,
                  'data-nav': `opt:${oid}`,
                  onclick: () => this.toggleOption(oid),
                },
                h(
                  'span',
                  { class: 'box' },
                  unlocked ? (ticked ? svgIcon(ICON.check, { size: 14 }) : null) : this.lockIcon(),
                ),
                t[oid],
              );
            }),
          ),
        );
      }
      if (runs.length > 0) {
        const chosen = this.profile.runOption(mode.mode);
        box.append(
          h(
            'div',
            { class: 'field-row', role: 'radiogroup', 'aria-label': t.field },
            h('span', { class: 'opt-title' }, t.field),
            runs.map((oid, k) =>
              h(
                'button',
                {
                  type: 'button',
                  role: 'radio',
                  'aria-checked': String(oid === chosen),
                  class: `field-btn${oid === chosen ? ' is-on' : ''}`,
                  'data-nav': `run:${oid}`,
                  onclick: () => this.chooseRun(mode.mode, oid),
                },
                String(k + 1),
              ),
            ),
          ),
        );
      }
      if (folded > 0) {
        box.append(h('p', { class: 'opt-folded' }, this.lockIcon(), fmt(t.lockedOptions, folded)));
      }
      const hint = this.optionHint(mode);
      this.hintShown = hint !== '';
      box.append(h('p', { class: 'opt-hint' }, hint));
      out.push(box);
    }
    out.push(this.startButton(canStart ? t.start : t.locked, canStart));
    return out;
  }

  private startButton(label: string, on: boolean): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        class: `btn-wood btn-start${on ? '' : ' is-off'}`,
        'aria-disabled': on ? false : 'true',
        'data-nav': 'start',
        onclick: () => {
          this.focusKey = 'start';
          if (on) this.startChosen();
        },
      },
      on ? null : this.lockIcon(),
      h('span', null, label),
      on ? this.confirmCap() : null,
    );
  }

  /** The notebook: quests and fridge, the quests closest to done, the settings. */
  private notebook(): HTMLElement {
    const t = this.t;
    const c = this.counts();
    const tile = (screen: 'quests' | 'fridge', icon: Icon, [have, all]: [number, number]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'book-tile',
          'data-nav': `tab:${screen}`,
          onclick: () => (screen === 'quests' ? this.showQuests() : this.showFridge()),
        },
        this.img(icon, 'tile-art'),
        h('span', { class: 'tile-name' }, t[screen]),
        h('span', { class: 'tile-count' }, `${have} / ${all}`),
        this.bar(all > 0 ? have / all : 0, screen === 'quests' ? 'progress' : 'fridge'),
      );
    return h(
      'section',
      { class: 'board board-book', 'aria-labelledby': 'book-h' },
      this.plank(t.book, null, 'book-h', 1.2, 2),
      h(
        'div',
        { class: 'book-tiles' },
        tile('quests', { item: 20 }, c.quests),
        tile('fridge', { item: 1018 }, c.fridge),
      ),
      this.nearQuests(),
      h(
        'button',
        {
          type: 'button',
          class: 'btn-ghost btn-settings',
          'data-nav': 'settings',
          onclick: () => this.showSettings(),
        },
        svgIcon(ICON.gear, { size: 20 }),
        t.settings,
      ),
    );
  }

  /** The two quests in progress closest to done, with their first items. */
  private nearQuests(): HTMLElement | null {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const ids = q.quests.map((x) => x.id).filter((id) => q.status(p, id) === 'progress');
    if (ids.length === 0) return null;
    const frac = (id: number) => {
      const reqs = q.requirements(id);
      const need = reqs.reduce((a, r) => a + r.qty, 0);
      const have = reqs.reduce((a, r) => a + Math.min(p.items[r.item] ?? 0, r.qty), 0);
      return need > 0 ? have / need : 0;
    };
    const near = [...ids].sort((a, b) => frac(b) - frac(a)).slice(0, 2);
    return h(
      'div',
      { class: 'near' },
      h('h3', { class: 'near-title' }, t.questsNear),
      near.map((id) => {
        const reqs = q.requirements(id);
        const ok = reqs.filter((r) => (p.items[r.item] ?? 0) >= r.qty).length;
        const shown = reqs.slice(0, 3);
        return h(
          'button',
          {
            type: 'button',
            class: 'near-quest',
            'data-nav': `near:${id}`,
            onclick: () => {
              this.showQuests();
              this.questTab = 'progress';
              this.questId = id;
              this.focusKey = `q:${id}`;
              this.render();
            },
          },
          h(
            'span',
            { class: 'near-head' },
            h('span', { class: 'near-name' }, this.texts.getQuestName(id)),
            h('span', { class: 'near-count' }, fmt(t.itemsOf, ok, reqs.length)),
          ),
          h(
            'span',
            { class: 'near-items' },
            shown.map((r) => {
              const have = p.items[r.item] ?? 0;
              const done = have >= r.qty;
              return h(
                'span',
                { class: 'near-item' },
                this.itemImg(r.item, have >= r.qty ? 'in' : have > 0 ? 'part' : 'never'),
                h(
                  'span',
                  { class: `tag${done ? ' is-done' : ''}` },
                  done ? '✓' : `${have}/${r.qty}`,
                ),
              );
            }),
            reqs.length > shown.length
              ? h('span', { class: 'near-more' }, fmt(t.moreItems, reqs.length - shown.length))
              : null,
          ),
        );
      }),
    );
  }

  /** Under the frame: the moves' keys (or buttons), as the help dialog lists them. */
  private keysStrip(): HTMLElement | null {
    const dev = this.input.device;
    if (dev === 'touch') return null;
    const t = this.t;
    const b = this.bindings;
    const caps = (action: PlayerAction): HTMLElement[] => {
      if (dev === 'gamepad') {
        const p = padButtonOf(b.pad[action][0] ?? -1);
        return p ? [this.padCap(p)] : [];
      }
      const kc = b.keys[action][0]?.[0];
      if (kc === undefined) return [];
      const name =
        kc === 32 ? this.texts.getStatic(10) || 'SPACE' : (keyName(kc, this.lang) ?? '?');
      return [h('kbd', { class: `cap${name.length > 2 ? ' wide' : ''}` }, name)];
    };
    const item = (keys: HTMLElement[], label: string) =>
      h('span', { class: 'keys-item' }, keys, h('span', null, label));
    return h(
      'div',
      { class: 'keys-strip', 'aria-label': t.controlsTitle },
      item([...caps('left'), ...caps('right')], t.moveHint),
      item(caps('jump'), t.mv_jump),
      item(caps('attack'), t.mv_attack),
      item(
        dev === 'gamepad' ? [this.padCap('start')] : [h('kbd', { class: 'cap' }, 'P')],
        t.pauseHint,
      ),
    );
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

  /** The phone's tab bar: play, quests, fridge, settings, each with the game's picture. */
  private tabbar(): HTMLElement {
    const t = this.t;
    const cur =
      this.screen === 'quests'
        ? 'quests'
        : this.screen === 'fridge'
          ? 'fridge'
          : this.screen === 'settings' || this.screen === 'controls'
            ? 'settings'
            : 'play';
    const tab = (id: string, label: string, icon: Icon, go: () => void) =>
      h(
        'button',
        {
          type: 'button',
          class: `tab${cur === id ? ' is-current' : ''}`,
          'aria-current': cur === id ? 'page' : false,
          'data-nav': `nav:${id}`,
          onclick: go,
        },
        this.img(icon, 'tab-art'),
        h('span', null, label),
      );
    return h(
      'div',
      { class: 'tabbar-inner' },
      tab('play', t.tabPlay, { clip: 'hammer_player' }, () => this.showMenu()),
      tab('quests', t.quests, { item: 20 }, () => this.showQuests()),
      tab('fridge', t.tabFridge, { item: 1018 }, () => this.showFridge()),
      tab('settings', t.options, { item: 1208 }, () => this.showSettings()),
    );
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

  // ------------------------------------------------------------ the game under way

  /** The top bar while a game the menu started plays: its mode and the options it uses. */
  private fillChips(): void {
    const d = this.dom;
    if (!d) return;
    const mode = MODES.find((m) => m.mode === this.playing);
    if (!mode) {
      fill(d.chips);
      return;
    }
    const t = this.t;
    const opts =
      mode.mode === 'tutorial'
        ? []
        : this.modeOptions(mode).filter(
            (oid) =>
              this.profile.hasOption(oid) && (oid === Data.OPT_BOOST || this.profile.isChosen(oid)),
          );
    fill(
      d.chips,
      h('span', { class: 'chip' }, t[mode.mode]),
      opts.map((oid) => h('span', { class: 'chip is-on' }, t[oid])),
    );
  }

  /**
   * The give up button of the playing toolbar: the first press arms it for 3 s (its label says
   * to press again), the second gives up, as Ctrl Shift K does.
   */
  armQuit(): boolean {
    const now = performance.now();
    if (now - this.quitArmed < 3000) {
      this.quitArmed = 0;
      return true;
    }
    this.quitArmed = now;
    return false;
  }

  /** The playing toolbar's labels, in the current language. */
  get toolLabels(): Record<string, string> {
    const t = this.t;
    return {
      pause: t.pauseHint,
      map: t.toolMap,
      music: t.music,
      full: t.toolFull,
      quit: t.toolQuit,
      quitSure: t.toolQuitSure,
    };
  }

  // ------------------------------------------------------------ quests

  /** The quests of the tab showing: in progress, done, or both, each in id order. */
  private questList(): number[] {
    const q = this.profile.quests;
    const p = this.profile.data;
    const ids = q.quests.map((x) => x.id);
    const of = (s: string) => ids.filter((id) => q.status(p, id) === s);
    if (this.questTab === 'progress') return of('progress');
    if (this.questTab === 'done') return of('done');
    return [...of('progress'), ...of('done')];
  }

  /** Items gathered out of all the quest needs, and how many of its items are complete. */
  private questProgress(id: number): { f: number; ok: number; all: number } {
    const q = this.profile.quests;
    const p = this.profile.data;
    const reqs = q.requirements(id);
    const need = reqs.reduce((a, r) => a + r.qty, 0);
    const have = reqs.reduce((a, r) => a + Math.min(p.items[r.item] ?? 0, r.qty), 0);
    return {
      f: need > 0 ? have / need : 1,
      ok: reqs.filter((r) => (p.items[r.item] ?? 0) >= r.qty).length,
      all: reqs.length,
    };
  }

  private pageQuests(): HTMLElement {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const ids = q.quests.map((x) => x.id);
    const count = (s: string) => ids.filter((id) => q.status(p, id) === s).length;
    const tabs: [QuestTab, string, number][] = [
      ['progress', t.progress, count('progress')],
      ['done', t.done, count('done')],
      ['all', t.all, count('progress') + count('done')],
    ];
    const list = this.questList();
    if (this.questId === null || !list.includes(this.questId)) this.questId = list[0] ?? null;
    const phone = this.isPhone;
    const none = count('none');
    return h(
      'section',
      { class: 'board board-page', 'aria-labelledby': 'q-h' },
      this.plank(t.quests, { item: 20 }, 'q-h'),
      h(
        'div',
        { class: 'page-bar' },
        this.backButton(() => this.showMenu()),
        h(
          'div',
          { class: 'tabs', role: 'tablist', 'aria-label': t.filter },
          tabs.map(([id, label, n]) =>
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': String(id === this.questTab),
                'aria-controls': 'q-list',
                class: `tab-btn is-${id}${id === this.questTab ? ' is-on' : ''}`,
                'data-nav': `qtab:${id}`,
                onclick: () => {
                  this.questTab = id;
                  this.questId = this.questList()[0] ?? null;
                  this.focusKey = `qtab:${id}`;
                  this.render();
                },
              },
              h('span', { class: 'dot' }),
              label,
              h('span', { class: 'count' }, String(n)),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'split' },
        h(
          'div',
          { class: 'quest-list', id: 'q-list', role: 'tabpanel' },
          list.length === 0 ? h('p', { class: 'empty' }, t.noQuest) : null,
          list.map((id) => {
            const done = q.status(p, id) === 'done';
            const pr = this.questProgress(id);
            const on = id === this.questId;
            const row = h(
              'button',
              {
                type: 'button',
                class: `quest-row${on ? ' is-on' : ''}`,
                'aria-pressed': String(on),
                'data-nav': `q:${id}`,
                onclick: () => this.setFocus(`q:${id}`),
              },
              h(
                'span',
                { class: `seal${done ? ' is-done' : ''}` },
                done ? '✓' : `${Math.floor(pr.f * 100)}%`,
              ),
              h(
                'span',
                { class: 'quest-main' },
                h(
                  'span',
                  { class: 'quest-head' },
                  h('span', { class: 'quest-name' }, this.texts.getQuestName(id)),
                  h('span', { class: 'quest-count' }, done ? t.done : `${pr.ok} / ${pr.all}`),
                ),
                this.bar(done ? 1 : pr.f, done ? 'done' : 'progress'),
              ),
            );
            // On a phone the chosen quest opens under its row
            return on && phone ? [row, this.questDetail(id)] : row;
          }),
          none > 0 && list.length > 0 ? h('p', { class: 'note' }, fmt(t.moreQuests, none)) : null,
        ),
        this.questId === null || phone ? null : this.questDetail(this.questId),
      ),
      h('p', { class: 'note' }, t.questRule),
    );
  }

  /** The chosen quest: its items with "found / needed", and its reward once done. */
  private questDetail(id: number): HTMLElement {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const done = q.status(p, id) === 'done';
    const reqs = q.requirements(id);
    return h(
      'div',
      { class: 'inset quest-detail', 'aria-live': 'polite' },
      h(
        'div',
        { class: 'detail-title' },
        h('h2', null, this.texts.getQuestName(id)),
        h('span', { class: `state-chip${done ? ' is-done' : ''}` }, done ? t.done : t.progress),
      ),
      h('h3', { class: 'sub-title' }, t.needed),
      h(
        'div',
        { class: 'need-grid' },
        reqs.map((r) => {
          const have = p.items[r.item] ?? 0;
          const ok = have >= r.qty;
          return h(
            'div',
            { class: `need${ok ? ' is-done' : ''}` },
            h(
              'span',
              { class: 'need-art' },
              have > 0
                ? this.itemImg(r.item, ok ? 'in' : 'part')
                : h('span', { class: 'unknown' }, '?'),
            ),
            h(
              'span',
              { class: 'need-name' },
              have > 0 ? this.texts.getItemName(r.item) : t.unknown,
            ),
            this.bar(Math.min(have, r.qty) / r.qty, ok ? 'done' : 'progress'),
            h('span', { class: 'need-count' }, `${Math.min(have, r.qty)} / ${r.qty}`),
          );
        }),
      ),
      h(
        'div',
        { class: 'reward' },
        this.img(STAR, 'reward-art'),
        h(
          'div',
          null,
          h('h3', { class: 'sub-title' }, t.reward),
          h(
            'p',
            { class: done ? '' : 'is-hidden' },
            done ? this.texts.getQuestDesc(id) : t.rewardHidden,
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ fridge

  /** The items the fridge's filter shows, in id order. */
  private fridgeIds(): number[] {
    const q = this.profile.quests;
    const p = this.profile.data;
    return q.itemIds.filter((id) => {
      const n = p.items[id] ?? 0;
      if (this.fridgeFilter === 'almost') return n > 0 && !q.inFridge(p, id);
      if (this.fridgeFilter === 'never') return n === 0;
      return true;
    });
  }

  private itemState(id: number): 'in' | 'part' | 'never' {
    const q = this.profile.quests;
    const p = this.profile.data;
    if (q.inFridge(p, id)) return 'in';
    return (p.items[id] ?? 0) > 0 ? 'part' : 'never';
  }

  /** Left or right past the shelf's edge: the next page, on the same shelf. */
  private turnFridgePage(dx: number, key: string): void {
    const ids = this.fridgeIds();
    const i = ids.indexOf(Number(key.slice(2)));
    const pages = Math.ceil(ids.length / FRIDGE_PAGE);
    const page = this.fridgePage + dx;
    if (i < 0 || page < 0 || page >= pages) return;
    const row = Math.floor((i % FRIDGE_PAGE) / FRIDGE_COLS);
    const col = dx > 0 ? 0 : FRIDGE_COLS - 1;
    const n = Math.min(ids.length - 1, page * FRIDGE_PAGE + row * FRIDGE_COLS + col);
    this.fridgePage = page;
    this.setFocus(`f:${ids[n]}`);
  }

  private goFridgePage(page: number): void {
    const ids = this.fridgeIds();
    this.fridgePage = page;
    this.fridgeId = ids[page * FRIDGE_PAGE] ?? null;
    this.render();
  }

  private pageFridge(): HTMLElement {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const [have, all] = this.counts().fridge;
    const ids = this.fridgeIds();
    const pages = Math.max(1, Math.ceil(ids.length / FRIDGE_PAGE));
    if (this.fridgeId !== null && ids.includes(this.fridgeId)) {
      this.fridgePage = Math.floor(ids.indexOf(this.fridgeId) / FRIDGE_PAGE);
    }
    this.fridgePage = Math.max(0, Math.min(pages - 1, this.fridgePage));
    const shown = ids.slice(this.fridgePage * FRIDGE_PAGE, (this.fridgePage + 1) * FRIDGE_PAGE);
    if (this.fridgeId === null || !ids.includes(this.fridgeId)) this.fridgeId = shown[0] ?? null;
    const filters: [FridgeFilter, string][] = [
      ['all', t.fridgeAll],
      ['almost', t.fridgeAlmost],
      ['never', t.fridgeNever],
    ];
    const shelves: HTMLElement[] = [];
    for (let r = 0; r < FRIDGE_ROWS; r++) {
      const row = shown.slice(r * FRIDGE_COLS, (r + 1) * FRIDGE_COLS);
      if (row.length === 0 && r > 0) break;
      shelves.push(
        h(
          'div',
          { class: 'shelf' },
          h(
            'div',
            { class: 'shelf-row' },
            row.map((id) => {
              const n = p.items[id] ?? 0;
              const state = this.itemState(id);
              const need = q.unlockCount(id);
              const on = id === this.fridgeId;
              return h(
                'button',
                {
                  type: 'button',
                  class: `cell${on ? ' is-on' : ''}`,
                  'aria-pressed': String(on),
                  'aria-label': n > 0 ? this.texts.getItemName(id) : t.unknown,
                  'data-nav': `f:${id}`,
                  onclick: () => this.setFocus(`f:${id}`),
                },
                this.itemImg(id, state),
                state === 'never'
                  ? null
                  : h(
                      'span',
                      { class: `badge is-${state}` },
                      state === 'in' ? `×${n}` : `${n}/${need}`,
                    ),
                state === 'part' ? this.bar(n / need, 'progress', 'cell-bar') : null,
              );
            }),
          ),
          h('div', { class: 'glass', 'aria-hidden': 'true' }),
        ),
      );
    }
    return h(
      'section',
      { class: 'board board-page board-fridge', 'aria-labelledby': 'f-h' },
      this.plank(t.fridge, { item: 1018 }, 'f-h', 1.2),
      h(
        'div',
        { class: 'page-bar' },
        this.backButton(() => this.showMenu()),
        h(
          'div',
          { class: 'fridge-count' },
          h('span', null, fmt(t.fridgeCount, have, all)),
          this.bar(all > 0 ? have / all : 0, 'done', 'wide'),
        ),
        h(
          'div',
          { class: 'tabs', role: 'tablist', 'aria-label': t.filter },
          filters.map(([id, label]) =>
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': String(id === this.fridgeFilter),
                'aria-controls': 'f-shelves',
                class: `tab-btn${id === this.fridgeFilter ? ' is-on' : ''}`,
                'data-nav': `ftab:${id}`,
                onclick: () => {
                  this.fridgeFilter = id;
                  this.fridgePage = 0;
                  this.fridgeId = this.fridgeIds()[0] ?? null;
                  this.focusKey = `ftab:${id}`;
                  this.render();
                },
              },
              label,
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'split' },
        h(
          'div',
          { class: 'fridge-main', id: 'f-shelves', role: 'tabpanel' },
          h(
            'div',
            { class: 'fridge-inside' },
            shown.length === 0 ? h('p', { class: 'empty' }, t.fridgeEmpty) : shelves,
          ),
          h(
            'div',
            { class: 'pager' },
            h(
              'button',
              {
                type: 'button',
                class: 'btn-round',
                'aria-label': t.prevPage,
                'aria-disabled': this.fridgePage > 0 ? false : 'true',
                'data-nav': 'fprev',
                onclick: () => {
                  this.focusKey = 'fprev';
                  if (this.fridgePage > 0) this.goFridgePage(this.fridgePage - 1);
                },
              },
              svgIcon(ICON.prev, { size: 18 }),
            ),
            h('span', { class: 'pager-text' }, fmt(t.pageOf, this.fridgePage + 1, pages)),
            h(
              'button',
              {
                type: 'button',
                class: 'btn-round',
                'aria-label': t.nextPage,
                'aria-disabled': this.fridgePage < pages - 1 ? false : 'true',
                'data-nav': 'fnext',
                onclick: () => {
                  this.focusKey = 'fnext';
                  if (this.fridgePage < pages - 1) this.goFridgePage(this.fridgePage + 1);
                },
              },
              svgIcon(ICON.next, { size: 18 }),
            ),
          ),
        ),
        this.fridgeId === null ? null : this.itemCard(this.fridgeId),
      ),
      h('p', { class: 'note' }, t.fridgeRule),
    );
  }

  /** The chosen item: picture, name, how far it is from the fridge, and its family. */
  private itemCard(id: number): HTMLElement {
    const t = this.t;
    const q = this.profile.quests;
    const p = this.profile.data;
    const n = p.items[id] ?? 0;
    const need = q.unlockCount(id);
    const state = this.itemState(id);
    const status =
      state === 'in'
        ? fmt(t.inFridge, n)
        : state === 'part'
          ? fmt(t.partial, n, need, need - n)
          : t.never;
    const fid = q.familyOf(id);
    let family: HTMLElement | null = null;
    if (fid !== undefined) {
      const fam = q.itemsOf(fid);
      const famIn = fam.filter((x) => q.inFridge(p, x)).length;
      family = h(
        'div',
        { class: 'family' },
        h(
          'div',
          { class: 'family-head' },
          h('span', { class: 'family-name' }, this.texts.getFamilyName(fid)),
          h('span', { class: 'family-count' }, fmt(t.famCount, famIn, fam.length)),
        ),
        h(
          'div',
          { class: 'family-grid' },
          fam.map((x) => {
            const s = this.itemState(x);
            const known = (p.items[x] ?? 0) > 0;
            return h(
              'span',
              {
                class: `fam-cell is-${s}${x === id ? ' is-on' : ''}`,
                title: known ? this.texts.getItemName(x) : t.unknown,
              },
              known ? this.itemImg(x, s) : h('span', { class: 'unknown' }, '?'),
            );
          }),
        ),
      );
    }
    return h(
      'aside',
      { class: 'inset item-card', 'aria-live': 'polite' },
      h('div', { class: 'item-disc' }, this.itemImg(id, state)),
      h('h2', null, n > 0 ? this.texts.getItemName(id) : t.unknown),
      h('p', { class: `item-status is-${state}` }, status),
      state === 'never'
        ? null
        : this.bar(state === 'in' ? 1 : n / need, state === 'in' ? 'done' : 'progress'),
      family,
    );
  }

  // ------------------------------------------------------------ settings

  /**
   * The settings page (the site's "Options"): the guide's four checkboxes with their texts, the
   * volume, the HD pictures (5.6), the controls page (G.4) and the language.
   */
  private pageSettings(): HTMLElement {
    const t = this.t;
    const choice = savedBitmapChoice();
    const hdValue =
      choice === 'auto'
        ? `${t.hdAuto} (${bitmapScaleOf('auto')}×)`
        : choice === 1
          ? t.hdOff
          : `${choice}×`;
    return h(
      'section',
      { class: 'board board-page board-settings', 'aria-labelledby': 'o-h' },
      this.plank(t.settings, null, 'o-h', -1.2),
      h(
        'div',
        { class: 'page-bar' },
        this.backButton(() => this.leaveSettings()),
      ),
      h(
        'div',
        { class: 'check-grid' },
        (['detail', 'shake', 'sound', 'music'] as const).map((row) => this.checkCard(row)),
      ),
      this.volumeRow(),
      h(
        'div',
        { class: 'inset set-row' },
        h('span', { class: 'set-label', id: 'hd-l' }, t.hd),
        h(
          'button',
          {
            type: 'button',
            class: 'btn-ghost hd-btn',
            'aria-describedby': 'hd-h',
            'aria-labelledby': 'hd-l hd-v',
            'data-nav': 'set:hd',
            onclick: () => this.stepHd(1),
          },
          h('span', { id: 'hd-v' }, hdValue),
        ),
        h('p', { class: 'set-hint', id: 'hd-h' }, t.hdHint),
      ),
      h(
        'div',
        { class: 'set-foot' },
        h(
          'div',
          { class: 'tabs', role: 'radiogroup', 'aria-label': t.language },
          (
            [
              ['fr', 'Français'],
              ['en', 'English'],
              ['es', 'Español'],
            ] as const
          ).map(([id, label]) =>
            h(
              'button',
              {
                type: 'button',
                role: 'radio',
                lang: id,
                'aria-checked': String(id === this.lang),
                class: `tab-btn${id === this.lang ? ' is-on' : ''}`,
                'data-nav': `lang:${id}`,
                onclick: () => {
                  this.focusKey = `lang:${id}`;
                  if (id !== this.lang) this.onLang?.(id);
                },
              },
              label,
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn-ghost',
            'data-nav': 'set:controls',
            onclick: () => this.showControls(),
          },
          t.controls,
        ),
      ),
      h('p', { class: 'note center' }, t.settingsNote),
    );
  }

  /** A setting's checkbox, with the guide's text for it. */
  private checkCard(row: 'detail' | 'shake' | 'sound' | 'music'): HTMLElement {
    const t = this.t;
    const on = !!this.settings[row];
    return h(
      'button',
      {
        type: 'button',
        role: 'checkbox',
        'aria-checked': String(on),
        class: `check-card${on ? ' is-on' : ''}`,
        'data-nav': `set:${row}`,
        onclick: () => this.toggleSetting(row),
      },
      h('span', { class: 'box' }, on ? svgIcon(ICON.check, { size: 18 }) : null),
      h(
        'span',
        { class: 'check-text' },
        h('span', { class: 'check-name' }, t[row]),
        h('span', { class: 'check-hint' }, t[row + 'Hint']),
      ),
    );
  }

  /**
   * The volume: a gauge in steps of `VOLUME_STEP`, set by a click or a drag at its place, or by
   * left and right while focused.
   */
  private volumeRow(): HTMLElement {
    const t = this.t;
    const v = this.settings.volume;
    const track = h(
      'span',
      { class: 'slider-track' },
      h('span', { class: 'slider-fill', style: `width: ${v}%` }),
    );
    const knob = h('span', { class: 'slider-knob', style: `left: ${v}%` });
    const slider = h(
      'span',
      {
        class: 'slider',
        role: 'slider',
        tabindex: '0',
        'aria-labelledby': 'vol-l',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(v),
        'aria-valuetext': `${v} %`,
        'data-nav': 'set:volume',
      },
      track,
      knob,
    );
    const at = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      this.setVolume((100 * (e.clientX - r.left)) / Math.max(1, r.width));
    };
    slider.addEventListener('pointerdown', (e) => {
      try {
        slider.setPointerCapture(e.pointerId);
      } catch {
        // a scripted event
      }
      at(e);
    });
    slider.addEventListener('pointermove', (e) => {
      if (slider.hasPointerCapture?.(e.pointerId)) at(e);
    });
    return h(
      'div',
      { class: 'inset set-row' },
      h('span', { class: 'set-label', id: 'vol-l' }, t.volume),
      slider,
      h('span', { class: 'set-value' }, `${v} %`),
      this.screen === 'sound' ? null : h('p', { class: 'set-hint' }, t.volumeHint),
    );
  }

  /** The sound panel over the paused game: sound, music and volume, which apply at once. */
  private panelSound(): HTMLElement {
    const t = this.t;
    return h(
      'section',
      { class: 'board board-sound', role: 'dialog', 'aria-labelledby': 's-h' },
      h('h2', { class: 'sound-title', id: 's-h' }, t.soundKey),
      h('div', { class: 'sound-rows' }, this.checkCard('sound'), this.checkCard('music')),
      this.volumeRow(),
      h('p', { class: 'note center' }, t.soundNote),
      this.backButton(() => this.leaveSettings()),
    );
  }

  // ------------------------------------------------------------ controls (G.4)

  /**
   * The controls page (G.4): each move's two keyboard slots and controller slot, as the SWF's
   * key setup screen (`#910`) has a key per move; then the default keys. A slot that waits
   * shows the SWF's prompt instead of the help, and a click anywhere cancels it.
   */
  private pageControls(): HTMLElement {
    const t = this.t;
    const b = this.bindings;
    const cap = this.capture;
    const rows = MOVES.map((action, row) =>
      h(
        'div',
        { class: 'ctl-row', role: 'row' },
        h('span', { class: 'ctl-move', role: 'rowheader' }, t[`mv_${action}`]),
        [0, 1, 2].map((col) => {
          const waiting = cap?.row === row && cap.col === col;
          const content: HTMLElement[] = waiting
            ? [h('span', { class: 'waiting' }, '…')]
            : col < 2
              ? this.keyCaps(b.keys[action][col])
              : this.padCaps(b.pad[action]);
          return h(
            'button',
            {
              type: 'button',
              role: 'gridcell',
              class: `slot${waiting ? ' is-waiting' : ''}`,
              'aria-label': `${t[`mv_${action}`]}, ${col < 2 ? t.keyboard : t.pad}`,
              'data-nav': `ctl:${row}:${col}`,
              onclick: () => this.startCapture(row, col),
            },
            content,
          );
        }),
      ),
    );
    let help: (HTMLElement | null)[];
    if (cap) {
      const onPad = cap.col === 2;
      help = [
        h('p', { class: 'prompt' }, onPad ? t.capPad : t.capKey),
        h(
          'p',
          { class: 'prompt-cancel' },
          onPad
            ? t.capPadCancel.replace('{0}', padLabel('start', this.input.padLayout))
            : t.capKeyCancel,
        ),
        cap.note ? h('p', { class: 'prompt-note' }, cap.note) : null,
      ];
    } else {
      help = [h('p', { class: 'note' }, t.controlsHelp)];
    }
    const page = h(
      'section',
      { class: 'board board-page board-controls', 'aria-labelledby': 'c-h' },
      this.plank(t.controlsTitle, null, 'c-h', 1.2),
      h(
        'div',
        { class: 'page-bar' },
        this.backButton(() => this.leaveControls()),
      ),
      h(
        'div',
        { class: 'inset ctl-table', role: 'grid' },
        h(
          'div',
          { class: 'ctl-row ctl-head', role: 'row' },
          h('span', null),
          h('span', { class: 'ctl-col2', role: 'columnheader' }, t.keyboard),
          h('span', { role: 'columnheader' }, t.pad),
        ),
        rows,
      ),
      h(
        'div',
        { class: 'ctl-foot' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn-ghost',
            'data-nav': 'reset',
            onclick: () => {
              this.focusKey = 'reset';
              this.changeBindings(DEFAULT_BINDINGS);
            },
          },
          t.resetKeys,
        ),
        h('div', { class: 'ctl-help', 'aria-live': 'polite' }, help),
      ),
      h('p', { class: 'note' }, t.controlsNote),
    );
    if (cap) {
      // Over the page: a click cancels the wait
      page.append(h('div', { class: 'veil', onclick: () => this.stopCapture() }));
    }
    return page;
  }

  /** A keyboard slot's keys, as keycaps side by side, or a dash. */
  private keyCaps(codes: readonly number[]): HTMLElement[] {
    if (codes.length === 0) return [h('span', { class: 'dash' }, '—')];
    return codes.map((kc) => h('kbd', { class: 'cap' }, keyName(kc, this.lang) ?? '?'));
  }

  /** A controller slot's buttons, as the controller in use shows them, or a dash. */
  private padCaps(buttons: readonly number[]): HTMLElement[] {
    const caps = buttons
      .map((i) => padButtonOf(i))
      .filter((p): p is PadButton => p !== null)
      .map((p) => this.padCap(p));
    return caps.length > 0 ? caps : [h('span', { class: 'dash' }, '—')];
  }

  // ------------------------------------------------------------ results

  /**
   * What the game sent the site: the reached level and score for a game over, and the items
   * found. The end of the set sends no score (`GameMode.exitGame`). Then what the game added
   * to the profile: the quests it completed and the new fridge items.
   */
  private pageResult(): HTMLElement {
    const t = this.t;
    const r = this.result!;
    const over = r.kind === 'gameOver';
    const stats: HTMLElement[] = [];
    if (r.kind === 'gameOver') {
      const data = r.stats.data;
      // Only the Time Attack sends no data, and it has its own page
      if (Array.isArray(data) || data === null) {
        stats.push(this.stat(t.score, formatScore(r.score)));
      } else {
        // The co-op mode sends no score, only each player's (`MultiCoop.saveScore`)
        stats.push(this.stat('Igor', formatScore(data.s0 ?? 0)));
        stats.push(this.stat('Sandy', formatScore(data.s1 ?? 0)));
      }
      const lvl = r.stats.reachedLevel;
      stats.push(this.stat(t.levelReached, String(lvl), this.texts.getSectorName(0, lvl)));
    }
    const done = this.record?.quests ?? [];
    const banners: HTMLElement[] = [];
    for (const id of done.slice(0, done.length > 3 ? 2 : 3)) {
      banners.push(
        h(
          'div',
          { class: 'banner banner-quest stamp' },
          this.img(STAR, 'banner-art'),
          h(
            'span',
            { class: 'banner-text' },
            h('span', { class: 'banner-title' }, fmt(t.questDone, this.texts.getQuestName(id))),
            h('span', { class: 'banner-sub' }, this.texts.getQuestDesc(id)),
          ),
        ),
      );
    }
    if (done.length > 3) {
      banners.push(
        h(
          'div',
          { class: 'banner banner-quest' },
          h('span', { class: 'banner-title' }, fmt(t.moreDone, done.length - 2)),
        ),
      );
    }
    const fridge = this.record?.fridge ?? [];
    if (fridge.length > 0) {
      banners.push(
        h(
          'button',
          {
            type: 'button',
            class: 'banner banner-fridge',
            'data-nav': 'tab:fridge',
            onclick: () => this.showFridge(),
          },
          this.img({ item: fridge[0] }, 'banner-art'),
          h(
            'span',
            { class: 'banner-text' },
            h(
              'span',
              { class: 'banner-title' },
              fridge.length === 1 ? t.newFridge1 : fmt(t.newFridge, fridge.length),
            ),
            h(
              'span',
              { class: 'banner-sub' },
              fridge
                .slice(0, 4)
                .map((id) => this.texts.getItemName(id))
                .join(', ') + (fridge.length > 4 ? '…' : ''),
            ),
          ),
        ),
      );
    }
    const picks = resultPicks(r);
    return h(
      'div',
      { class: `result${over ? ' is-over' : ''}` },
      over
        ? h('img', { class: 'melted', src: `${this.baseUrl}${GAME_OVER_FILE}`, alt: t.gameOver })
        : h('img', {
            class: 'result-logo',
            src: `${this.baseUrl}${TITLE_FILE}`,
            alt: 'Hammerfest',
          }),
      h(
        'section',
        { class: 'board board-page board-result', 'aria-labelledby': 'r-h' },
        // The game over picture says it already: the title is for screen readers then
        h(
          'h1',
          { class: `result-title${over ? ' sr-only' : ''}`, id: 'r-h' },
          over ? t.gameOver : t.endGame,
        ),
        stats.length > 0 ? h('div', { class: 'stats' }, stats) : null,
        banners.length > 0 ? h('div', { class: 'banners' }, banners) : null,
        h(
          'div',
          { class: 'found' },
          h('h2', { class: 'sub-title' }, picks.length > 0 ? t.collected : t.none),
          picks.length > 0
            ? h(
                'div',
                { class: 'found-grid' },
                picks.map(([id, n]) =>
                  h(
                    'div',
                    { class: 'found-cell', title: this.texts.getItemName(id) },
                    this.img({ item: id }, '', this.texts.getItemName(id)),
                    h('span', { class: 'badge is-wood' }, `×${n}`),
                  ),
                ),
              )
            : null,
        ),
        this.continueButton(),
      ),
    );
  }

  private stat(label: string, value: string, sub = ''): HTMLElement {
    return h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat-label' }, label),
      h('span', { class: 'stat-value' }, value),
      sub ? h('span', { class: 'stat-sub' }, sub) : null,
    );
  }

  private continueButton(): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        class: 'btn-wood btn-start btn-continue',
        'data-nav': 'continue',
        onclick: () => this.showMenu(),
      },
      h('span', null, this.t.continue),
      this.confirmCap(),
    );
  }

  /**
   * The results of a Time Attack game (port's own page: the site's is unknown, and it had a
   * ranking of all players instead of a personal best). A finished run shows its time under
   * the mode's name, and the best time or "new best time"; a lost game shows the game over
   * picture. These games send no items.
   */
  private pageTimeResult(tr: TimeResult): HTMLElement {
    const t = this.t;
    const lost = tr.time >= NO_TIME;
    return h(
      'div',
      { class: `result${lost ? ' is-over' : ''}` },
      lost
        ? h('img', { class: 'melted', src: `${this.baseUrl}${GAME_OVER_FILE}`, alt: t.gameOver })
        : h('img', {
            class: 'result-logo',
            src: `${this.baseUrl}${TITLE_FILE}`,
            alt: 'Hammerfest',
          }),
      h(
        'section',
        { class: 'board board-page board-result', 'aria-labelledby': 'r-h' },
        h('h1', { class: 'result-title', id: 'r-h' }, t[tr.mode]),
        lost
          ? h('p', { class: 'lost-run' }, t.lostRun)
          : h('div', { class: 'stats' }, this.stat(t.runTime, formatRunTime(tr.time))),
        !lost && tr.isNew
          ? h(
              'div',
              { class: 'banners' },
              h(
                'div',
                { class: 'banner banner-quest stamp' },
                this.img(STAR, 'banner-art'),
                h('span', { class: 'banner-title' }, t.newBest),
              ),
            )
          : null,
        tr.best !== null
          ? h('p', { class: 'best-time' }, fmt(t.bestTime, formatRunTime(tr.best)))
          : null,
        this.continueButton(),
      ),
    );
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

/** Replaces `{0}`, `{1}`... with the arguments. */
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
