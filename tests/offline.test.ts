import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offlineFiles, serviceWorker } from '../tools/vite-plugin-offline';

describe('offline play (5.3)', () => {
  it('caches the build, without the Ruffle side-by-side, source maps or itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'igorsquest-offline-'));
    for (const f of [
      'index.html',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'gfx/library.json',
      'original-swf/game.swf',
      'sw.js',
    ]) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), f);
    }
    expect(offlineFiles(dir)).toEqual(['assets/index-abc.js', 'gfx/library.json', 'index.html']);
  });

  it('writes a service worker that is valid JavaScript and lists every file', () => {
    const src = serviceWorker('0123456789ab', ['index.html', 'gfx/library.json']);
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain("const CACHE = 'igorsquest-0123456789ab';");
    // The caches of the builds named HammerFenix go too
    const old = /\.filter\(\(k\) => (\/.*\/)\.test\(k\)/.exec(src)![1];
    const prefix = new RegExp(old.slice(1, -1));
    expect(['igorsquest-1', 'hammerfenix-1', 'other-1'].map((k) => prefix.test(k))).toEqual([
      true,
      true,
      false,
    ]);
    expect(src).toContain('["./","index.html","gfx/library.json"]');
    expect(src).toContain('ignoreVary: true');
  });

  it('keeps the HD bitmaps for their first fetch, not the install', () => {
    const src = serviceWorker('0123456789ab', ['gfx/bitmaps/b4.jpg', 'gfx/bitmaps-x4/b4.jpg']);
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('["./","gfx/bitmaps/b4.jpg"]');
    const onDemand = /(\/.*\/)\.test\(new URL\(req\.url\)\.pathname\)/.exec(src)![1];
    const re = new RegExp(onDemand.slice(1, -1));
    expect(re.test('/IgorsQuest/gfx/bitmaps-x4/b4.jpg')).toBe(true);
    expect(re.test('/gfx/bitmaps-x2/b4.a.png')).toBe(true);
    expect(re.test('/gfx/bitmaps/b4.jpg')).toBe(false);
  });

  it('declares the manifest and icons the page links to', () => {
    const root = join(__dirname, '..');
    const html = readFileSync(join(root, 'index.html'), 'utf-8');
    const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf-8'));
    expect(html).toContain('href="./manifest.webmanifest"');
    const icons = [
      ...manifest.icons.map((i: { src: string }) => i.src),
      ...[...html.matchAll(/href="\.\/(icons\/[^"]+)"/g)].map((m) => m[1]),
    ];
    expect(icons.length).toBeGreaterThanOrEqual(5);
    for (const f of icons) expect(() => readFileSync(join(root, 'public', f))).not.toThrow();
    const png = readFileSync(join(root, 'public/icons/icon-512.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
  });
});
