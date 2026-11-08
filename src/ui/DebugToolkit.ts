import { Graphics } from 'pixi.js';
import { Data } from '../game/Data';
import { BaseEntity } from '../game/entity/Entity';
import { ScoreItem, SpecialItem } from '../game/entity/Item';
import {
  BlackBomb,
  BlueBomb,
  ClassicBomb,
  GreenBomb,
  MineBomb,
  RedBomb,
  RepelBomb,
} from '../game/entity/Bomb';
import type { GameSession } from '../game/GameSession';

export class DebugToolkit {
  private readonly session: GameSession;
  private readonly containerEl: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private isVisible = false;

  private overlayGfx: Graphics;
  private showHitboxes = false;
  private showGrid = false;
  private isGodMode = false;

  private fps = 0;
  private lastFpsCalc = performance.now();
  private framesCount = 0;

  constructor(session: GameSession, containerEl: HTMLElement) {
    this.session = session;
    this.containerEl = containerEl;

    // Overlay graphics for visual debug (hitboxes, grid, collision boxes)
    this.overlayGfx = new Graphics();
    this.overlayGfx.zIndex = 99999;
    this.session.gameRoot.addChild(this.overlayGfx);

    this.createDom();
    this.bindKeyboardShortcuts();
    this.startDebugLoop();
  }

  private createDom(): void {
    const el = document.createElement('div');
    el.id = 'debug-toolkit-panel';
    el.className = 'debug-panel';
    el.style.display = 'none';

    el.innerHTML = `
      <div class="debug-header">
        <span class="debug-title">🛠️ Debug & Testing Toolkit</span>
        <button type="button" class="btn btn-sm btn-close" id="dbg-btn-close">✕</button>
      </div>

      <div class="debug-body">
        <div class="debug-stats" id="dbg-stats">
          FPS: -- | Cycle: 0 | Igor: (0, 0)
        </div>

        <div class="debug-section">
          <h4>Cheats & Toggles</h4>
          <div class="debug-btn-row">
            <button type="button" class="btn btn-sm" id="dbg-btn-god">God Mode: OFF</button>
            <button type="button" class="btn btn-sm" id="dbg-btn-hitboxes">Hitboxes: OFF</button>
            <button type="button" class="btn btn-sm" id="dbg-btn-grid">Grid: OFF</button>
          </div>
        </div>

        <div class="debug-section">
          <h4>Simulation Speed</h4>
          <div class="debug-btn-row">
            <button type="button" class="btn btn-sm" data-speed="0.2">0.2x (Slow)</button>
            <button type="button" class="btn btn-sm active" data-speed="1.0">1.0x</button>
            <button type="button" class="btn btn-sm" data-speed="2.0">2.0x</button>
            <button type="button" class="btn btn-sm btn-primary" id="dbg-btn-step">Step 1 Frame (F)</button>
          </div>
        </div>

        <div class="debug-section">
          <h4>Actions</h4>
          <div class="debug-btn-row">
            <button type="button" class="btn btn-sm" id="dbg-btn-kill-bads">Kill All Bads (K)</button>
            <button type="button" class="btn btn-sm" id="dbg-btn-hurry">Trigger Hurry-Up (H)</button>
            <button type="button" class="btn btn-sm" id="dbg-btn-clear">Clear Level (Exit)</button>
            <button type="button" class="btn btn-sm" id="dbg-btn-extend">Spawn EXTEND</button>
            <button type="button" class="btn btn-sm btn-secondary" id="dbg-btn-compare">⚡ Flash Original</button>
          </div>
        </div>

        <div class="debug-section">
          <h4>Record &amp; Replay</h4>
          <div class="debug-btn-row">
            <button type="button" class="btn btn-sm" id="dbg-btn-record">⏺ Record from this level</button>
            <button type="button" class="btn btn-sm" id="dbg-btn-record-stop" disabled>⏹ Stop &amp; save</button>
            <button type="button" class="btn btn-sm btn-secondary" id="dbg-btn-replay">▶ Play replay file…</button>
            <input type="file" id="dbg-replay-file" accept=".json,application/json" hidden />
          </div>
          <p class="debug-desc" id="dbg-record-status">
            Restarts the level and records your input. Debug actions (spawns, god mode, kills) are
            not recorded, so avoid them while recording. Saved files go in
            <code>tests/replays/</code> to become regression tests.
          </p>
        </div>

        <div class="debug-section">
          <h4>Spawn Entity</h4>
          <div class="debug-spawn-grid">
            <select id="dbg-spawn-bad-select" class="select-field">
              <option value="0">0 - Pomme (Apple)</option>
              <option value="1">1 - Poire (Pear)</option>
              <option value="2">2 - Banane (Banana)</option>
              <option value="3">3 - Cerise (Cherry Flyer)</option>
              <option value="4">4 - Citron (Lemon)</option>
              <option value="5">5 - Ananas (Pineapple)</option>
              <option value="6">6 - Fraise (Strawberry)</option>
              <option value="7">7 - Framboise (Raspberry)</option>
              <option value="8">8 - Kiwi</option>
              <option value="9">9 - Litchi</option>
              <option value="10">10 - Saw (Wall Crawler)</option>
              <option value="15">15 - Tubby (Hurry Up)</option>
            </select>
            <button type="button" class="btn btn-sm btn-secondary" id="dbg-btn-spawn-bad">Spawn Monster</button>

            <select id="dbg-spawn-bomb-select" class="select-field">
              <option value="classic">Classic Bomb</option>
              <option value="blue">Blue (Ice)</option>
              <option value="green">Green (Poison)</option>
              <option value="red">Red (Fire)</option>
              <option value="black">Black (Mega)</option>
              <option value="repel">Repel Bomb</option>
              <option value="mine">Mine</option>
            </select>
            <button type="button" class="btn btn-sm btn-secondary" id="dbg-btn-spawn-bomb">Drop Bomb</button>
          </div>
        </div>

        <div class="debug-section">
          <h4>Original Flash Game Comparison</h4>
          <p class="debug-desc">
            "⚡ Flash Original" runs the 2006 original in Ruffle (<code>original-swf/loader.swf</code>),
            in its dev mode: its level field sends the original's own jump keys (Ctrl and three
            numpad digits), in the current dimension.
          </p>
        </div>
      </div>
    `;

    this.containerEl.appendChild(el);
    this.panelEl = el;

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.panelEl) return;

