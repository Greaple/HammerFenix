import type { Container } from 'pixi.js';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import type { SwfMovieClip } from '../engine/swf/SwfMovieClip';

/** The stats sent with a score (`Adventure.saveScore`). */
export interface ScoreStats {
  /** `$reachedLevel`: the level reached in the adventure (`dimensions[0].currentId`). */
  reachedLevel: number;
  /** `$item2` (`GameMode.getPicks2`): pick count per item id, score items at id + 1000. */
  item2: number[];
  /** `$data`: the game log (`manager.history`) as rebuilt by `Adventure.onGameOver`. */
  data: string[];
}

/**
 * What the game hands to the site when it ends, for the results screen (3.1c) and the
 * profile (3.2b).
 *
 * - `gameOver`: `Loader.gameOver(score, runId, stats)`. The original sent this to the server,
 *   which saved the game and showed the results page.
 * - `exitGame`: `Loader.exitGame(url, params)`. The end of the set: the original posted
 *   `params` (the item picks, `PersistCodec` encoded) to `endGame.html`. Never sends a score.
 */
export type GameResult =
  | {
      kind: 'gameOver';
      score: number;
      runId: number | null;
      stats: ScoreStats;
      /** `Loader.countUniques($item2)`: how many different items were found. */
      uniqueItems: number;
    }
  | {
      kind: 'exitGame';
      url: string;
      params: string | null;
    };

/** What the Loader needs from the page: its stage, the game's clip and the `$statics` texts. */
export interface LoaderHost {
  readonly lib: SwfLibrary;
  /** `root_mc`: the Loader's stage, above the game. */
  readonly stage: Container;
  /** `game`: the clip holding the whole game, removed when the screen is covered. */
  readonly gameRoot: SwfMovieClip;
  /** `Loader.getLangStr`: the `$statics` texts of the lang file. */
  getLangStr(id: number): string;
  /** `GameManager` is built and starts its mode: the end of `Loader.startGame`. */
  startGameInstance(): void;
  /**
   * Port addition: the text that replaces "click to start" (`Lang` static 53) for a controller
   * player, or null to keep it.
   */
  startText?(): string | null;
}

/**
 * Port of the end of a game in `Loader` (`class/hammer/Loader.mt`): `gameOver`, `exitGame`,
 * `attachLoading` and the fades of `mainGame`. The `loading` clip comes from `_loader.swf`.
 *
 * Also the start of a game once the page has chosen the mode (3.1b): `gameReady` ("click to
 * start", frame 2), `queryStart` (frame 3), `startGame` and the fade-out of frame 6. The menu
 * skips that step (`startNow`, a port addition): its fade goes straight into the game. The SWF and
 * music downloads before it (frames 1 and 7) are not ported: the port loads its assets before
 * the site page shows.
 *
 * Not ported: the server side (the start query, sending the score, retries, `saveAgain`, the
 * redirections). The start query answers at once, as a server that accepts the game. Where the
 * original waits for the server or leaves the page, `onResult` gets the result once the fade is
 * over.
 */
export class Loader {
  private readonly host: LoaderHost;

  fl_gameOver = false;
  fl_exit = false;
  fl_fade = false;
  /** `game._name != null`: the game's clip is still on the stage. */
  fl_game = true;

  loading: SwfMovieClip | null = null;
  /** The label `loading` was sent to by `attachLoading`. */
  private loadingFrame = 0;
  /**
   * `loading._alpha`. Flash keeps any value (the fade counts up to 220), while the port's
   * `_alpha` stops at 100, so the count is kept here.
   */
  private alpha = 100;

  exitUrl: string | null = null;
  exitParams: string | null = null;
  uniqueItems = 0;
  result: GameResult | null = null;
  /** The game has ended and its fade is over: the site would take over from here. */
  fl_done = false;
  /** Waiting for the click on "click to start": the game is not built yet. */
  fl_wait = false;
  /** `_mode`: the site's `$mode` (`solo`, `tutorial`...). */
  mode = 'solo';

  onResult?: (result: GameResult) => void;

  constructor(host: LoaderHost) {
    this.host = host;
  }

  /** Back to a game in progress (the original loads a new page instead). */
  reset(): void {
    this.loading?.removeMovieClip();
    this.loading = null;
    this.alpha = 100;
    this.fl_gameOver = false;
    this.fl_exit = false;
    this.fl_fade = false;
    this.fl_game = true;
    this.exitUrl = null;
    this.exitParams = null;
    this.uniqueItems = 0;
    this.result = null;
    this.fl_done = false;
    this.fl_wait = false;
    this.host.gameRoot.visible = true;
  }

  /** `true` while `gameInst.main()` runs this frame. */
  get gameRunning(): boolean {
    return this.fl_game && !this.fl_wait && !this.fl_gameOver && !this.fl_done;
  }

  /**
   * `Loader.gameReady`: the game is loaded, "click to start" (frame 2). `mode` is the site's
   * `$mode`. Covers the game until `onRelease` (a click on the game) calls `queryStart`.
   */
  gameReady(mode: string): void {
    this.reset();
    this.mode = mode;
    this.fl_wait = true;
    this.attachLoading(2);
  }

  /** Frame 2 waits for the click that starts the game. */
  get waitingStart(): boolean {
    return this.fl_wait && this.loadingFrame === 2;
  }

