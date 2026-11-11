import type { ItemsData, QuestAction, QuestDef } from './data/types';

/**
 * The player's progress as the hammerfest.fr server kept it: what `Profile` saves.
 */
export interface ProfileData {
  version: 1;
  /** Times each item was found in Adventure games, by item id (score items from 1000). */
  items: number[];
  /** Quests done, in the order they were completed. */
  quests: number[];
  /** Unlocked item families, sent to the game as `$families`. */
  families: number[];
  /** Game options unlocked by quests (`Data.OPT_*`, and the level set choices `set_ta_N`). */
  options: string[];
  /** Options ticked on the mode menu, sent with the next games (3.3). */
  chosen: string[];
  /** Unlocked game modes (`$mode` values). */
  modes: string[];
  /** Extra games won by quests (`give tokens`). The port has no game cost, so they do nothing. */
  tokens: number;
  /** Bonus to the games bought in the shop (`give bank`). No shop in the port either. */
  bank: number;
  /** Adventure games recorded. */
  games: number;
  /**
   * Personal best times of the Time Attack modes, in milliseconds, by `$mode` then run id. The
   * site kept a ranking of all players instead (port addition).
   */
  times: { [mode: string]: number[] };
}

/**
 * The families of a new player. The original's `GameManager` uses `0,7,1000,18` with no site;
 * the server's own list is unknown. 7 and 18 are removed by quests and given by none, so a new
 * player had them. 1020 (keys), 1024 (game pads) and 1028 (Sandy's kit) hold random drops that
 * players found, and no quest gives them either. See PORT_STATUS.md, "Quests and profile".
 */
export const START_FAMILIES: readonly number[] = [0, 7, 18, 1000, 1020, 1024, 1028];

/** The modes every player has (site guide, section 3): Adventure and the free Learning mode. */
export const START_MODES: readonly string[] = ['solo', 'tutorial'];

/** Finds an item needs to enter the fridge when its `unlock` is not set (site guide, section 4). */
export const FRIDGE_UNLOCK = 10;

export function newProfile(): ProfileData {
  return {
    version: 1,
    items: [],
    quests: [],
    families: [...START_FAMILIES],
    options: [],
    chosen: [],
    modes: [...START_MODES],
    tokens: 0,
    bank: 0,
    games: 0,
    times: {},
  };
}

export interface QuestRequirement {
  item: number;
  qty: number;
}

/** Progress of a quest: `done`, `progress` (some of its items found) or `none`. */
export type QuestStatus = 'done' | 'progress' | 'none';

/**
 * The quests of hammerfest.fr (roadmap 3.2c), read from `xml/quests.xml`. Not a port: the server
 * that ran them was never released. The rules come from the site guide, the archived profiles
 * and hamm4all.net (PORT_STATUS.md, "Quests and profile"):
 *
 * - Item counts add up over all Adventure games. Quests do not use up the items.
 * - The server checked the quests when a game ended. A completed quest's rewards apply from
 *   the next game on, for good.
 * - A quest is done when every `require` count is reached. Its `give` and `remove` entries then
 *   apply in document order.
 */
export class QuestEngine {
  readonly quests: readonly QuestDef[];
  private readonly unlockById = new Map<number, number>();
  private readonly familyById = new Map<number, number>();
  private readonly familyItems = new Map<number, number[]>();

  constructor(quests: readonly QuestDef[], items: ItemsData) {
    this.quests = [...quests].sort((a, b) => a.id - b.id);
    for (const f of [...items.special, ...items.score]) {
      this.familyItems.set(
        f.id,
        f.items.map((it) => it.id),
      );
      for (const it of f.items) {
        this.unlockById.set(it.id, it.unlock ?? FRIDGE_UNLOCK);
        this.familyById.set(it.id, f.id);
      }
    }
  }

  /** The family of item `id` in `items.xml`. */
  familyOf(id: number): number | undefined {
    return this.familyById.get(id);
  }

  /** The items of family `fid`, in `items.xml` order. */
  itemsOf(fid: number): readonly number[] {
    return this.familyItems.get(fid) ?? [];
  }

  get(qid: number): QuestDef | undefined {
    return this.quests.find((q) => q.id === qid);
  }

  requirements(qid: number): QuestRequirement[] {
    return (this.get(qid)?.actions ?? [])
      .filter((a) => a.type === 'require')
      .map((a) => ({ item: parseInt(a.attrs.item, 10), qty: parseInt(a.attrs.qty, 10) }));
  }

  status(p: ProfileData, qid: number): QuestStatus {
    if (p.quests.includes(qid)) return 'done';
    return this.requirements(qid).some((r) => (p.items[r.item] ?? 0) > 0) ? 'progress' : 'none';
  }

  /** Item ids in the order of `items.xml`, families of special items first. */
  get itemIds(): number[] {
    return [...this.unlockById.keys()];
  }

  /** Finds item `id` needs to show in the fridge (`unlock` in `items.xml`). */
  unlockCount(id: number): number {
    return this.unlockById.get(id) ?? FRIDGE_UNLOCK;
  }

  inFridge(p: ProfileData, id: number): boolean {
    return (p.items[id] ?? 0) >= this.unlockCount(id);
  }

  /**
   * The end of an Adventure game: adds its picks (`[item id, count]`) to the collection and
   * checks the quests. Returns the quests it completed.
   */
  addGame(p: ProfileData, picks: readonly [number, number][]): number[] {
    for (const [id, n] of picks) p.items[id] = (p.items[id] ?? 0) + n;
    p.games++;
    return this.check(p);
  }

  /** Completes, in id order, every quest not done yet whose items are all found. */
  check(p: ProfileData): number[] {
    const done: number[] = [];
    for (const q of this.quests) {
      if (p.quests.includes(q.id)) continue;
      const reqs = this.requirements(q.id);
      if (!reqs.every((r) => (p.items[r.item] ?? 0) >= r.qty)) continue;
      p.quests.push(q.id);
      for (const a of q.actions) this.apply(p, a);
      done.push(q.id);
    }
    return done;
  }

  /**
   * Applies one `give` or `remove` entry. Returns false for an entry it does not know. The one
   * `log` reward (quest 74) has no known effect and is ignored.
   */
  apply(p: ProfileData, a: QuestAction): boolean {
    if (a.type === 'require') return true;
    if (a.type !== 'give' && a.type !== 'remove') return false;
    const give = a.type === 'give';
    let handled = true;
    for (const [key, value] of Object.entries(a.attrs)) {
      switch (key) {
        case 'family':
          setMember(p.families, parseInt(value, 10), give);
          break;
        case 'option':
          setMember(p.options, value, give);
          break;
        case 'mode':
          setMember(p.modes, value, give);
          break;
        case 'tokens':
          p.tokens += (give ? 1 : -1) * parseInt(value, 10);
          break;
        case 'bank':
          p.bank += (give ? 1 : -1) * parseInt(value, 10);
          break;
        case 'log':
          break;
        default:
          handled = false;
      }
    }
    return handled;
  }
}

function setMember<T>(list: T[], v: T, on: boolean): void {
  const i = list.indexOf(v);
  if (on && i < 0) list.push(v);
  if (!on && i >= 0) list.splice(i, 1);
}
