import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { LevelData, LevelSet, PortalLink, PortalLinksData } from '../src/game/data/types';
import { BaseEntity } from '../src/game/entity/Entity';
import { SYSTEM_FAMILIES } from '../src/game/GameParameters';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

/**
 * Roadmap 2B.1: the links of `xml/portalLinks.xml` against the levels they join, then every
 * reachable link taken headless, from the portal to the arrival case.
 *
 * Portal ids (`GameMode.usePortal`, `Data.getLink`): a portal field's id is its index in the
 * level's `portalList`, filled as `View.attachField` meets the fields; a floating portal
 * (`e_openPortal`) and the `e_portal` event carry theirs. On arrival (`getPortalEntrance`), an
 * id that is not in `portalList` puts the player at the level's start, knocked.
 */

const DATA = join(__dirname, '../public/data');
/** `Adventure.initWorld`: the dimensions, in `did` order (`xml_dev` only in dev mode). */
const DIMS = ['adventure', 'deepnight', 'hiko', 'ayame', 'hk'];
const sets = DIMS.map(
  (d) => (JSON.parse(readFileSync(join(DATA, 'levels', `${d}.json`), 'utf8')) as LevelSet).levels,
);
const { tags, links } = JSON.parse(
  readFileSync(join(DATA, 'portalLinks.json'), 'utf8'),
) as PortalLinksData;

const name = (did: number, lid: number, pid?: number) =>
  `${DIMS[did] ?? did}:${lid}${pid === undefined ? '' : `(${pid})`}`;
const fromName = (l: PortalLink) => name(l.from_did, l.from_lid, l.from_pid);
const toName = (l: PortalLink) => name(l.to_did, l.to_lid, l.to_pid);
const level = (did: number, lid: number): LevelData | undefined => sets[did]?.[lid];

/** `View.attachField` order: the portal fields of a map, as `portalList` holds them. */
function fieldPortals(map: number[][]): { cx: number; cy: number }[] {
  const done = map.map((col) => col.map(() => false));
  const out: { cx: number; cy: number }[] = [];
  for (let y = 0; y < Data.LEVEL_HEIGHT; y++) {
    for (let x = 0; x < Data.LEVEL_WIDTH; x++) {
      const id = map[x][y];
      if (id >= 0 || done[x][y]) continue;
      if (map[x + 1]?.[y] === id) {
        for (let i = x; map[i]?.[y] === id; i++) done[i][y] = true;
      } else if (map[x][y + 1] === id) {
        for (let i = y; map[x][i] === id; i++) done[x][i] = true;
      }
      if (id === Data.FIELD_PORTAL) out.push({ cx: x, cy: y });
    }
  }
  return out;
}

/** A script trigger's name and integer attributes (`$x`, `$y`, `$t`...). */
interface Trigger {
  name: string;
  attrs: Record<string, number>;
}

const readAttrs = (src: string): Record<string, number> =>
  Object.fromEntries([...src.matchAll(/\$(\w+)="(-?\d+)"/g)].map((m) => [m[1], Number(m[2])]));

/** Floating portals a level script opens (`e_openPortal`) by id, with the trigger around each. */
function scriptPortals(script: string): Map<number, { cx: number; cy: number; trigger?: Trigger }> {
  const out = new Map<number, { cx: number; cy: number; trigger?: Trigger }>();
  const open: Trigger[] = [];
  for (const m of script.matchAll(/<(\/?)\$(\w+)([^>]*?)(\/?)>/g)) {
    const [, closing, tag, src, selfClosing] = m;
    if (closing) {
      open.pop();
    } else if (tag === 'e_openPortal') {
      const a = readAttrs(src);
      if (!out.has(a.pid)) out.set(a.pid, { cx: a.x, cy: a.y, trigger: open.at(-1) });
    } else if (!selfClosing) {
      open.push({ name: tag, attrs: readAttrs(src) });
    }
  }
  return out;
}

/** Ids of the `e_portal` events of a level script (a portal taken from the script). */
const scriptPortalEvents = (script: string) =>
  [...script.matchAll(/<\$e_portal\b[^>]*\$pid="(-?\d+)"/g)].map((m) => Number(m[1]));

/**
 * `GameMode.getPortalEntrance`, read from the target level's data. Mirrored, the map is read
 * flipped (`SetManager.flip`) and each row's portals reversed (`SetManager.flipPortals`).
 */