    this.panelEl.querySelector('#dbg-btn-close')?.addEventListener('click', () => {
      this.toggle();
    });

    const godBtn = this.panelEl.querySelector('#dbg-btn-god') as HTMLButtonElement;
    godBtn?.addEventListener('click', () => {
      this.isGodMode = !this.isGodMode;
      if (this.session.player) {
        this.session.player.fl_godMode = this.isGodMode;
      }
      godBtn.textContent = `God Mode: ${this.isGodMode ? 'ON' : 'OFF'}`;
      godBtn.classList.toggle('active', this.isGodMode);
    });

    const hitBtn = this.panelEl.querySelector('#dbg-btn-hitboxes') as HTMLButtonElement;
    hitBtn?.addEventListener('click', () => {
      this.showHitboxes = !this.showHitboxes;
      hitBtn.textContent = `Hitboxes: ${this.showHitboxes ? 'ON' : 'OFF'}`;
      hitBtn.classList.toggle('active', this.showHitboxes);
      if (!this.showHitboxes && !this.showGrid) this.overlayGfx.clear();
    });

    const gridBtn = this.panelEl.querySelector('#dbg-btn-grid') as HTMLButtonElement;
    gridBtn?.addEventListener('click', () => {
      this.showGrid = !this.showGrid;
      gridBtn.textContent = `Grid: ${this.showGrid ? 'ON' : 'OFF'}`;
      gridBtn.classList.toggle('active', this.showGrid);
      if (!this.showHitboxes && !this.showGrid) this.overlayGfx.clear();
    });

    // Speed buttons
    const speedBtns = this.panelEl.querySelectorAll<HTMLButtonElement>('[data-speed]');
    for (const btn of speedBtns) {
      btn.addEventListener('click', () => {
        speedBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const spd = parseFloat(btn.dataset.speed || '1.0');
        this.session.gameLoop.timeScale = spd;
      });
    }

    // Step button
    this.panelEl.querySelector('#dbg-btn-step')?.addEventListener('click', () => {
      if (!this.session.fl_pause) this.session.onPause();
      this.session.gameLoop.stepSingleFrame();
    });

    // Actions
    this.panelEl.querySelector('#dbg-btn-kill-bads')?.addEventListener('click', () => {
      this.killAllBads();
    });

    this.panelEl.querySelector('#dbg-btn-hurry')?.addEventListener('click', () => {
      this.session.onHurryUp();
    });

    this.panelEl.querySelector('#dbg-btn-clear')?.addEventListener('click', () => {
      this.session.fxMan.attachExit();
      this.session.fl_clear = true;
    });

    this.panelEl.querySelector('#dbg-btn-extend')?.addEventListener('click', () => {
      // The level's letters, or any letter on a level that has none (no special slots)
      const s = this.session;
      if (s.statsMan.extendList.length > 0) {
        s.statsMan.attachExtend();
      } else if (s.player) {
        SpecialItem.attach(s, s.player.x, s.player.y - 40, 0, s.rand.random(Data.EXTENDS.length));
      }
    });

