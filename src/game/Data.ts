import type {
  DataManifest,
  ItemFamily,
  ItemsData,
  LangData,
  LevelSet,
  PortalLinksData,
  QuestDef,
} from './data/types';

export interface AnimDef {
  readonly id: number;
  readonly loop: boolean;
}

/**
 * Port of Hammerfest's global `Data` constants (`class/hammer/Data.mt`).
 */
export const Data = {
  DOC_WIDTH: 420,
  DOC_HEIGHT: 520,
  GAME_WIDTH: 400,
  GAME_HEIGHT: 500,
  LEVEL_WIDTH: 20,
  LEVEL_HEIGHT: 25,
  CASE_WIDTH: 20,
  CASE_HEIGHT: 20,
  SECOND: 32,
  SCROLL_SPEED: 0.04,
  FADE_SPEED: 8,
  MIN_DARKNESS_LEVEL: 16,
  LEVEL_READ_LENGTH: 1,

  // RandomManager table ids (`auto_inc` values in the original)
  RAND_EXTENDS_ID: 23,
  RAND_ITEMS_ID: 24,
  RAND_SCORES_ID: 25,
  RAND_EXTENDS: [10, 10, 6, 5, 5, 10, 4] as readonly number[],

  // Render depth planes (DepthManager)
  DP_SPECIAL_BG: 0,
  DP_BACK_LAYER: 1,
  DP_SPRITE_BACK_LAYER: 2,
  DP_FIELD_LAYER: 3,
  DP_SPEAR: 4,
  DP_PLAYER: 5,
  DP_ITEMS: 6,
  DP_SHOTS: 7,
  DP_BADS: 8,
  DP_BOMBS: 9,
  DP_FX: 10,
  DP_SUPA: 11,
  DP_TOP_LAYER: 12,
  DP_SPRITE_TOP_LAYER: 13,
  DP_BORDERS: 14,
  DP_SCROLLER: 15,
  DP_INTERF: 16,
  DP_TOP: 17,
  DP_SOUNDS: 18,

  // Sound channels
  CHAN_MUSIC: 0,
  CHAN_BOMB: 1,
  CHAN_PLAYER: 2,
  CHAN_BAD: 3,
  CHAN_ITEM: 4,
  CHAN_FIELD: 5,
  CHAN_INTERF: 6,
  /** Unused: the musics come from `GameManager.musics` (`MUSIC_TRACKS` in `GameSession.ts`). */
  TRACKS: ['music_ingame', 'music_boss'] as readonly string[],

  // Entity type bitflags
  ENTITY: 1 << 0,
  PHYSICS: 1 << 1,
  ITEM: 1 << 2,
  SPECIAL_ITEM: 1 << 3,
  PLAYER: 1 << 4,
  PLAYER_BOMB: 1 << 5,
  BAD: 1 << 6,
  SHOOT: 1 << 7,
  BOMB: 1 << 8,
  FX: 1 << 9,
  SUPA: 1 << 10,
  CATCHER: 1 << 11,
  BALL: 1 << 12,
  HU_BAD: 1 << 13,
  BOSS: 1 << 14,
  BAD_BOMB: 1 << 15,
  BAD_CLEAR: 1 << 16,
  SOCCERBALL: 1 << 17,
  PLAYER_SHOOT: 1 << 18,
  PERFECT_ITEM: 1 << 19,
  SPEAR: 1 << 20,

  // Stats (`StatsManager`). The original marks STAT_KICK and every stat after it as unused.
  STAT_MAX_COMBO: 0,
  STAT_SUPAITEM: 1,
  STAT_KICK: 2,
  STAT_BOMB: 3,
  STAT_SHOT: 4,
  STAT_JUMP: 5,
  STAT_ICEHIT: 6,
  STAT_KNOCK: 7,
  STAT_DEATH: 8,

  // Extends. Unused by the original: `StatsManager.spreadExtend` only reads STAT_MAX_COMBO.
  EXT_MIN_COMBO: 3,
  EXT_MAX_BOMBS: 3,
  EXT_MAX_KICKS: 0,
  EXT_MAX_JUMPS: 10,

  // Level cell types
  GROUND: 1,
  WALL: 2,
  OUT_WALL: 3,
  HORIZONTAL: 1,
  VERTICAL: 2,
  FIELD_TELEPORT: -6,
  FIELD_PORTAL: -7,
  FIELD_GOAL_1: -8,
  FIELD_GOAL_2: -9,
  FIELD_BUMPER: -10,
  FIELD_PEACE: -11,

  // Physics constants
  BORDER_MARGIN: 10,
  FRICTION_X: 0.93,
  FRICTION_Y: 0.86,
  FRICTION_GROUND: 0.7,
  FRICTION_SLIDE: 0.97,
  GRAVITY: 1.0,
  FALL_SPEED: 0.9,
  FALL_FACTOR_FROZEN: 2.3,
  FALL_FACTOR_KNOCK: 1.5,
  FALL_FACTOR_DEAD: 1.75,
  STEP_MAX: 20,
  DEATH_LINE: 550,

  // Particles (`entity.fx.Particle`, frames of `hammer_fx_particle`)
  MAX_FX: 16,
  PARTICLE_ICE: 1,
  PARTICLE_CLASSIC_BOMB: 2,
  PARTICLE_STONE: 3,
  PARTICLE_SPARK: 4,
  PARTICLE_DUST: 5,
  PARTICLE_ORANGE: 6,
  PARTICLE_METAL: 7,
  PARTICLE_TUBERCULOZ: 8,
  PARTICLE_RAIN: 9,
  PARTICLE_LITCHI: 10,
  PARTICLE_PORTAL: 4,
  PARTICLE_BUBBLE: 11,
  PARTICLE_ICE_BAD: 12,
  PARTICLE_BLOB: 13,
  PARTICLE_FRAMB: 14,
  PARTICLE_FRAMB_SMALL: 14,

  // Special backgrounds (frames of `hammer_special_bg`, minus one)
  BG_STAR: 0,
  BG_FLASH: 1,
  BG_ORANGE: 2,
  BG_FIREBALL: 3,
  BG_HYPNO: 4,
  BG_CONSTEL: 5,
  BG_JAP: 6,
  BG_GHOSTS: 7,
  BG_FIRE: 8,
  BG_PYRAMID: 9,
  BG_SINGER: 10,
  BG_STORM: 11,
  BG_GUU: 12,
  BG_SOCCER: 13,

  // Mover actions (`auto_inc` values, after DP_SOUNDS)
  ACTION_MOVE: 19,
  ACTION_WALK: 20,
  ACTION_SHOOT: 21,
  ACTION_FALLBACK: 22,

  // World map events (`GameMode.registerMapEvent`)
  EVENT_EXIT_RIGHT: 1,
  EVENT_BACK_RIGHT: 2,
  EVENT_EXIT_LEFT: 3,
  EVENT_BACK_LEFT: 4,
  EVENT_DEATH: 5,
  EVENT_EXTEND: 6,
  EVENT_TIME: 7,

  // Player constants
  PLAYER_SPEED: 4.3,
  PLAYER_JUMP: 18.7,
  PLAYER_HKICK_X: 3.5,
  PLAYER_HKICK_Y: 7.4,
  PLAYER_VKICK: 18,
  PLAYER_AIR_JUMP: 7,
  WBOMB_SPEED: 4.3 * 1.5,
  KICK_DISTANCE: 20,
  AIR_KICK_DISTANCE: 30,
  SHIELD_DURATION: 32 * 5,
  WEAPON_DURATION: 32 * 30,
  SUPA_DURATION: 32 * 30,
  PLAYER_KNOCK_DURATION: 32 * 2.5,
  TELEPORTER_DISTANCE: 80,
  EXTRA_LIFE_STEPS: [100000, 500000, 1000000, 2000000, 3000000, 4000000] as readonly number[],
  BASE_COLORS: [0xffffff, 0xf4e093, 0x5555ff, 0xfbb64f] as readonly number[],
  DARK_COLORS: [0x70658d, 0xd54000, 0x000000, 0x000000] as readonly number[],
  EDGE_TIMER: 32 * 0.2,
  WAIT_TIMER: 32 * 8,
  DUST_FALL_HEIGHT: 80,

  // Weapons
  WEAPON_NONE: -1,
  WEAPON_B_CLASSIC: 1,
  WEAPON_B_BLACK: 2,
  WEAPON_B_BLUE: 3,
  WEAPON_B_GREEN: 4,
  WEAPON_B_RED: 5,
  WEAPON_S_ARROW: 6,
  WEAPON_S_FIRE: 7,
  WEAPON_S_ICE: 8,
  WEAPON_B_REPEL: 9,

  // Enemy constants
  FREEZE_DURATION: 32 * 5,
  KNOCK_DURATION: 32 * 3.75,
  ICE_HIT_MIN_SPEED: 4,
  ICE_KNOCK_MIN_SPEED: 2,
  MAX_ANGER: 3,
  AUTO_ANGER: 32 * 4,
  PEACE_COOLDOWN: 32 * 3,
  BALL_TIMEOUT: 2.3 * 32,

  // Overhead icons (frames of the `curse` clip)
  CURSE_PEACE: 1,
  CURSE_SHRINK: 2,
  CURSE_SLOW: 3,
  CURSE_TAUNT: 4,
  CURSE_MULTIPLY: 5,
  CURSE_FALL: 6,
  CURSE_MARIO: 7,
  CURSE_TRAITOR: 8,
  CURSE_GOAL: 9,
  BAD_HJUMP_X: 5.5,
  BAD_HJUMP_Y: 8.5,
  BAD_VJUMP_X: 1.3,
  BAD_VJUMP_X_CLIFF: 2.2,
  BAD_VJUMP_Y: 19,
  BAD_VDJUMP_Y: 6.5,
  BAD_VJUMP_Y_LIST: [11, 14, 19] as readonly number[],
  HU_STEPS: [35 * 32, 25 * 32] as readonly number[],
  BAT_LEVEL: 100,
  TUBERCULOZ_LEVEL: 101,
  BOSS_BAT_MIN_DIST: 20 * 7,
  BOSS_BAT_MIN_X_DIST: 20 * 3,

  // Item lifetimes & special IDs
  ITEM_LIFE_TIME: 8 * 32,
  EXTEND_TIMER: 10 * 32,
  SPECIAL_ITEM_TIMER: 8 * 32,
  SCORE_ITEM_TIMER: 12 * 32,
  DIAMANT: 8,
  CONVERT_DIAMANT: 17,
  MAX_ITEMS: 300,
  EXTENDS: ['C', 'R', 'Y', 'S', 'T', 'A', 'L'] as readonly string[],

  // Blinking
  BLINK_DURATION: 2.5,
  BLINK_DURATION_FAST: 1.0,

  // Animations
  ANIM_PLAYER_STOP: { id: 0, loop: true } as AnimDef,
  ANIM_PLAYER_WALK: { id: 1, loop: true } as AnimDef,
  ANIM_PLAYER_JUMP_UP: { id: 2, loop: false } as AnimDef,
  ANIM_PLAYER_JUMP_DOWN: { id: 3, loop: false } as AnimDef,
  ANIM_PLAYER_JUMP_LAND: { id: 4, loop: false } as AnimDef,
  ANIM_PLAYER_DIE: { id: 5, loop: true } as AnimDef,
  ANIM_PLAYER_KICK: { id: 6, loop: false } as AnimDef,
  ANIM_PLAYER_ATTACK: { id: 7, loop: false } as AnimDef,
  ANIM_PLAYER_EDGE: { id: 8, loop: true } as AnimDef,
  ANIM_PLAYER_WAIT1: { id: 9, loop: false } as AnimDef,
  ANIM_PLAYER_WAIT2: { id: 10, loop: false } as AnimDef,
  ANIM_PLAYER_KNOCK_IN: { id: 12, loop: false } as AnimDef,
  ANIM_PLAYER_KNOCK_OUT: { id: 13, loop: false } as AnimDef,
  ANIM_PLAYER_RESURRECT: { id: 14, loop: false } as AnimDef,
  ANIM_PLAYER_CARROT: { id: 15, loop: true } as AnimDef,
  ANIM_PLAYER_RUN: { id: 16, loop: true } as AnimDef,
  ANIM_PLAYER_SOCCER: { id: 17, loop: true } as AnimDef,
  ANIM_PLAYER_AIRKICK: { id: 18, loop: false } as AnimDef,
  ANIM_PLAYER_STOP_V: { id: 19, loop: true } as AnimDef,
  ANIM_PLAYER_WALK_V: { id: 20, loop: true } as AnimDef,
  ANIM_PLAYER_STOP_L: { id: 21, loop: true } as AnimDef,
  ANIM_PLAYER_WALK_L: { id: 22, loop: true } as AnimDef,

  ANIM_BAD_WALK: { id: 0, loop: true } as AnimDef,
  ANIM_BAD_ANGER: { id: 1, loop: true } as AnimDef,
  ANIM_BAD_FREEZE: { id: 2, loop: false } as AnimDef,
  ANIM_BAD_KNOCK: { id: 3, loop: true } as AnimDef,
  ANIM_BAD_DIE: { id: 4, loop: true } as AnimDef,
  ANIM_BAD_SHOOT_START: { id: 5, loop: false } as AnimDef,
  ANIM_BAD_SHOOT_END: { id: 6, loop: false } as AnimDef,
  ANIM_BAD_THINK: { id: 7, loop: false } as AnimDef,
  ANIM_BAD_JUMP: { id: 8, loop: true } as AnimDef,
  ANIM_BAD_SHOOT_LOOP: { id: 9, loop: true } as AnimDef,

  ANIM_BAT_WAIT: { id: 0, loop: true } as AnimDef,
  ANIM_BAT_MOVE: { id: 1, loop: true } as AnimDef,
  ANIM_BAT_SWITCH: { id: 2, loop: false } as AnimDef,
  ANIM_BAT_DIVE: { id: 3, loop: false } as AnimDef,
  ANIM_BAT_INTRO: { id: 4, loop: false } as AnimDef,
  ANIM_BAT_KNOCK: { id: 5, loop: true } as AnimDef,
  ANIM_BAT_FINAL_DIVE: { id: 6, loop: true } as AnimDef,
  ANIM_BAT_ANGER: { id: 7, loop: true } as AnimDef,

  ANIM_BOSS_WAIT: { id: 0, loop: true } as AnimDef,
  ANIM_BOSS_SWITCH: { id: 1, loop: false } as AnimDef,
  ANIM_BOSS_JUMP_UP: { id: 2, loop: false } as AnimDef,
  ANIM_BOSS_JUMP_DOWN: { id: 3, loop: false } as AnimDef,
  ANIM_BOSS_JUMP_LAND: { id: 4, loop: false } as AnimDef,
  ANIM_BOSS_TORNADO_START: { id: 5, loop: false } as AnimDef,
  ANIM_BOSS_TORNADO_END: { id: 6, loop: false } as AnimDef,
  ANIM_BOSS_BAT_FORM: { id: 7, loop: false } as AnimDef,
  ANIM_BOSS_BURN_START: { id: 8, loop: false } as AnimDef,
  ANIM_BOSS_DEATH: { id: 9, loop: false } as AnimDef,
  ANIM_BOSS_DASH_START: { id: 10, loop: false } as AnimDef,
  ANIM_BOSS_DASH: { id: 11, loop: false } as AnimDef,
  ANIM_BOSS_BOMB: { id: 12, loop: false } as AnimDef,
  ANIM_BOSS_HIT: { id: 13, loop: false } as AnimDef,
  ANIM_BOSS_DASH_BUILD: { id: 14, loop: true } as AnimDef,
  ANIM_BOSS_BURN_LOOP: { id: 15, loop: true } as AnimDef,
  ANIM_BOSS_TORNADO_LOOP: { id: 16, loop: true } as AnimDef,
  ANIM_BOSS_DASH_LOOP: { id: 17, loop: true } as AnimDef,

  ANIM_SHOOT: { id: 0, loop: false } as AnimDef,
  ANIM_SHOOT_LOOP: { id: 0, loop: true } as AnimDef,
  ANIM_BOMB_DROP: { id: 0, loop: false } as AnimDef,
  ANIM_BOMB_LOOP: { id: 1, loop: true } as AnimDef,
  ANIM_BOMB_EXPLODE: { id: 2, loop: false } as AnimDef,
  ANIM_WBOMB_STOP: { id: 0, loop: true } as AnimDef,
  ANIM_WBOMB_WALK: { id: 1, loop: true } as AnimDef,

  // IA grid flags
  MAX_ITERATION: 30,
  /** The flag names the dev key G shows, by flag bit. */
  GRID_NAMES: [
    '$IA_TILE_TOP',
    '$IA_ALLOW_FALL',
    '$IA_BORDER',
    '$IA_SMALLSPOT',
    '$IA_FALL_SPOT',
    '$IA_JUMP_UP',
    '$IA_JUMP_DOWN',
    '$IA_JUMP_LEFT',
    '$IA_JUMP_RIGHT',
    '$IA_TILE',
    '$IA_CLIMB_LEFT',
    '$IA_CLIMB_RIGHT',
    '$FL_TELEPORTER',
  ] as readonly string[],
  IA_TILE_TOP: 1 << 0,
  IA_ALLOW_FALL: 1 << 1,
  IA_BORDER: 1 << 2,
  IA_SMALL_SPOT: 1 << 3,
  IA_FALL_SPOT: 1 << 4,
  IA_JUMP_UP: 1 << 5,
  IA_JUMP_DOWN: 1 << 6,
  IA_JUMP_LEFT: 1 << 7,
  IA_JUMP_RIGHT: 1 << 8,
  IA_TILE: 1 << 9,
  IA_CLIMB_LEFT: 1 << 10,
  IA_CLIMB_RIGHT: 1 << 11,
  FL_TELEPORTER: 1 << 12,
  IA_HJUMP: 2,
  IA_VJUMP: 2,
  IA_CLIMB: 4,
  IA_CLOSE_DISTANCE: 110,

  // Enemy IDs
  BAD_POMME: 0,
  BAD_CERISE: 1,
  BAD_BANANE: 2,
  BAD_FIREBALL: 3,
  BAD_ANANAS: 4,
  BAD_ABRICOT: 5,
  BAD_ABRICOT2: 6,
  BAD_POIRE: 7,
  BAD_BOMBE: 8,
  BAD_ORANGE: 9,
  BAD_FRAISE: 10,
  BAD_CITRON: 11,
  BAD_BALEINE: 12,
  BAD_SPEAR: 13,
  BAD_CRAWLER: 14,
  BAD_TZONGRE: 15,
  BAD_SAW: 16,
  BAD_LITCHI: 17,
  BAD_KIWI: 18,
  BAD_LITCHI_WEAK: 19,
  BAD_FRAMBOISE: 20,

  BAD_LINKAGES: [
    'hammer_bad_pomme',
    'hammer_bad_cerise',
    'hammer_bad_banane',
    'hammer_bad_fireball',
    'hammer_bad_ananas',
    'hammer_bad_abricot',
    'hammer_bad_abricot',
    'hammer_bad_poire',
    'hammer_bad_bombe',
    'hammer_bad_orange',
    'hammer_bad_fraise',
    'hammer_bad_citron',
    'hammer_bad_baleine',
    'hammer_bad_spear',
    'hammer_bad_crawler',
    'hammer_bad_tzongre',
    'hammer_bad_saw',
    'hammer_bad_litchi',
    'hammer_bad_kiwi',
    'hammer_bad_litchi_weak',
    'hammer_bad_framboise',
  ] as readonly string[],

  // Item rarities (the item and quest browsers color by them)
  __NA: 0,
  COMM: 2000,
  UNCO: 1000,
  RARE: 300,
  UNIQ: 100,
  MYTH: 10,
  CANE: 60,
  LEGEND: 1,
  RARITY: [0, 2000, 1000, 300, 100, 10, 1, 60] as readonly number[],

  // Mode options
  OPT_MIRROR: 'mirror',
  OPT_MIRROR_MULTI: 'mirrormulti',
  OPT_NIGHTMARE_MULTI: 'nightmaremulti',
  OPT_NIGHTMARE: 'nightmare',
  OPT_LIFE_SHARING: 'lifesharing',
  OPT_SOCCER_BOMBS: 'soccerbomb',
  OPT_KICK_CONTROL: 'kickcontrol',
  OPT_BOMB_CONTROL: 'bombcontrol',
  OPT_NINJA: 'ninja',
  OPT_BOMB_EXPERT: 'bombexpert',
  OPT_BOOST: 'boost',

  OPT_SET_TA_0: 'set_ta_0',
  OPT_SET_TA_1: 'set_ta_1',
  OPT_SET_TA_2: 'set_ta_2',

  OPT_SET_MTA_0: 'set_mta_0',
  OPT_SET_MTA_1: 'set_mta_1',
  OPT_SET_MTA_2: 'set_mta_2',

  OPT_SET_SOC_0: 'set_soc_0',
  OPT_SET_SOC_1: 'set_soc_1',
  OPT_SET_SOC_2: 'set_soc_2',
  OPT_SET_SOC_3: 'set_soc_3',

  // Player heads (frames of the head clip)
  HEAD_NORMAL: 1,
  HEAD_AFRO: 2,
  HEAD_CERBERE: 3,
  HEAD_PIOU: 4,
  HEAD_MARIO: 5,
  HEAD_TUB: 6,
  HEAD_IGORETTE: 7,
  HEAD_LOSE: 8,
  HEAD_CROWN: 9,
  HEAD_SANDY: 10,
  HEAD_SANDY_LOSE: 11,
  HEAD_SANDY_CROWN: 12,

  // Level editor (`mode.Editor`, not ported)
  FIELDS: [
    null,
    'BASE ',
    'noir ',
    'bleu ',
    'vert ',
    'rouge ',
    'warp ',
    'portal ',
    'goal 1',
    'goal 2',
    'bumper ',
    'peace ',
  ] as readonly (string | null)[],
  MAX_TILES: 53,
  MAX_BG: 30,
  MAX_BADS: 20,
  MAX_FIELDS: 11,
  TOOL_TILE: 26,
  TOOL_BAD: 27,
  TOOL_FIELD: 28,
  TOOL_START: 29,
  TOOL_SPECIAL: 30,
  TOOL_SCORE: 31,

  getCrystalValue(comboIndex: number): number {
    return Math.round(Math.min(50000, 500 * Math.round(Math.pow(comboIndex + 1, 2))));
  },

  /**
   * `Data.replaceTag`: wraps every other piece of `str` split on `char` in `start` and `end`
   * (`*Sorbex*` to `<font ...>Sorbex</font>`). An odd count of `char` leaves `str` as is (the
   * original also logs a warning).
   */
  replaceTag(str: string, char: string, start: string, end: string): string {
    const arr = str.split(char);
    if (arr.length % 2 === 0) return str;
    let out = '';
    for (let i = 0; i < arr.length; i++) {
      out += i % 2 !== 0 ? start + arr[i] + end : arr[i];
    }
    return out;
  },

  /** `Data.formatNumber`: groups digits by 3 with dots (negative numbers are left as is). */
  formatNumber(n: number): string {
    let txt = String(n);
    if (txt.indexOf('-') < 0) {
      for (let i = txt.length - 3; i > 0; i -= 3) {
        txt = txt.substring(0, i) + '.' + txt.substring(i);
      }
    }
    return txt;
  },

  /** `Data.leadingZeros`: pads with zeros up to `zeros` characters. */
  leadingZeros(n: number, zeros: number): string {
    let s = '' + n;
    while (s.length < zeros) {
      s = '0' + s;
    }
    return s;
  },

  formatNumberStr(raw: string | number): string {
    const s = String(raw);
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out.push(' ');
      out.push(s[i]);
    }
    return out.join('');
  },
} as const;

