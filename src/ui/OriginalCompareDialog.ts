/**
 * Side-by-side with the original game, run by Ruffle (roadmap 2B.3).
 *
 * The original starts from `loader.swf`, as on hammerfest.fr: it loads `game.swf` and the musics
 * (`../sfx/`) from its `base` folder, then a click starts a local game. Flash resolves relative
 * URLs against the page, so `base` must point at `original-swf/`. Flashvars: `lang` and
 * `mode=solo` (Adventure; `GameManager.isMode`). `game.swf` embeds `xml_dev`, so the original
 * always runs in dev mode (`GameManager.isDev`): its debug keys work, and it uses the dev item
 * families (`0,7,1000,1001,1002,1` to `19`), not the no-site ones the port's debug toolbar uses.
 *
 * Level jump: the original's own debug keys (`Player.getDebugControls`). Three numpad digits
 * with Ctrl held call `GameMode.forcedGoto(n)`, in the current dimension only; N goes to the next
 * level and K gives every key. They only work while the player can move.
 */

declare global {
  interface Window {
    RufflePlayer?: {
      newest: () => {
        createPlayer: () => any;
      };
    };
  }
}

/** Ruffle from unpkg, pinned (the original was checked with it, 2B.3). */
const RUFFLE_URL = 'https://unpkg.com/@ruffle-rs/ruffle@0.7.1';

export class OriginalCompareDialog {
  private readonly dialogEl: HTMLDialogElement;
  private readonly containerEl: HTMLElement;
  private player: any = null;
  private isLoaded = false;
  private isLoading = false;
  private readonly baseUrl: string;

  constructor(dialogEl: HTMLDialogElement, baseUrl = './original-swf/') {
    this.dialogEl = dialogEl;
    this.containerEl = dialogEl.querySelector('#ruffle-container') as HTMLElement;
    this.baseUrl = baseUrl;

    this.bindEvents();
  }

  private bindEvents(): void {
    // When the dialog closes, pause audio/player if needed
    this.dialogEl.addEventListener('close', () => {
      if (this.player && typeof this.player.pause === 'function') {
        this.player.pause();
      }
    });
    const form = this.dialogEl.querySelector<HTMLFormElement>('#flash-goto-form');
    const input = this.dialogEl.querySelector<HTMLInputElement>('#flash-goto-level');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Number(input?.value);
      if (Number.isInteger(n) && n >= 0 && n <= 999) void this.gotoLevel(n);
    });
    this.dialogEl
      .querySelector('#flash-next-level')
      ?.addEventListener('click', () => void this.pressKey('KeyN', 'n', 78));
    this.dialogEl
      .querySelector('#flash-all-keys')
      ?.addEventListener('click', () => void this.pressKey('KeyK', 'k', 75));
  }

  async open(): Promise<void> {
    this.dialogEl.showModal();
    if (!this.isLoaded && !this.isLoading) {
      await this.loadRuffle();
    } else if (this.player && typeof this.player.play === 'function') {
      this.player.play();
    }
  }

  close(): void {
    this.dialogEl.close();
  }

  /** `GameMode.forcedGoto(n)` through the debug keys: Ctrl held, then 3 numpad digits. */
  async gotoLevel(n: number): Promise<void> {
    await this.focusGame();
    this.key('keydown', 'ControlLeft', 'Control', 17, true, 1);
    await wait(100);
    for (const d of String(n).padStart(3, '0')) {
      const code = 96 + Number(d);
      this.key('keydown', `Numpad${d}`, d, code, true, 3);
      await wait(120);
      this.key('keyup', `Numpad${d}`, d, code, true, 3);
      await wait(120);
    }
    await wait(100);
    this.key('keyup', 'ControlLeft', 'Control', 17, false, 1);
  }

  /** Presses and releases a key in the original (held over a few frames, so it is seen). */
  async pressKey(code: string, key: string, keyCode: number): Promise<void> {
    await this.focusGame();
    this.key('keydown', code, key, keyCode, false, 0);
    await wait(150);
    this.key('keyup', code, key, keyCode, false, 0);
  }

  /** Ruffle ignores keys while it is not focused (a click on the dialog's buttons takes it). */
  private async focusGame(): Promise<void> {
    this.gameTarget()?.focus();
    await wait(50);
  }

  private gameTarget(): HTMLElement | null {
    return this.player?.shadowRoot?.querySelector('#container') ?? this.player;
  }

  /**
   * Ruffle reads keys on the focused `#container` of its shadow DOM, and tells numpad digits
   * apart by the event's `location` (3).
   */
  private key(
    type: string,
    code: string,
    key: string,
    keyCode: number,
    ctrlKey: boolean,
    location: number,
  ): void {
    this.gameTarget()?.dispatchEvent(
      new KeyboardEvent(type, {
        code,
        key,
        keyCode,
        which: keyCode,
        ctrlKey,
        location,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  }

  private async loadRuffle(): Promise<void> {
    this.isLoading = true;
    if (this.containerEl) {
      this.containerEl.innerHTML =
        '<div class="flash-loading">⏳ Loading Ruffle WebAssembly & the original game...</div>';
    }

    try {
      if (!window.RufflePlayer) {
        await this.injectRuffleScript();
      }

      if (!window.RufflePlayer) {
        throw new Error('RufflePlayer was not initialized');
      }

      const ruffle = window.RufflePlayer.newest();
      const player = ruffle.createPlayer();
      player.id = 'ruffle-compare-player';
      player.style.width = '100%';
      // No minimum height: in a short window the container shrinks, and Ruffle letterboxes
      // the whole frame into it instead of being cropped
      player.style.height = '100%';

      if (this.containerEl) {
        this.containerEl.innerHTML = '';
        this.containerEl.appendChild(player);
      }

      const lang = ['fr', 'en', 'es'].includes(document.documentElement.lang)
        ? document.documentElement.lang
        : 'fr';
      await player.load({
        url: `${this.baseUrl}loader.swf`,
        base: this.baseUrl,
        parameters: { lang, mode: 'solo' },
        letterbox: 'on',
        unmuteOverlay: 'hidden',
      });

      this.player = player;
      this.isLoaded = true;
    } catch (err: any) {
      console.error('Failed to load Flash with Ruffle:', err);
      if (this.containerEl) {
        this.containerEl.innerHTML = `
          <div class="flash-error">
            <p>⚠️ Unable to load original Flash game via Ruffle:</p>
            <code>${err?.message || String(err)}</code>
            <p class="mt-2 text-muted">Ensure WebAssembly is enabled in your browser.</p>
          </div>
        `;
      }
    } finally {
      this.isLoading = false;
    }
  }

  private injectRuffleScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = RUFFLE_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Ruffle script from unpkg CDN'));
      document.head.appendChild(script);
    });
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
