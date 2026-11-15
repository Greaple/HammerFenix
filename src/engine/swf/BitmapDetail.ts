/**
 * Which bitmap set to load (port addition, for big screens such as a TV): the SWF's own bitmaps
 * (1), or their upscales, 2x or 4x (`public/gfx/bitmaps-x2/`, `-x4/`, see `tools/build-site.ts`).
 * Everything else the game draws is vector, which the renderer already draws at the frame's
 * size on screen; the bitmaps (level backgrounds, platform textures, decor) would stay blurry.
 *
 * By default picked from the screen, as the frame can grow to fill it: how many device pixels a
 * stage pixel gets in full screen. 4x from 3.5 (a 4K TV, a 5K monitor), 2x from 1.5 (a 1080p
 * screen, a Retina laptop). Phones and tablets get at most 2x: the 4x set takes about 190 MB
 * once decoded. The settings page's "HD pictures" row chooses a set and keeps it
 * (`localStorage`); so does `?hd=1`, `?hd=2` or `?hd=4` in the address, and `?hd=auto` goes back
 * to the screen's (the Ruffle comparisons need `?hd=1`). The library loads one set, so a new
 * choice applies when the page loads again.
 */
export type BitmapScale = 1 | 2 | 4;
/** The player's choice: a set, or the screen's (`auto`). */
export type BitmapChoice = 'auto' | BitmapScale;

const STORAGE_KEY = 'hammerfenix_hd_v1';

/** The set this page loaded, once `pickBitmapScale` ran. */
let loaded: BitmapScale | null = null;
/** A choice made without storage. */
let memory: BitmapChoice | null = null;

function parse(v: string | null): BitmapScale | null {
  return v === '1' ? 1 : v === '2' ? 2 : v === '4' ? 4 : null;
}

/** The set for this screen, for the `auto` choice. */
export function screenBitmapScale(): BitmapScale {
  if (typeof window === 'undefined') return 1;
  const sw = window.screen?.width || window.innerWidth;
  const sh = window.screen?.height || window.innerHeight;
  const scale = Math.min(sw / 420, sh / 520) * (window.devicePixelRatio || 1);
  const touchOnly =
    window.matchMedia?.('(pointer: coarse)').matches &&
    !window.matchMedia?.('(any-pointer: fine)').matches;
  const best: BitmapScale = scale >= 3.5 ? 4 : scale >= 1.5 ? 2 : 1;
  return touchOnly ? (Math.min(best, 2) as BitmapScale) : best;
}

/** The kept choice (`auto` when none, or without storage). */
export function savedBitmapChoice(): BitmapChoice {
  if (memory) return memory;
  try {
    return parse(localStorage.getItem(STORAGE_KEY)) ?? 'auto';
  } catch {
    return 'auto';
  }
}

/** Keeps a choice for the next loads. */
export function saveBitmapChoice(choice: BitmapChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(choice));
  } catch {
    // No storage: the choice lasts until the page closes
    memory = choice;
  }
}

/** The set a choice loads. */
export function bitmapScaleOf(choice: BitmapChoice): BitmapScale {
  return choice === 'auto' ? screenBitmapScale() : choice;
}

/** The set this page loaded (1 before the library loads). */
export function loadedBitmapScale(): BitmapScale {
  return loaded ?? 1;
}

/** The set to load: the one `?hd=` forces (and keeps), else the kept choice, else the screen's. */
export function pickBitmapScale(): BitmapScale {
  if (typeof window === 'undefined') return 1;
  const param = new URLSearchParams(window.location.search).get('hd');
  if (param === 'auto') saveBitmapChoice('auto');
  else if (parse(param)) saveBitmapChoice(parse(param)!);
  loaded = parse(param) ?? bitmapScaleOf(savedBitmapChoice());
  return loaded;
}
