import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/engine/Audio';
import { Data } from '../src/game/Data';
import { GameParameters, SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

/** Just enough of Web Audio to see which sounds play, on which gain, at which volume. */
class FakeNode {
  readonly gain = { value: 1, setValueAtTime: (v: number) => (this.gain.value = v) };
  out: FakeNode | null = null;
  connect(n: FakeNode): void {
    this.out = n;
  }
}

class FakeSource extends FakeNode {
  buffer: { name: string } | null = null;
  loop = false;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  end(): void {
    this.onended?.();
  }
}

class FakeContext {
  static last: FakeContext;
  state = 'running';
  currentTime = 0;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  constructor() {
    FakeContext.last = this;
  }
  createGain(): FakeNode {
    return new FakeNode();
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(buf: ArrayBuffer): Promise<{ name: string }> {
    return { name: new TextDecoder().decode(buf) };
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
}

const SOUNDS = { sound_bad_death: 'a.mp3', sound_pop: 'b.mp3', music_ingame: 'm.mp3' };

/** An engine with every sound decoded, on the fake context. */
async function makeEngine(): Promise<{ audio: AudioEngine; ctx: FakeContext }> {
  const audio = new AudioEngine(SOUNDS);
  audio.preload();
  audio.unlock();
  await new Promise((r) => setTimeout(r, 0));
  return { audio, ctx: FakeContext.last };
}

const playing = (ctx: FakeContext) => ctx.sources.filter((s) => s.started && !s.stopped);

describe('AudioEngine (SoundManager.mt)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(url).buffer,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays sounds of one channel over each other (Flash Sound.start)', async () => {
    const { audio, ctx } = await makeEngine();
    audio.playSound('sound_bad_death', Data.CHAN_BAD);
    audio.playSound('sound_bad_death', Data.CHAN_BAD);
    audio.playSound('sound_pop', Data.CHAN_BAD);
    expect(playing(ctx)).toHaveLength(3);
  });

  it('gives each channel its own volume, 100 until set', async () => {
    const { audio, ctx } = await makeEngine();
    audio.setVolume(Data.CHAN_BAD, 40);
    audio.playSound('sound_bad_death', Data.CHAN_BAD);
    audio.playSound('sound_pop', Data.CHAN_ITEM);
    const [bad, item] = playing(ctx);
    expect(bad.out!.gain.value).toBeCloseTo(0.4);
    expect(item.out!.gain.value).toBe(1);
    audio.setVolume(Data.CHAN_ITEM, 50);
    expect(item.out!.gain.value).toBeCloseTo(0.5);
  });

  it('plays at most 32 sounds at once, and drops the new ones', async () => {
    const { audio, ctx } = await makeEngine();
    for (let i = 0; i < 40; i++) audio.playSound('sound_pop', Data.CHAN_ITEM);
    expect(playing(ctx)).toHaveLength(AudioEngine.MAX_SOUNDS);
    playing(ctx)[0].end();
    audio.playSound('sound_pop', Data.CHAN_ITEM);
    expect(ctx.sources.filter((s) => s.started)).toHaveLength(33);
  });

  it('stop(chan) stops every sound of that channel only', async () => {
    const { audio, ctx } = await makeEngine();
    audio.playSound('sound_pop', Data.CHAN_ITEM);
    audio.playSound('sound_pop', Data.CHAN_ITEM);
    audio.playSound('sound_bad_death', Data.CHAN_BAD);
    audio.stop(Data.CHAN_ITEM);
    expect(playing(ctx).map((s) => s.buffer!.name)).toEqual(['./a.mp3']);
  });

  it('restarts the music when the same track is asked again (Mode.playMusicAt)', async () => {
    const { audio, ctx } = await makeEngine();
    audio.playMusic('music_ingame');
    await new Promise((r) => setTimeout(r, 0));
    audio.playMusic('music_ingame');
    await new Promise((r) => setTimeout(r, 0));
    const music = ctx.sources.filter((s) => s.loop);
    expect(music).toHaveLength(2);
    expect(music[0].stopped).toBe(true);
    expect(music[1].stopped).toBe(false);
  });
});

describe('volumes (GameParameters, GameManager, Mode.setMusicVolume)', () => {
  it('reads the site settings: volume 100, sound and music on', () => {
    const c = new GameParameters(SYSTEM_FAMILIES, '');
    expect(c.soundVolume).toBe(0.5);
    expect(c.musicVolume).toBeCloseTo(0.325);
    expect(c.hasMusic()).toBe(true);
    const off = new GameParameters(SYSTEM_FAMILIES, '', {
      volume: 60,
      sound: 0,
      music: 0,
      detail: 1,
      shake: 1,
    });
    expect(off.soundVolume).toBe(0);
    expect(off.hasMusic()).toBe(false);
  });

  describe('in a game', () => {
    let s: GameSession;
    beforeAll(async () => {
      s = await createHeadlessSession();
    });

    it('sets each channel at a new game, enemies and interface 10 lower', () => {
      const setVolume = vi.spyOn(s.audio, 'setVolume');
      s.setParameters(SYSTEM_FAMILIES, '');
      s.startGame(1, 1234);
      const vol = new Map(setVolume.mock.calls);
      expect(vol.get(Data.CHAN_PLAYER)).toBe(50);
      expect(vol.get(Data.CHAN_BOMB)).toBe(50);
      expect(vol.get(Data.CHAN_ITEM)).toBe(50);
      expect(vol.get(Data.CHAN_FIELD)).toBe(50);
      expect(vol.get(Data.CHAN_BAD)).toBe(40);
      expect(vol.get(Data.CHAN_INTERF)).toBe(40);
      setVolume.mockRestore();
    });

    it('plays the music at 33, 16 while paused, 0 when muted with M', () => {
      const setMusicVolume = vi.spyOn(s.audio, 'setMusicVolume');
      s.game.playMusicTrack(0);
      expect(setMusicVolume).toHaveBeenLastCalledWith(33);
      s.game.setMusicVolume(0.5);
      expect(setMusicVolume).toHaveBeenLastCalledWith(16);
      s.game.setMusicVolume(0);
      expect(setMusicVolume).toHaveBeenLastCalledWith(0);
      setMusicVolume.mockRestore();
    });
  });
});
