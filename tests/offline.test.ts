import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offlineFiles, serviceWorker } from '../tools/vite-plugin-offline';

describe('offline play (5.3)', () => {
  it('caches the build, without the Ruffle side-by-side, source maps or itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hammerfenix-offline-'));
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
    expect(src).toContain("const CACHE = 'hammerfenix-0123456789ab';");
    expect(src).toContain('["./","index.html","gfx/library.json"]');
    expect(src).toContain('ignoreVary: true');
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
