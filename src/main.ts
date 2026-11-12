import { Application, UPDATE_PRIORITY } from 'pixi.js';
import { AudioEngine } from './engine/Audio';
import { loadGameFonts } from './engine/Fonts';
import { InputController, type ControlAction } from './engine/Input';
import { bindingKeys, loadBindings, saveBindings } from './engine/Bindings';
import { showHelpKeys } from './ui/HelpKeys';
import { SwfLibrary } from './engine/swf/SwfLibrary';
import { runQueuedFrameActions } from './engine/swf/SwfMovieClip';
import { GameDataStore } from './game/Data';
import { GameSession } from './game/GameSession';
import { SymbolBrowser } from './ui/SymbolBrowser';
import { DebugToolkit } from './ui/DebugToolkit';
import { OriginalCompareDialog } from './ui/OriginalCompareDialog';
import { Profile } from './game/Profile';
import { QuestEngine } from './game/Quests';
import { Shell } from './ui/Shell';
import { pickLang } from './ui/Language';
import { applyPageText, pageText } from './ui/PageText';
import { loadPadIcons, type PadButton, padIconHtml, padLabel } from './game/gui/PadGlyphs';

const SOUNDS: Record<string, string> = {
  sound_bad_death: 'sfx/sound_bad_death.mp3',
  sound_bomb: 'sfx/sound_bomb.mp3',
  sound_bomb_black: 'sfx/sound_bomb_black.mp3',
  sound_bomb_blue: 'sfx/sound_bomb_blue.mp3',
  sound_bomb_drop: 'sfx/sound_bomb_drop.mp3',
  sound_bomb_green: 'sfx/sound_bomb_green.mp3',
  sound_bomb_jump: 'sfx/sound_bomb_jump.mp3',
  sound_boss_laugh: 'sfx/sound_boss_laugh.mp3',
  sound_field: 'sfx/sound_field.mp3',
  sound_freeze: 'sfx/sound_freeze.mp3',
  sound_hurry: 'sfx/sound_hurry.mp3',
  sound_item_score: 'sfx/sound_item_score.mp3',
  sound_item_special: 'sfx/sound_item_special.mp3',
  sound_item_supa: 'sfx/sound_item_supa.mp3',
  sound_jump: 'sfx/sound_jump.mp3',
  sound_kick: 'sfx/sound_kick.mp3',
  sound_land: 'sfx/sound_land.mp3',
  sound_level_clear: 'sfx/sound_level_clear.mp3',
  sound_player_death: 'sfx/sound_player_death.mp3',
  sound_pop: 'sfx/sound_pop.mp3',
  sound_teleport: 'sfx/sound_teleport.mp3',
  music_ingame: 'sfx/music.mp3',
  music_boss: 'sfx/boss.mp3',
  music_hurry: 'sfx/hurryUp.mp3',
};

/**
 * Modern Web Guidance: Light-dismiss fallback for browsers
 * without native `closedby="any"` support.
 */
function initDialogFallbacks(): void {
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (isDialogContent) return;
        dialog.close();
      });
    });
  }
}