/** Reads one JSON file under `public/data/` by its relative path (e.g. `levels/adventure.json`). */
export type DataLoader = (rel: string) => Promise<unknown>;

/**
 * Runtime loader & store for the generated JSON data (`public/data/*`).
 */
export class GameDataStore {
  readonly manifest: DataManifest;
  readonly items: ItemsData;
  readonly quests: QuestDef[];
  readonly portalLinks: PortalLinksData;
  readonly scoreValues = new Map<number, number>();
  private readonly langs = new Map<string, LangData>();
  private readonly levelSets = new Map<string, LevelSet>();
  private currentLangId: string;
  private readonly loader: DataLoader;

  private constructor(
    loader: DataLoader,
    manifest: DataManifest,
    items: ItemsData,
    quests: QuestDef[],
    portalLinks: PortalLinksData,
    initialLang: LangData,
  ) {
    this.loader = loader;
    this.manifest = manifest;
    this.items = items;
    this.quests = quests;
    this.portalLinks = portalLinks;
    this.langs.set(initialLang.id, initialLang);
    this.currentLangId = initialLang.id;

    for (const fam of items.score) {
      for (const it of fam.items) {
        this.scoreValues.set(it.id, it.value);
      }
    }
  }

  static async load(baseUrl = './', preferredLang = 'en'): Promise<GameDataStore> {
    return GameDataStore.fromLoader(async (rel) => {
      const r = await fetch(`${baseUrl}data/${rel}`);
      if (!r.ok) throw new Error(`Failed to fetch data/${rel} (${r.status})`);
      return r.json();
    }, preferredLang);
  }