    this.panelEl.querySelector('#dbg-btn-compare')?.addEventListener('click', () => {
      (window as any).originalCompare?.open();
    });

    this.bindRecordReplay(this.panelEl);

    // Spawners
    const spawnBadSelect = this.panelEl.querySelector('#dbg-spawn-bad-select') as HTMLSelectElement;
    this.panelEl.querySelector('#dbg-btn-spawn-bad')?.addEventListener('click', () => {
      const id = parseInt(spawnBadSelect.value, 10);
      const p = this.session.player;
      const x = p ? p.x + 40 : 200;
      const y = p ? p.y - 40 : 100;
      this.session.attachBad(id, x, y);
    });

    const spawnBombSelect = this.panelEl.querySelector(
      '#dbg-spawn-bomb-select',
    ) as HTMLSelectElement;
    this.panelEl.querySelector('#dbg-btn-spawn-bomb')?.addEventListener('click', () => {
      const p = this.session.player;
      if (!p) return;
      const bType = spawnBombSelect.value;
      switch (bType) {
        case 'classic':
          ClassicBomb.attach(this.session, p.x, p.y);
          break;
        case 'black':
          BlackBomb.attach(this.session, p.x, p.y);
          break;
        case 'blue':
          BlueBomb.attach(this.session, p.x, p.y);
          break;
        case 'green':
          GreenBomb.attach(this.session, p.x, p.y);
          break;
        case 'red':
          RedBomb.attach(this.session, p.x, p.y);
          break;
        case 'repel':
          RepelBomb.attach(this.session, p.x, p.y);
          break;
        case 'mine':
          MineBomb.attach(this.session, p.x, p.y);
          break;
      }
    });
  }

  private bindRecordReplay(panel: HTMLElement): void {
    const recordBtn = panel.querySelector('#dbg-btn-record') as HTMLButtonElement;
    const stopBtn = panel.querySelector('#dbg-btn-record-stop') as HTMLButtonElement;
    const replayBtn = panel.querySelector('#dbg-btn-replay') as HTMLButtonElement;
    const fileInput = panel.querySelector('#dbg-replay-file') as HTMLInputElement;
    const status = panel.querySelector('#dbg-record-status') as HTMLElement;

    recordBtn.addEventListener('click', () => {
      this.session.startRecording();
      recordBtn.disabled = true;
      stopBtn.disabled = false;
      status.textContent = `Recording level ${this.session.world.currentId} (seed ${this.session.seed})…`;
    });

    stopBtn.addEventListener('click', () => {
      const replay = this.session.stopRecording() ?? this.session.lastRecording;
      recordBtn.disabled = false;
      stopBtn.disabled = true;
      if (!replay) {
        status.textContent = 'The recording was ended by a restart or level change.';
        return;
      }
      const ticks = replay.input.reduce((n, [, c]) => n + c, 0);
      const name = `${replay.set}-${String(replay.level).padStart(2, '0')}-${replay.seed}.json`;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(replay) + '\n'], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = `Saved ${name} (${ticks} ticks).`;
    });

    replayBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const replay = JSON.parse(await file.text());
        const player = await this.session.playReplay(replay);
        recordBtn.disabled = false;
        stopBtn.disabled = true;
        status.textContent = `Playing ${file.name} (${player.ticks} ticks). Keyboard control comes back when it ends.`;
      } catch (e) {
        status.textContent = `Could not play ${file.name}: ${(e as Error).message}`;
      }
    });
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      // Don't intercept typing in inputs
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'Backquote' || e.key === '`') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'KeyK' && !e.ctrlKey && this.isVisible) {
        this.killAllBads();
      } else if (e.code === 'KeyG' && this.isVisible) {
        const godBtn = this.panelEl?.querySelector('#dbg-btn-god') as HTMLButtonElement;
        godBtn?.click();
      } else if (e.code === 'KeyB' && this.isVisible) {
        const hitBtn = this.panelEl?.querySelector('#dbg-btn-hitboxes') as HTMLButtonElement;
        hitBtn?.click();
      } else if (e.code === 'KeyF' && this.isVisible) {
        const stepBtn = this.panelEl?.querySelector('#dbg-btn-step') as HTMLButtonElement;
        stepBtn?.click();
      } else if (e.code === 'BracketLeft') {
        if (this.session.world.currentId > 0) {
          this.session.changeLevel(this.session.world.currentId - 1);
        }
      } else if (e.code === 'BracketRight') {
        if (this.session.world.currentId < this.session.world.levelCount - 1) {
          this.session.changeLevel(this.session.world.currentId + 1);
        }
      }
    });
  }

  private killAllBads(): void {
    const bads = this.session.getBads();
    for (const b of bads) {
      b.forceKill(0);
    }
  }

  private startDebugLoop(): void {
    const statsEl = this.panelEl?.querySelector('#dbg-stats');

    const update = (now: number) => {
      this.framesCount++;
      if (now - this.lastFpsCalc >= 1000) {
        this.fps = this.framesCount;
        this.framesCount = 0;
        this.lastFpsCalc = now;
      }

      if (this.isVisible && statsEl) {
        const p = this.session.player;
        const pStr = p ? `(${Math.round(p.x)}, ${Math.round(p.y)}) [${p.cx}, ${p.cy}]` : 'None';
        const badCount = this.session.getBads().length;
        statsEl.textContent = `FPS: ${this.fps} | Cyc: ${this.session.cycle} | Igor: ${pStr} | Bads: ${badCount}`;
      }

      this.renderVisualOverlay();
      requestAnimationFrame(update);
    };

    requestAnimationFrame(update);
  }

  private renderVisualOverlay(): void {
    if (!this.showHitboxes && !this.showGrid) {
      this.overlayGfx.clear();
      return;
    }

    this.overlayGfx.clear();

    // 1. Grid visualizer
    if (this.showGrid) {
      // Cell lines
      this.overlayGfx.setStrokeStyle({ width: 1, color: 0x334155, alpha: 0.4 });
      for (let x = 0; x <= Data.LEVEL_WIDTH; x++) {
        this.overlayGfx.moveTo(x * Data.CASE_WIDTH, 0);
        this.overlayGfx.lineTo(x * Data.CASE_WIDTH, Data.LEVEL_HEIGHT * Data.CASE_HEIGHT);
        this.overlayGfx.stroke();
      }
      for (let y = 0; y <= Data.LEVEL_HEIGHT; y++) {
        this.overlayGfx.moveTo(0, y * Data.CASE_HEIGHT);
        this.overlayGfx.lineTo(Data.LEVEL_WIDTH * Data.CASE_WIDTH, y * Data.CASE_HEIGHT);
        this.overlayGfx.stroke();
      }

      // Solid walls
      for (let y = 0; y < Data.LEVEL_HEIGHT; y++) {
        for (let x = 0; x < Data.LEVEL_WIDTH; x++) {
          if (this.session.world.getCase(x, y) > 0) {
            this.overlayGfx
              .rect(x * Data.CASE_WIDTH, y * Data.CASE_HEIGHT, Data.CASE_WIDTH, Data.CASE_HEIGHT)
              .fill({ color: 0x0284c7, alpha: 0.25 });
          }
        }
      }
    }

    // 2. Hitbox visualizer
    if (this.showHitboxes) {
      // Player
      const p = this.session.player;
      if (p) {
        const hw = p.hitWidth;
        const hh = p.hitHeight;
        this.overlayGfx
          .rect(p.x - hw * 0.5, p.y - hh, hw, hh)
          .stroke({ width: 1.5, color: 0x22c55e, alpha: 0.9 })
          .fill({ color: 0x22c55e, alpha: 0.15 });

        // Origin cross
        this.overlayGfx.circle(p.x, p.y, 2).fill(0x22c55e);
      }

      // Bads
      for (const b of this.session.getBads()) {
        const hw = b.hitWidth;
        const hh = b.hitHeight;
        this.overlayGfx
          .rect(b.x - hw * 0.5, b.y - hh, hw, hh)
          .stroke({ width: 1.5, color: 0xef4444, alpha: 0.9 })
          .fill({ color: 0xef4444, alpha: 0.15 });
        this.overlayGfx.circle(b.x, b.y, 2).fill(0xef4444);
      }

      // Bombs
      for (const bomb of this.session.getBombs()) {
        const hw = bomb.hitWidth;
        const hh = bomb.hitHeight;
        this.overlayGfx
          .rect(bomb.x - hw * 0.5, bomb.y - hh, hw, hh)
          .stroke({ width: 1.5, color: 0x38bdf8, alpha: 0.9 })
          .fill({ color: 0x38bdf8, alpha: 0.15 });
      }

      // Items
      for (const item of this.session.getItems()) {
        const hw = item.hitWidth;
        const hh = item.hitHeight;
        this.overlayGfx
          .rect(item.x - hw * 0.5, item.y - hh, hw, hh)
          .stroke({ width: 1.5, color: 0xfbbf24, alpha: 0.9 })
          .fill({ color: 0xfbbf24, alpha: 0.2 });
      }
    }
  }

  toggle(): boolean {
    this.isVisible = !this.isVisible;
    if (this.panelEl) {
      this.panelEl.style.display = this.isVisible ? 'block' : 'none';
    }
    if (!this.isVisible) {
      this.overlayGfx.clear();
    }
    return this.isVisible;
  }
}
