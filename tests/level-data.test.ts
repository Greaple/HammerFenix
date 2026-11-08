import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { PersistCodec, type PersistValue } from '../src/engine/codec/PersistCodec';
import { SwfLibrary } from '../src/engine/swf/SwfLibrary';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import type { SwfLibraryData } from '../src/engine/swf/types';
import { Data } from '../src/game/Data';
import type { LevelData, LevelSet } from '../src/game/data/types';
import { LevelView } from '../src/game/levels/LevelView';
import { LevelWorld } from '../src/game/levels/LevelWorld';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

/**
 * Roadmap 2B.0: the level data the port plays is the original's, and every value in it is one
 * the engine and the SWF handle. Reads every set of `xml/levels/` (`levels.SetManager` reads one
 * level per `:`-separated chunk, with `PersistCodec`).
 */

const ROOT = join(__dirname, '..');
const XML_DIR = join(ROOT, 'assets-src/original/xml/levels');
const SETS = readdirSync(XML_DIR)
  .filter((f) => f.endsWith('.xml'))
  .map((f) => f.slice(0, -'.xml'.length))
  .sort();

/** The original level objects of a set, keys still `$`-prefixed (`levels.Data`). */
type RawLevel = {
  $map: number[][];
  $badList: { $id: number; $x: number; $y: number }[];
  $playerX: number;
  $playerY: number;
  $skinTiles: number;
  $skinBg: number;
  $specialSlots: { $x: number; $y: number }[];
  $scoreSlots: { $x: number; $y: number }[];
  $script: string;
};

function readChunks(set: string): string[] {
  return readFileSync(join(XML_DIR, `${set}.xml`), 'utf8')
    .replace(/^﻿/, '')
    .trim()
    .split(':');
}

const decode = (chunk: string) => new PersistCodec().decode(chunk) as unknown as RawLevel;

const pt = (p: { $x: number; $y: number }) => ({ x: p.$x, y: p.$y });

/** What the game reads from the built JSON, written out field by field from the original. */
function expectedLevel(l: RawLevel): LevelData {
  return {
    map: l.$map,
    badList: l.$badList.map((b) => ({ id: b.$id, x: b.$x, y: b.$y })),
    playerX: l.$playerX,
    playerY: l.$playerY,
    skinTiles: l.$skinTiles,
    skinBg: l.$skinBg,
    specialSlots: l.$specialSlots.map(pt),
    scoreSlots: l.$scoreSlots.map(pt),
    script: l.$script,
  };
}

/** `SetManager.flip`: only the map and the player's start move (the rest is commented out). */
function originalFlip(l: LevelData): LevelData {
  return {
    ...l,
    playerX: Data.LEVEL_WIDTH - l.playerX - 1,
    map: l.map.map((_, x) => l.map[Data.LEVEL_WIDTH - x - 1].slice()),
  };
}

/** `SetManager.unserialize` + `GameMechanics.parseWalls`, on a copy. */
function originalRead(l: LevelData): number[][] {
  const map = l.map.map((col) => col.slice());
  for (let cy = 0; cy < Data.LEVEL_HEIGHT; cy++) {
    for (let cx = 0; cx < Data.LEVEL_WIDTH; cx++) {
      if (map[cx][cy] === Data.WALL) map[cx][cy] = Data.GROUND; // convertWalls
    }
  }
  for (let cy = 0; cy < Data.LEVEL_HEIGHT; cy++) {
    for (let cx = 0; cx < Data.LEVEL_WIDTH; cx++) {
      if (map[cx][cy] > 0 && map[cx][cy - 1] > 0) map[cx][cy] = Data.WALL; // parseWalls
    }
  }
  return map;
}

/** `GameMode.attachBad`: the class each enemy id makes (BAD_FIREBALL has no case there). */
const BAD_CLASSES: Record<number, string> = {
  [Data.BAD_POMME]: 'PommeBad',
  [Data.BAD_CERISE]: 'CeriseBad',
  [Data.BAD_BANANE]: 'BananeBad',
  [Data.BAD_ANANAS]: 'AnanasBad',
  [Data.BAD_ABRICOT]: 'AbricotBad',
  [Data.BAD_ABRICOT2]: 'AbricotBad',
  [Data.BAD_POIRE]: 'PoireBad',
  [Data.BAD_BOMBE]: 'BombeBad',
  [Data.BAD_ORANGE]: 'OrangeBad',
  [Data.BAD_FRAISE]: 'FraiseBad',
  [Data.BAD_CITRON]: 'CitronBad',
  [Data.BAD_BALEINE]: 'BaleineBad',
  [Data.BAD_SPEAR]: 'SpearBad',
  [Data.BAD_CRAWLER]: 'CrawlerBad',
  [Data.BAD_TZONGRE]: 'TzongreBad',
  [Data.BAD_SAW]: 'SawBad',
  [Data.BAD_LITCHI]: 'LitchiBad',
  [Data.BAD_KIWI]: 'KiwiBad',
  [Data.BAD_LITCHI_WEAK]: 'LitchiWeakBad',
  [Data.BAD_FRAMBOISE]: 'FramboiseBad',
};

/** `View.getTileSkinId` and `View.getColumnSkinId`: an id from 100 holds column * 100 + tile. */
const OriginalSkins = {
  tile: (id: number) => (id >= 100 ? id - Math.floor(id / 100) * 100 : id),
  column: (id: number) => (id >= 100 ? Math.floor(id / 100) : id),
};

const inBounds = (x: number, y: number) =>
  Number.isInteger(x) &&
  Number.isInteger(y) &&
  x >= 0 &&
  x < Data.LEVEL_WIDTH &&
  y >= 0 &&
  y < Data.LEVEL_HEIGHT;

