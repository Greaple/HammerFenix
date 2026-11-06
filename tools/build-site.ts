/**
 * Copies the few site images the app uses (roadmap 3.1: the menu screens and the page scenery)
 * from `assets-src/site-archive/` to `public/site/`, keeping the site's paths. They are
 * hammerfest.fr's, except the English and Spanish logo banners (roadmap 3.4).
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = 'assets-src/site-archive';
const OUT = 'public/site';

const FILES = [
  // Page scenery: the site's sky and hills (`src/style.css`)
  'hammerfest.fr/img/design/stars.jpg',
  'hammerfest.fr/img/design/landscape.jpg',
  // Logo banner of the menu screens (`src/ui/Shell.ts`), one per language: each site's own
  // (`lang_es.css` of hammerfest.es swaps it; hfest.net had the English one)
  'hammerfest.fr/img/design/headers/fr/header.jpg',
  'hfest.net/img/design/headers/en/header.jpg',
  'hammerfest.es/img/design/headers/es/header.jpg',
  // Mode icons of the site menu, one per mode
  ...['iadv', 'itutorial', 'itatt', 'imulticoop', 'imultitime', 'isoccer', 'ibossrush'].map(
    (n) => `hammerfest.fr/img/design/menu/${n}.gif`,
  ),
  // Tabs of the quest and fridge screens, and the fridge's unknown item
  ...['icon_quests', 'icon_inventory'].flatMap((n) => [
    `hammerfest.fr/img/design/${n}.png`,
    `hammerfest.fr/img/design/${n}_on.png`,
  ]),
  'hammerfest.fr/img/items/small/a.gif',
];

for (const f of FILES) {
  // The site's paths without the domain: the three sites shared them
  const out = join(OUT, f.replace(/^[^/]+\//, ''));
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(SRC, f), out);
}
console.log(`site: ${FILES.length} files copied to ${OUT}`);