function expectedEntrance(l: PortalLink, mirror: boolean) {
  const lv = level(l.to_did, l.to_lid)!;
  const flipX = (x: number) => (mirror ? Data.LEVEL_WIDTH - x - 1 : x);
  const map = lv.map.map((_, x) => lv.map[flipX(x)]);
  // SetManager.getCase: off the map is OUT_WALL, except above it; the top row is never a floor
  const at = (x: number, y: number) => {
    if (x < 0 || x >= Data.LEVEL_WIDTH || y >= Data.LEVEL_HEIGHT) return Data.OUT_WALL;
    if (y <= 0) return map[x][0] > 0 ? Data.WALL : 0;
    return map[x][y];
  };
  let portals = fieldPortals(map);
  if (mirror) {
    const rows = [...new Set(portals.map((p) => p.cy))].sort((a, b) => a - b);
    portals = rows.flatMap((y) => portals.filter((p) => p.cy === y).reverse());
  }
  const portal = l.to_pid >= 0 ? portals[l.to_pid] : undefined;
  if (!portal) return { x: flipX(lv.playerX), y: lv.playerY, unstable: true };
  let { cx: px, cy: py } = portal;
  if (at(px, py + 1) === Data.FIELD_PORTAL) {
    while (at(px, py + 1) === Data.FIELD_PORTAL) py++;
    if (at(px - 1, py) <= 0) px -= 1;
    else if (at(px + 1, py) <= 0) px += 1;
    return { x: px, y: py, unstable: false };
  }
  if (at(px + 1, py) === Data.FIELD_PORTAL) py += 2;
  return { x: px, y: py, unstable: true };
}

/** The link `Data.getLink` returns for a portal: the first one from it. */
const firstLinks = links.filter(
  (l, i) => links.findIndex((o) => fromName(o) === fromName(l)) === i,
);

describe('portal links (2B.1)', () => {
  it('every tag names a level of an Adventure dimension', () => {
    expect(tags.filter((t) => !level(t.did, t.lid)).map((t) => t.name)).toEqual([]);
  });

  it('every link joins two levels that exist', () => {
    const bad = links.filter((l) => !level(l.from_did, l.from_lid) || !level(l.to_did, l.to_lid));
    expect(bad.map((l) => `${fromName(l)} > ${toName(l)}`)).toEqual([]);
  });

  it('every link starts at a portal of its level', () => {
    const missing = links.filter((l) => {
      const lv = level(l.from_did, l.from_lid)!;
      return (
        l.from_pid >= fieldPortals(lv.map).length &&
        !scriptPortals(lv.script).has(l.from_pid) &&
        !scriptPortalEvents(lv.script).includes(l.from_pid)
      );
    });
    expect(missing.map(fromName)).toEqual([]);
  });

  // Quirks of the original data, kept as they are: the port must do the same with them.
  it('original quirks: links hidden by an earlier one from the same portal', () => {
    const hidden = links.filter((l) => !firstLinks.includes(l));
    expect(hidden.map((l) => `${fromName(l)} > ${toName(l)}`)).toEqual([
      'adventure:0(0) > hiko:0(-1)',
    ]);
  });

  it('original quirks: links that arrive at no portal field (the player starts at the level start)', () => {
    const noField = links.filter(
      (l) => l.to_pid >= 0 && l.to_pid >= fieldPortals(level(l.to_did, l.to_lid)!.map).length,
    );
    expect(noField.map(toName)).toEqual(['deepnight:0(0)']);
  });

  it('original quirks: portals with no link', () => {
    const unlinked: string[] = [];
    sets.forEach((levels, did) =>
      levels.forEach((lv, lid) => {
        const pids = new Set([
          ...fieldPortals(lv.map).keys(),
          ...scriptPortals(lv.script).keys(),
          ...scriptPortalEvents(lv.script),
        ]);
        for (const pid of pids) {
          if (!links.some((l) => fromName(l) === name(did, lid, pid))) {
            unlinked.push(name(did, lid, pid));
          }
        }
      }),
    );
    expect(unlinked).toEqual(['ayame:28(0)', 'ayame:34(0)']);
  });
});

