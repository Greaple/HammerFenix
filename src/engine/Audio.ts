/**
 * Web Audio port of `SoundManager` (`mtypes/lib/SoundManager.mt`, github.com/motion-twin/mtypes)
 * and of the music `Sound` objects that `Loader.mt` hands to `GameManager` (`musics`).
 *
 * As in Flash, a channel (`Data.CHAN_*`) only groups sounds under one volume: `playSound`
 * starts a new instance each time and never cuts the ones already playing (Flash `Sound.start`).
 * Flash Player plays at most 32 sounds at once and drops new ones past that (Ruffle's
 * `AudioManager.MAX_SOUNDS`). Volumes are Flash's, 0 to 100 (100 = full).
 *
 * Port additions: the page's sound switch (`setMuted`) and the pause of a hidden tab
 * (`setSuspended`). Files are fetched by `preload` (Flash had them in the SWF, and the Loader
 * downloaded the musics before the game) and decoded once a user gesture unlocks the audio.
 */
export class AudioEngine {
  /** Ruffle's `AudioManager.MAX_SOUNDS`. */
  static readonly MAX_SOUNDS = 32;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  /** One gain per channel: the channel clip's `vol_ctrl` sound. */
  private readonly channelGains = new Map<number, GainNode>();

  private readonly urls = new Map<string, string>();
  private readonly files = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();

  /** Every sound playing, with its channel (-1 for the music). */
  private readonly playing = new Map<AudioBufferSourceNode, number>();
  private musicSource: AudioBufferSourceNode | null = null;
  private currentMusicName: string | null = null;

  private muted = false;
  /** `unlock` started decoding the files. */
  private decoding = false;
  /** `SoundManagerChannel.vol`: 100 until `setVolume`. */
  private readonly channelVolumes = new Map<number, number>();
  /** The music `Sound`'s volume (`Sound.setVolume`). */
  private musicVolume = 100;

  constructor(sounds: Record<string, string>, baseUrl = './') {
    for (const [name, rel] of Object.entries(sounds)) {
      this.urls.set(name, `${baseUrl}${rel}`);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** The page's sound switch (port addition): silences everything. */
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

  /** `SoundManager.setVolume`: the volume (0 to 100) of every sound of a channel. */
  setVolume(chan: number, volume: number): void {
    this.channelVolumes.set(chan, volume);
    const g = this.channelGains.get(chan);
    if (g && this.ctx) g.gain.setValueAtTime(volume / 100, this.ctx.currentTime);
  }

  /** `musics[i].setVolume`: the music's volume (0 to 100). */
  setMusicVolume(volume: number): void {
    this.musicVolume = volume;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setValueAtTime(volume / 100, this.ctx.currentTime);
    }
  }

  /** Stops all sound while the page is hidden, and starts it again (`false`). */
  setSuspended(on: boolean): void {
    if (!this.ctx) return;
    if (on && this.ctx.state === 'running') void this.ctx.suspend();
    else if (!on && this.ctx.state !== 'running') this.resume();
  }

  /** Fetches every sound file, so they play on time once decoded. */
  preload(): void {
    for (const name of this.urls.keys()) void this.fetchFile(name);
  }

  /**
   * Unlocks the Web Audio context on a user gesture, and decodes the sounds. Called on every
   * gesture: the browser may refuse the first ones (a touch only counts once the finger
   * lifts), and stops the audio again by itself (iOS, when the page leaves the screen).
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (!this.decoding) {
      this.decoding = true;
      for (const name of this.urls.keys()) void this.loadBuffer(name);
    }
    if (ctx.state !== 'running') this.resume();
  }

  private resume(): void {
    void this.ctx?.resume().catch(() => {});
  }

  /**
   * The music asked for while the audio was locked starts once it runs (`statechange`),
   * whichever gesture or return to the page unlocked it.
   */
  private onStateChange(): void {
    if (this.ctx?.state === 'running' && this.currentMusicName && !this.musicSource) {
      this.playMusic(this.currentMusicName);
    }
  }

  /** `SoundManager.playSound`: `start(0, 1)`, over the sounds already playing. */
  playSound(name: string, chan = 1): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') {
      void this.loadBuffer(name);
      return;
    }

