import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  DataManifest,
  ItemsData,
  LangData,
  LevelSet,
  PortalLinksData,
  QuestDef,
} from '../src/game/data/types';

const DATA_DIR = join(__dirname, '../public/data');

describe('Game Data Pipeline', () => {
  it('loads and validates public/data/manifest.json', () => {
    const raw = readFileSync(join(DATA_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(raw) as DataManifest;
    expect(manifest.version).toBe(1);
    expect(manifest.langs).toEqual(['en', 'es', 'fr']);
    expect(manifest.levelSets).toHaveLength(17);
    expect(manifest.levelSets).toContain('adventure');
    expect(manifest.levelSets).toContain('tutorial');
    expect(manifest.levelSets).toContain('deepnight');
  });

  it('loads and validates items.json', () => {
    const raw = readFileSync(join(DATA_DIR, 'items.json'), 'utf-8');
    const items = JSON.parse(raw) as ItemsData;
    expect(items.score.length).toBeGreaterThan(0);
    expect(items.special.length).toBeGreaterThan(0);

    const firstFamily = items.score[0];
    expect(firstFamily.id).toBeDefined();
    expect(firstFamily.items.length).toBeGreaterThan(0);
    expect(firstFamily.items[0].id).toBeDefined();
  });

  it('loads and validates quests.json', () => {
    const raw = readFileSync(join(DATA_DIR, 'quests.json'), 'utf-8');
    const quests = JSON.parse(raw) as QuestDef[];
    expect(quests.length).toBe(76);

    const q0 = quests[0];
    expect(q0.id).toBe(0);
    expect(q0.actions.length).toBeGreaterThan(0);
  });

  it('loads and validates portalLinks.json', () => {
    const raw = readFileSync(join(DATA_DIR, 'portalLinks.json'), 'utf-8');
    const links = JSON.parse(raw) as PortalLinksData;
    expect(links.links).toBeDefined();
    expect(links.links.length).toBeGreaterThan(0);

    const firstLink = links.links[0];
    expect(firstLink.from_did).toBeGreaterThanOrEqual(0);
    expect(firstLink.from_lid).toBeGreaterThanOrEqual(0);
    expect(firstLink.to_did).toBeGreaterThanOrEqual(0);
  });

  it('validates all 3 localization files (EN, ES, FR)', () => {
    for (const lang of ['en', 'es', 'fr']) {
      const p = join(DATA_DIR, `lang/${lang}.json`);
      expect(existsSync(p)).toBe(true);
      const raw = readFileSync(p, 'utf-8');
      const langData = JSON.parse(raw) as LangData;
      expect(langData.id).toBe(lang);
      expect(Object.keys(langData.items).length).toBeGreaterThan(0);
      expect(Object.keys(langData.statics).length).toBeGreaterThan(0);
      expect(Object.keys(langData.quests).length).toBeGreaterThan(0);
    }
  });

  it('validates all 17 compiled level set files in public/data/levels/', () => {
    const files = readdirSync(join(DATA_DIR, 'levels')).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(17);

    for (const file of files) {
      const raw = readFileSync(join(DATA_DIR, 'levels', file), 'utf-8');
      const set = JSON.parse(raw) as LevelSet;
      expect(set.name).toBeDefined();
      expect(set.levels.length).toBeGreaterThan(0);

      // Verify level 0 structure
      const l0 = set.levels[0];
      expect(l0.playerX).toBeGreaterThanOrEqual(0);
      expect(l0.playerY).toBeGreaterThanOrEqual(0);
      expect(l0.map).toBeDefined();
      expect(l0.map.length).toBe(20); // 20 columns
      expect(l0.badList).toBeDefined();
    }
  });
});
