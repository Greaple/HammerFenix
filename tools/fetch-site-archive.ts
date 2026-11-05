/**
 * Downloads the archived hammerfest.fr site files listed in `assets-src/site-archive/manifest.json`
 * from the Wayback Machine. Files already on disk are skipped, so it can be re-run after a failure.
 *
 *   npx tsx tools/fetch-site-archive.ts [--force]
 *
 * The Wayback Machine refuses connections when hit too fast, so requests are spaced out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface Entry {
  /** Path under `assets-src/site-archive/` */
  path: string;
  /** Original URL */
  url: string;
  /** Wayback timestamp of the capture */
  timestamp: string;
}

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'assets-src/site-archive');
const force = process.argv.includes('--force');
const entries: Entry[] = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')).files;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
for (const e of entries) {
  const dest = join(DIR, e.path);
  if (!force && existsSync(dest)) continue;
  // `id_` asks for the original bytes, without the Wayback toolbar or rewritten links
  const src = `https://web.archive.org/web/${e.timestamp}id_/${e.url}`;
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    try {
      const res = await fetch(src);
      // Not archived: retrying will not help
      if (res.status === 404) {
        console.warn(`missing ${e.path}`);
        break;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`ok ${e.path}`);
      ok = true;
    } catch (err) {
      console.warn(`retry ${attempt + 1} ${e.path}: ${(err as Error).message}`);
      await sleep(60_000 * (attempt + 1));
    }
  }
  if (!ok) failed++;
  await sleep(6000);
}
console.log(failed ? `${failed} files failed` : 'done');
