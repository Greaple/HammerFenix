import { PersistCodec, type PersistValue } from '../engine/codec/PersistCodec';
import { Data } from './Data';
import type { GameResult } from './Loader';
import { newProfile, type ProfileData, type QuestEngine, START_MODES } from './Quests';

/** `localStorage` key of the profile; a new format gets a new key. */
export const PROFILE_KEY = 'hammerfenix_profile_v1';

/** What one game added to the profile, for the results screen. */
export interface GameRecord {
  /** Quests the game completed, in id order. */
  quests: number[];
  /** Items that entered the fridge with this game. */
  fridge: number[];
}

/**
 * The options each mode offers on the menu, in the menu's order. The quest texts say which mode
 * each is for (quests 63, 64, 72, 74, 68 to 70 for the co-op mode, 66 for the soccer); the other
 * modes' come with them (Phase 4). `bombcontrol` and `soccerbomb` are given by no quest.
 */
export const MODE_OPTIONS: Record<string, readonly string[]> = {
  solo: [Data.OPT_MIRROR, Data.OPT_NIGHTMARE, Data.OPT_NINJA, Data.OPT_BOMB_EXPERT],
  multicoop: [Data.OPT_MIRROR_MULTI, Data.OPT_NIGHTMARE_MULTI, Data.OPT_LIFE_SHARING],
  soccer: [Data.OPT_KICK_CONTROL],
};

/**
 * The level set choices (`$options`) of the Time Attack modes, one per run (`set_ta_N`,
 * `set_mta_N`), and of the soccer, one per field (`set_soc_N`). The site's mode menu had a select
 * for them (`.slc`).
 */
export const MODE_RUNS: Record<string, readonly string[]> = {
  timeattack: [Data.OPT_SET_TA_0, Data.OPT_SET_TA_1, Data.OPT_SET_TA_2],
  multitime: [Data.OPT_SET_MTA_0, Data.OPT_SET_MTA_1, Data.OPT_SET_MTA_2],
  soccer: [Data.OPT_SET_SOC_0, Data.OPT_SET_SOC_1, Data.OPT_SET_SOC_2, Data.OPT_SET_SOC_3],
};

/** `TimeAttack.INFINITY`: the time a lost Time Attack game sends. */
export const NO_TIME = 59 * 60 * 1000 + 59 * 1000 + 999;

/** A Time Attack game's time against the profile's best (`Profile.timeResult`). */
export interface TimeResult {
  /** The site's `$mode`: `timeattack` or `multitime`. */
  mode: string;
  runId: number;
  /** The time sent, in milliseconds; `NO_TIME` for a lost game. */
  time: number;
  /** The best time before this game, null if none. */
  best: number | null;
  /** This game beat the best time (or set the first one). */
  isNew: boolean;
}

/** The part of `Storage` the profile uses, so tests can pass their own. */
export type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The player's profile (roadmap 3.2b): the item collection, quests, unlocked families, options
 * and modes. The hammerfest.fr server kept it; the port keeps it in the browser's
 * `localStorage`, encoded with the game's `PersistCodec` (with its CRC). Not a port.
 */
export class Profile {
  data: ProfileData;
  readonly quests: QuestEngine;
  private readonly storage: ProfileStorage | null;

  constructor(quests: QuestEngine, storage: ProfileStorage | null = defaultStorage()) {
    this.quests = quests;
    this.storage = storage;
    this.data = this.load();
  }

  /** The saved profile, or a new one when there is none or it cannot be read. */
  load(): ProfileData {
    try {
      const raw = this.storage?.getItem(PROFILE_KEY);
      if (raw) return decodeProfile(raw) ?? newProfile();
    } catch {
      // storage blocked: start a new profile
    }
    return newProfile();
  }

  save(): void {
    try {
      this.storage?.setItem(PROFILE_KEY, encodeProfile(this.data));
    } catch {
      // storage full or blocked: the profile lasts for this page only
    }
  }

  /** `$families` for the next game. */
  get familiesParam(): string {
    return this.data.families.join(',');
  }

  hasOption(oid: string): boolean {
    return this.data.options.includes(oid);
  }

  /**
   * The profile can play `mode`. Every player has the modes of `START_MODES`, also with a profile
   * saved before the soccer joined them. Quests give `timeattack` (73) and `multicoop` (67); no
   * quest gives `multitime`, so the port's guess: a player who has both has it.
   */
  hasMode(mode: string): boolean {
    if (START_MODES.includes(mode)) return true;
    if (mode === 'multitime') return this.hasMode('timeattack') && this.hasMode('multicoop');
    return this.data.modes.includes(mode);
  }

  /**
   * The run a Time Attack game plays, or the soccer's field (its `set_*` option), null for
   * another mode. For the Time Attack, the first run the profile has: quest 73 gives `set_ta_0`
   * and no quest gives another, so the menu has no run to choose. No quest gives a `set_mta_*`
   * either: the port's guess is run 0. The soccer's field is the one chosen on the menu
   * (`runChoices`), the first by default.
   */
  runOption(mode: string): string | null {
    const runs = MODE_RUNS[mode];
    if (!runs) return null;
    if (mode === 'multitime') return runs[0];
    if (mode === 'soccer') return runs.find((o) => this.data.chosen.includes(o)) ?? runs[0];
    return runs.find((o) => this.hasOption(o)) ?? null;
  }

