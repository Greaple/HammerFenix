/**
 * Writes a greppable copy of the original Motion Twin sources to `.cache/original/`.
 *
 * The files in `assets-src/original/class` use old Mac CR line endings and Latin-1,
 * so grep and line-based reads fail on them. This converts them to LF + UTF-8 and
 * also writes `.cache/original/INDEX.txt`: one line per file listing its functions.
 *
 * Usage: npm run orig
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const SRC = 'assets-src/original/class';
const OUT = '.cache/original';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const index: string[] = [];
for (const file of walk(SRC).sort()) {
  const rel = relative(SRC, file);
  const text = new TextDecoder('latin1').decode(readFileSync(file)).replace(/\r\n?/g, '\n');
  const out = join(OUT, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);

  const lines = text.split('\n').length;
  const fns = [...text.matchAll(/function\s+([A-Za-z_0-9]+)/g)].map((m) => m[1]);
  index.push(`${rel} (${lines}): ${[...new Set(fns)].join(' ')}`);
}

writeFileSync(join(OUT, 'INDEX.txt'), index.join('\n') + '\n');
console.log(`Normalized ${index.length} files into ${OUT}/ (see INDEX.txt)`);
