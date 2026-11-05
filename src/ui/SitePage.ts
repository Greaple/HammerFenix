/**
 * The hammerfest.fr pages that surrounded the game (roadmap 3.1). The original site's HTML for
 * the logged-in pages was never archived, so the structure follows the class names of its CSS
 * (`main_v77.css`, ported in `src/site.css`) and the texts come from the site's game guide in
 * each language (`guide.html`). See PORT_STATUS.md, "Site screens".
 *
 * So far: the site frame and the mode menu ("MENU CHOOSE GAME"). The other tabs (fridge,
 * quests, rankings) are 3.2d and later.
 */

type Lang = 'fr' | 'en' | 'es';

interface ModeEntry {
  /** The menu icon class (`li.iadv`...) and the site's `$mode`. */
  icon: string;
  mode: string;
  /** Ported in the game; the others are listed disabled (`.lidis`). */
  enabled: boolean;
}

/** The modes a new player has: Adventure and the free Learning mode (guide, section 3). */
const MODES: ModeEntry[] = [
  { icon: 'iadv', mode: 'solo', enabled: true },
  { icon: 'itutorial', mode: 'tutorial', enabled: false },
];

/** Texts from the site's guide (`guide.html` of hammerfest.fr, hfest.net and hammerfest.es). */
const TEXT: Record<Lang, Record<string, string>> = {
  fr: {
    modes: 'Modes de jeu',
    solo: 'Aventure',
    tutorial: 'Apprentissage',
    soloDesc:
      'Le principal Mode de jeu c’est le mode Aventure. Grâce au mode Aventure vous pouvez faire des quêtes, débloquer des nouveaux modes de jeu, gagner des points pour monter la Pyramide, etc.',
    tutorialDesc:
      'Le mode Apprentissage est très recommandé pour les débutants. Avec ce mode vous apprenez les techniques basiques avant de vous lancer au mode Aventure. C’est illimité et gratuit.',
    start: 'Commencer',
    play: 'Jouer',
    notPorted: 'Pas encore porté',
  },
  en: {
    modes: 'Game modes',
    solo: 'Adventure',
    tutorial: 'Learning',
    soloDesc:
      'The main game mode is the Adventure mode. In the Adventure mode you’ll find quests, unblock new game modes, obtain points to climb up the pyramid, etc.',
    tutorialDesc:
      'The Learning mode is highly recommended for beginners. With this mode you learn the basic techniques before playing the Adventure mode. The Learning mode is free and unlimited.',
    start: 'Start game',
    play: 'Play',
    notPorted: 'Not ported yet',
  },
  es: {
    modes: 'Modos de juego',
    solo: 'Aventura',
    tutorial: 'Aprendizaje',
    soloDesc:
      'El principal Modo de juego es el modo Aventura. En el modo Aventura puedes hacer exploraciones, desbloquear nuevos modos de juego, ganar puntos para subir en la pirámide, etc.',
    tutorialDesc:
      'El modo Aprendizaje está muy recomendado para los principiantes. Con este modo aprendes las técnicas básicas antes de lanzarte al modo Aventura. El modo aprendizaje es ilimitado y gratuito.',
    start: 'Comenzar',
    play: 'Jugar',
    notPorted: 'Aún no portado',
  },
};

export class SitePage {
  readonly root: HTMLElement;
  private lang: Lang = 'fr';
  private selected = 'solo';
  /** "Commencer": the site loads the game page with `$mode`. */
  onStart?: (mode: string) => void;

  constructor(parent: HTMLElement, lang: string) {
    this.root = document.createElement('div');
    this.root.id = 'site';
    this.root.className = 'hf-site';
    parent.appendChild(this.root);
    this.setLang(lang);
  }

  setLang(lang: string): void {
    this.lang = lang === 'en' || lang === 'es' ? lang : 'fr';
    this.render();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const t = TEXT[this.lang];
    const px = 'site/img/design/pixel.gif';
    const modes = MODES.map((m) => {
      const label = `<span>${t[m.mode]}</span> <img src="${px}" alt="" />`;
      if (!m.enabled) {
        return `<li class="${m.icon} lidis" title="${t.notPorted}">${t[m.mode]} <img src="${px}" alt="" /></li>`;
      }
      return `<li class="${m.icon}"><a data-mode="${m.mode}">${label}</a></li>`;
    }).join('');
    const sel = MODES.find((m) => m.mode === this.selected) ?? MODES[0];

    this.root.innerHTML = `
      <div class="siteHeaderBg">
        <div class="siteBanner"><div class="siteHeader"></div></div>
      </div>
      <div class="siteBg">
        <div class="siteContentBg">
          <div class="siteContent">
            <div class="icons">
              <div class="iconPlay"><a title="${t.play}"><img src="${px}" alt="${t.play}" /></a></div>
            </div>
            <div class="siteMinHeight">
              <div class="menu">
                <div class="menuTop"></div>
                <div class="menuMiddle">
                  <div class="menuContLeft">
                    <h2><a>${t.modes}</a></h2>
                    <ul>${modes}</ul>
                  </div>
                  <div class="menuContRight">
                    <h2>${t[sel.mode]}</h2>
                    <p>${t[sel.mode + 'Desc']}</p>
                    ${sel.enabled ? `<a class="button" data-start="${sel.mode}">${t.start}</a>` : ''}
                  </div>
                  <div class="clear"></div>
                </div>
                <div class="menuBottom"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    this.root.querySelectorAll<HTMLElement>('a[data-mode]').forEach((a) => {
      a.addEventListener('click', () => {
        this.selected = a.dataset.mode!;
        this.render();
      });
    });
    this.root.querySelector<HTMLElement>('a[data-start]')?.addEventListener('click', (e) => {
      this.onStart?.((e.currentTarget as HTMLElement).dataset.start!);
    });
  }
}
