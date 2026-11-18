/**
 * The game's fonts, written to `public/fonts/` by `tools/build-fonts.ts`. They are registered
 * under the family names the SWF text fields use (`SwfMovieClip`) and the site screens
 * (`Shell`), so canvas text draws in them.
 *
 * Satans is the outline embedded in `_gfx.swf`. Franklin Gothic Heavy and Impact, commercial
 * fonts, are free look-alikes under the SIL Open Font License (Libre Franklin Black, Anton),
 * scaled so their capitals and small letters stand as high as the SWF's outlines, with the
 * SWF fonts' ascent and descent (`size-adjust` scales the overrides too, hence the division).
 */

interface GameFont {
  family: string;
  file: string;
  descriptors?: FontFaceDescriptors;
}

/** A look-alike scaled by `size`, with the original font's ascent and descent (em units). */
function lookalike(size: number, ascent: number, descent: number): FontFaceDescriptors {
  const pct = (v: number) => `${((v / size) * 100).toFixed(1)}%`;
  return {
    sizeAdjust: `${size * 100}%`,
    ascentOverride: pct(ascent),
    descentOverride: pct(descent),
    lineGapOverride: '0%',
  } as FontFaceDescriptors;
}

/** Family name and file in `public/fonts/` (same list as the tool's). */
const FONTS: GameFont[] = [
  {
    family: 'Franklin Gothic Heavy',
    file: 'libre-franklin-black.woff2',
    descriptors: lookalike(0.92, 0.917, 0.218),
  },
  { family: 'Satans', file: 'satans.otf' },
  { family: 'Impact', file: 'anton.woff2', descriptors: lookalike(0.93, 1.009, 0.211) },
];

/**
 * Loads the fonts. Each covers every weight, so a bold style uses the outline as it is
 * instead of a synthetic bold (Franklin Gothic Heavy is already heavy). A font that fails to
 * load leaves its fallback.
 */
export async function loadGameFonts(baseUrl: string): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  await Promise.all(
    FONTS.map(async ({ family, file, descriptors }) => {
      try {
        const face = new FontFace(family, `url(${baseUrl}fonts/${file})`, {
          weight: '100 900',
          ...descriptors,
        });
        document.fonts.add(await face.load());
      } catch {
        // keep the fallback font
      }
    }),
  );
}