async function main(): Promise<void> {
  initDialogFallbacks();
  initTouch();

  const baseUrl = import.meta.env.BASE_URL || './';
  // The page's texts at once, in the language the game will start in
  const startLang = pickLang(GameSession.savedLang(), navigator.languages ?? []);
  applyPageText(startLang);
  const loading = new LoadingScreen();

  // 1. Create PixiJS application (420 x 520 virtual resolution)
  const app = new Application();
  await app.init({
    width: 420,
    height: 520,
    backgroundColor: 0x000000,
    antialias: true,
    // Overlay blends read what is drawn under them (`OverlayFilter`)
    useBackBuffer: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  /** Set when the canvas must be drawn again although the game did not step (a resize). */
  let forceRender = true;
  const canvasContainer = document.getElementById('game-canvas-container');
  if (canvasContainer) {
    canvasContainer.appendChild(app.canvas);
    app.canvas.setAttribute('aria-label', 'Hammerfest');
    // The game is vector art: draw it at the frame's size on screen, so it stays sharp at
    // any scale (the stage keeps its 420 x 520 coordinates)
    let lastRes = 0;
    new ResizeObserver(() => {
      const w = canvasContainer.clientWidth;
      if (w <= 0) return;
      const res = Math.min(4, Math.max(1, (w * (window.devicePixelRatio || 1)) / 420));
      if (Math.abs(res - lastRes) < 0.01) return;
      lastRes = res;
      app.renderer.resize(420, 520, res);
      forceRender = true;
    }).observe(canvasContainer);
  }

  // 2. Load game data and assets in parallel
  const [dataStore, lib] = await Promise.all([
    GameDataStore.load(baseUrl, startLang),
    SwfLibrary.load(baseUrl, (f) => loading.progress(f)),
    loadGameFonts(baseUrl),
    loadPadIcons(),
  ]);

  // 3. Initialize Audio & Input engines
  const audio = new AudioEngine(SOUNDS, baseUrl);
  audio.preload();
  const input = new InputController();
  input.attach();

  // Unlock audio on first user gesture
  const unlockAudio = () => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  // 4. Initialize Dialogs & Symbol Browser
  const aboutDialog = document.getElementById('about-dialog') as HTMLDialogElement;
  const symbolDialog = document.getElementById('symbol-browser-dialog') as HTMLDialogElement;
  const symbolBrowser = new SymbolBrowser(lib, symbolDialog);
  const compareDialog = document.getElementById('flash-compare-dialog') as HTMLDialogElement;
  const originalCompare = new OriginalCompareDialog(compareDialog);
  (window as any).originalCompare = originalCompare;

  // 5. Create GameSession. The mode menu shows first, in the game frame (it replaces the
  // hammerfest.fr pages, roadmap 3.1).
  const session = await GameSession.create(app, lib, dataStore, audio, input, 'adventure');
  // The player's profile: what the hammerfest.fr server kept (roadmap 3.2)
  const profile = new Profile(new QuestEngine(dataStore.quests, dataStore.items));
  const shell = new Shell(lib, input, dataStore, profile);
  await shell.load(baseUrl);
  app.stage.addChild(shell.root, shell.pauseLayer);
  session.gameRoot.visible = false;
  shell.showMenu();
  loading.done();
  // Offline play (roadmap 5.3): the build's service worker caches the game once it has loaded
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // Touch found after the menu showed: redraw it without its keyboard hints
  new MutationObserver(() => shell.refresh()).observe(document.documentElement, {
    attributeFilter: ['class'],
  });
  app.ticker.add(() => {
    shell.update();
    shell.setPauseButton(!shell.visible && session.soundMenuAvailable);
    runQueuedFrameActions();
  });
  // Render only when the picture can have changed (port addition, for phones and 120 Hz screens):
  // the game changes only on its 32 Hz logic ticks. Screens, fades and a stopped loop (debug
  // stepping) render every frame.
  let renderedStep = -1;
  app.ticker.remove(app.render, app);
  app.ticker.add(
    () => {
      const loop = session.gameLoop;
      if (forceRender || shell.visible || !loop.isRunning || loop.stepCount !== renderedStep) {
        forceRender = false;
        renderedStep = loop.stepCount;
        app.render();
      }
    },
    null,
    UPDATE_PRIORITY.LOW,
  );
  /** Leaves the menu for the game (the debug toolbar plays without the menu). */
  const showGame = () => {
    if (!shell.visible) return;
    shell.hide();
    session.start();
  };
  // The settings page (the site's "Options"): the next game reads them
  shell.settings = { ...session.settings };
  shell.onSettings = (settings) => session.setSettings(settings);
  // The player's own keys and buttons (G.4), from the settings page's controls page
  const applyBindings = () => {
    input.setMoveKeys(bindingKeys(shell.bindings), shell.bindings.pad);
    showHelpKeys(shell.bindings, dataStore.langId);
    applyPageText(pickLang(dataStore.langId, []));
  };
  shell.bindings = loadBindings();
  applyBindings();
  shell.onBindings = (b) => {
    saveBindings(b);
    applyBindings();
    showDevice();
  };
  // Port addition: the sound panel over the paused game (the pause's button, O or R1). The game
  // stops while it shows, and the key that closes it does not reach the game.
  const openSound = () => {
    if (shell.visible || !session.soundMenuAvailable) return;
    const wasRunning = session.gameLoop.isRunning;
    session.gameLoop.stop();
    shell.setPauseButton(false);
    shell.settings = { ...session.settings };
    shell.showSound(() => {
      input.lockHeld();
      if (wasRunning) session.gameLoop.start();
    });
  };
  session.onSoundMenu = openSound;
  shell.onPauseSound = openSound;
  shell.onStart = (mode) => {
    // The menu dissolves into the first level (no "click to start": `Loader.startNow`)
    shell.fadeOut(() => session.levelShown);
    session.start();
    // The site's start query answers with the profile's families; the page sent the options.
    // The Learning mode's page sent none (`try.html`), and the game takes the system families
    session.setParameters(
      profile.familiesParam,
      mode === 'tutorial' ? '' : profile.optionsParam(mode),
    );
    session.startNow(mode);
  };
  canvasContainer?.addEventListener('pointerdown', () => session.clickStart());
  // The Loader is done (score saved, or the end of the set): the results replace the game
  session.onGameResult = (result) => {
    session.stop();
    // The free modes leave for the site's `$out` with nothing to show: back to the menu
    if (result.kind === 'exitGame' && result.url === session.out) {
      shell.showMenu();
      return;
    }
    // Only Adventure games started from the menu count for the profile (site guide, section 4).
    // The co-op mode is the Adventure for two and sends its items too (`MultiCoop.saveScore`),
    // and the boss rush sends the Adventure's (`BossRush` keeps `Adventure.saveScore`; counting
    // them is the maintainer's call, 2026-11-12)
    const counts =
      session.siteMode === 'solo' ||
      session.siteMode === 'multicoop' ||
      session.siteMode === 'bossrush';
    const record = counts ? profile.recordGame(result) : null;
    // A Time Attack game sends a time and its run (`TimeAttack.saveScore`); one the menu
    // started may set the best time
    const timed =
      result.kind === 'gameOver' &&
      result.runId !== null &&
      (session.mode === 'timeattack' || session.mode === 'multitime');
    const time = timed
      ? profile.timeResult(
          session.mode,
          result.runId!,
          result.score,
          session.siteMode === session.mode,
        )
      : null;
    shell.showResult(result, record, time);
  };
  (window as any).profile = profile;
  (window as any).shell = shell;
  (window as any).gameSession = session;
  (window as any).pixiApp = app;
  (window as any).gameLib = lib;

  // A hidden tab pauses the game (the pause screen of P) and silences the sound. Port
  // addition: the Flash game kept running behind other tabs.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      session.requestPause();
      audio.setSuspended(true);
    } else {
      audio.setSuspended(false);
    }
  });

  // Initialize Debug Toolkit
  const debugToolkit = new DebugToolkit(session, document.body);
  (window as any).debugToolkit = debugToolkit;

  // Developer tools (level select, restart, debug, Flash comparison, the original's dev keys)
  // stay hidden unless switched on in the help dialog or with `?dev`; the choice is remembered.
  const devToggle = document.getElementById('dev-toggle') as HTMLInputElement | null;
  const setDev = (on: boolean) => {
    document.body.classList.toggle('dev', on);
    session.fl_debug = on; // the original's dev keys
    if (devToggle) devToggle.checked = on;
    try {
      localStorage.setItem('hammerfenix.dev', on ? '1' : '0');
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  };
  let devOn = new URLSearchParams(location.search).has('dev');
  try {
    devOn ||= localStorage.getItem('hammerfenix.dev') === '1';
  } catch {
    // ignore
  }
  setDev(devOn);
  devToggle?.addEventListener('change', () => setDev(devToggle.checked));

  // 6. Connect UI Toolbar Controls
  const levelSetSelect = document.getElementById('levelset-select') as HTMLSelectElement;
  const levelInput = document.getElementById('level-input') as HTMLInputElement;
  const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
  const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
  const btnMute = document.getElementById('btn-mute') as HTMLButtonElement;
  const langSelect = document.getElementById('lang-select') as HTMLSelectElement;
  const btnOpenSymbols = document.getElementById('btn-open-symbols') as HTMLButtonElement;
  const btnOpenDebug = document.getElementById('btn-open-debug') as HTMLButtonElement;
  const btnOpenCompare = document.getElementById('btn-open-compare') as HTMLButtonElement;
  const btnOpenAbout = document.getElementById('btn-open-about') as HTMLButtonElement;
  const footerAboutLink = document.getElementById('footer-about-link') as HTMLButtonElement;

  // Populate level sets
  if (levelSetSelect) {
    levelSetSelect.innerHTML = '';
    for (const name of dataStore.manifest.levelSets) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      if (name === 'adventure') opt.selected = true;
      levelSetSelect.appendChild(opt);
    }

    levelSetSelect.addEventListener('change', async () => {
      const setName = levelSetSelect.value;
      showGame();
      await session.changeSet(setName, 0);
      if (levelInput) {
        levelInput.value = '0';
        levelInput.max = String(Math.max(0, session.game.world.set.levels.length - 1));
      }
    });
  }

  // Level number input
  if (levelInput) {
    levelInput.max = String(Math.max(0, session.game.world.set.levels.length - 1));
    levelInput.addEventListener('change', () => {
      const lvl = parseInt(levelInput.value, 10);
      if (!Number.isNaN(lvl)) {
        showGame();
        session.changeLevel(lvl);
      }
    });
  }

  // Restart, Pause, Mute buttons
  btnRestart?.addEventListener('click', () => {
    showGame();
    session.restartLevel();
  });

  btnPause?.addEventListener('click', () => {
    session.game.togglePause();
  });

  /** The page's texts and the sound button, in the current language. */
  const lang = () => pickLang(dataStore.langId, []);
  const showMute = () => {
    const muted = audio.isMuted;
    btnMute?.classList.toggle('muted', muted);
    btnMute?.setAttribute('aria-pressed', String(muted));
    btnMute?.setAttribute('data-i18n-label', muted ? 'soundOff' : 'soundOn');
    applyPageText(lang());
  };
  audio.setMuted(session.savedMuted);
  showMute();

  btnMute?.addEventListener('click', () => {
    audio.toggleMute();
    session.saveSettings();
    showMute();
  });

  // Language selector
  if (langSelect) langSelect.value = dataStore.langId;
  langSelect?.addEventListener('change', async () => {
    await dataStore.setLang(langSelect.value);
    session.saveSettings();
    showHelpKeys(shell.bindings, dataStore.langId);
    showDevice();
    applyPageText(lang());
    shell.refresh();
  });

  // Dialog & Debug open triggers
  btnOpenDebug?.addEventListener('click', () => {
    debugToolkit.toggle();
  });

  btnOpenCompare?.addEventListener('click', () => {
    originalCompare.open();
  });

  btnOpenSymbols?.addEventListener('click', () => {
    symbolBrowser.open();
  });

  btnOpenAbout?.addEventListener('click', () => {
    aboutDialog?.showModal();
  });

  footerAboutLink?.addEventListener('click', () => {
    aboutDialog?.showModal();
  });

  // 7. Wire up session events
  session.onLevelChange = (lvl, setName) => {
    if (levelInput) levelInput.value = String(lvl);
    if (levelSetSelect && levelSetSelect.value !== setName) {
      levelSetSelect.value = setName;
    }
    document.title = document.body.classList.contains('dev')
      ? `Level ${lvl} (${setName}) — HammerFenix`
      : pageText(lang(), 'pageTitle');
  };

  session.onStateChange = (state) => {
    if (btnPause) {
      const pauseText = btnPause.querySelector('.btn-text');
      if (pauseText) pauseText.textContent = state.isPaused ? 'Resume' : 'Pause';
    }
  };

  // 8. Controllers (roadmap G.1): the screens show the buttons of the device in use
  const notice = new PadNotice();
  const showDevice = () => {
    document.documentElement.dataset.input = input.device;
    const layout = input.padLayout;
    document.querySelectorAll<HTMLElement>('kbd[data-pad]').forEach((el) => {
      const b = el.dataset.pad as PadButton;
      const icon = padIconHtml(b, layout, 22);
      el.classList.toggle('icon', icon !== null);
      if (icon) el.innerHTML = icon;
      else el.textContent = padLabel(b, layout);
      el.title = padLabel(b, layout);
    });
  };
  showDevice();
  input.onDeviceChange = () => {
    showDevice();
    shell.refresh();
  };
  input.onPadConnect = () => {
    showDevice();
    notice.show(pageText(lang(), 'padConnected'));
  };
  // Unplugged during a game: the game pauses
  input.onPadDisconnect = () => {
    const playing = session.loader.gameRunning && !session.game.fl_pause;
    if (playing) session.requestPause();
    notice.show(pageText(lang(), playing ? 'padLostPaused' : 'padLost'));
  };
  // In a dialog: A, B or Start close it (as Escape does), the D-pad scrolls it
  input.onDialogPad = (action) => {
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (!dialog) return;
    if (action === 'ok' || action === 'back') dialog.close();
    const body = dialog.querySelector('.dialog-body');
    if (action === 'up') body?.scrollBy({ top: -80, behavior: 'smooth' });
    if (action === 'down') body?.scrollBy({ top: 80, behavior: 'smooth' });
  };

  // 9. Bind On-Screen Touch Controls
  const bindTouch = (id: string, action: ControlAction) => {
    const el = document.getElementById(id);
    if (!el) return;

    const start = (e: Event) => {
      e.preventDefault();
      el.classList.add('active');
      input.setTouch(action, true);
    };

    const end = (e: Event) => {
      e.preventDefault();
      el.classList.remove('active');
      input.setTouch(action, false);
    };

    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  bindDpad(input, {
    'touch-left': 'left',
    'touch-right': 'right',
    'touch-down': 'down',
  });
  bindTouch('touch-jump', 'jump');
  bindTouch('touch-bomb', 'attack');
}

