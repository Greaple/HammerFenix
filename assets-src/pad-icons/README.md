# Controller button icons

SVG exports of three Figma Community files (published under CC BY 4.0, Figma's Community
license), one folder per controller layout. `tools/build-pad-icons.ts` turns them into
`src/game/gui/padIconData.ts` (`npm run assets`).

| Folder         | Figma file                                                                                                                                                         | Style used                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `xbox/`        | [Xbox Controller Icons Free (Community)](https://www.figma.com/design/GrZYDNnYAn1wxyclydjDQe/Xbox-Controller-Icons-Free--Community-)                                 | solid, not colored          |
| `playstation/` | [PlayStation Controller Icons (Community)](https://www.figma.com/design/Dpl9gYmuhvfrvXZgT23QBZ/PlayStation-Controller-Icons--Community-)                            | plain (solid), not colored  |
| `nintendo/`    | [Switch Button Icons, Essential pack (Community)](https://www.figma.com/design/ydgwwJaBo4vWG5L456rEuw/Switch-Button-Icons--Essential-pack---Community-?node-id=66-24033) | Solid, Mono, light          |

Files are named by the button's place in the standard mapping, not by its label: `a` is the
bottom face button, `b` the right one, `x` the left one, `y` the top one (so on a Switch, `a.svg`
is the B button). The others: `r2` (right trigger), `start`, `back`, `dpad` (the whole cross),
`stick` (the left stick).

Export each icon's frame as SVG, as is: the build removes the sheet's background and maps the
icon's two colors (light body, dark cut-outs) to the colors of the screen it is drawn on. A
color it does not know stops the build: add it to `BODY` or `INK` there.

Figma node of each icon:

- Xbox: `a` 2:3, `b` 2:15, `x` 2:27, `y` 2:39, `r2` 2:174 (right-trigger), `start` 2:52 (menu),
  `back` 2:58 (view), `dpad` 2:183, `stick` 2:137 (left-joystick).
- PlayStation: `a` 2:6 (plain-cross), `b` 2:5 (plain-circle), `x` 2:8 (plain-square), `y` 2:4
  (plain-triangle), `r2` 101:1549 (plain-R2), `dpad` 2:37 (plain-top), `stick` 1:175 (plain-L).
  `start` (plain-small-option, the PS5 Options button) and `back` (Share) are pills exported by
  the maintainer in the sheet's style,
  cropped to the pill by the build.
- Switch (Mono, light): `a` 66:24299 (B), `b` 66:24298 (A), `x` 66:24301 (Y), `y` 66:24300 (X), `r2` 66:24307
  (ZR), `start` 66:24315 (+), `back` 66:24316 (−), `dpad` 72:37065 (+Control Pad), `stick`
  66:24371 (Left Stick).

Missing files: the screens draw that button themselves (`padGlyph` in `PadGlyphs.ts`).
