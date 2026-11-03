# Port status

Original path is relative to `assets-src/original/class/hammer/`. Assessed 2026-11-03.

Status: **done** = faithful port · **partial** = ported with gaps · **approx** = simplified behavior · **missing** = not started

## Core

| Original                                                                   | TypeScript                                        | Status  | Notes                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Data.mt`                                                                  | `src/game/Data.ts`                                | partial | All 211 ported values match. Missing: `PARTICLE_*`, `BG_*`, `CURSE_*`, `HEAD_*`, `OPT_*`, `STAT_*`, `EXT_*`, boss animations                    |
| `Entity.mt`                                                                | `entity/Entity.ts` BaseEntity                     | done    | Audited (1.5). No `fl_stickRot` / `fl_stickBound` (no caller yet)                                                                               |
| `entity/Animator.mt`                                                       | `entity/Entity.ts` AnimatorEntity                 | done    | Audited (1.5)                                                                                                                                   |
| `entity/Physics.mt`                                                        | `entity/Entity.ts` PhysicsEntity                  | done    | Audited (1.5). Aqua bubbles in `endUpdate` wait for particles (2.5)                                                                             |
| `entity/Mover.mt`                                                          | `entity/Entity.ts` MoverEntity                    | done    | Audited (1.5)                                                                                                                                   |
| `entity/Player.mt`, `PlayerController.mt`                                  | `entity/Player.ts`                                | done    | Audited (1.5), see "Audit 1.5" below                                                                                                            |
| `SpecialManager.mt`                                                        | `entity/Player.ts`                                | partial | 64 of 118 effects; see below                                                                                                                    |
| `entity/Item.mt`, `item/*`                                                 | `entity/Item.ts`                                  | done    |                                                                                                                                                 |
| `entity/Trigger.mt`                                                        | `entity/Entity.ts`                                | done    |                                                                                                                                                 |
| `FxManager.mt`                                                             | `src/game/FxManager.ts`                           | partial | No `attachBg/detachBg/clearBg`; `inGameParticles` renders every type as ice                                                                     |
| `entity/fx/Particle.mt`                                                    |                                                   | missing |                                                                                                                                                 |
| `RandomManager.mt`                                                         | `src/game/RandomManager.ts`, `src/game/Random.ts` | done    | Seeded generator (`game.rand`) replaces `Std.random` and `Math.random`. Item families are fixed to 0-2 and 1000-1002 until profiles exist (3.2) |
| `StatsManager.mt`, `Stat.mt`, `Chrono.mt`                                  |                                                   | missing |                                                                                                                                                 |
| `Cookie.mt`, `Lang.mt`, `Loader.mt`, `GameManager.mt`, `GameParameters.mt` | `src/main.ts`, `Data.ts` (lang)                   | approx  | No menus, options or profile                                                                                                                    |

## Engine

- SWF frame scripts: 86 of 89 run in `src/engine/swf/Avm1.ts`. Not run: 2 particle emitters (`_gfx` #234, `_anims` #150) and a ghost effect (`_anims` #3200), which define functions.
- Backward timeline seeks keep children that stay on the same depth, as Flash does.
- `_width` / `_height` are the exact vector bounds, hidden children included, as in Flash. Hit boxes no longer include the 1 px rasterization margin.
- Animation runs at 40 Hz, tied to the 32 Hz logic (5 steps per 4 ticks).
- Input is sampled once per tick (`InputController.poll`), and can be recorded and replayed (`InputRecording.ts`). `SwfLibrary.headless()` runs the game in Node.

## Modes

| Original                                                                                                     | TypeScript                | Status  | Notes                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `Mode.mt`, `mode/GameMode.mt`, `mode/Adventure.mt`                                                           | `src/game/GameSession.ts` | partial | No boss spawning, `isBossLevel`, map, end of set, score saving; game over is placeholder text |
| `mode/TimeAttack*.mt`, `MultiCoop.mt`, `Soccer*.mt`, `BossRush.mt`, `Tutorial.mt`, `Shareware.mt`, `Fjv*.mt` |                           | missing | Level sets load but run with Adventure rules                                                  |

## Levels

| Original                                                     | TypeScript                               | Status  | Notes                                                   |
| ------------------------------------------------------------ | ---------------------------------------- | ------- | ------------------------------------------------------- |
| `levels/SetManager.mt`, `GameMechanics.mt`                   | `levels/LevelWorld.ts`                   | done    | Editor and serialization functions skipped on purpose   |
| `levels/ScriptEngine.mt`                                     | `levels/ScriptRunner.ts`                 | done    | Missing `addShortNode`, `getFloat`, `insertItem`        |
| `levels/View.mt`                                             | `levels/LevelView.ts`                    | partial | No special backgrounds or snapshots                     |
| `levels/ViewManager.mt`                                      |                                          | missing | Level change is an instant cut, not a scroll            |
| `levels/ViewLight.mt`                                        |                                          | missing | Darkness partly handled in `GameSession.updateDarkness` |
| `levels/PortalLink.mt`, `PortalData.mt`, `TeleporterData.mt` | `levels/LevelWorld.ts`, `GameSession.ts` | partial | `usePortal` ignores the arrival portal position         |

## Enemies (`entity/Bad.ts`)

All 21 species are registered in the factory at the end of `Bad.ts`.

- done: `Bad`, `Walker`, `Jumper`, `Shooter`, `Flyer`, `WallWalker`, `Spear`, `FireBall`, Pomme, Cerise, Banane, Ananas, Abricot, Poire, Bombe, Orange, Fraise, Citron, Tzongre, Crawler, Saw, Litchi, LitchiWeak, Kiwi
- done: Baleine (a plain `Flyer` in the original too)
- approx: Framboise (original 250 lines, task 2.12)
- unused: `walker/Coward.mt`, `walker/Hunter.mt` (the original's `attachBad` never creates them)
- All classes above audited line by line in 1.5, see "Audit 1.5" below.
- missing: `boss/Bat.mt` (level 100), `boss/Tuberculoz.mt` (level 101)

## Bombs and projectiles

- `entity/Bomb.ts` done: Bomb, PlayerBomb, Classic, Black, Blue, Green, Red, RepelBomb, BadBomb, PoireBomb, Mine
- missing: `bomb/bad/BossBomb`, `bomb/player/MineFrozen`, `PoireBombFrozen`, `SoccerBall`, `entity/WalkingBomb.mt`
- `entity/Shoot.ts` done: Shoot, Pepin, Zeste, FireBall, Ball, PlayerArrow, PlayerFireBall, PlayerPearl
- missing: `shoot/BossFireBall`, `FireRain`, `FramBall`, `Hammer`
- missing: all of `entity/supa/*` (Arrow, Ball, Bubble, IceMeteor, Smoke, SupaItem, Tons) and `entity/Supa.mt`

## Interface

| Original                                                                                                       | TypeScript                | Status  | Notes                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------- | ------- | ------------------------------------------------------------ |
| `gui/GameInterface.mt`                                                                                         | `src/game/gui/GameHud.ts` | partial | Single player only (no `initMulti`, `initTime`, `lightMode`) |
| `gui/SoccerInterface.mt`, `ExtendBox.mt`, `Container.mt`, `SimpleButton.mt`, `Field.mt`, `Label.mt`, `Item.mt` |                           | missing |                                                              |

## Item effects (`SpecialManager.execute`)

30 missing plus 24 approximated (zodiac). The id is the `// *** N.` comment in the original. Missing ids fall into `Player.ts`'s generic "+2500 points" fallback.

- 3 beach ball (supa Ball) · 8 star (supa Bubble) · 9 Sauron eye (supa Tons) · 10 phone · 24 snow crystal (IceMeteor)
- 30, 31 blue and red glasses · 38 totem
- 40-51 zodiac signs and 52-63 zodiac potions: approx (score items work, constellation background missing)
- 77, 78, 79 blue, red and yellow fish · 81 blue pearl · 84 fire rain talisman · 85 hammer · 87 blue larva
- 93 mailbox · 96, 97, 98 orange, green and pink pearls (conversion) · 100 Guu doll
- 106 mushroom book · 107 star book · 108 green umbrella · 109, 110, 111 snowflakes 1 to 3 · 112 pioupiouz
- 113 Tuberculoz cape · 116 Ankhel jewel · 117 Gordon key

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
- Player: picking a pearl (`CONVERT_DIAMANT`) does not call `onPickPerfectItem` (pearl items, task 2.3). Debug keys (`getDebugControls`) are not ported.
- Key locks are released on every tick; the original releases them only when the controller runs (not while controls are locked).
- `Jumper.checkClimb` skips a null or zero climb height; the original would jump with a NaN speed.
- `Physics` portals: the original calls `onPortal(null)` when no portal matches; the port does nothing.
- `Spear`: no spawn puff when created after the first second; `Kiwi.clearMines` is never called in the original, not ported.
- Visual: `Bad.onDeathLine` attaches its fx through `fxMan` instead of a bare clip.
- Session (not audited yet): hurry-up is reset on every level start, the original only on unvisited levels (`resetHurry` in `initLevel`).