describe('level data (2B.0)', () => {
  it('reads all 17 sets of xml/levels', () => {
    expect(SETS).toHaveLength(17);
  });

  describe.each(SETS)('%s', (set) => {
    const chunks = readChunks(set);
    const levels = chunks.map(decode);
    const built = JSON.parse(
      readFileSync(join(ROOT, 'public/data/levels', `${set}.json`), 'utf8'),
    ) as LevelSet;

    it('decodes losslessly: encoding each level again gives the original string', () => {
      const changed = chunks
        .map((c, i) =>
          new PersistCodec().encode(levels[i] as unknown as PersistValue) === c ? -1 : i,
        )
        .filter((i) => i >= 0);
      expect(changed).toEqual([]);
    });

    it('built JSON holds the same levels', () => {
      expect(built.name).toBe(set);
      expect(built.levels).toEqual(levels.map(expectedLevel));
    });

    it('every value is in the shape and range the engine reads', () => {
      const problems: string[] = [];
      levels.forEach((l, i) => {
        const at = (msg: string) => problems.push(`${set}:${i} ${msg}`);
        if (l.$map.length !== Data.LEVEL_WIDTH) at(`map width ${l.$map.length}`);
        l.$map.forEach((col, x) => {
          if (col.length !== Data.LEVEL_HEIGHT) at(`column ${x} height ${col.length}`);
          // Tiles: 0 empty, GROUND, or a field (FIELD_PEACE -11 to -1). No WALL: walls are found
          // when the level is read (parseWalls).
          for (const t of col)
            if (!Number.isInteger(t) || t < Data.FIELD_PEACE || t > Data.GROUND) at(`tile ${t}`);
        });
        if (!inBounds(l.$playerX, l.$playerY)) at(`player ${l.$playerX},${l.$playerY}`);
        for (const b of l.$badList) {
          if (BAD_CLASSES[b.$id] === undefined) at(`enemy id ${b.$id}`);
          if (!inBounds(b.$x, b.$y)) at(`enemy at ${b.$x},${b.$y}`);
        }
        for (const s of [...l.$specialSlots, ...l.$scoreSlots]) {
          if (!s || !inBounds(s.$x, s.$y)) at(`item slot ${JSON.stringify(s)}`);
        }
        if (!Number.isInteger(l.$skinBg) || l.$skinBg < 1) at(`skinBg ${l.$skinBg}`);
        if (!Number.isInteger(l.$skinTiles) || l.$skinTiles < 1) at(`skinTiles ${l.$skinTiles}`);
        if (typeof l.$script !== 'string') at(`script ${typeof l.$script}`);
      });
      expect(problems).toEqual([]);
    });

    it.each([false, true])(
      'the port reads each level as the original does (mirror %s)',
      (mirror) => {
        const world = new LevelWorld(built);
        world.fl_mirror = mirror;
        world.resetForNewGame();
        const wrong = levels
          .map((l, i) => {
            const read = world.getLevel(i);
            let want = expectedLevel(l);
            if (mirror) want = originalFlip(want);
            want = { ...want, map: originalRead(want) };
            return isDeepStrictEqual(read, want) ? -1 : i;
          })
          .filter((i) => i >= 0);
        expect(wrong).toEqual([]);
      },
    );
  });

  describe('graphics and entities for every value used', () => {
    const all = SETS.flatMap((set) => readChunks(set).map(decode));
    const lib = SwfLibrary.headless(
      JSON.parse(readFileSync(join(ROOT, 'public/gfx/library.json'), 'utf8')) as SwfLibraryData,
    );
    const frames = (mc: SwfMovieClip | null | undefined) => mc?._totalframes ?? 0;
    const unique = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

    it('every background is a frame of hammer_bg (View.attachBg)', () => {
      const count = frames(lib.attach('hammer_bg'));
      expect(unique(all.map((l) => l.$skinBg)).filter((s) => s > count)).toEqual([]);
    });

    it('every tile and column skin is a frame of tile.skin and tile.endTile (View.attachTile)', () => {
      const tile = lib.attach('tile');
      const skins = unique(
        all.flatMap((l) => [OriginalSkins.tile(l.$skinTiles), OriginalSkins.column(l.$skinTiles)]),
      );
      for (const l of all) {
        expect(LevelView.getTileSkinId(l.$skinTiles)).toBe(OriginalSkins.tile(l.$skinTiles));
        expect(LevelView.getColumnSkinId(l.$skinTiles)).toBe(OriginalSkins.column(l.$skinTiles));
      }
      const count = Math.min(frames(tile.skin), frames(tile.endTile));
      expect(count).toBeGreaterThan(0);
      expect(skins.filter((s) => s < 1 || s > count)).toEqual([]);
    });

    it('every field is a frame of field.skin (View.attachField)', () => {
      const count = frames(lib.attach('field').skin);
      const fields = unique(all.flatMap((l) => l.$map.flat().filter((t) => t < 0)));
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.map(Math.abs).filter((f) => f > count)).toEqual([]);
    });

    describe('every enemy id makes its class (GameMode.attachBad)', () => {
      let session: GameSession;
      beforeAll(async () => {
        session = await createHeadlessSession();
      });
      const ids = unique(all.flatMap((l) => l.$badList.map((b) => b.$id)));
      it.each(ids)('id %i', (id) => {
        const bad = session.attachBad(id, 100, 100) as { constructor: { name: string } } & {
          fl_spawner?: boolean;
        };
        expect(bad.constructor.name).toBe(BAD_CLASSES[id]);
        if (id === Data.BAD_ABRICOT) expect(bad.fl_spawner).toBe(true);
        if (id === Data.BAD_ABRICOT2) expect(bad.fl_spawner).toBe(false);
      });
    });
  });
});