  /**
   * The runs the menu lets the player choose: the soccer's four fields. The site's soccer page
   * sent `set_soc_0` and no quest gives a field, so the port's guess is that the site's select
   * listed them all (the game has four, and `SoccerSelector.mt` shows four).
   */
  runChoices(mode: string): readonly string[] {
    return mode === 'soccer' ? MODE_RUNS.soccer : [];
  }

  /** Chooses the run of `mode` on the menu (`runChoices`), and saves. */
  chooseRun(mode: string, oid: string): void {
    if (!this.runChoices(mode).includes(oid)) return;
    const c = this.data.chosen;
    for (const o of MODE_RUNS[mode]) {
      if (c.includes(o)) c.splice(c.indexOf(o), 1);
    }
    c.push(oid);
    this.save();
  }

  /** The best time of a Time Attack run, in milliseconds, or null. */
  bestTime(mode: string, runId: number): number | null {
    return this.data.times[mode]?.[runId] ?? null;
  }

  /**
   * A Time Attack game's time against the best one. With `record` (a game the menu started),
   * a finished run's better time becomes the best and is saved. A lost game has no time.
   */
  timeResult(mode: string, runId: number, time: number, record: boolean): TimeResult {
    const best = this.bestTime(mode, runId);
    const isNew = time < NO_TIME && (best === null || time < best);
    if (isNew && record) {
      const times = (this.data.times[mode] ??= []);
      times[runId] = time;
      this.save();
    }
    return { mode, runId, time, best, isNew };
  }

  isChosen(oid: string): boolean {
    return this.hasOption(oid) && this.data.chosen.includes(oid);
  }

  /** Ticks or unticks an unlocked option on the menu, and saves. */
  toggleOption(oid: string): void {
    if (!this.hasOption(oid)) return;
    const c = this.data.chosen;
    if (c.includes(oid)) c.splice(c.indexOf(oid), 1);
    else c.push(oid);
    this.save();
  }

  /**
   * `$options` for a game of `mode`: the mode's options ticked on the menu, and the Tornade
   * boost once unlocked, which applies "quelles que soient les options choisies" (quest 62).
   */
  optionsParam(mode: string): string {
    const out = (MODE_OPTIONS[mode] ?? []).filter((o) => this.isChosen(o));
    if (this.hasOption(Data.OPT_BOOST)) out.push(Data.OPT_BOOST);
    const run = this.runOption(mode);
    if (run) out.push(run);
    return out.join(',');
  }

  /**
   * The server's part of the end of an Adventure game: counts the items the game sent, checks
   * the quests and saves.
   */
  recordGame(result: GameResult): GameRecord {
    const picks = resultPicks(result);
    const ids = picks.map(([id]) => id);
    const before = new Set(ids.filter((id) => this.quests.inFridge(this.data, id)));
    const quests = this.quests.addGame(this.data, picks);
    const fridge = ids.filter((id) => !before.has(id) && this.quests.inFridge(this.data, id));
    this.save();
    return { quests, fridge };
  }

  /** Starts over with a new profile. */
  reset(): void {
    this.data = newProfile();
    this.save();
  }
}

export function encodeProfile(p: ProfileData): string {
  return new PersistCodec({ crc: true }).encode(p as unknown as PersistValue);
}

/** Reads a saved profile; null if it is damaged or of another version. */
export function decodeProfile(raw: string): ProfileData | null {
  const v = new PersistCodec({ crc: true }).decode<Partial<ProfileData>>(raw);
  if (!v || typeof v !== 'object' || v.version !== 1) return null;
  const p = newProfile();
  const nums = (a: unknown) =>
    Array.isArray(a) && a.every((x) => x == null || typeof x === 'number');
  const strs = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if (nums(v.items)) p.items = v.items!.map((n) => n ?? undefined) as number[];
  if (nums(v.quests)) p.quests = v.quests!;
  if (nums(v.families)) p.families = v.families!;
  if (strs(v.options)) p.options = v.options!;
  if (strs(v.chosen)) p.chosen = v.chosen!;
  if (strs(v.modes)) p.modes = v.modes!;
  if (typeof v.tokens === 'number') p.tokens = v.tokens;
  if (typeof v.bank === 'number') p.bank = v.bank;
  if (typeof v.games === 'number') p.games = v.games;
  if (v.times && typeof v.times === 'object' && !Array.isArray(v.times)) {
    for (const [mode, list] of Object.entries(v.times)) {
      if (nums(list))
        p.times[mode] = (list as (number | null)[]).map((n) => n ?? undefined) as number[];
    }
  }
  return p;
}

function defaultStorage(): ProfileStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The items found in the game, as `[item id, count]` in id order. A game over sends `$item2`
 * (count per id, score items at id + 1000); the end of the set sends the special and score
 * pick arrays, `PersistCodec` encoded (`GameMode.exitGame`).
 */
export function resultPicks(r: GameResult): [number, number][] {
  let counts: number[] = [];
  if (r.kind === 'gameOver') {
    counts = r.stats.item2 ?? [];
  } else if (r.params) {
    const codec = new PersistCodec();
    const [special, score] = (codec.decode<string>(r.params) ?? '').split(':');
    (codec.decode<number[]>(special ?? '') ?? []).forEach((n, id) => (counts[id] = n));
    (codec.decode<number[]>(score ?? '') ?? []).forEach((n, id) => (counts[id + 1000] = n));
  }
  const out: [number, number][] = [];
  counts.forEach((n, id) => {
    if (n > 0) out.push([id, n]);
  });
  return out;
}
