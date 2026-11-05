/**
 * Copies the few hammerfest.fr site images the app uses (roadmap 3.1: the menu screens and the
 * page scenery) from `assets-src/site-archive/` to `public/site/`, keeping the site's paths.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = 'assets-src/site-archive';
const OUT = 'public/site';

const FILES = [
  // Page scenery: the site's sky and hills (`src/style.css`)
  'hammerfest.fr/img/design/stars.jpg',
  'hammerfest.fr/img/design/landscape.jpg',
  // Logo banner of the menu screens (`src/ui/Shell.ts`)
  'hammerfest.fr/img/design/headers/fr/header.jpg',
  // Mode icons of the site menu, one per mode
  ...['iadv', 'itutorial', 'itatt', 'imulticoop', 'imultitime', 'isoccer', 'ibossrush'].map(
    (n) => `hammerfest.fr/img/design/menu/${n}.gif`,
  ),
];

for (const f of FILES) {
  const out = join(OUT, f.replace(/^hammerfest\.fr\//, ''));
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(SRC, f), out);
}
console.log(`site: ${FILES.length} files copied to ${OUT}`);
