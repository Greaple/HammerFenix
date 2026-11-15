/**
 * Copies the images that are not in the SWFs. The site screens (`src/ui/Shell.ts`) use the
 * game's title logo. The original is `assets-src/original/images/mainTitle.png` (420 x 180);
 * the screens use its upscale (2000 x 857, transparent), made by the maintainer and kept in
 * `assets-src/upscaled/`. The screens draw everything else from the SWFs (UI batch U.2), and the
 * page around the frame has its own picture (`public/scenery/`).
 *
 * Also the HD bitmaps (port addition, for big screens): every file of `public/gfx/bitmaps/`
 * upscaled 4x and 2x (`assets-src/upscaled/bitmaps-x4/`, `-x2/`, made by
 * `tools/upscale-bitmaps/`), copied to `public/gfx/bitmaps-x4/` and `-x2/`. `SwfLibrary` picks
 * a set from the screen's size.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILES: [string, string][] = [
  ['assets-src/upscaled/mainTitle.webp', 'public/images/mainTitle.webp'],
  // The results page's game over picture (`.artResult`), never archived: given by the maintainer
  ['assets-src/upscaled/gameOver.webp', 'public/images/gameOver.webp'],
];

for (const scale of [2, 4]) {
  const dir = `assets-src/upscaled/bitmaps-x${scale}`;
  for (const f of readdirSync(dir)) FILES.push([join(dir, f), `public/gfx/bitmaps-x${scale}/${f}`]);
}

for (const [src, out] of FILES) {
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(src, out);
}
console.log(`site: ${FILES.length} files copied`);
