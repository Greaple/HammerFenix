/**
 * Copies the images the site screens use that are not in the SWFs (`src/ui/Shell.ts`): the
 * game's title logo. The original is `assets-src/original/images/mainTitle.png` (420 x 180);
 * the screens use its upscale (2000 x 857, transparent), made by the maintainer and kept in
 * `assets-src/upscaled/`. The screens draw everything else from the SWFs (UI batch U.2), and the
 * page around the frame has its own picture (`public/scenery/`).
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FILES: [string, string][] = [
  ['assets-src/upscaled/mainTitle.webp', 'public/images/mainTitle.webp'],
];

for (const [src, out] of FILES) {
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(src, out);
}
console.log(`site: ${FILES.length} files copied`);
