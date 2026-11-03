/**
 * Build-time data pipeline: converts the original Hammerfest resources found
 * in `assets-src/original/xml` into JSON consumed by the game.
 *
 *   npm run assets
 *
 * Outputs to `public/data/`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PersistCodec, type PersistValue } from '../src/engine/codec/PersistCodec';
import type {
  DataManifest,
  ItemFamily,
  ItemsData,
  LangData,
  LevelData,
  LevelSet,
  LevelTag,
  PortalLink,
  PortalLinksData,
  QuestDef,
} from '../src/game/data/types';
import { child, int, parseXml, type XmlElement } from './lib/xml';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'assets-src/original/xml');
const OUT = join(ROOT, 'public/data');

const read = (p: string) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

function write(rel: string, data: unknown): void {
  const path = join(OUT, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

/** Recursively strips the `$` obfuscation prefix from object keys. */
function stripDollar(v: PersistValue): PersistValue {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : stripDollar(x)));
  if (v && typeof v === 'object') {
    const o: Record<string, PersistValue> = {};
    for (const [k, x] of Object.entries(v)) o[k.startsWith('$') ? k.slice(1) : k] = stripDollar(x);
    return o;
  }
  return v;
}

// ------------------------------------------------------------------ levels

function buildLevelSets(): string[] {
  const dir = join(SRC, 'levels');
  const names: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.xml'))
    .sort()) {
    const name = basename(file, '.xml');
    const raw = read(join(dir, file)).trim();
    const levels: LevelData[] = raw.split(':').map((chunk, i) => {
      const decoded = new PersistCodec().decode(chunk);
      if (!decoded) throw new Error(`${name}: failed to decode level #${i}`);
      return stripDollar(decoded) as unknown as LevelData;
    });
    const set: LevelSet = { name, levels };
    write(`levels/${name}.json`, set);
    names.push(name);
    console.log(`  levels/${name}.json  (${levels.length} levels)`);
  }
  return names;
}

// ------------------------------------------------------------------- items

function readFamilies(file: string): ItemFamily[] {
  const root = parseXml(read(join(SRC, file)));
  if (root.name !== 'items') throw new Error(`${file}: invalid root <${root.name}>`);
  return root.children.map((family) => ({
    id: int(family.attrs.id),
    items: family.children.map((item) => ({
      id: int(item.attrs.id),
      rarity: int(item.attrs.rarity),
      value: int(item.attrs.value),
      ...(item.attrs.unlock !== undefined ? { unlock: int(item.attrs.unlock) } : {}),
    })),
  }));
}

function buildItems(): void {
  const data: ItemsData = {
    special: readFamilies('specialItems.xml'),
    score: readFamilies('scoreItems.xml'),
  };
  write('items.json', data);
  console.log(
    `  items.json  (${data.special.length} special / ${data.score.length} score families)`,
  );
}

// ------------------------------------------------------------------ quests

function buildQuests(): void {
  const root = parseXml(read(join(SRC, 'quests.xml')));
  const quests: QuestDef[] = root.children.map((q) => ({
    id: int(q.attrs.id),
    actions: q.children.map((a) => ({ type: a.name, attrs: a.attrs })),
  }));
  write('quests.json', quests);
  console.log(`  quests.json  (${quests.length} quests)`);
}

// ------------------------------------------------------------ portal links

/** Port of Data.getLevelFromTag: "name" or "name+inc". */
function levelFromTag(tags: LevelTag[], code: string): { did: number; lid: number } | null {
  const lower = code.toLowerCase();
  const name = lower.split('+')[0];
  const inc = int(lower.split('+')[1]);
  let found: { did: number; lid: number } | null = null;
  for (const t of tags) if (t.name === name) found = { did: t.did, lid: t.lid + inc };
  return found;
}

function buildPortalLinks(): void {
  const root = parseXml(read(join(SRC, 'portalLinks.xml')));
  const tags: LevelTag[] = child(root, 'tags').children.map((t) => ({
    name: (t.attrs.name ?? '').toLowerCase(),
    did: int(t.attrs.did),
    lid: int(t.attrs.lid),
  }));

  const parseEnd = (att: string) =>
    att.replace(/\(/g, ',').replace(/\)/g, '').replace(/ /g, '').split(',');

  const links: PortalLink[] = [];
  for (const way of child(root, 'ways').children) {
    const from = parseEnd(way.attrs.from ?? '');
    const to = parseEnd(way.attrs.to ?? '');
    const lf = levelFromTag(tags, from[0]);
    const lt = levelFromTag(tags, to[0]);
    if (!lf || !lt)
      throw new Error(`portalLinks: unknown tag in ${way.attrs.from} > ${way.attrs.to}`);
    const link: PortalLink = {
      from_did: lf.did,
      from_lid: lf.lid,
      from_pid: int(from[1]),
      to_did: lt.did,
      to_lid: lt.lid,
      to_pid: int(to[1]),
    };
    links.push(link);
    if (way.name === 'twoway') {
      links.push({
        from_did: link.to_did,
        from_lid: link.to_lid,
        from_pid: link.to_pid,
        to_did: link.from_did,
        to_lid: link.from_lid,
        to_pid: link.from_pid,
      });
    }
  }
  const data: PortalLinksData = { tags, links };
  write('portalLinks.json', data);
  console.log(`  portalLinks.json  (${tags.length} tags, ${links.length} links)`);
}

// -------------------------------------------------------------------- lang

/** Port of Data.cleanString: trims spaces, converts CR to spaces. */
function cleanString(s: string): string {
  return s.replace(/^ +| +$/g, '').replace(/\r/g, ' ');
}

function buildLangs(): string[] {
  const dir = join(SRC, 'lang');
  const ids: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.xml'))
    .sort()) {
    const root = parseXml(read(join(dir, file)));
    const table = (node: string, attr: string): Record<number, string> => {
      const out: Record<number, string> = {};
      for (const e of child(root, node).children) out[int(e.attrs.id)] = e.attrs[attr] ?? '';
      return out;
    };
    const quests: LangData['quests'] = {};
    for (const q of child(root, 'quests').children) {
      quests[int(q.attrs.id)] = {
        title: q.attrs.title ?? '',
        desc: cleanString(q.text.replace(/\s*\n\s*/g, ' ').trim()),
      };
    }
    const levels: LangData['levels'] = {};
    for (const d of child(root, 'dimensions').children as XmlElement[]) {
      const names: Record<number, string> = {};
      for (const l of d.children) names[int(l.attrs.id)] = l.attrs.name ?? '';
      levels[int(d.attrs.id)] = names;
    }
    const data: LangData = {
      id: root.attrs.id ?? basename(file, '.xml'),
      debug: root.attrs.debug === '1',
      statics: table('statics', 'v'),
      items: table('items', 'name'),
      families: table('families', 'name'),
      quests,
      keys: table('keys', 'name'),
      levels,
    };
    write(`lang/${data.id}.json`, data);
    ids.push(data.id);
    console.log(`  lang/${data.id}.json  (${Object.keys(data.statics).length} strings)`);
  }
  return ids;
}

// -------------------------------------------------------------------- main

console.log('Building game data → public/data');
const levelSets = buildLevelSets();
buildItems();
buildQuests();
buildPortalLinks();
const langs = buildLangs();
const manifest: DataManifest = { version: 1, levelSets, langs };
write('manifest.json', manifest);
console.log('Done.');
