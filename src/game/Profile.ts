import { PersistCodec, type PersistValue } from '../engine/codec/PersistCodec';
import { Data } from './Data';
import type { GameResult } from './Loader';
import { newProfile, type ProfileData, type QuestEngine } from './Quests';

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
 * each is for (quests 63, 64, 72, 74, and 68 to 70 for the co-op mode); the other modes' come
 * with them (Phase 4).
 */
export const MODE_OPTIONS: Record<string, readonly string[]> = {
  solo: [Data.OPT_MIRROR, Data.OPT_NIGHTMARE, Data.OPT_NINJA, Data.OPT_BOMB_EXPERT],
  multicoop: [Data.OPT_MIRROR_MULTI, Data.OPT_NIGHTMARE_MULTI, Data.OPT_LIFE_SHARING],
};

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
    counts = r.stats.item2;
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
