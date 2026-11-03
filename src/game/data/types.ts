/**
 * Data formats produced by the build-time pipeline (`tools/build-data.ts`) and
 * consumed by the game at runtime. Field names mirror the original MotionTypes
 * classes, minus the `$` obfuscation-protection prefix.
 */

/** A monster placement (levels.BadData). */
export interface BadData {
  x: number;
  y: number;
  id: number;
}

/** A single level (levels.Data). `map[x][y]`, 20 columns × 25 rows. */
export interface LevelData {
  map: number[][];
  badList: BadData[];
  playerX: number;
  playerY: number;
  skinTiles: number;
  skinBg: number;
  specialSlots: { x: number; y: number }[];
  scoreSlots: { x: number; y: number }[];
  /** Level script, in the original `$`-prefixed XML dialect (see ScriptEngine). */
  script: string;
}

/** A level set (one `xml/levels/*.xml` file). */
export interface LevelSet {
  name: string;
  levels: LevelData[];
}

export interface ItemDef {
  id: number;
  /** Raw rarity index (0..7), mapped through `Data.RARITY` at runtime. */
  rarity: number;
  /** Score value (score items only, 0 otherwise). */
  value: number;
  /** Unlock count, when specified. */
  unlock?: number;
}

export interface ItemFamily {
  id: number;
  items: ItemDef[];
}

export interface ItemsData {
  special: ItemFamily[];
  score: ItemFamily[];
}

/** One `<require>`, `<give>` or `<remove>` entry of a quest, in document order. */
export interface QuestAction {
  type: 'require' | 'give' | 'remove' | string;
  attrs: Record<string, string>;
}

export interface QuestDef {
  id: number;
  actions: QuestAction[];
}

export interface LevelTag {
  name: string;
  did: number;
  lid: number;
}

/** Resolved portal link (levels.PortalLink). */
export interface PortalLink {
  from_did: number;
  from_lid: number;
  from_pid: number;
  to_did: number;
  to_lid: number;
  to_pid: number;
}

export interface PortalLinksData {
  tags: LevelTag[];
  links: PortalLink[];
}

/** Localized strings. Sparse maps keyed by numeric id. */
export interface LangData {
  id: string;
  debug: boolean;
  statics: Record<number, string>;
  items: Record<number, string>;
  families: Record<number, string>;
  quests: Record<number, { title: string; desc: string }>;
  keys: Record<number, string>;
  /** levels[did][lid] = sector name */
  levels: Record<number, Record<number, string>>;
}

/** Index of everything generated, loaded first by the game. */
export interface DataManifest {
  version: number;
  levelSets: string[];
  langs: string[];
}
