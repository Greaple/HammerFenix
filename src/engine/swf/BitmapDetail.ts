/**
 * Which bitmap set to load (port addition, for big screens such as a TV): the SWF's own bitmaps
 * (1), or their upscales, 2x or 4x (`public/gfx/bitmaps-x2/`, `-x4/`, see `tools/build-site.ts`).
 * Everything else the game draws is vector, which the renderer already draws at the frame's
 * size on screen; the bitmaps (level backgrounds, platform textures, decor) would stay blurry.
 *
 * Picked from the screen, as the frame can grow to fill it: how many device pixels a stage
 * pixel gets in full screen. 4x from 3.5 (a 4K TV, a 5K monitor), 2x from 1.5 (a 1080p screen,
 * a Retina laptop). Phones and tablets get at most 2x: the 4x set takes about 190 MB once
 * decoded. `?hd=1`, `?hd=2` or `?hd=4` in the address forces a set and keeps it
 * (`localStorage`), `?hd=auto` goes back to the screen's (the Ruffle comparisons need `?hd=1`).
 */
export type BitmapScale = 1 | 2 | 4;

const STORAGE_KEY = 'hammerfenix_hd_v1';

function parse(v: string | null): BitmapScale | null {
  return v === '1' ? 1 : v === '2' ? 2 : v === '4' ? 4 : null;
}

/** The set for this screen, or the one forced by `?hd=`. */
export function pickBitmapScale(): BitmapScale {
  if (typeof window === 'undefined') return 1;
  const param = new URLSearchParams(window.location.search).get('hd');
  try {
    if (param === 'auto') localStorage.removeItem(STORAGE_KEY);
    else if (parse(param)) localStorage.setItem(STORAGE_KEY, param!);
  } catch {
    // No storage: the address still applies to this page
  }
  let forced = parse(param);
  if (!forced) {
    try {
      forced = parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      forced = null;
    }
  }
  if (forced) return forced;

  const sw = window.screen?.width || window.innerWidth;
  const sh = window.screen?.height || window.innerHeight;
  const scale = Math.min(sw / 420, sh / 520) * (window.devicePixelRatio || 1);
  const touchOnly =
    window.matchMedia?.('(pointer: coarse)').matches &&
    !window.matchMedia?.('(any-pointer: fine)').matches;
  const best: BitmapScale = scale >= 3.5 ? 4 : scale >= 1.5 ? 2 : 1;
  return touchOnly ? (Math.min(best, 2) as BitmapScale) : best;
}
