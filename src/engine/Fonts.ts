/**
 * The game's own fonts: the outlines embedded in `_gfx.swf`, written as OpenType files by
 * `tools/build-fonts.ts`. They are registered under the family names the SWF text fields use
 * (`SwfMovieClip`) and the site screens (`Shell`), so canvas text draws in them.
 */

/** Family name and file in `public/fonts/` (same list as `FONT_FILES` in the tool). */
const FONTS: [string, string][] = [
  ['Franklin Gothic Heavy', 'franklin-gothic-heavy.otf'],
  ['Satans', 'satans.otf'],
  ['Impact', 'impact.otf'],
];

/**
 * Loads the fonts. Each covers every weight, so a bold style uses the outline as it is
 * instead of a synthetic bold (the SWF's Franklin Gothic Heavy is already heavy). A font that
 * fails to load leaves its fallback.
 */
export async function loadGameFonts(baseUrl: string): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  await Promise.all(
    FONTS.map(async ([family, file]) => {
      try {
        const face = new FontFace(family, `url(${baseUrl}fonts/${file})`, { weight: '100 900' });
        document.fonts.add(await face.load());
      } catch {
        // keep the fallback font
      }
    }),
  );
}
