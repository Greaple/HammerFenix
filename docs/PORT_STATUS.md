# Port status

Original path is relative to `assets-src/original/class/hammer/`. Assessed 2026-11-03.

Status: **done** = faithful port · **partial** = ported with gaps · **approx** = simplified behavior · **missing** = not started

## Core

| Original                                                                   | TypeScript                                        | Status  | Notes                                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Data.mt`                                                                  | `src/game/Data.ts`                                | partial | All 211 ported values match. Missing: `PARTICLE_*`, `BG_*`, `CURSE_*`, `HEAD_*`, `OPT_*`, `STAT_*`, `EXT_*`, boss animations                    |
| `Entity.mt`                                                                | `entity/Entity.ts` BaseEntity                     | done    |                                                                                                                                                 |
| `entity/Animator.mt`                                                       | `entity/Entity.ts` AnimatorEntity                 | done    |                                                                                                                                                 |
| `entity/Physics.mt`                                                        | `entity/Entity.ts` PhysicsEntity                  | done    |                                                                                                                                                 |
| `entity/Mover.mt`                                                          | `entity/Entity.ts` MoverEntity                    | done    |                                                                                                                                                 |
| `entity/Player.mt`, `PlayerController.mt`                                  | `entity/Player.ts`                                | done    | `head` / `skin` are only changed by debug keys and missing items 112, 113                                                                       |
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
- approx: Framboise (original 250 lines), Baleine (mapped to plain `FlyerBad`)
- missing: `walker/Coward.mt`, `walker/Hunter.mt` (not in the factory; check whether any level uses them)
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
