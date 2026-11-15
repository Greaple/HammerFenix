# HD bitmaps

Makes `assets-src/upscaled/bitmaps-x4/` and `-x2/`: every file of `public/gfx/bitmaps/` (the
SWFs' 200 bitmaps and 36 masks) upscaled 4x and 2x, same names, exactly that many times the size.
`tools/build-site.ts` copies them to `public/gfx/bitmaps-x4/` and `-x2/`, and the game picks a set
from the screen (`src/engine/swf/BitmapDetail.ts`). See `docs/BITMAPS.md`.

- Model: [4xHFA2k_ludvae_realplksr_dysample](https://github.com/Phhofm/models/releases/tag/4xHFA2k_ludvae_realplksr_dysample)
  (RealPLKSR, Philip Hofmann, CC BY 4.0, credited in the help dialog), from OpenModelDB,
  sha256 `c6e44af18fd3159787b0dbf81d432a6c1ba12c736fc1184b107ed091e49e327c`. The fastest of five
  tried (about 100 s for all on an M1). Loaded with [Spandrel](https://github.com/chaiNNer-org/spandrel)
  0.4.2 on PyTorch 2.15, weights only (no pickle code).
- Repeating fills are wrap-padded before upscaling (no seams), others edge-padded; 256 px tiles.
- The low frequencies are the original's (its Lanczos upscale), so the colours do not drift.
- Transparent pixels (RGBA PNGs, masked JPEGs under their mask) are filled from their neighbours
  first, so no dark fringe. Masks are resized bicubic.
- Sides under 12 px: plain resize (nearest for `b285`, 1 x 3; Lanczos for the 5 x 20 caps and the
  20 x 11 map icons).
- The 2x set is the 4x one area-downscaled.

Rebuild, from the repo root:

```bash
python3 -m venv .cache/upscale-venv
.cache/upscale-venv/bin/pip install torch spandrel spandrel_extra_arches opencv-python-headless safetensors
curl -L -o .cache/realplksr.pth https://github.com/Phhofm/models/releases/download/4xHFA2k_ludvae_realplksr_dysample/4xHFA2k_ludvae_realplksr_dysample.pth
python3 tools/upscale-bitmaps/list.py public/gfx/library.json public/gfx/intro.json > .cache/bitmaps.json
.cache/upscale-venv/bin/python -I tools/upscale-bitmaps/upscale.py --tile 256 --model .cache/realplksr.pth --src public/gfx/bitmaps --list .cache/bitmaps.json --out assets-src/upscaled/bitmaps-x4
.cache/upscale-venv/bin/python -I tools/upscale-bitmaps/downscale.py assets-src/upscaled/bitmaps-x4 assets-src/upscaled/bitmaps-x2 .cache/bitmaps.json
.cache/upscale-venv/bin/python -I tools/upscale-bitmaps/drift.py public/gfx/bitmaps assets-src/upscaled/bitmaps-x4 .cache/bitmaps.json
```

`drift.py` prints the largest colour shifts against the originals (visible pixels only): all
under 3 out of 255 for this set.
