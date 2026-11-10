/**
 * Level contact sheets (roadmap 2B.2), a dev page: `npm run dev`, then open
 * `/tools/level-sheets.html`. Each level is played until it shows (IA parse, `attach` scripts),
 * captured, and laid out on sheets that the dev server saves to `.cache/level-sheets/`.
 *
 * - `?sheet=skins`: one level per background and tile skin pair of the game's sets.
 * - `?sheet=worldmap`: Adventure 0 to 99 beside the original's world map thumbnails
 *   (`assets-src/original/worldmap`, 52 x 66: layout and background only; drawn from an older
 *   version of the levels). Options: `&set=`, `&from=`, `&to=`, `&scale=`.
 * - `?sheet=set&set=name`: every level of a set, or `&ids=1,2,3` only those.
 *
 * By default enemies, items, the player, effects and the darkness are hidden, as on the world map;
 * `&full=1` keeps them.
 */
import { Application, Rectangle } from 'pixi.js';
import { AudioEngine } from '../src/engine/Audio';
import { loadGameFonts } from '../src/engine/Fonts';
import { InputController } from '../src/engine/Input';
import { SwfLibrary } from '../src/engine/swf/SwfLibrary';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import { Data, GameDataStore } from '../src/game/Data';
import type { LevelData } from '../src/game/data/types';
import { GameSession } from '../src/game/GameSession';

/** The sets the original game loads (`swfmake.xml`). */
const GAME_SETS = [
  'adventure',
  'deepnight',
  'hiko',
  'ayame',
  'hk',
  'tutorial',
  'shareware',
  'fjv',
  'timeAttack',
  'multiTime',
  'soccer',
  'hof',
  'dev',
  'test',
];

const W = Data.DOC_WIDTH;
const H = Data.DOC_HEIGHT;
const params = new URLSearchParams(location.search);
const full = params.get('full') === '1';
const status = document.getElementById('status')!;
const out = document.getElementById('out')!;

const app = new Application();
await app.init({ width: W, height: H, backgroundColor: 0x000000, antialias: true });
app.ticker.stop();
const [dataStore, lib] = await Promise.all([
  GameDataStore.load('/', 'fr'),
  SwfLibrary.load('/'),
  loadGameFonts('/'),
]);
const session = await GameSession.create(
  app,
  lib,
  dataStore,
  new AudioEngine({}),
  new InputController(),
  'adventure',
);
session.stop();

const step = (n = 1) => {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
};

/** Plays a level until it shows, then a few frames for its `attach` scripts, and captures it. */
async function capture(set: string, id: number): Promise<HTMLCanvasElement> {
  if (session.currentSetName !== set) await session.changeSet(set, id);
  else session.startGame(id, 1234);
  for (let i = 0; i < 300 && session.game.fl_lock; i++) step();
  step(3);
  if (!full) {
    for (const e of session.game.getList(Data.ENTITY)) e.mc._visible = false;
    const dark = (session as unknown as { darknessMC: SwfMovieClip | null }).darknessMC;
    if (dark) dark._visible = false;
    // Effects (item spawn flashes) and the zone name banner
    session.game.fxMan.clear();
  }
  return app.renderer.extract.canvas({
    target: app.stage,
    frame: new Rectangle(0, 0, W, H),
    resolution: 1,
  }) as HTMLCanvasElement;
}

interface Cell {
  set: string;
  id: number;
  label: string;
  /** An original picture to show on the left. */
  original?: string;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** Draws cells on sheets of `cols` x `rows`, each level at `scale`, and saves them. */
async function sheets(name: string, cells: Cell[], cols: number, rows: number, scale: number) {
  const lw = Math.round(W * scale);
  const lh = Math.round(H * scale);
  const pair = cells.some((c) => c.original);
  const cw = (pair ? lw * 2 + 4 : lw) + 8;
  const ch = lh + 22;
  const perSheet = cols * rows;
  for (let page = 0; page * perSheet < cells.length; page++) {
    const part = cells.slice(page * perSheet, (page + 1) * perSheet);
    const sheet = document.createElement('canvas');
    sheet.width = cols * cw;
    sheet.height = Math.ceil(part.length / cols) * ch;
    const g = sheet.getContext('2d')!;
    g.fillStyle = '#222';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '11px system-ui, sans-serif';
    for (const [i, c] of part.entries()) {
      status.textContent = `${name}: ${c.label}`;
      const x = (i % cols) * cw + 4;
      const y = Math.floor(i / cols) * ch + 4;
      let lx = x;
      if (c.original) {
        const img = await loadImage(c.original);
        g.imageSmoothingEnabled = false;
        if (img) g.drawImage(img, x, y, lw, lh);
        g.imageSmoothingEnabled = true;
        lx += lw + 4;
      }
      g.drawImage(await capture(c.set, c.id), lx, y, lw, lh);
      g.fillStyle = '#ddd';
      g.fillText(c.label, x, y + lh + 13);
    }
    const file = `${name}-${String(page + 1).padStart(2, '0')}.png`;
    const blob = await new Promise<Blob>((r) => sheet.toBlob((b) => r(b!), 'image/png'));
    await fetch(`/__save?file=${file}`, { method: 'POST', body: blob });
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.title = file;
    out.append(img);
  }
}

const levels = async (set: string): Promise<LevelData[]> =>
  (await dataStore.loadLevelSet(set)).levels;

const sheet = params.get('sheet') ?? 'skins';
const suffix = full ? '-full' : '';
if (sheet === 'skins') {
  // One level per (background, tile skin) pair, the first that has it
  const seen = new Set<string>();
  const cells: Cell[] = [];
  for (const set of GAME_SETS) {
    for (const [id, l] of (await levels(set)).entries()) {
      const key = `${l.skinBg}/${l.skinTiles}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ set, id, label: `bg ${l.skinBg} tiles ${l.skinTiles} · ${set} ${id}` });
    }
  }
  await sheets(`skins${suffix}`, cells, 5, 4, 0.4);
} else if (sheet === 'worldmap') {
  const set = params.get('set') ?? 'adventure';
  const cells: Cell[] = [];
  const from = Number(params.get('from') ?? 0);
  const to = Number(params.get('to') ?? 99);
  for (let id = from; id <= to; id++) {
    const n = String(id).padStart(3, '0');
    cells.push({
      set,
      id,
      label: `${id} (left: original)`,
      original: `/assets-src/original/worldmap/niveau${n}.jpg`,
    });
  }
  const scale = Number(params.get('scale') ?? 0.3);
  const name = `worldmap${set === 'adventure' ? '' : `-${set}`}${from || to !== 99 ? `-${from}-${to}` : ''}`;
  await sheets(`${name}${suffix}`, cells, 5, 4, scale);
} else if (sheet === 'set') {
  const set = params.get('set') ?? 'adventure';
  const ids = params.get('ids')?.split(',').map(Number);
  const cells = (await levels(set))
    .map((_, id) => ({ set, id, label: `${set} ${id}` }))
    .filter((c) => !ids || ids.includes(c.id));
  await sheets(`set-${set}${ids ? '-some' : ''}${suffix}`, cells, 6, 5, ids ? 0.35 : 0.25);
}
status.textContent = 'Done: saved in .cache/level-sheets/';
