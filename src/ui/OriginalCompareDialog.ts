/**
 * Original Flash Game Comparison Modal & Side-by-Side Player using Ruffle WebAssembly.
 *
 * Runs Motion Twin's original `game.swf` directly in the browser alongside HammerFenix
 * so developers and players can compare movement physics, animations, timing,
 * level layouts, audio, and visual fidelity in real time.
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

export class OriginalCompareDialog {
  private readonly dialogEl: HTMLDialogElement;
  private readonly containerEl: HTMLElement;
  private player: any = null;
  private isLoaded = false;
  private isLoading = false;
  private readonly swfUrl: string;

  constructor(dialogEl: HTMLDialogElement, swfUrl = './original-swf/game.swf') {
    this.dialogEl = dialogEl;
    this.containerEl = dialogEl.querySelector('#ruffle-container') as HTMLElement;
    this.swfUrl = swfUrl;

    this.bindEvents();
  }

  private bindEvents(): void {
    // When the dialog closes, pause audio/player if needed
    this.dialogEl.addEventListener('close', () => {
      if (this.player && typeof this.player.pause === 'function') {
        this.player.pause();
      }
    });
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

  private async loadRuffle(): Promise<void> {
    this.isLoading = true;
    if (this.containerEl) {
      this.containerEl.innerHTML =
        '<div class="flash-loading">⏳ Loading Ruffle WebAssembly & original game.swf...</div>';
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
      player.style.height = '100%';
      player.style.minHeight = '480px';

      if (this.containerEl) {
        this.containerEl.innerHTML = '';
        this.containerEl.appendChild(player);
      }

      await player.load({
        url: this.swfUrl,
        parameters: {
          lang: 'en',
        },
        letterbox: 'on',
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
      script.src = 'https://unpkg.com/@ruffle-rs/ruffle';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Ruffle script from unpkg CDN'));
      document.head.appendChild(script);
    });
  }
}