  /** `loading.onRelease`, set on frames 2 and 4 only. */
  onRelease(): void {
    if (this.fl_wait && this.loadingFrame === 2) this.queryStart();
  }

  /** `Loader.queryStart`: "starting the game..." (frame 3) while the server answers. */
  private queryStart(): void {
    this.attachLoading(3);
    // `serverData`: the port has no server, the game is always accepted
    this.startGame();
  }

  /**
   * Port addition: starts the game at once, as the menu does. In the original the site page
   * loaded the game after the mode was chosen, so frame 2 covered that download and waited for
   * a click; the port has everything loaded before the menu shows, so there is nothing to wait
   * for. No cover either: the menu fades out over the game itself (`Shell.fadeOut`).
   */
  startNow(mode: string): void {
    this.reset();
    this.mode = mode;
    this.startGame(false);
  }

  /** `Loader.startGame`: builds the game, then fades out frame 6 while it runs. */
  private startGame(cover = true): void {
    this.fl_wait = false;
    this.host.startGameInstance();
    if (cover) this.attachLoading(6);
  }

  private countUniques(a: number[]): number {
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] != null) {
        n++;
      }
    }
    return n;
  }

  /** The game is over: covers the game with "saving, please wait" and sends the score. */
  gameOver(score: number, runId: number | null, stats: ScoreStats): void {
    if (this.fl_gameOver) return;

    this.fl_gameOver = true;

    this.fl_fade = true;
    this.attachLoading(5);
    this.setAlpha(0);
    this.uniqueItems = this.countUniques(stats.item2);
    this.result = { kind: 'gameOver', score, runId, stats, uniqueItems: this.uniqueItems };
  }

  /** The end of the set: covers the game, then leaves for `url`. */
  exitGame(url: string, params: string | null): void {
    if (this.fl_exit) return;
    this.fl_fade = true;
    this.fl_exit = true;
    this.exitUrl = url;
    this.exitParams = params;
    this.attachLoading(6);
    this.setAlpha(0);
  }

  attachLoading(frame: number): void {
    this.loading?.removeMovieClip();
    const mc = this.host.lib.attach('loading');
    mc.mcName = 'loading';
    mc.mcDepth = 99;
    this.host.stage.addChild(mc);
    this.loading = mc;
    this.loadingFrame = frame;
    mc.gotoAndStop(String(frame));
    mc.getClip('bg')?.gotoAndStop('1'); // "2" is the dev mode background
    if (frame === 2 || frame === 3) {
      mc.avmSet('currentWeapon', 1);
      this.setText('title', this.host.getLangStr(50));
      this.setText('km', this.host.getLangStr(52));
      if (frame === 2) {
        // click to start
        this.refreshStartText();
        if (this.mode === 'tutorial' || this.mode === 'soccer') {
          // free modes
          this.setText('subBottom', this.host.getLangStr(58));
        } else {
          this.setText('subBottom', this.host.getLangStr(57));
        }
      }
      if (frame === 3) {
        // starting...
        this.setText('bottom', this.host.getLangStr(54));
        this.setText('subBottom', '');
      }
    }
    if (frame === 5) {
      // saving, please wait...
      this.setText('bottom', this.host.getLangStr(55));
      this.setText('subBottom', this.host.getLangStr(56));
    }
  }

  /** "Click to start", or the controller's button when one is in use (port addition). */
  refreshStartText(): void {
    if (this.loadingFrame !== 2) return;
    this.setText('bottom', this.host.startText?.() ?? this.host.getLangStr(53));
  }

  private setText(name: string, text: string): void {
    const tf = this.loading?.getText(name);
    if (tf) tf.text = text;
  }

  private setAlpha(v: number): void {
    this.alpha = v;
    if (this.loading) this.loading._alpha = v;
  }

  /** `Loader.mainGame`, run once per Flash frame (40 Hz), up to the call of the game's main. */
  main(): void {
    this.loading?.stepAnimation(); // Flash plays every clip on the stage
    if (this.fl_done) return;

    if (this.fl_fade) {
      this.setAlpha(this.alpha + 5);
      if (this.alpha >= 100 && this.fl_game) {
        this.host.gameRoot.visible = false; // game.removeMovieClip()
        this.fl_game = false;
      }
      if (this.alpha >= 220) {
        this.setAlpha(100);
        this.fl_fade = false;
      }
    }

    if (this.fl_exit) {
      if (!this.fl_fade) {
        // The original posts `exitParams` to `exitUrl` and stops here
        this.fl_exit = false;
        this.result = { kind: 'exitGame', url: this.exitUrl ?? '', params: this.exitParams };
        this.finish();
        return;
      }
    }
    if (this.fl_gameOver) {
      // The original waits for the server's answer ("$ok"), then loads the results page
      if (!this.fl_fade && this.result) {
        this.setText('bottom', this.host.getLangStr(73)); // "Sauvegarde réussie ! :)"
        this.setText('subBottom', '');
        this.finish();
      }
      return;
    }

    if (!this.fl_fade && !this.fl_exit && !this.fl_gameOver && !this.fl_wait) {
      if (this.loading) {
        this.setAlpha(this.alpha - 2);
        if (this.alpha <= 0) {
          this.loading.removeMovieClip();
          this.loading = null;
          this.alpha = 100;
        }
      }
    }
  }

  private finish(): void {
    this.fl_done = true;
    if (this.result) this.onResult?.(this.result);
  }
}
