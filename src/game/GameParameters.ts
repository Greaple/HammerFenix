/**
 * The player's settings the site passed as flash variables ("Paramètres" page). The defaults
 * are the ones the site's pages wrote (`try.html`, `soccer.html`): volume 100, sound and music on.
 * `$detail` and `$shake` are not ported yet.
 */
export interface SoundSettings {
  /** `$volume`, 0 to 100 */
  volume: number;
  /** `$sound`: sound effects on (1) or off (0) */
  sound: number;
  /** `$music`: music on (1) or off (0) */
  music: number;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { volume: 100, sound: 1, music: 1 };

/**
 * Port of `GameParameters` (`class/hammer/GameParameters.mt`): the `$families` and `$options`
 * the site gave the game, and the volumes from the player's settings. Not ported yet:
 * `$detail` (`setLowDetails`) and `$shake`.
 */
export class GameParameters {
  /** The families as received, comma separated (`families`). */
  readonly families: string[];
  readonly specialItemFamilies: number[] = [];
  readonly scoreItemFamilies: number[] = [];
  private readonly options = new Map<string, boolean>();
  /** For `toString()` and the replays only. */
  readonly optionList: string[] = [];
  readonly generalVolume: number;
  /** Sound effects volume, 0 to 0.5 (`GameManager` multiplies it by 100). */
  readonly soundVolume: number;
  /** Music volume, 0 to 0.325. */
  readonly musicVolume: number;
  /** The Loader downloads the musics only when `$music` is not 0. */
  private readonly fl_musicLoaded: boolean;

  constructor(f: string, opt: string, settings: SoundSettings = DEFAULT_SOUND_SETTINGS) {
    // Game options (mirror, nightmare...)
    if (opt.length > 0) {
      this.optionList = opt.split(',');
      for (const o of this.optionList) this.options.set(o, true);
    }

    // Families
    this.families = f.split(',');
    for (const s of this.families) {
      const id = parseInt(s, 10);
      if (id >= 1000) this.scoreItemFamilies.push(id);
      else this.specialItemFamilies.push(id);
    }

    // Misc data
    this.generalVolume = (settings.volume * 0.5) / 100;
    this.soundVolume = settings.sound * this.generalVolume;
    this.musicVolume = settings.music * this.generalVolume * 0.65;
    this.fl_musicLoaded = settings.music !== 0;
  }

  /** True if the family `id` is unlocked. */
  hasFamily(id: number): boolean {
    return this.specialItemFamilies.includes(id) || this.scoreItemFamilies.includes(id);
  }

  /** True if the option is on. */
  hasOption(oid: string): boolean {
    return this.options.get(oid) === true;
  }

  /** `hasMusic`: `manager.musics[0] != null`, the Loader downloaded the musics. */
  hasMusic(): boolean {
    return this.fl_musicLoaded;
  }

  toString(): string {
    return (
      `fam=${this.families.join(', ')}\nopt=${this.optionList.join('\n  ')}\n` +
      `mus=${this.musicVolume}\nsnd=${this.soundVolume}\n`
    );
  }
}

/**
 * `GameManager` constructor: the families of the tutorial and of a game started with no site
 * (`Loader.BASE_SCRIPT_URL == null`), logged as "using sysfam". The Ruffle side-by-side runs the
 * original this way.
 */
export const SYSTEM_FAMILIES = '0,7,1000,18';
