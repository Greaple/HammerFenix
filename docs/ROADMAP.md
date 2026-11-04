# Roadmap

Goal: near-perfect clone of Hammerfest. Each task is sized for about one conversation. Tick boxes as work lands.

## Next up

Phase 1 is done. Phase 2, starting with the super-item entities (2.1). After any behavior fix, check the replay snapshot diff and accept it with `npx vitest run -u`. Open deviations from the audits are listed in PORT_STATUS.md ("Audit 1.5", "Audit 1.6").

## Phase 1: Stabilize and make fidelity measurable

Without reproducible runs you can't check whether the clone matches the original.

- [x] 1.1 Bug: `GameSession.initGame()` attaches a new player without destroying the old one. Restart, the level picker and set switching leave extra players running.
- [x] 1.2 Bug: `GameSession.changeSet()` replaces `this.view` without destroying the old view (`switchLevelSet()` does destroy it). Merge the two functions.
- [x] 1.3 Port `RandomManager.mt` (rarity-weighted draws) and a seeded generator. Replace all ~83 `Math.random` calls in `src/game` with it. Also: `initGame()` now resets game-wide state (visited levels, keys, pick counts, combos, portals) as the original's fresh `GameMode` does.
- [x] Bug (found in play): the player's head and skin cycled through every frame and the carrot showed on his neck. The SWF frame scripts that pick those frames were dropped at build time; they now run in an AVM1 interpreter.
- [x] 1.4 Input recorder and headless replay: record key events per tick, replay with `stepSingleFrame()`, snapshot entity state. Add Vitest regression tests from replays. Also: animation steps are tied to logic ticks (5 per 4), Flash scripts use a seeded random source, and `_width` / `_height` (hit boxes) come from vector bounds instead of rendered sprites, so a browser recording replays identically in Node.
- [x] 1.5 Line-by-line audit of `Player.ts` and `Bad.ts` against the original, logging deviations in PORT_STATUS.md. About 30 deviations fixed; the open ones are listed under "Audit 1.5" there.
- [x] 1.6 Same audit for `GameSession.ts` (against `mode/GameMode.mt`, `mode/Adventure.mt`), `Bomb.ts`, `Shoot.ts` and `Item.ts`. Shots were rewritten; the level flow, hurry-up and portals now follow the original.

## Phase 2: Finish the Adventure (critical path)

- [ ] 2.1 Super-item entities (`entity/supa/*`: Ball, Bubble, Tons, IceMeteor, Arrow, Smoke, SupaItem), needed by item effects 3, 8, 9, 24 and others.
- [ ] 2.2 Missing projectiles and bombs: FireRain, Hammer, BossFireBall, FramBall; BossBomb, MineFrozen, PoireBombFrozen, SoccerBall.
- [ ] 2.3 The 30 missing item effects (list in PORT_STATUS.md). Remove the generic "+2500 points" fallback in `Player.ts`.
- [ ] 2.4 Zodiac items 40-63: add the constellation background (`fxMan.attachBg(BG_CONSTEL)`).
- [ ] 2.5 Particle system (`entity/fx/Particle.mt`, `PARTICLE_*` constants). `FxManager.inGameParticles` currently renders every type as ice.
- [ ] 2.6 Special backgrounds: `FxManager.attachBg/detachBg/clearBg` and the `BG_*` effects.
- [ ] 2.7 Level transition scroll (`levels/ViewManager.mt`) and lighting (`levels/ViewLight.mt`). `goto()` currently cuts instantly.
- [ ] 2.8 Boss: Bat (`entity/boss/Bat.mt`, level 100) and `isBossLevel` logic, boss music.
- [ ] 2.9 Boss: Tuberculoz (`entity/boss/Tuberculoz.mt`, level 101) and the ending.
- [ ] 2.10 `StatsManager.mt` (extend and perfect rules) and `Chrono.mt`.
- [ ] 2.11 Game over sequence and score screen (replace the placeholder text in `onGameOver()`). Pass the anger level to `callEvilOne()` as the original does.
- [ ] 2.12 Simplified enemies: Framboise (250 original lines), Baleine (currently plain `FlyerBad`).

## Phase 3: Shell and progression

- [ ] 3.1 Title screen and mode menu (the original's menus were on the hammerfest.fr site; see `HammerClient.as`, `GameManager.mt`, `Loader.mt`).
- [ ] 3.2 Player profile save: quests (`quests.json` is loaded but unused), item families unlocked by quests (they decide which items drop), item collection.
- [ ] 3.3 Game options: mirror, nightmare, ninja, bomb expert, boost, kick and bomb control (`OPT_*` in `Data.mt`). Flags exist in `GameSession` but nothing sets them.
- [ ] 3.4 Localization: replace French text built into the graphics (e.g. "niveau suivant") in English and Spanish.

## Phase 4: Other modes (`class/hammer/mode/`)

- [ ] 4.1 Time Attack (`TimeAttack.mt`) and its interface (`initTime` in `gui/GameInterface.mt`)
- [ ] 4.2 Two-player co-op (`MultiCoop.mt`), 2-player interface (`initMulti`)
- [ ] 4.3 Time Attack multi (`TimeAttackMulti.mt`)
- [ ] 4.4 Soccer (`Soccer.mt`, `SoccerSelector.mt`, `gui/SoccerInterface.mt`)
- [ ] 4.5 Boss Rush (`BossRush.mt`)
- [ ] 4.6 Tutorial, Shareware, Fjv / FjvEnd

## Phase 5: Polish

- [ ] 5.1 Audio mix parity (channels, priorities, music switching)
- [ ] 5.2 Performance and mobile pass
- [ ] 5.3 Offline play (PWA)

## Out of scope

Developer tools from the original: `Editor`, `ScriptEditor`, `Browser`, `ItemBrowser`, `QuestBrowser`, `Converter`.
