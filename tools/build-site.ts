/**
 * Copies the images the site screens use that are not in the SWFs (`src/ui/Shell.ts`): the
 * game's title logo, `assets-src/original/images/mainTitle.png`. The screens draw everything
 * else from the SWFs (UI batch U.2), and the page around the frame has its own picture
 * (`public/scenery/`).
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILES: [string, string][] = [
  ['assets-src/original/images/mainTitle.png', 'public/images/mainTitle.png'],
];

for (const [src, out] of FILES) {
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(src, out);
}
console.log(`site: ${FILES.length} files copied`);