describe.each([
  ['', false],
  [' (mirror option)', true],
])('taking every portal, headless (2B.1)%s', (_, mirror) => {
  let s: GameSession;
  beforeAll(async () => {
    s = await createHeadlessSession();
    s.setParameters(SYSTEM_FAMILIES, mirror ? Data.OPT_MIRROR : '');
  });

  const step = () => s.gameLoop.stepSingleFrame();
  /** Steps until the game unlocks (level parsed and shown). */
  function ready(max = 300): boolean {
    for (let i = 0; i < max; i++) {
      step();
      if (!s.game.fl_lock) return true;
    }
    return false;
  }

  /** Starts a game in the link's level, with its enemies gone so the level is clear. */
  function enter(l: PortalLink): void {
    s.startGame(l.from_did === 0 ? l.from_lid : 0, 1234);
    expect(s.game.fl_mirror).toBe(mirror);
    expect(ready()).toBe(true);
    if (l.from_did !== 0) {
      s.game.fl_clear = true;
      s.game.switchDimensionById(l.from_did, l.from_lid, -1);
      expect(ready()).toBe(true);
    }
    expect(name(s.game.currentDim, s.game.world.currentId)).toBe(name(l.from_did, l.from_lid));
    // Enemies come a frame after the unlock; the game then clears the level itself
    // (GameMode.checkLevelClear), which runs the script's $end blocks
    for (let i = 0; i < 60 && !(i > 2 && s.game.fl_clear); i++) {
      for (const b of s.game.getBads()) b.destroy();
      step();
    }
    expect(s.game.fl_clear).toBe(true);
    // The arrival knock of the setup (pid -1) would carry over to the portal's arrival
    for (let i = 0; i < 100 && s.game.player!.fl_knock; i++) step();
  }

  const left = (l: PortalLink) =>
    s.game.currentDim !== l.from_did || s.game.world.currentId !== l.from_lid;

  it.each(firstLinks.map((l) => [`${fromName(l)} > ${toName(l)}`, l] as const))('%s', (_, l) => {
    enter(l);
    const p = s.game.player!;
    const field = s.game.world.portalList[l.from_pid];
    const floating = scriptPortals(s.game.world.current.script).get(l.from_pid);
    // Script coordinates are flipped where they are used (GameMode.flipCoordCase)
    const fx = (cx: number) => s.game.flipCoordCase(cx);
    if (field) {
      // Entering the portal field: Physics.infix, run when the player changes case
      p.moveToCase(field.cx, field.cy);
      (p as unknown as { infix(): void }).infix();
    } else if (floating) {
      // The level script opens it (e_openPortal) when its trigger fires, with a position trigger
      // that takes the player in (ScriptEngine.insertPortal)
      const opened = () =>
        (s.game as unknown as { portalMcList: unknown[] }).portalMcList[l.from_pid];
      const t = floating.trigger;
      // A locked portal ($key) needs its key, found elsewhere in the game
      if (t?.attrs.key !== undefined) s.game.giveKey(t.attrs.key);
      for (let i = 0; i < 1500 && !opened(); i++) {
        if (t?.name === 'exp') {
          const x = s.game.flipCoordReal(BaseEntity.x_ctr(t.attrs.x));
          s.game.onExplode(x, BaseEntity.y_ctr(t.attrs.y), Data.CASE_WIDTH);
        } else if (t?.name === 't_pos') {
          p.moveToCase(fx(t.attrs.x), t.attrs.y);
        } else if (t?.name === 'enter') {
          s.game.onEnterCase(fx(t.attrs.x), t.attrs.y);
        }
        step();
      }
      expect(opened(), `opened by its ${t?.name} trigger`).toBeTruthy();
      p.moveToCase(fx(floating.cx), floating.cy);
    } else {
      // An e_portal event of the level script (the village's well, behind a key and a case)
      expect(s.game.usePortal(l.from_pid, null)).toBe(true);
    }
    for (let i = 0; i < 300 && !left(l); i++) {
      // Held at a floating portal until its trigger pulls the player in (GameMode.usePortal)
      if (floating && !field && !(s.game as unknown as { nextLink: unknown }).nextLink) {
        p.moveToCase(fx(floating.cx), floating.cy);
      }
      step();
    }
    expect(name(s.game.currentDim, s.game.world.currentId)).toBe(name(l.to_did, l.to_lid));
    expect(ready()).toBe(true);

    const want = expectedEntrance(l, mirror);
    expect({ x: p.cx, y: p.cy }).toEqual({ x: want.x, y: want.y });
    expect(p.fl_knock).toBe(want.unstable);
  });
});
