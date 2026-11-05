/**
 * Copies the hammerfest.fr site images used by the site-replacement screens (roadmap 3.1)
 * from `assets-src/site-archive/` to `public/site/`, keeping the site's own paths
 * (`img/design/...`), so the CSS rules port with only their root changed.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = 'assets-src/site-archive';
const OUT = 'public/site';

const FILES = [
  // Site frame (`.siteHeaderBg`, `.siteHeader`, `.siteBg`, `.siteContentBg`, `.siteContent`)
  'hammerfest.fr/img/design/stars.jpg',
  'hammerfest.fr/img/design/headers/fr/header.jpg',
  'hammerfest.fr/img/design/landscape.jpg',
  'hammerfest.fr/img/design/contentbg.gif',
  'hammerfest.fr/img/design/footer.jpg',
  // Tabs (`.icons`)
  'hammerfest.fr/img/design/icon_play.png',
  'hammerfest.fr/img/design/icon_play_on.png',
  'hammerfest.fr/img/design/icon_inventory.png',
  'hammerfest.fr/img/design/icon_inventory_on.png',
  'hammerfest.fr/img/design/icon_quests.png',
  'hammerfest.fr/img/design/icon_quests_on.png',
  'hammerfest.fr/img/design/icon_score.png',
  'hammerfest.fr/img/design/icon_score_on.png',
  'hammerfest.fr/img/design/snow_flake_blue.gif',
  'hammerfest.fr/img/design/pixel.gif',
  // Mode menu ("MENU CHOOSE GAME")
  ...[
    'menutop',
    'menubg',
    'menubot',
    'menubtop',
    'menubbg',
    'menubbot',
    'imenub',
    'arrow',
    'igorwonder',
    'iadv',
    'iadv_over',
    'itutorial',
    'itutorial_over',
    'itatt',
    'itatt_over',
    'imulticoop',
    'imulticoop_over',
    'imultitime',
    'imultitime_over',
    'isoccer',
    'isoccer_over',
    'ibossrush',
    'ibossrush_over',
  ].map((n) => `hammerfest.fr/img/design/menu/${n}.gif`),
];

for (const f of FILES) {
  const out = join(OUT, f.replace(/^hammerfest\.fr\//, ''));
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(SRC, f), out);
}
console.log(`site: ${FILES.length} files copied to ${OUT}`);
