/**
 * Which language the app starts in (roadmap 3.4). The original got it from the site as `$lang`
 * (`Loader.mt`): `fr` on hammerfest.fr, `en` on hfest.net, `es` on hammerfest.es. The port has
 * one site, so it takes the player's last choice, else the browser's language, else English.
 */

/** The languages of the original's lang files (`xml/lang/`). */
export const LANGS = ['fr', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

function asLang(id: string | null | undefined): Lang | null {
  const l = id?.slice(0, 2).toLowerCase();
  return LANGS.find((x) => x === l) ?? null;
}

/**
 * @param saved the language saved by the last session, if any
 * @param browser `navigator.languages`, in order of preference (e.g. `['es-ES', 'en']`)
 */
export function pickLang(saved: string | null | undefined, browser: readonly string[]): Lang {
  const s = asLang(saved);
  if (s) return s;
  for (const b of browser) {
    const l = asLang(b);
    if (l) return l;
  }
  return 'en';
}
