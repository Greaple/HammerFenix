# Port status

Original path is relative to `assets-src/original/class/hammer/`. Assessed 2026-11-03.

Status: **done** = faithful port · **partial** = ported with gaps · **approx** = simplified behavior · **missing** = not started

## Core

| Original                                                                   | TypeScript                                        | Status  | Notes                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Data.mt`                                                                  | `src/game/Data.ts`                                | partial | All 211 ported values match. Missing: `CURSE_*`, `HEAD_*`, `OPT_*`, `STAT_*`, `EXT_*`, boss animations                                          |
| `Entity.mt`                                                                | `entity/Entity.ts` BaseEntity                     | done    | Audited (1.5). No `fl_stickRot` / `fl_stickBound` (no caller yet)                                                                               |
| `entity/Animator.mt`                                                       | `entity/Entity.ts` AnimatorEntity                 | done    | Audited (1.5)                                                                                                                                   |
| `entity/Physics.mt`                                                        | `entity/Entity.ts` PhysicsEntity                  | done    | Audited (1.5). Aqua bubbles in `endUpdate` wait for particles (2.5)                                                                             |
| `entity/Mover.mt`                                                          | `entity/Entity.ts` MoverEntity                    | done    | Audited (1.5)                                                                                                                                   |
| `entity/Player.mt`, `PlayerController.mt`                                  | `entity/Player.ts`                                | done    | Audited (1.5), see "Audit 1.5" below                                                                                                            |
| `SpecialManager.mt`                                                        | `entity/Player.ts`                                | partial | all 118 effects, with special backgrounds; the ghost glow missing, see below                                                                    |
| `entity/Item.mt`, `item/*`                                                 | `entity/Item.ts`                                  | done    | Audited (1.6)                                                                                                                                   |
| `entity/Trigger.mt`                                                        | `entity/Entity.ts`                                | done    |                                                                                                                                                 |
| `FxManager.mt`                                                             | `src/game/FxManager.ts`                           | partial | `inGameParticles` renders every type as ice                                                                                                     |
| `entity/fx/Particle.mt`                                                    |                                                   | missing |                                                                                                                                                 |
| `RandomManager.mt`                                                         | `src/game/RandomManager.ts`, `src/game/Random.ts` | done    | Seeded generator (`game.rand`) replaces `Std.random` and `Math.random`. Item families are fixed to 0-2 and 1000-1002 until profiles exist (3.2) |
| `StatsManager.mt`, `Stat.mt`, `Chrono.mt`                                  |                                                   | missing |                                                                                                                                                 |
| `Cookie.mt`, `Lang.mt`, `Loader.mt`, `GameManager.mt`, `GameParameters.mt` | `src/main.ts`, `Data.ts` (lang)                   | approx  | No menus, options or profile                                                                                                                    |

## Engine

- Blend modes: Flash `LAYER` is `SwfMovieClip.setLayerBlend` (an `AlphaFilter` that also carries `_alpha`), `ERASE` is Pixi's `erase`. Only set from code (the darkness); timeline blend modes other than multiply, screen and add still draw as normal.
- SWF frame scripts: 86 of 89 run in `src/engine/swf/Avm1.ts`. Not run: 2 particle emitters (`_gfx` #234, `_anims` #150) and a ghost effect (`_anims` #3200), which define functions.
- Backward timeline seeks keep children that stay on the same depth, as Flash does.
- `_width` / `_height` are the exact vector bounds, hidden children included, as in Flash. Hit boxes no longer include the 1 px rasterization margin.
- Animation runs at 40 Hz, tied to the 32 Hz logic (5 steps per 4 ticks).
- Input is sampled once per tick (`InputController.poll`), and can be recorded and replayed (`InputRecording.ts`). `SwfLibrary.headless()` runs the game in Node.

## Modes

| Original                                                                                                     | TypeScript                | Status  | Notes                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Mode.mt`, `mode/GameMode.mt`, `mode/Adventure.mt`                                                           | `src/game/GameSession.ts` | partial | Audited (1.6), see "Audit 1.6". Darkness with light holes (2.7). Missing: bosses, map, StatsManager, options, score saving; game over is placeholder text |
| `mode/TimeAttack*.mt`, `MultiCoop.mt`, `Soccer*.mt`, `BossRush.mt`, `Tutorial.mt`, `Shareware.mt`, `Fjv*.mt` |                           | missing | Level sets load but run with Adventure rules                                                                                                              |

## Levels

| Original                                                     | TypeScript                               | Status  | Notes                                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `levels/SetManager.mt`, `GameMechanics.mt`                   | `levels/LevelWorld.ts`                   | done    | Audited (1.7). No mirror mode (3.3). IA map parsed 30 cases per frame (2.7). Editor and serialization skipped on purpose                                         |
| `levels/ScriptEngine.mt`                                     | `levels/ScriptRunner.ts`                 | done    | Audited (1.7). `tools/scan-scripts.ts` checks every level script                                                                                                 |
| `levels/View.mt`                                             | `levels/LevelView.ts`                    | partial | Audited (1.7). Special backgrounds hide `_bg` (same picture as the Flash 8 cache path). Snapshots via Pixi `generateTexture` (2.7). No bitmap cache, editor grid |
| `levels/ViewManager.mt`                                      | `GameSession.ts` ("ViewManager")         | done    | Level scroll, portal side scroll and fade (2.7), with the old view as a snapshot (`fake`); no snapshot when headless. No `flipPortals` (3.3)                     |
| `levels/ViewLight.mt`                                        |                                          | skipped | Wireframe level preview used only by the `Browser` dev tool (out of scope). The darkness is `GameMode.updateDarkness`, ported in 2.7                             |
| `levels/PortalLink.mt`, `PortalData.mt`, `TeleporterData.mt` | `levels/LevelWorld.ts`, `GameSession.ts` | partial | Portals follow the original (arrival portal, late players, floating portal pull-in, side scroll or fade). Map events (`EVENT_EXIT_*`) not ported                 |

## Enemies (`entity/Bad.ts`)

All 21 species are registered in the factory at the end of `Bad.ts`.

- done: `Bad`, `Walker`, `Jumper`, `Shooter`, `Flyer`, `WallWalker`, `Spear`, `FireBall`, Pomme, Cerise, Banane, Ananas, Abricot, Poire, Bombe, Orange, Fraise, Citron, Tzongre, Crawler, Saw, Litchi, LitchiWeak, Kiwi
- done: Baleine (a plain `Flyer` in the original too)
- approx: Framboise (original 250 lines, task 2.12)
- unused: `walker/Coward.mt`, `walker/Hunter.mt` (the original's `attachBad` never creates them)
- All classes above audited line by line in 1.5, see "Audit 1.5" below.
- missing: `boss/Bat.mt` (level 100), `boss/Tuberculoz.mt` (level 101)

## Bombs and projectiles

- `entity/Bomb.ts` done (audited 1.6): Bomb, PlayerBomb, Classic, Black, Blue, Green, Red, RepelBomb, BadBomb, PoireBomb, Mine
- done (2.2): `bomb/bad/BossBomb` (used by Tuberculoz, 2.9), `bomb/player/SoccerBall` (no glow filter: `FxManager.addGlow` is not ported; round since the clip mask fix)
- unused: `bomb/player/MineFrozen`, `PoireBombFrozen` (`Mine.getFrozen` and `PoireBomb.getFrozen` are commented out in the original, so nothing creates them)
- missing: `entity/WalkingBomb.mt`
- `entity/Shoot.ts` done (rewritten from the original in 1.6): Shoot, Pepin, Zeste, FireBall, Ball, PlayerArrow, PlayerFireBall, PlayerPearl
- done (2.2): `shoot/FireRain`, `Hammer` (item 85), `BossFireBall` (used by the Bat, 2.8), `FramBall` (used by Framboise, 2.12)
- `entity/Supa.ts` done (2.1): `entity/Supa.mt` and all of `entity/supa/*` (Arrow, Ball, Bubble, IceMeteor, Smoke, SupaItem, Tons). Not ported: `SupaItem.pick`'s `logAction` (server log) and `STAT_SUPAITEM` (StatsManager, 2.10).

## Interface

| Original                                                                                                       | TypeScript                | Status  | Notes                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------- | ------- | ------------------------------------------------------------ |
| `gui/GameInterface.mt`                                                                                         | `src/game/gui/GameHud.ts` | partial | Single player only (no `initMulti`, `initTime`, `lightMode`) |
| `gui/SoccerInterface.mt`, `ExtendBox.mt`, `Container.mt`, `SimpleButton.mt`, `Field.mt`, `Label.mt`, `Item.mt` |                           | missing |                                                              |

## Item effects (`SpecialManager.execute`)

All 118 effects are ported (task 2.3, 2026-11-04), with `interrupt`, `levelConversion`, `warpZone`, `onPerfect` and the recurring events. The id is the `// *** N.` comment in the original. Tested in `tests/specials.test.ts`.

- Special backgrounds (2.4, 2.6): `fxMan.attachBg` queues them and shows one at a time; any effect ending (`interrupt`) and every level change clear them. Tested in `tests/specials.test.ts`.
- 86 ghost candy: the glow filters on the player and the enemies are not ported (no glow filter in Pixi core).
- 84: the clouds' `BlurFilter` (4 px box blur) is approximated with Pixi's gaussian blur (`SwfMovieClip.setBlur`).
- 10 phone does nothing, as in the original (the effect is commented out).
- Original quirks kept: picking any item with id 17 (`CONVERT_DIAMANT`, also the gold mushroom) counts as a pearl, so after a finished conversion it gives the 50000 perfect bonus again; the fish callbacks (77-79) are not cleared on a level change and run at the next level clear; interrupting the shoe (7) resets the speed to 1.0 even in nightmare mode.
- Fixed in the existing effects while porting: warp umbrellas (11, 12) stop at boss and empty levels and show the alert; 22, 88 and 91 showed the wrong curse icon; 26 and 68 now update the darkness; 94 sets its global flag; 114 is temporary, not permanent; 102 plays script clip 100; random draws of 23, 83, 101 and strikes match the original.

## Audit 1.5: Player and enemies

Line-by-line comparison of `Player.ts` and `Bad.ts` (and the `Entity`, `Animator`, `Physics`, `Mover` layers) with the original, 2026-11-04. `SpecialManager` (item effects) and `Framboise` were out of scope.

### Fixed

- Hit boxes used `_width` / `_height` clamped to 8-80 px (else 20); the original uses them as is.
- `fl_slide` is true by default in `Physics`. The port set it false on the player and on enemies (enemies only lose it after their first thaw), so ground deceleration was wrong.
- New player: 1 life (not 2), plus quest families 102-105 and 108; family 100 adds a bomb, 101 unlocks the down-kick (it was always on), 106/107 set `fl_candle` / `fl_torch`.
- Shooters and Crawlers start with `PEACE_COOLDOWN` (3 s), not 0.8 s.
- A Fraise that waits for a pass uses `BALL_TIMEOUT + 5` (78.6 ticks), not 133.
- `Jumper.infix` runs its jump checks even after `Walker.infix` handled a ledge, and checks jump-up and jump-down independently.
- `Walker.onNext` (fallback) flipped `dir`; the original does not.
- Litchi's weak child spawns at the original position.
- Kicks no longer set the bomb's `fl_stable`; a jump no longer clears the player's `fl_stable` (physics does it).
- The attack and down keys are read (and locked) before the cooldown and down-kick checks, as `keyIsDown` does.
- `resurrect()` keeps `speedFactor` unless in nightmare mode.
- `Bad.killHit`, `burn` and `knock` had invented `fl_kill` guards; `checkHits` re-checked `fl_kill` between the two `hit` calls.
- `Physics.calcSteps` could not return 0 steps; the stair patch reset `fallStart`; `shockWave` clamped its ratio; `killHit(null)` drew a random `dx`.
- `Animator`: invented blink fallback timer; `disableAnimator` now lets the clip play.
- Soft recal (`activateSoftRecal`, Wall walkers turning corners) is ported.
- Ninja icons reattach when the sticker is gone; `fl_showIA` taunt icon; Ananas taunt icon.
- FireBall anger uses `diffFactor`; its eye frame clamps instead of wrapping.
- Random draws use the original's integer forms (`Std.random(1000) < chance`, `Std.random(2)*2-1`), and Bombe draws its unused random duration.
- Session: the HUD reads the new player's lives and score on each new game; `shake()` keeps a stronger running shake (`||`, not `&&`).

### Open

- Particles (task 2.5): every `inGameParticles` / `inGameParticlesDir` call uses type 0, and some counts or random positions are simplified (Player knock wall hit, Bad freeze, Litchi, Bombe, Crawler, Saw stun sparks, aqua bubbles).
- Options (task 3.3): `OPT_BOOST`, `fl_bombControl` (`WalkingBomb`), life sharing.
- Player: debug keys (`getDebugControls`) are not ported.
- Key locks are released on every tick; the original releases them only when the controller runs (not while controls are locked).
- `Jumper.checkClimb` skips a null or zero climb height; the original would jump with a NaN speed.
- `Physics` portals: the original calls `onPortal(null)` when no portal matches; the port does nothing.
- `Spear`: no spawn puff when created after the first second; `Kiwi.clearMines` is never called in the original, not ported.
- Visual: `Bad.onDeathLine` attaches its fx through `fxMan` instead of a bare clip.

## Audit 1.6: session, bombs, shots, items

`GameSession.ts` against `mode/GameMode.mt` and `mode/Adventure.mt`, plus `Bomb.ts`, `Shoot.ts` and `Item.ts`, 2026-11-04.

### Fixed

- Level flow follows the original chain: `goto` (players keep their x and fall from above) → IA parse (17 frames) → `onDataReady` (scroll starts, script compiles) → scroll (40 frames) → `onLevelReady` → `initLevel` → `startLevel`, all inside the world update, before the level script runs. A new game is locked until its first level is parsed (17 frames), as the original's `Mode` constructor locks it.
- The level script compiles and runs its first cycle when the level is read; enemies and items inserted at level start run on the next script update.
- Levels are marked visited when left, not when entered; level data (tiles changed by scripts) persists for the whole game.
- Hurry-up is reset only on unvisited levels, recomputes `diffFactor` from spare lives and nightmare mode, and switches the music to the hurry track and back.
- The fire ball of the second hurry-up starts as a harmless summon at anger 0 (it was instantly lethal at anger 1); later ones get `round(huTimer / AUTO_ANGER)` anger.
- Clearing a level removes the extend letters on screen; boss levels never clear by themselves; `onKillBad` no longer re-checks the clear.
- Main loop order: level script, HUD, portals, effects, hurry-up, entities, then level clear, floating portal, shake, exit arrow, nightmare anger.
- Boss levels (30, 40, ..., 100, 101) show the warning; `globalActives[94]` adds a second score item; extends are only inserted when the level has special slots.
- Portals: the dimension switch requires a cleared level, resets the players (temporary effects, weapon, controls), places them at the arrival portal (`getPortalEntrance`), knocks late players, and handles the floating portal's pull-in. A new game always starts in the main world.
- `getClose` included dead entities in the original; the port filtered them out.
- Shake: offsets use the original's integer draws, and the power resets when the shake ends.
- Bombs: no invented "already exploded" guards (only `Green` has one), `duplicate()` no longer sets owner and parent, red bomb and mine no longer clear `fl_stable`, the mine calls `blinkLife()`.
- Shots: rewritten from the original. Speeds, cooldowns (2 s for the player's arrow, fire ball and pearl), offsets and hit rules were invented: the player's fire ball and pearl go through enemies, pips and zests do not disappear on hit, a missed ball goes back to a random Fraise.
- World keys from quest families 5000-5099; `setBaseAnims` ported.

### Open

- Not ported yet: bosses (2.8, 2.9), `StatsManager` extends (2.10, the extend timer is inserted on every level with special slots), the map and its events, ninja mode (`onBadsReady`, 3.3), bullet time, wind timer, aqua screen wobble. X/Y flips are ported (items 30, 31).
- `onGameOver` / end of set are placeholders (2.11).
- `ScoreItem` gives 500 points for an unknown id; the original stops with a fatal error.
- Float random draws remain in `FxManager`.

## Audit 1.7: level script, world and view

`levels/ScriptRunner.ts` against `levels/ScriptEngine.mt`, `levels/LevelWorld.ts` against `SetManager.mt` and `GameMechanics.mt`, `levels/LevelView.ts` against `View.mt`, 2026-11-04.

### Fixed

- Script tree: Flash's `removeNode()` leaves `nextSibling` null, so `runScript` stops at the first trigger removed in a cycle; the triggers after it run on the next cycle. The port ran them all at once (checked in Ruffle's XML code).
- A trigger nested in another one is moved to the end of the script (`appendChild`): the events after it in its parent are skipped (deepnight 141 in ninja mode never shows message 163), and a repeating parent adds it only once (deepnight 184).
- Level start order (`ViewManager.onDataReady`): the view is created and `$attach` set before the compile. A level shown without a transition (new game, level picker, warp start) is ready before its script compiles, so its enemies appear on the first cycle; after a level change the script compiles when the scroll starts and the enemies appear when it ends. Players are placed before the compile.
- The script only runs while the world is unlocked (`world.lock` in `goto`, pause and `suspend`; `unlock` in `startLevel`); the level clear is only checked then.
- `GameMechanics.suspend`: the script left is saved into the level data when a dimension is left, so coming back runs what was left of it.
- `$e_bad` with `$sys` on a visited level now decrements `badCount`; `$e_hide` removes the script's decor sprites (`View.detach`); `$e_setVar` accepts an empty value; `$e_msg` with a text the language lacks shows nothing (`Lang.get` is null; the English file lacks texts 158-163); code trigger 4 gives the elevator the player's head and starts `endModeTimer`, which ends the game; code trigger 5 (exit after Tuberculoz) ported; code triggers 7 and 8 use `setBaseAnims`.
- `insertItem`, `addNode`, `addShortNode`, `getFloat` ported; `$e_itemLine` keeps the original's `</$$t_timer>` typo (Flash keeps the nodes read before a bad end tag).
- `forceCase` (`$e_add`, `$e_rem`) no longer re-parses walls and rebuilds the whole IA map: clearing a tile turns the wall below into a floor, and only `IA_TILE` follows. Walls are parsed once, when the level is read.
- `_checkSecureFall` returned one more than the original (walkers' `decideFall` reads it), and stopped at walls.
- `getGround` searches down the given column only (wrapping once); the port searched other columns too. Extend letters and `globalActives[94]` items land in the drawn column.
- `getCase` above the screen and outside the columns returns 0, not `OUT_WALL`.
- Floating portal fields (`GameMechanics.update`) bob and sparkle; this was not ported.
- `triggers` grid kept across levels; `forcedGoto` clears the world's hide flags; a new view per level built from the world's flags (`ViewManager.createView`); `View.moveTo` / `moveToPreviousPos` ported.
- Added: `isEmptyLevel`, `shapeInBound` (for 2.1 and 2.3).

### Open

- `$e_ext` calls `GameSession.spawnExtend`, which draws the letter directly; the original picks from `StatsManager.extendList` (2.10).
- When a trigger repeats after its nested trigger moved out, Ruffle still follows the old sibling link and adds the nested trigger again; the port adds it once. Only deepnight 184 has this.
- Mirror mode (`SetManager.flip`, `flipPortals`) is not ported (3.3).
- Data notes from the scan (the original ignores them too): three `$t_timer` with `repeat` instead of `$repeat` (adventure 100), `$s` instead of `$si` (adventure 102), sprites missing from every original SWF (`$jail_large`, `$mcMarioBlock`, `$doorSideRight`, not in the Adventure set).
