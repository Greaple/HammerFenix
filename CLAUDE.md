# HammerFenix

Web remake of Hammerfest (Motion Twin, 2006). Goal: near-perfect clone. TypeScript, PixiJS v8, Vite, Vitest.

**Plan and progress:** [docs/ROADMAP.md](docs/ROADMAP.md). Read its "Next up" section first.
**What is ported, file by file:** [docs/PORT_STATUS.md](docs/PORT_STATUS.md). Read it only when you need a specific area.
**Level-by-level checks:** [docs/LEVELS.md](docs/LEVELS.md), one row per level (roadmap Phase 2B).

## Commands

- `npm install --legacy-peer-deps`
- `npm run dev`: Vite dev server (`.claude/launch.json` config "vite")
- `npm test`, `npm run typecheck`, `npm run format:check` (CI runs all three plus `npm run assets` and the build)
- `npm run assets`: rebuild `public/data` and `public/gfx` from `assets-src/original`
- `npm run orig`: write a greppable copy of the original source to `.cache/original/` (gitignored)
- `npx tsx tools/scan-scripts.ts [--all]`: list what level scripts use that the engine does not handle (`tests/scripts.test.ts` fails on new problems)

## Original source (`assets-src/original`, identical to github.com/motion-twin/hammerfest)

- `class/**/*.mt` (MotionTypes, AS2-like) has **CR line endings and Latin-1**: grep and line reads fail on it. Run `npm run orig` once, then use `.cache/original/` instead.
- `.cache/original/INDEX.txt`: one line per original file with its line count and function names. Grep it to find code.
- Comments are in French. Item effects are `case auto++:` blocks in `hammer/SpecialManager.mt` `execute()`, numbered by `// *** N.` comments.
- `xml/` levels, items and quests feed `tools/build-data.ts`. `swf/` graphics and sounds feed `tools/build-swf.ts`.

## Code layout

- `src/engine/`: loop (`GameLoop.ts`, fixed 32 Hz logic with `tmod = 1`, 40 Hz movie clips), audio, input, SWF runtime (`swf/`), save codec
- SWF frame scripts run in `swf/Avm1.ts`. They read an entity's fields through `mc.scriptHost` (e.g. the player's `head`, `skin`, `currentWeapon`), so keep the original field names on entities.
- `src/game/GameSession.ts`: port of `mode/GameMode.mt` + `mode/Adventure.mt` (the only mode so far)
- `src/game/entity/`: `Entity.ts` (Entity, Animator, Physics, Mover), `Player.ts` (Player + PlayerController + SpecialManager), `Bad.ts` (all enemies), `Bomb.ts`, `Shoot.ts`, `Item.ts`
- `src/game/levels/`: `LevelWorld.ts` (SetManager + GameMechanics), `LevelView.ts` (View), `ScriptRunner.ts` (ScriptEngine)
- `src/game/Data.ts`: port of `Data.mt`. Values must match the original exactly.
- `src/ui/`: debug toolkit, SWF symbol browser, Ruffle side-by-side with the original game

## Conventions

- Port faithfully: same names, logic and order as the original. Doc comment each class with its source, e.g. ``Port of `entity.item.SpecialItem` (`class/hammer/entity/item/SpecialItem.mt`)``.
- No `Math.random` in `src/game`: use `game.rand.random(n)` for `Std.random(n)` and `game.rand.next()` for `Math.random()`, so seeded replays stay deterministic.
- Never invent behavior. If the original is unclear, check the Ruffle side-by-side ("Flash" button) and note it.
- Storage: there is no remote database or server. Anything that must persist (profile, quests, collection, options, scores) goes in the browser's `localStorage`, under a versioned `hammerfenix_*` key (e.g. `hammerfenix_save_v1` in `GameSession.ts`). Wrap every read and write in try/catch and fall back to defaults, as `loadSave()` does.
- Prettier: single quotes, width 100, trailing commas.

## Testing in the browser

- Debug handles: `window.gameSession`, `window.gameLib`, `window.debugToolkit`.
- A hidden browser pane throttles `requestAnimationFrame`, so real-time play is unreliable. Drive the game deterministically:
  `s = window.gameSession; s.gameLoop.stop(); s.gameLoop.stepSingleFrame()` (one logic tick), and send keys with `window.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', code: 'Space'}))`.
- Level 0 (village): bombing the bucket at tile (11,19) is the original's secret warp to level 10. It is not a bug.

## Replay regression tests

- `tests/replay.test.ts` plays every `tests/replays/*.json` headless (`tests/helpers/headless.ts`) and compares the state with `tests/__snapshots__/`. A diff means game behavior changed. If the change is intended, check the diff, then run `npx vitest run -u` to accept it.
- Add replays by recording in the browser (Debug > Record & Replay, save the file into `tests/replays/`) or with `npx tsx tools/make-replays.ts` (seeded random input).
- In code: `session.startRecording(level)`, `session.stopRecording()`, `await session.playReplay(replay)`.

## End of each session

Tick finished tasks in `docs/ROADMAP.md`, update "Next up", fix any line in `docs/PORT_STATUS.md` that changed, and fill the rows of `docs/LEVELS.md` for levels you checked.
