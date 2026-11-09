import { Application, Container } from 'pixi.js';
import type { SwfLibrary } from '../engine/swf/SwfLibrary';
import type { SwfMovieClip } from '../engine/swf/SwfMovieClip';

export class SymbolBrowser {
  private readonly lib: SwfLibrary;
  private readonly dialog: HTMLDialogElement;
  private previewApp: Application | null = null;
  private currentClip: SwfMovieClip | null = null;
  private currentLinkage = '';
  private isPlaying = true;
  private animTimer: number | null = null;

  private searchInput!: HTMLInputElement;
  private symbolListEl!: HTMLUListElement;
  private previewContainer!: HTMLElement;
  private infoEl!: HTMLElement;
  private playPauseBtn!: HTMLButtonElement;
  private frameSlider!: HTMLInputElement;
  private frameLabel!: HTMLElement;
  private categoryFilter = 'all';

  constructor(lib: SwfLibrary, dialog: HTMLDialogElement) {
    this.lib = lib;
    this.dialog = dialog;
    this.buildDom();
    this.setupEvents();
  }

  private buildDom(): void {
    const symbols = Object.keys(this.lib.data.exports).sort();
    const categories = [
      { id: 'all', label: `All (${symbols.length})` },
      { id: 'hammer', label: 'Player & Tools' },
      { id: 'bad', label: 'Monsters (Bads)' },
      { id: 'item', label: 'Items & Pickups' },
      { id: 'fx', label: 'Effects' },
      { id: 'hud', label: 'Interface & HUD' },
    ];

    this.dialog.innerHTML = `
      <div class="symbol-browser-layout">
        <header class="symbol-browser-header">
          <h2 id="symbol-browser-title">SWF Symbol Browser (${symbols.length} Linkages)</h2>
          <form method="dialog">
            <button class="btn btn-close" aria-label="Close symbol browser">✕</button>
          </form>
        </header>

        <div class="symbol-browser-controls">
          <input
            id="symbol-search-input"
            name="symbolSearch"
            type="search"
            class="symbol-search-input"
            placeholder="Filter symbols (e.g. bad_, hammer_, fx_)..."
            aria-label="Filter symbols"
          />
          <div class="symbol-categories" role="tablist">
            ${categories
              .map(
                (c, i) => `
              <button
                type="button"
                role="tab"
                class="category-tab ${i === 0 ? 'active' : ''}"
                data-category="${c.id}"
              >
                ${c.label}
              </button>
            `,
              )
              .join('')}
          </div>
        </div>

        <div class="symbol-browser-body">
          <div class="symbol-list-pane">
            <ul class="symbol-list" role="listbox" aria-label="Exported SWF symbols"></ul>
          </div>

          <div class="symbol-preview-pane">
            <div class="preview-canvas-box" id="symbol-preview-box"></div>

            <div class="preview-controls">
              <button type="button" class="btn btn-sm" id="btn-play-pause">Pause</button>
              <input type="range" class="frame-slider" id="frame-slider" min="1" max="1" value="1" />
              <span class="frame-label" id="frame-label">Frame 1 / 1</span>
            </div>

            <div class="symbol-info" id="symbol-info">
              <p>Select a symbol from the list to preview.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    this.searchInput = this.dialog.querySelector('.symbol-search-input')!;
    this.symbolListEl = this.dialog.querySelector('.symbol-list')!;
    this.previewContainer = this.dialog.querySelector('#symbol-preview-box')!;
    this.infoEl = this.dialog.querySelector('#symbol-info')!;
    this.playPauseBtn = this.dialog.querySelector('#btn-play-pause')!;
    this.frameSlider = this.dialog.querySelector('#frame-slider')!;
    this.frameLabel = this.dialog.querySelector('#frame-label')!;

    this.renderSymbolList(symbols);
  }

  private filterSymbols(): string[] {
    const q = this.searchInput.value.toLowerCase().trim();
    const cat = this.categoryFilter;

    return Object.keys(this.lib.data.exports)
      .sort()
      .filter((name) => {
        if (q && !name.toLowerCase().includes(q)) return false;
        if (cat === 'all') return true;
        if (cat === 'hammer') return name.startsWith('hammer_') && !name.startsWith('hammer_fx');
        if (cat === 'bad') return name.startsWith('bad_');
        if (cat === 'item') return name.startsWith('item_') || name.startsWith('score_');
        if (cat === 'fx') return name.includes('fx');
        if (cat === 'hud')
          return name.startsWith('hud_') || name.startsWith('interf_') || name.includes('menu');
        return true;
      });
  }

  private renderSymbolList(symbols: string[]): void {
    this.symbolListEl.innerHTML = '';
    for (const name of symbols) {
      const li = document.createElement('li');
      li.className = 'symbol-list-item';
      li.setAttribute('role', 'option');
      li.setAttribute('data-linkage', name);
      li.textContent = name;
      if (name === this.currentLinkage) li.classList.add('selected');
      this.symbolListEl.appendChild(li);
    }
  }

  private setupEvents(): void {
    this.searchInput.addEventListener('input', () => {
      this.renderSymbolList(this.filterSymbols());
    });

    const tabs = this.dialog.querySelectorAll<HTMLButtonElement>('.category-tab');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.categoryFilter = tab.dataset.category || 'all';
        this.renderSymbolList(this.filterSymbols());
      });
    }

    this.symbolListEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLLIElement>('.symbol-list-item');
      if (!target) return;
      const linkage = target.dataset.linkage;
      if (linkage) {
        this.selectSymbol(linkage);
      }
    });

    this.playPauseBtn.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      this.playPauseBtn.textContent = this.isPlaying ? 'Pause' : 'Play';
    });

    this.frameSlider.addEventListener('input', () => {
      if (!this.currentClip) return;
      this.isPlaying = false;
      this.playPauseBtn.textContent = 'Play';
      const frame = parseInt(this.frameSlider.value, 10);
      this.currentClip.gotoAndStop(String(frame));
      this.updateFrameLabel();
    });

    // Clean up preview when dialog closes
    this.dialog.addEventListener('close', () => {
      this.stopAnimation();
    });
  }

  private async initPreviewApp(): Promise<Application> {
    if (this.previewApp) return this.previewApp;

    const app = new Application();
    await app.init({
      width: 280,
      height: 280,
      backgroundAlpha: 0,
      antialias: true,
      // Overlay blends read what is drawn under them (`OverlayFilter`)
      useBackBuffer: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });

    this.previewContainer.innerHTML = '';
    this.previewContainer.appendChild(app.canvas);
    this.previewApp = app;
    return app;
  }

  async selectSymbol(linkage: string): Promise<void> {
    this.currentLinkage = linkage;
    const items = this.symbolListEl.querySelectorAll('.symbol-list-item');
    items.forEach((item) => {
      if (item.getAttribute('data-linkage') === linkage) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });

    const app = await this.initPreviewApp();
    this.stopAnimation();

    // Clear old stage children
    app.stage.removeChildren();

    const charId = this.lib.data.exports[linkage];
    const charDef = this.lib.data.characters[charId];

    if (!charDef) {
      this.infoEl.innerHTML = `<p>Symbol <code>${linkage}</code> (ID ${charId}) not found.</p>`;
      return;
    }

    const clip = this.lib.attach(linkage);
    this.currentClip = clip;

    // Center in preview box (140, 140)
    const stageWrapper = new Container();
    stageWrapper.position.set(140, 140);
    stageWrapper.addChild(clip);
    app.stage.addChild(stageWrapper);

    const totalFrames = clip._totalframes || 1;
    this.frameSlider.max = String(Math.max(1, totalFrames));
    this.frameSlider.value = '1';
    this.updateFrameLabel();

    this.infoEl.innerHTML = `
      <div class="symbol-meta-grid">
        <div><strong>Linkage:</strong> <code>${linkage}</code></div>
        <div><strong>Character ID:</strong> ${charId}</div>
        <div><strong>Kind:</strong> <code>${charDef.kind}</code></div>
        <div><strong>Frames:</strong> ${totalFrames}</div>
      </div>
    `;

    this.startAnimation();
  }

  private updateFrameLabel(): void {
    if (!this.currentClip) return;
    const cur = this.currentClip._currentframe || 1;
    const total = this.currentClip._totalframes || 1;
    this.frameLabel.textContent = `Frame ${cur} / ${total}`;
    this.frameSlider.value = String(cur);
  }

  private startAnimation(): void {
    this.stopAnimation();
    let lastTime = performance.now();
    const frameInterval = 1000 / 32; // 32 Hz Flash frame rate

    const loop = (now: number) => {
      if (this.isPlaying && this.currentClip && this.currentClip._totalframes > 1) {
        if (now - lastTime >= frameInterval) {
          lastTime = now;
          this.currentClip.updateTimeline();
          this.updateFrameLabel();
        }
      }
      this.animTimer = requestAnimationFrame(loop);
    };

    this.animTimer = requestAnimationFrame(loop);
  }

  private stopAnimation(): void {
    if (this.animTimer !== null) {
      cancelAnimationFrame(this.animTimer);
      this.animTimer = null;
    }
  }

  open(): void {
    this.dialog.showModal();
    if (!this.currentLinkage) {
      const first = Object.keys(this.lib.data.exports).sort()[0];
      if (first) this.selectSymbol(first);
    } else {
      this.startAnimation();
    }
  }
}