/**
 * The D-pad follows the finger: sliding from one arrow to another switches the key without
 * lifting, as on a game pad (a touch otherwise stays on the button it started on). A thumb that
 * drifts off the arrows (or over a gap) keeps its key until it lifts or reaches another arrow.
 */
function bindDpad(input: InputController, buttons: Record<string, ControlAction>): void {
  const els = new Map<HTMLElement, ControlAction>();
  for (const [id, action] of Object.entries(buttons)) {
    const el = document.getElementById(id);
    if (el) els.set(el, action);
  }
  /** The button each finger is on. */
  const held = new Map<number, HTMLElement | null>();
  const buttonAt = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.dpad-btn') ?? null;
    return el && els.has(el) ? el : null;
  };
  const isHeld = (el: HTMLElement) => [...held.values()].includes(el);
  const moveTo = (id: number, el: HTMLElement | null) => {
    const prev = held.get(id) ?? null;
    if (prev === el) return;
    held.set(id, el);
    if (prev && !isHeld(prev)) {
      prev.classList.remove('active');
      input.setTouch(els.get(prev)!, false);
    }
    if (el) {
      el.classList.add('active');
      input.setTouch(els.get(el)!, true);
    }
  };
  const end = (e: PointerEvent) => {
    if (!held.has(e.pointerId)) return;
    moveTo(e.pointerId, null);
    held.delete(e.pointerId);
  };
  for (const el of els.keys()) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Touch pointers are captured by the button they start on: free them to follow the finger
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      moveTo(e.pointerId, el);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  window.addEventListener('pointermove', (e) => {
    if (!held.has(e.pointerId)) return;
    const el = buttonAt(e.clientX, e.clientY);
    if (el) moveTo(e.pointerId, el);
  });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/**
 * Marks the page as a touch screen (`html.touch`): the touch controls show and the screens
 * drop their keyboard hints. On from the start on phones and tablets, and on a computer once
 * its screen is touched.
 */