  static async fromLoader(loader: DataLoader, preferredLang = 'en'): Promise<GameDataStore> {
    const fetchJson = async <T>(rel: string): Promise<T> => (await loader(rel)) as T;

    const manifest = await fetchJson<DataManifest>('manifest.json');
    const langId = manifest.langs.includes(preferredLang)
      ? preferredLang
      : (manifest.langs[0] ?? 'en');

    const [items, quests, portalLinks, lang] = await Promise.all([
      fetchJson<ItemsData>('items.json'),
      fetchJson<QuestDef[]>('quests.json'),
      fetchJson<PortalLinksData>('portalLinks.json'),
      fetchJson<LangData>(`lang/${langId}.json`),
    ]);

    return new GameDataStore(loader, manifest, items, quests, portalLinks, lang);
  }

  get lang(): LangData {
    return this.langs.get(this.currentLangId)!;
  }

  get langId(): string {
    return this.currentLangId;
  }

  async setLang(id: string): Promise<LangData> {
    if (!this.langs.has(id)) {
      this.langs.set(id, (await this.loader(`lang/${id}.json`)) as LangData);
    }
    this.currentLangId = id;
    return this.lang;
  }

  /** A level set already loaded (`loadLevelSet`), for the modes' `addWorld`. */
  getLevelSet(name: string): LevelSet | undefined {
    return this.levelSets.get(name);
  }

