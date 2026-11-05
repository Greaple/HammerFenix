/**
 * The hammerfest.fr pages that surrounded the game (roadmap 3.1). The original site's HTML for
 * the logged-in pages was never archived, so the structure follows the class names of its CSS
 * (`main_v77.css`, ported in `src/site.css`) and the texts come from the site's game guide in
 * each language (`guide.html`). See PORT_STATUS.md, "Site screens".
 *
 * So far: the site frame, the mode menu ("MENU CHOOSE GAME") and the results page after a game
 * (`/play.html/<id>/result`, `endGame.html`). The other tabs (fridge, quests, rankings) are 3.2d
 * and later.
 */
import { PersistCodec } from '../engine/codec/PersistCodec';
import type { GameResult } from '../game/Loader';

/** The game's lang texts the site pages reuse. */
export interface SiteTexts {
  /** `$statics` text `id` of the current language. */
  getStatic(id: number): string;
  /** Item name by item id (score items from 1000). */
  getItemName(id: number): string;
}

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
    gameOver: 'Partie terminée',
    endGame: 'Fin de l\u2019aventure !',
    collected: 'Objets trouvés',
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
    gameOver: 'Game over',
    endGame: 'End of the adventure!',
    collected: 'Items found',
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
    gameOver: 'Fin de la partida',
    endGame: '¡Fin de la aventura!',
    collected: 'Objetos encontrados',
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
  /** The results page being shown, or `null` for the mode menu. */
  private result: GameResult | null = null;
  private readonly texts: SiteTexts;

  constructor(parent: HTMLElement, lang: string, texts: SiteTexts) {
    this.texts = texts;
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

  /** The page the site loaded once the game was saved: the results of `result`. */
  showResult(result: GameResult): void {
    this.result = result;
    this.render();
    this.show();
  }

  /** Back to the mode menu. */
  showMenu(): void {
    this.result = null;
    this.render();
    this.show();
  }

  private render(): void {
    this.root.innerHTML = this.frame(this.result ? this.resultPage(this.result) : this.menuPage());
    this.bind();
  }

  /** The site's page frame around `content`. */
  private frame(content: string): string {
    const t = TEXT[this.lang];
    const px = 'site/img/design/pixel.gif';
    return `
      <div class="siteHeaderBg">
        <div class="siteBanner"><div class="siteHeader"></div></div>
      </div>
      <div class="siteBg">
        <div class="siteContentBg">
          <div class="siteContent">
            <div class="icons">
              <div class="iconPlay"><a data-menu title="${t.play}"><img src="${px}" alt="${t.play}" /></a></div>
            </div>
            <div class="siteMinHeight">${content}</div>
          </div>
        </div>
      </div>`;
  }

  /**
   * The results page, from the classes of the site's CSS ("RESULT"): `h2.gameOver`, the reached
   * level and score in `.levelResult` (`icon_endGame.gif` in the title at the end of the set, which sends no score), the items
   * found in `ul.collected`, and the `.continue` box back to the menu. Not shown: the quest
   * progress table (`table.result`, 3.2) and the new fridge items, which need the profile (3.2b).
   */
  private resultPage(r: GameResult): string {
    const t = TEXT[this.lang];
    const picks = resultPicks(r);
    const level =
      r.kind === 'gameOver'
        ? `<div class="levelResult">
             <p><span>${this.texts.getStatic(1)}</span> ${r.stats.reachedLevel}</p>
             <p><span>Score</span> ${formatScore(r.score)}</p>
           </div>`
        : '';
    const title =
      r.kind === 'gameOver'
        ? t.gameOver
        : `${t.endGame} <img src="site/img/design/icon_endGame.gif" alt="" />`;
    const items = picks
      .map(
        ([id, n]) =>
          `<li><img src="site/img/items/${id}.gif" alt="" /> <span>${escapeHtml(this.texts.getItemName(id))}${n > 1 ? ` x${n}` : ''}</span></li>`,
      )
      .join('');
    return `
      <h2 class="gameOver">${title}</h2>
      ${level}
      <div class="clear"></div>
      ${picks.length > 0 ? `<h4>${t.collected}</h4><ul class="collected">${items}</ul>` : ''}
      <div class="lineResult"></div>
      <div class="continue"><a data-menu>${escapeHtml(this.texts.getStatic(6))}</a></div>`;
  }

  private menuPage(): string {
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

    return `
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
      </div>`;
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLElement>('a[data-mode]').forEach((a) => {
      a.addEventListener('click', () => {
        this.selected = a.dataset.mode!;
        this.render();
      });
    });
    this.root.querySelector<HTMLElement>('a[data-start]')?.addEventListener('click', (e) => {
      this.onStart?.((e.currentTarget as HTMLElement).dataset.start!);
    });
    this.root.querySelectorAll<HTMLElement>('a[data-menu]').forEach((a) => {
      a.addEventListener('click', () => this.showMenu());
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

/** Scores as the site wrote them: `8.684.323`. */
function formatScore(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
