import { beforeAll, describe, expect, it } from 'vitest';
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
    s.initGame(1, 1234);
    for (let i = 0; i < 60; i++) s.gameLoop.stepSingleFrame();
    s.destroyList(Data.FX);
  }

  it('low details: no dust and no bouncing particles (FxManager.dust, inGameParticles)', () => {
    start(DEFAULT_SETTINGS);
    s.fxMan.dust(10, 10);
    s.fxMan.inGameParticles(Data.PARTICLE_ICE, 100, 100, 3);
    expect(s.getList(Data.FX).length).toBeGreaterThan(0);

    start(LOW);
    const draws = s.rand.next();
    start(LOW);
    s.fxMan.dust(10, 10);
    s.fxMan.inGameParticles(Data.PARTICLE_ICE, 100, 100, 3);
    expect(s.getList(Data.FX)).toHaveLength(0);
    // and no random draws either
    expect(s.rand.next()).toBe(draws);
  });

  it('no shaking: the classic bomb does not shake the screen', () => {
    const shakeOf = () => (s as unknown as { shakeTimer: number }).shakeTimer;
    start(DEFAULT_SETTINGS);
    ClassicBomb.attach(s, 200, 200).onExplode();
    expect(shakeOf()).toBeGreaterThan(0);

    start({ ...DEFAULT_SETTINGS, shake: 0 });
    ClassicBomb.attach(s, 200, 200).onExplode();
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
