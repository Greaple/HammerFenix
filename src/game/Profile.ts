import { PersistCodec, type PersistValue } from '../engine/codec/PersistCodec';
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