  async loadLevelSet(name: string): Promise<LevelSet> {
    const cached = this.levelSets.get(name);
    if (cached) return cached;
    const set = (await this.loader(`levels/${name}.json`)) as LevelSet;
    this.levelSets.set(name, set);
    return set;
  }

  getStatic(id: number): string {
    return this.lang.statics[id] ?? '';
  }

  /** `Lang.get`: null when the language has no such text. */
  getLangText(id: number): string | null {
    return this.lang.statics[id] ?? null;
  }

  getItemName(id: number): string {
    return this.lang.items[id] ?? '';
  }

  /** `Lang.getFamilyName` */
  getFamilyName(id: number): string {
    return this.lang.families[id] ?? '';
  }

  /** `Lang.getQuestName` */
  getQuestName(id: number): string {
    return this.lang.quests[id]?.title ?? '';
  }

  /** `Lang.getQuestDesc` */
  getQuestDesc(id: number): string {
    return this.lang.quests[id]?.desc ?? '';
  }

  /** `Lang.getLevelName`: the name of level `lid` itself, null for most levels. */
  getLevelName(did: number, lid: number): string | null {
    return this.lang.levels[did]?.[lid] ?? null;
  }

  getSectorName(did: number, lid: number): string {
    const dim = this.lang.levels[did];
    if (!dim) return '';
    for (let l = lid; l >= 0; l--) {
      if (dim[l]) return dim[l];
    }
    return '';
  }

  /**
   * Port of `Data.getRandFromFamilies`: a RandomManager table indexed by item id, holding the
   * rarity weight of every item in the given families. Ids not in those families are holes.
   */
  getRandFromFamilies(familySet: ItemFamily[], familiesId: readonly number[]): number[] {
    const tab: number[] = [];
    for (const fid of familiesId) {
      const family = familySet.find((f) => f.id === fid);
      if (!family) continue;
      for (const it of family.items) {
        tab[it.id] = Data.RARITY[it.rarity];
      }
    }
    return tab;
  }
}