function initTouch(): void {
  const root = document.documentElement;
  const coarse = window.matchMedia?.('(hover: none) and (pointer: coarse)');
  root.classList.toggle('touch', coarse?.matches ?? false);
  window.addEventListener(
    'touchstart',
    () => {
      if (!root.classList.contains('touch')) root.classList.add('touch');
    },
    { passive: true },
  );
}

/** A short notice over the game frame when a controller is plugged in or unplugged. */
class PadNotice {
  private readonly el = document.getElementById('pad-notice');
  private timer = 0;

  show(text: string): void {
    if (!this.el) return;
    this.el.textContent = text;
    this.el.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el?.classList.remove('show'), 2500);
  }
}

/** The loading screen over the game frame, until the menu shows (`#loading`). */
class LoadingScreen {
  private readonly el = document.getElementById('loading');
  private readonly fill = document.getElementById('loading-fill');

  progress(f: number): void {
    if (this.fill) this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
  }

  done(): void {
    this.progress(1);
    this.el?.classList.add('done');
    window.setTimeout(() => this.el?.remove(), 600);
  }

  failed(): void {
    this.el?.classList.add('failed');
    const lang = pickLang(GameSession.savedLang(), navigator.languages ?? []);
    const text = this.el?.querySelector('.loading-text');
    if (text) text.textContent = pageText(lang, 'loadError');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  main().catch((err) => {
    console.error('Fatal initialization error:', err);
    new LoadingScreen().failed();
  });
});
