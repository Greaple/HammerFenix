import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Data } from '../src/game/Data';
import { ClassicBomb } from '../src/game/entity/Bomb';
import {
  DEFAULT_SETTINGS,
  GameParameters,
  loadSettings,
  type PlayerSettings,
  saveSettings,
  SETTINGS_KEY,
  SYSTEM_FAMILIES,
} from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

/** A `Storage` in memory. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const LOW: PlayerSettings = { ...DEFAULT_SETTINGS, detail: 0, shake: 0 };

describe('settings storage (2C.5)', () => {
  it('starts with the site defaults: volume 100, everything on', () => {
    expect(loadSettings(memoryStorage())).toEqual({
      volume: 100,
      sound: 1,
      music: 1,
      detail: 1,
      shake: 1,
    });
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and reads them back', () => {
    const st = memoryStorage();
    const s = { volume: 40, sound: 0, music: 1, detail: 0, shake: 1 };
    saveSettings(s, st);
    expect(loadSettings(st)).toEqual(s);
  });

  it('keeps the defaults for broken or out of range values', () => {
    const st = memoryStorage();
    st.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
    st.setItem(SETTINGS_KEY, JSON.stringify({ volume: 250, sound: 'yes', music: 0, detail: 2 }));
    expect(loadSettings(st)).toEqual({ ...DEFAULT_SETTINGS, volume: 100, music: 0 });
  });
});

describe('GameParameters settings', () => {
  it('reads $detail and $shake', () => {
    const on = new GameParameters(SYSTEM_FAMILIES, '');
    expect([on.fl_detail, on.fl_shaky, on.MAX_FX]).toEqual([true, true, Data.MAX_FX]);
    const off = new GameParameters(SYSTEM_FAMILIES, '', LOW);
    expect([off.fl_detail, off.fl_shaky]).toEqual([false, false]);
  });

  it('halves MAX_FX in low details (setLowDetails)', () => {
    const off = new GameParameters(SYSTEM_FAMILIES, '', LOW);
    expect(off.MAX_FX).toBe(8);
    expect(Data.MAX_FX).toBe(16);
  });

  it('scales the volumes as the original', () => {
    const c = new GameParameters(SYSTEM_FAMILIES, '', { ...DEFAULT_SETTINGS, volume: 40 });
    expect(c.soundVolume).toBeCloseTo(0.2);
    expect(c.musicVolume).toBeCloseTo(0.13);
  });
});

describe('what the settings turn off in a game', () => {
  let s: GameSession;
  beforeAll(async () => {
    s = await createHeadlessSession();
  });

  function start(settings: PlayerSettings): void {
    s.setParameters(SYSTEM_FAMILIES, '', settings);
    s.startGame(1, 1234);
    for (let i = 0; i < 60; i++) s.gameLoop.stepSingleFrame();
    s.game.destroyList(Data.FX);
  }

  it('low details: no dust and no bouncing particles (FxManager.dust, inGameParticles)', () => {
    start(DEFAULT_SETTINGS);
    s.game.fxMan.dust(10, 10);
    s.game.fxMan.inGameParticles(Data.PARTICLE_ICE, 100, 100, 3);
    expect(s.game.getList(Data.FX).length).toBeGreaterThan(0);

    start(LOW);
    const draws = s.rand.next();
    start(LOW);
    s.game.fxMan.dust(10, 10);
    s.game.fxMan.inGameParticles(Data.PARTICLE_ICE, 100, 100, 3);
    expect(s.game.getList(Data.FX)).toHaveLength(0);
    // and no random draws either
    expect(s.rand.next()).toBe(draws);
  });

  it('no shaking: the classic bomb does not shake the screen', () => {
    const shakeOf = () => (s.game as unknown as { shakeTimer: number }).shakeTimer;
    start(DEFAULT_SETTINGS);
    ClassicBomb.attach(s.game, 200, 200).onExplode();
    expect(shakeOf()).toBeGreaterThan(0);

    start({ ...DEFAULT_SETTINGS, shake: 0 });
    ClassicBomb.attach(s.game, 200, 200).onExplode();
    expect(shakeOf()).toBe(0);
  });

  it('the lag manager waits for a running loop (never headless)', () => {
    start(DEFAULT_SETTINGS);
    s.gameLoop.frameRate = 10;
    for (let i = 0; i < Data.SECOND * 31; i++) s.gameLoop.stepSingleFrame();
    expect(s.config.fl_detail).toBe(true);
    s.gameLoop.frameRate = 40;
  });

  it('a replay keeps low details and no shaking, as they change the random draws', async () => {
    s.setSettings(LOW);
    s.setParameters(SYSTEM_FAMILIES, '');
    s.startRecording(1);
    for (let i = 0; i < 10; i++) s.gameLoop.stepSingleFrame();
    const replay = s.stopRecording()!;
    expect([replay.detail, replay.shake]).toEqual([0, 0]);

    s.setSettings(DEFAULT_SETTINGS);
    await s.playReplay(replay);
    expect([s.config.fl_detail, s.config.fl_shaky]).toEqual([false, false]);
    await s.playReplay({ ...replay, detail: undefined, shake: undefined });
    expect([s.config.fl_detail, s.config.fl_shaky]).toEqual([true, true]);
  });
});

describe('sound during a game (port additions)', () => {
  let s: GameSession;
  beforeAll(async () => {
    s = await createHeadlessSession();
  });

  function start(settings: PlayerSettings = DEFAULT_SETTINGS): void {
    s.setSettings(settings);
    s.setParameters(SYSTEM_FAMILIES, '');
    s.startGame(1, 1234);
    for (let i = 0; i < 60; i++) s.gameLoop.stepSingleFrame();
  }

  function tap(action: 'music'): void {
    s.input.setTouch(action, true);
    s.gameLoop.stepSingleFrame();
    s.input.setTouch(action, false);
    s.gameLoop.stepSingleFrame();
  }

  it('applies the volume and the sound at once, details and shaking at the next game', () => {
    start();
    s.game.onPause();
    const vol = vi.spyOn(s.audio, 'setVolume');
    s.setSettings({ ...DEFAULT_SETTINGS, volume: 80, detail: 0, shake: 0 });
    let v = new Map(vol.mock.calls);
    expect([v.get(Data.CHAN_PLAYER), v.get(Data.CHAN_BAD)]).toEqual([40, 30]);
    expect([s.config.fl_detail, s.config.fl_shaky]).toEqual([true, true]);
    s.setSettings({ ...DEFAULT_SETTINGS, sound: 0 });
    v = new Map(vol.mock.calls);
    expect(v.get(Data.CHAN_PLAYER)).toBe(0);
    vol.mockRestore();
    s.setSettings(DEFAULT_SETTINGS);
  });

  it('stops the music when switched off, and starts the asked track again when on', () => {
    start();
    s.game.onPause();
    expect(s.game.fl_music).toBe(true);
    const stop = vi.spyOn(s.audio, 'stopMusic');
    s.setSettings({ ...DEFAULT_SETTINGS, music: 0 });
    expect(stop).toHaveBeenCalled();
    expect(s.game.fl_music).toBe(false);
    const play = vi.spyOn(s.audio, 'playMusic');
    const musicVol = vi.spyOn(s.audio, 'setMusicVolume');
    s.setSettings(DEFAULT_SETTINGS);
    expect(s.game.fl_music).toBe(true);
    expect(play).toHaveBeenCalledWith('music_ingame');
    // still paused: half the music volume
    expect(musicVol).toHaveBeenLastCalledWith(16);
    stop.mockRestore();
    play.mockRestore();
    musicVol.mockRestore();
  });

  it('M mutes and unmutes the music in play', () => {
    start();
    const musicVol = vi.spyOn(s.audio, 'setMusicVolume');
    tap('music');
    expect(s.game.fl_mute).toBe(true);
    expect(musicVol).toHaveBeenLastCalledWith(0);
    tap('music');
    expect(s.game.fl_mute).toBe(false);
    expect(musicVol).toHaveBeenLastCalledWith(33);
    musicVol.mockRestore();
  });

  it('the top bar switch sets both of the game switches, and follows them', () => {
    start();
    s.setMuted(false);
    const musicVol = vi.spyOn(s.audio, 'setMusicVolume');
    s.setMuted(true);
    expect([s.game.fl_mute, s.audio.effectsMuted]).toEqual([true, true]);
    expect(musicVol).toHaveBeenLastCalledWith(0);
    s.setMuted(false);
    expect([s.musicOn, s.effectsOn]).toEqual([true, true]);
    expect(musicVol).toHaveBeenLastCalledWith(33);
    // The toolbar's two switches: muted once both are off
    s.setMusicOn(false);
    s.syncMuted();
    expect(s.muted).toBe(false);
    s.setEffectsOn(false);
    s.syncMuted();
    expect(s.muted).toBe(true);
    // M turns the music back on: no longer muted
    tap('music');
    s.syncMuted();
    expect([s.musicOn, s.muted]).toEqual([true, false]);
    musicVol.mockRestore();
    s.setMuted(false);
  });

  it('the toolbar music switch works on the pause screen, at half volume', () => {
    start();
    s.game.onPause();
    const musicVol = vi.spyOn(s.audio, 'setMusicVolume');
    s.setMusicOn(false);
    expect(musicVol).toHaveBeenLastCalledWith(0);
    s.setMusicOn(true);
    expect(musicVol).toHaveBeenLastCalledWith(16);
    musicVol.mockRestore();
  });

  it('a new game starts from the top bar switch, not from the last game switches', () => {
    s.setMuted(true);
    const musicVol = vi.spyOn(s.audio, 'setMusicVolume');
    const play = vi.spyOn(s.audio, 'playMusic');
    start();
    expect([s.game.fl_mute, s.audio.effectsMuted]).toEqual([true, true]);
    // The music plays, silent from its first note: every volume set from its start on is 0
    expect(s.game.fl_music).toBe(true);
    const started = play.mock.invocationCallOrder.at(-1)!;
    const after = musicVol.mock.calls.filter(
      (_, i) => musicVol.mock.invocationCallOrder[i] > started,
    );
    expect(after.length).toBeGreaterThan(0);
    expect(after.every(([v]) => v === 0)).toBe(true);
    musicVol.mockRestore();
    play.mockRestore();
    s.setMuted(false);
    s.setMusicOn(false);
    s.syncMuted();
    start();
    expect([s.game.fl_mute, s.audio.effectsMuted]).toEqual([false, false]);
  });
});
