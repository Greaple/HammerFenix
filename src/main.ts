import { Application } from 'pixi.js';
import { AudioEngine } from './engine/Audio';
import { InputController, type ControlAction } from './engine/Input';
import { SwfLibrary } from './engine/swf/SwfLibrary';
import { GameDataStore } from './game/Data';
import { GameSession } from './game/GameSession';
import { SymbolBrowser } from './ui/SymbolBrowser';
import { DebugToolkit } from './ui/DebugToolkit';
import { OriginalCompareDialog } from './ui/OriginalCompareDialog';
import { SitePage } from './ui/SitePage';
import './site.css';

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

  const baseUrl = import.meta.env.BASE_URL || './';

  // 1. Create PixiJS application (420 x 520 virtual resolution)
  const app = new Application();
  await app.init({
    width: 420,
    height: 520,
    backgroundColor: 0x000000,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  const canvasContainer = document.getElementById('game-canvas-container');
  if (canvasContainer) {
    canvasContainer.appendChild(app.canvas);
  }

  // 2. Load game data and assets in parallel
  const [dataStore, lib] = await Promise.all([
    GameDataStore.load(baseUrl, 'en'),
    SwfLibrary.load(baseUrl),
  ]);

  // 3. Initialize Audio & Input engines
  const audio = new AudioEngine(SOUNDS, baseUrl);
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

  // 5. Create GameSession. The site page (mode menu) shows first, as on hammerfest.fr.
  const session = await GameSession.create(app, lib, dataStore, audio, input, 'adventure');
  const gameWrapper = document.getElementById('game-wrapper') as HTMLElement;
  const site = new SitePage(gameWrapper.parentElement!, dataStore.langId, dataStore);
  gameWrapper.hidden = true;
  /** Leaves the site page for the game (the debug toolbar plays without the menu). */
  const showGame = () => {
    if (!site.visible) return;
    site.hide();
    gameWrapper.hidden = false;
    session.start();
  };
  site.onStart = (mode) => {
    showGame();
    session.gameReady(mode);
  };
  canvasContainer?.addEventListener('pointerdown', () => session.clickStart());
  // The Loader is done (score saved, or the end of the set): the site shows the results
  session.onGameResult = (result) => {
    session.stop();
    gameWrapper.hidden = true;
    site.showResult(result);
  };
  (window as any).sitePage = site;
  (window as any).gameSession = session;
  (window as any).pixiApp = app;
  (window as any).gameLib = lib;

  // Initialize Debug Toolkit
  const debugToolkit = new DebugToolkit(session, document.body);
  (window as any).debugToolkit = debugToolkit;

  // 6. Connect UI Toolbar Controls
  const levelSetSelect = document.getElementById('levelset-select') as HTMLSelectElement;
  const levelInput = document.getElementById('level-input') as HTMLInputElement;
  const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
  const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
  const btnMute = document.getElementById('btn-mute') as HTMLButtonElement;
  const muteIcon = document.getElementById('mute-icon') as HTMLElement;
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
        levelInput.max = String(Math.max(0, session.world.set.levels.length - 1));
      }
    });
  }

  // Level number input
  if (levelInput) {
    levelInput.max = String(Math.max(0, session.world.set.levels.length - 1));
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
    session.togglePause();
  });

  btnMute?.addEventListener('click', () => {
    const isMuted = audio.toggleMute();
    if (muteIcon) muteIcon.textContent = isMuted ? '🔇' : '🔊';
  });

  // Language selector
  langSelect?.addEventListener('change', async () => {
    await dataStore.setLang(langSelect.value);
    site.setLang(langSelect.value);
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
    document.title = `Level ${lvl} (${setName}) — HammerFenix`;
  };

  session.onStateChange = (state) => {
    if (btnPause) {
      const pauseText = btnPause.querySelector('.btn-text');
      if (pauseText) pauseText.textContent = state.isPaused ? 'Resume' : 'Pause';
    }
  };

  // 8. Bind On-Screen Touch Controls
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

  bindTouch('touch-left', 'left');
  bindTouch('touch-right', 'right');
  bindTouch('touch-up', 'jump');
  bindTouch('touch-down', 'down');
  bindTouch('touch-jump', 'jump');
  bindTouch('touch-bomb', 'attack');
}

window.addEventListener('DOMContentLoaded', () => {
  main().catch((err) => {
    console.error('Fatal initialization error:', err);
  });
});
