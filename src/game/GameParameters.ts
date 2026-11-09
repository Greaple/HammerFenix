import { Data } from './Data';

/**
 * The player's settings the site passed as flash variables (its "Options" page, guide section
 * 8). The defaults are the ones the site's pages wrote (`try.html`, `soccer.html`): volume
 * 100, sound and music on; and the guide's boxes, "Détails graphiques élevés" and
 * "Vibrations fréquentes", on.
 */
export interface PlayerSettings {
  /** `$volume`, 0 to 100 */
  volume: number;
  /** `$sound`: sound effects on (1) or off (0) */
  sound: number;
  /** `$music`: music on (1) or off (0) */
  music: number;
  /** `$detail`: high graphic details on (1) or off (0) */
  detail: number;
  /** `$shake`: frequent shaking on (1) or off (0) */
  shake: number;
}

export const DEFAULT_SETTINGS: Readonly<PlayerSettings> = {
  volume: 100,
  sound: 1,
  music: 1,
  detail: 1,
  shake: 1,
};

/** `localStorage` key of the settings (the site kept them on the server); a new format gets a new key. */
export const SETTINGS_KEY = 'hammerfenix_settings_v1';

/** The volume steps of the settings screen. */
export const VOLUME_STEP = 10;

/** The saved settings, each one checked, or the defaults. */
export function loadSettings(storage: Storage | null = defaultStorage()): PlayerSettings {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const data = JSON.parse(raw) as Partial<Record<keyof PlayerSettings, unknown>>;
    const v = data.volume;
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.volume = Math.max(0, Math.min(100, Math.round(v)));
    }
    for (const k of ['sound', 'music', 'detail', 'shake'] as const) {
      if (data[k] === 0 || data[k] === 1) out[k] = data[k];
    }
  } catch {
    // unreadable storage or data: the defaults
  }
  return out;
}

export function saveSettings(s: PlayerSettings, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore storage quota / sandbox write errors
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Port of `GameParameters` (`class/hammer/GameParameters.mt`): the `$families` and `$options`
 * the site gave the game, and the player's settings (volumes, details, shaking). Low details
 * halve `Data.MAX_FX`, which the original changes in place (`MAX_FX` here, as `Data` is
 * constant; the original reloaded the SWF for each game, so it never carried over). Not ported:
 * the stage `_quality` set to medium (Flash's 2x2 antialiasing and unsmoothed bitmaps).
 */
export class GameParameters {
  /** The families as received, comma separated (`families`). */
  readonly families: string[];
  readonly specialItemFamilies: number[] = [];
  readonly scoreItemFamilies: number[] = [];
  private readonly options = new Map<string, boolean>();
  /** For `toString()` and the replays only. */
  readonly optionList: string[] = [];
  generalVolume!: number;
  /** Sound effects volume, 0 to 0.5 (`GameManager` multiplies it by 100). */
  soundVolume!: number;
  /** Music volume, 0 to 0.325. */
  musicVolume!: number;
  /** High details: dust, bouncing particles, ice shards (`$detail`). */
  fl_detail: boolean;
  /** Shaking from bombs and frozen enemies hitting walls (`$shake`). */
  fl_shaky: boolean;
  /** `Data.MAX_FX`: at most this many particles at once, halved in low details. */
  MAX_FX: number = Data.MAX_FX;
  /** The Loader downloads the musics only when `$music` is not 0. */
  private fl_musicLoaded!: boolean;

  constructor(f: string, opt: string, settings: PlayerSettings = DEFAULT_SETTINGS) {
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
    this.setSound(settings);
    this.fl_detail = settings.detail !== 0;
    this.fl_shaky = settings.shake !== 0;

    if (!this.fl_detail) {
      this.setLowDetails();
    }
  }

  /**
   * The volumes, and whether there is music. The constructor's; also called during a game by
   * the sound panel of the pause (port addition).
   */
  setSound(settings: PlayerSettings): void {
    this.generalVolume = (settings.volume * 0.5) / 100;
    this.soundVolume = settings.sound * this.generalVolume;
    this.musicVolume = settings.music * this.generalVolume * 0.65;
    this.fl_musicLoaded = settings.music !== 0;
  }

  /** `setLowDetails`: low quality mode. The stage's medium `_quality` is not ported. */
  setLowDetails(): void {
    this.fl_detail = false;
    this.MAX_FX = Math.ceil(this.MAX_FX * 0.5);
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
      `mus=${this.musicVolume}\nsnd=${this.soundVolume}\n` +
      `detail=${this.fl_detail}\nshaky =${this.fl_shaky}\n`
    );
  }
}

/**
 * `GameManager` constructor: the families of the tutorial and of a game started with no site
 * (`Loader.BASE_SCRIPT_URL == null`), logged as "using sysfam". The Ruffle side-by-side runs the
 * original this way.
 */
export const SYSTEM_FAMILIES = '0,7,1000,18';