    const buf = this.buffers.get(name);
    if (buf) {
      this.startSource(buf, chan, false);
    } else {
      void this.loadBuffer(name).then((loaded) => {
        if (loaded && this.ctx?.state === 'running') {
          this.startSource(loaded, chan, false);
        }
      });
    }
  }

  /** `SoundManager.stop`: stops every sound of a channel. */
  stop(chan: number): void {
    for (const [src, c] of this.playing) {
      if (c === chan) this.stopSource(src);
    }
  }

  /**
   * `musics[id].start(0, 99999)`, as `Mode.playMusicAt` calls it: the track starts from the
   * beginning, even when it is already playing.
   */
  playMusic(name: string): void {
    this.stopMusic();
    this.currentMusicName = name;

    const ctx = this.ensureContext();
    if (!ctx) return;

    void this.loadBuffer(name).then((buf) => {
      if (!buf || this.currentMusicName !== name || this.musicSource) return;
      if (this.ctx?.state === 'running') {
        this.musicSource = this.startSource(buf, -1, true);
      }
    });
  }

  /** `musics[id].stop()` */
  stopMusic(): void {
    this.currentMusicName = null;
    if (this.musicSource) this.stopSource(this.musicSource);
    this.musicSource = null;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;

    this.ctx = new AudioContext();
    this.ctx.addEventListener?.('statechange', () => this.onStateChange());
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.masterGain.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume / 100;
    this.musicGain.connect(this.masterGain);
    return this.ctx;
  }

  /** `SoundManager.getChannel`: the channel's gain, made on first use at volume 100. */
  private getChannel(chan: number): GainNode | null {
    if (!this.ctx || !this.masterGain) return null;
    let g = this.channelGains.get(chan);
    if (!g) {
      g = this.ctx.createGain();
      g.gain.value = (this.channelVolumes.get(chan) ?? 100) / 100;
      g.connect(this.masterGain);
      this.channelGains.set(chan, g);
    }
    return g;
  }

  private startSource(
    buffer: AudioBuffer,
    chan: number,
    loop: boolean,
  ): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    if (this.playing.size >= AudioEngine.MAX_SOUNDS) return null;
    const out = chan < 0 ? this.musicGain : this.getChannel(chan);
    if (!out) return null;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.connect(out);
    src.onended = () => {
      this.playing.delete(src);
      if (this.musicSource === src) this.musicSource = null;
    };
    this.playing.set(src, chan);
    src.start(0);
    return src;
  }

  private stopSource(src: AudioBufferSourceNode): void {
    this.playing.delete(src);
    try {
      src.stop();
    } catch {
      // Already stopped
    }
  }

  private fetchFile(name: string): Promise<ArrayBuffer | null> {
    let file = this.files.get(name);
    if (!file) {
      const url = this.urls.get(name);
      file = url
        ? fetch(url)
            .then((res) => (res.ok ? res.arrayBuffer() : null))
            .catch(() => null)
        : Promise.resolve(null);
      this.files.set(name, file);
    }
    return file;
  }

  private async loadBuffer(name: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(name)) return this.buffers.get(name)!;
    if (this.loading.has(name)) return this.loading.get(name)!;

    const ctx = this.ensureContext();
    if (!this.urls.has(name) || !ctx) return null;

    const promise = (async () => {
      try {
        const file = await this.fetchFile(name);
        if (!file) return null;
        // decodeAudioData detaches its input: decode a copy, the file stays cached
        const decoded = await ctx.decodeAudioData(file.slice(0));
        this.buffers.set(name, decoded);
        this.files.delete(name);
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
