import { setAvm1Host, type Avm1Host } from '../engine/swf/Avm1';
import { SwfLibrary } from '../engine/swf/SwfLibrary';
import { runQueuedFrameActions, type SwfMovieClip } from '../engine/swf/SwfMovieClip';
import { INTRO_ROOT } from '../engine/swf/types';

/** The movie's stage: `intro.swf` is 420 x 325 (and the site's page showed it at that size). */
export const INTRO_W = 420;
export const INTRO_H = 325;
/** Its frame rate. */
export const INTRO_FPS = 40;
/**
 * The page the movie goes to at its end or on a click: the flashvar `url` of the site's
 * `intro.html`, its free trial (`try.html`, the Learning mode).
 */
export const INTRO_URL = '/try.html#play';

/** `localStorage` key set once the intro played on the first launch. */
const SEEN_KEY = 'hammerfenix_intro_v1';

/**
 * Whether the intro should play on this launch (port addition, roadmap 3.5): once, for a new
 * player (no saved profile), since the port has no home page for visitors. Marks it as played.
 */
export function introOnLaunch(hasProfile: boolean): boolean {
  try {
    if (hasProfile || globalThis.localStorage?.getItem(SEEN_KEY)) return false;
    globalThis.localStorage?.setItem(SEEN_KEY, '1');
    return true;
  } catch {
    return false; // storage blocked: it would play on every launch
  }
}

/**
 * The intro of the hammerfest.fr site (roadmap 3.5): `swf/intro.swf`, which the site's "Intro"
 * page played for visitors (`intro.html`, with `url=/try.html#play` and `lang`). Not a class of
 * the game: the movie is all frame scripts, run as they are by `Avm1.ts`. The root's frame 1
 * holds the first scene (`main`, sprite 555: Tuberculoz takes the bananas and freezes Bouli in
 * the snow), its frame 2 the second (`main2`, sprite 660: Bouli walks across the desert); each
 * scene's `main()` runs every frame, and the first sends the root to frame 2 when it ends. The
 * second scene fades to black and calls `getURL(_root.url, "_self")`.
 *
 * It shows no text: its typewriter texts ("Aux limites de Hammerfest...") are attached as
 * `textBox`, a symbol that only `introDesert.swf` exports, so `attachMovie` fails and the
 * texts are skipped; its `indic1` / `indic2` fields are bound to variables no script sets. It
 * does not read `lang`. Ruffle shows the same (2026-11-12).
 *
 * The movie runs at 40 fps from `step()`; `ended` is set once it asked for its `url`.
 */
export class IntroMovie {
  readonly root: SwfMovieClip;
  /** Set when the movie asked for `url` (its end, or a click). */
  ended = false;
  private readonly host: Avm1Host;

  /**
   * `keyDown` is `Key.isDown` (a Flash key code): the first scene sends Tuberculoz back to his
   * walk while Enter is held (`Key.isDown(13)`, a leftover of its making).
   */
  constructor(lib: SwfLibrary, lang: string, keyDown: (code: number) => boolean = () => false) {
    this.host = {
      keyDown,
      getURL: () => {
        this.ended = true;
      },
    };
    this.root = lib.attach(INTRO_ROOT);
    // The page's flashvars, variables of the root
    this.root.avmSet('url', INTRO_URL);
    this.root.avmSet('lang', lang);
    // Frame 1's scripts run at once, as Flash shows the first frame
    this.run(() => this.root.goLive());
  }

  /** The movie's library, `gfx/intro.json` (built by `tools/build-swf.ts`). */
  static load(baseUrl: string): Promise<SwfLibrary> {
    return SwfLibrary.load(baseUrl, undefined, 'gfx/intro.json');
  }

  /** One frame of the movie: the clips step, then the scripts of the frames reached run. */
  step(): void {
    if (this.ended) return;
    this.run(() => this.root.stepAnimation());
  }

  /**
   * A click on the movie: its button (character 557, an invisible hit area over the whole
   * stage) does `getURL(_root.url, "_self")` on a press.
   */
  click(): void {
    this.host.getURL(String(this.root.avmGet('url')), '_self');
  }

  private run(f: () => void): void {
    setAvm1Host(this.host);
    try {
      f();
      runQueuedFrameActions();
    } finally {
      setAvm1Host(null);
    }
  }
}
