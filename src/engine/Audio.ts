/**
 * Web Audio multi-channel sound manager matching `mtypes/lib/SoundManager.mt`
 * and Hammerfest's `Data.CHAN_*` channels (`CHAN_MUSIC = 0`, `CHAN_BOMB = 1`, etc.).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private readonly urls = new Map<string, string>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly channelSources = new Map<number, AudioBufferSourceNode>();
  private currentMusicName: string | null = null;

  private muted = false;
  private sfxVol = 0.7;
  private musicVol = 0.45;
  /** `Mode.setMusicVolume`: the game's own music level (0 muted by M, 0.5 paused, 1). */
  private musicLevel = 1;

  constructor(sounds: Record<string, string>, baseUrl = './') {
    for (const [name, rel] of Object.entries(sounds)) {
      this.urls.set(name, `${baseUrl}${rel}`);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(m ? 0 : 1, this.ctx.currentTime);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVol = Math.max(0, Math.min(1, sfx));
    this.musicVol = Math.max(0, Math.min(1, music));
    this.applyVolumes();
  }

  /** The music's level from the game (`Mode.setMusicVolume`), times the music volume. */
  setMusicLevel(n: number): void {
    this.musicLevel = Math.max(0, Math.min(1, n));
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (this.ctx && this.sfxGain && this.musicGain) {
      this.sfxGain.gain.setValueAtTime(this.sfxVol, this.ctx.currentTime);
      this.musicGain.gain.setValueAtTime(this.musicVol * this.musicLevel, this.ctx.currentTime);
    }
  }

  /** Unlocks the Web Audio context after a user gesture. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().then(() => {
        if (this.currentMusicName && !this.channelSources.has(0)) {
          this.playMusic(this.currentMusicName);
        }
      });
    }
  }

  playSound(name: string, channel = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') {
      void this.loadBuffer(name);
      return;
    }

    const buf = this.buffers.get(name);
    if (buf) {
      this.startSource(buf, channel, false);
    } else {
      void this.loadBuffer(name).then((loaded) => {
        if (loaded && this.ctx?.state === 'running') {
          this.startSource(loaded, channel, false);
        }
      });
    }
  }

  playMusic(name: string): void {
    if (this.currentMusicName === name && this.channelSources.has(0)) return;
    this.currentMusicName = name;
    this.stopChannel(0);

    const ctx = this.ensureContext();
    if (!ctx) return;

    void this.loadBuffer(name).then((buf) => {
      if (!buf || this.currentMusicName !== name) return;
      if (this.ctx?.state === 'running') {
        this.startSource(buf, 0, true);
      }
    });
  }

  stopMusic(): void {
    this.currentMusicName = null;
    this.stopChannel(0);
  }

  stopChannel(channel: number): void {
    const prev = this.channelSources.get(channel);
    if (prev) {
      try {
        prev.stop();
      } catch {
        // Already stopped
      }
      this.channelSources.delete(channel);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;

    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.masterGain.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVol;
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol * this.musicLevel;
    this.musicGain.connect(this.masterGain);
    return this.ctx;
  }

  private startSource(buffer: AudioBuffer, channel: number, loop: boolean): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    // Monophonic per channel (matches Flash SoundManagerChannel behavior).
    this.stopChannel(channel);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(channel === 0 ? this.musicGain : this.sfxGain);
    src.onended = () => {
      if (this.channelSources.get(channel) === src) {
        this.channelSources.delete(channel);
      }
    };
    this.channelSources.set(channel, src);
    src.start(0);
  }

  private async loadBuffer(name: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(name)) return this.buffers.get(name)!;
    if (this.loading.has(name)) return this.loading.get(name)!;

    const url = this.urls.get(name);
    const ctx = this.ensureContext();
    if (!url || !ctx) return null;

    const promise = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        this.buffers.set(name, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.loading.delete(name);
      }
    })();

    this.loading.set(name, promise);
    return promise;
  }
}
