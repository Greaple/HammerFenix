/**
 * Texts of the page around the game frame (header, help, touch buttons) in the three languages
 * of the original. The story is section 1 of each site's guide (`guide.html` of hammerfest.fr,
 * hfest.net and hammerfest.es, in `assets-src/site-archive/`); the control names reuse the pause
 * screen's (`Lang` statics 7 to 10) where it has them. The rest is the port's own.
 *
 * Elements opt in with attributes: `data-i18n` (text), `data-i18n-html` (trusted markup from
 * this file) and `data-i18n-label` (`aria-label` and `title`). The loading texts are the
 * original loader's (`Lang` static 50), shown before the lang files load.
 */
import type { Lang } from './Language';

type PageTexts = Record<string, string>;

const TEXT: Record<Lang, PageTexts> = {
  fr: {
    pageTitle: 'HammerFenix — Les Cavernes de Hammerfest',
    loading: 'Voyage vers Hammerfest…',
    loadError: 'Le voyage a échoué : le jeu n’a pas pu se charger.',
    retry: 'Réessayer',
    credit: 'Hammerfest © Motion Twin',
    soundOn: 'Couper le son',
    soundOff: 'Remettre le son',
    language: 'Langue',
    help: 'Aide et crédits',
    close: 'Fermer',
    jump: 'Sauter',
    left: 'Gauche',
    right: 'Droite',
    down: 'Bas',
    jumpShort: 'SAUT',
    bombShort: 'BOMBE',
    helpTitle: 'Comment jouer',
    storyTitle: 'L’histoire',
    story:
      'Igor était un petit bonhomme de neige sans histoire vivant en Hammerfest. Mais ce beau pays et les fruits qui le peuplaient étaient secoués par les attaques incessantes du cruel sorcier Tuberculoz. Un jour, lassé de ses nombreux assauts sans effet, celui-ci décida de prendre les choses en main et sortit de sa Caverne… Les innocents fruits du pays de Hammerfest ne se doutaient alors pas encore du terrible plan que fomentait le sorcier…',
    controlsTitle: 'Commandes',
    move: 'Se déplacer',
    jumpKey: 'Sauter',
    spaceKey: 'ESPACE',
    bombKey: 'Poser une bombe, ou frapper une bombe toute proche',
    pauseKey: 'Pause',
    musicKey: 'Couper ou remettre la musique',
    quitKey: 'Abandonner la partie (elle est enregistrée)',
    creditsTitle: 'Crédits',
    credits:
      '<strong>Hammerfest</strong> a été créé par <strong>Motion Twin</strong> en 2006. Son code source et ses graphismes ont été publiés sous licence CC BY-NC-SA 4.0. HammerFenix est un remake indépendant et non commercial, pour préserver le jeu ; les graphismes, sons et niveaux restent ceux de Motion Twin.',
    linkOriginal: 'Code source original (Motion Twin)',
    linkPort: 'Code source de HammerFenix',
    linkLicense: 'Licence CC BY-NC-SA 4.0',
    devTools: 'Outils de développement',
    ok: 'Compris !',
  },
  en: {
    pageTitle: 'HammerFenix — The Caverns of Hammerfest',
    loading: 'Travelling to Hammerfest…',
    loadError: 'The journey failed: the game could not load.',
    retry: 'Try again',
    credit: 'Hammerfest © Motion Twin',
    soundOn: 'Mute sound',
    soundOff: 'Turn sound on',
    language: 'Language',
    help: 'Help and credits',
    close: 'Close',
    jump: 'Jump',
    left: 'Left',
    right: 'Right',
    down: 'Down',
    jumpShort: 'JUMP',
    bombShort: 'BOMB',
    helpTitle: 'How to play',
    storyTitle: 'The story',
    story:
      'Igor is a snowman who lives in the far away and cold land of Hammerfest. This beautiful country of green hills and snow-covered mountains was once shattered by the evil powers of Tuber the Sorcerer. The fruits were cursed and kidnapped and Igor found himself sad and alone without his friends. The intrepid Igor decided to go and rescue his friends the Fruits and to destroy the evil sorcerer’s plan…',
    controlsTitle: 'Controls',
    move: 'Move',
    jumpKey: 'Jump',
    spaceKey: 'SPACE',
    bombKey: 'Place a bomb, or kick a bomb next to you',
    pauseKey: 'Pause',
    musicKey: 'Music on / off',
    quitKey: 'Give up the game (it is saved)',
    creditsTitle: 'Credits',
    credits:
      '<strong>Hammerfest</strong> was made by <strong>Motion Twin</strong> in 2006. Its source code and graphics were released under the CC BY-NC-SA 4.0 license. HammerFenix is an independent, non-commercial remake to preserve the game; the graphics, sounds and levels are still Motion Twin’s.',
    linkOriginal: 'Original source code (Motion Twin)',
    linkPort: 'HammerFenix source code',
    linkLicense: 'CC BY-NC-SA 4.0 license',
    devTools: 'Developer tools',
    ok: 'Got it!',
  },
  es: {
    pageTitle: 'HammerFenix — Las Cavernas de Hammerfest',
    loading: 'Viajando a Hammerfest…',
    loadError: 'El viaje ha fallado: el juego no se ha podido cargar.',
    retry: 'Reintentar',
    credit: 'Hammerfest © Motion Twin',
    soundOn: 'Silenciar',
    soundOff: 'Activar el sonido',
    language: 'Idioma',
    help: 'Ayuda y créditos',
    close: 'Cerrar',
    jump: 'Saltar',
    left: 'Izquierda',
    right: 'Derecha',
    down: 'Abajo',
    jumpShort: 'SALTO',
    bombShort: 'BOMBA',
    helpTitle: 'Cómo jugar',
    storyTitle: 'La historia',
    story:
      'Igor es un pequeño hombre de nieve que vive en las lejanas y frías tierras de Hammerfest. Un día este bello país de verdes colinas y montañas nevadas se vio sacudido por los maléficos poderes de Tubérculo el hechicero. ¡Las frutas fueron maldecidas y secuestradas! El intrépido Igor decidió salir en búsqueda de sus amigas las frutas para acabar con el malvado plan del hechicero…',
    controlsTitle: 'Controles',
    move: 'Desplazarse',
    jumpKey: 'Saltar',
    spaceKey: 'ESPACIO',
    bombKey: 'Poner una bomba, o golpear una bomba cercana',
    pauseKey: 'Pausa',
    musicKey: 'Activar o quitar la música',
    quitKey: 'Abandonar la partida (se guarda)',
    creditsTitle: 'Créditos',
    credits:
      '<strong>Hammerfest</strong> fue creado por <strong>Motion Twin</strong> en 2006. Su código fuente y sus gráficos se publicaron con la licencia CC BY-NC-SA 4.0. HammerFenix es un remake independiente y sin ánimo de lucro para preservar el juego; los gráficos, sonidos y niveles siguen siendo de Motion Twin.',
    linkOriginal: 'Código fuente original (Motion Twin)',
    linkPort: 'Código fuente de HammerFenix',
    linkLicense: 'Licencia CC BY-NC-SA 4.0',
    devTools: 'Herramientas de desarrollo',
    ok: '¡Entendido!',
  },
};

/** The page text `key` in language `lang`. */
export function pageText(lang: Lang, key: string): string {
  return TEXT[lang][key] ?? TEXT.en[key] ?? key;
}

/** Writes the page's texts in language `lang`. */
export function applyPageText(lang: Lang, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = pageText(lang, el.dataset.i18n ?? '');
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = pageText(lang, el.dataset.i18nHtml ?? '');
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((el) => {
    const s = pageText(lang, el.dataset.i18nLabel ?? '');
    el.setAttribute('aria-label', s);
    el.title = s;
  });
  if (root === document) {
    document.documentElement.lang = lang;
    document.title = pageText(lang, 'pageTitle');
  }
}

/** Every key, for the test that each language has them all. */
export const PAGE_TEXT_KEYS: Record<Lang, string[]> = {
  fr: Object.keys(TEXT.fr),
  en: Object.keys(TEXT.en),
  es: Object.keys(TEXT.es),
};
