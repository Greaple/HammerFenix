# Roadmap

Goal: near-perfect clone of Hammerfest. Each task is sized for about one conversation. Tick boxes as work lands.

## Next up

Finish Phase 1 with the level script audit (1.7), then Phase 2, starting with the super-item entities (2.1). After any behavior fix, check the replay snapshot diff and accept it with `npx vitest run -u`. Open deviations from the audits are listed in PORT_STATUS.md ("Audit 1.5", "Audit 1.6").

## Phase 1: Stabilize and make fidelity measurable

Without reproducible runs you can't check whether the clone matches the original.

- [x] 1.1 Bug: `GameSession.initGame()` attaches a new player without destroying the old one. Restart, the level picker and set switching leave extra players running.
- [x] 1.2 Bug: `GameSession.changeSet()` replaces `this.view` without destroying the old view (`switchLevelSet()` does destroy it). Merge the two functions.
- [x] 1.3 Port `RandomManager.mt` (rarity-weighted draws) and a seeded generator. Replace all ~83 `Math.random` calls in `src/game` with it. Also: `initGame()` now resets game-wide state (visited levels, keys, pick counts, combos, portals) as the original's fresh `GameMode` does.
- [x] Bug (found in play): the player's head and skin cycled through every frame and the carrot showed on his neck. The SWF frame scripts that pick those frames were dropped at build time; they now run in an AVM1 interpreter.
- [x] 1.4 Input recorder and headless replay: record key events per tick, replay with `stepSingleFrame()`, snapshot entity state. Add Vitest regression tests from replays. Also: animation steps are tied to logic ticks (5 per 4), Flash scripts use a seeded random source, and `_width` / `_height` (hit boxes) come from vector bounds instead of rendered sprites, so a browser recording replays identically in Node.
- [x] 1.5 Line-by-line audit of `Player.ts` and `Bad.ts` against the original, logging deviations in PORT_STATUS.md. About 30 deviations fixed; the open ones are listed under "Audit 1.5" there.
- [x] 1.6 Same audit for `GameSession.ts` (against `mode/GameMode.mt`, `mode/Adventure.mt`), `Bomb.ts`, `Shoot.ts` and `Item.ts`. Shots were rewritten; the level flow, hurry-up and portals now follow the original.
- [ ] 1.7 Same audit for `levels/ScriptRunner.ts` (against `levels/ScriptEngine.mt`; `addShortNode`, `getFloat` and `insertItem` are missing), `levels/LevelWorld.ts` (`SetManager.mt`, `GameMechanics.mt`) and `levels/LevelView.ts` (`View.mt`). Add a tool or test that scans every level script in every set of `xml/levels/` and lists the nodes, triggers and attributes the engine does not handle, so no level breaks silently.

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

## Phase 2B: Level-by-level comparison with the original

Start once Phase 2 is done; before that, most differences are features already listed there. For each batch, play every level next to the original (Ruffle side-by-side, "Flash" button) and check: tile layout and background, enemy and item spawn points, script events, portals and secret passages, darkness, music, and the level clear. Record a short replay per level as a regression fixture. Fix differences or log them in PORT_STATUS.md.

- [ ] 2B.1 Adventure levels 0-20
- [ ] 2B.2 Adventure levels 21-40
- [ ] 2B.3 Adventure levels 41-60
- [ ] 2B.4 Adventure levels 61-80
- [ ] 2B.5 Adventure levels 81-101 (bosses included)
- [ ] 2B.6 The other dimensions reached by portals (`xml/portalLinks.xml`): hof, deepnight, hiko, ayame, hk, bumdum
- [ ] 2B.7 Sets of the other modes (tutorial, shareware, timeAttack, multiTime, soccer, fjv), done with their mode in Phase 4

## Phase 3: Shell and progression

- [ ] 3.1 Title screen and mode menu (the original's menus were on the hammerfest.fr site; see `HammerClient.as`, `GameManager.mt`, `Loader.mt`).
- 3.2 Quests and progression. The original client never runs quests: the hammerfest.fr server counted items, checked `xml/quests.xml` (77 quests) and sent back the unlocked families as the `$families` parameter (`Loader.mt`, `GameParameters.hasFamily`). That server code is not in the released source, so the rules must come from `quests.xml` and outside evidence, and every guess must be logged in PORT_STATUS.md.
  - [ ] 3.2a Research: settle what the server did. Do item counts add up across games? When are quests checked (end of game or live)? What do the `tokens`, `bank` and `log` rewards do? What is the starting family set? Sources: `quests.xml` comments, `Lang.mt`, `QuestBrowser.mt`, `HammerClient.as`, archives of the hammerfest.fr site and player wikis. Write the findings in PORT_STATUS.md.
  - [ ] 3.2b Player profile save: item collection (count per item id, as the server kept it), quests done, unlocked families, options and modes. Versioned, with the save codec in `src/engine/`.
  - [ ] 3.2c Quest engine: read `quests.json`, check requirements, apply `give` / `remove` (families, options, modes, tokens, bank, log) and pass the families to `GameSession` instead of the fixed 0-2 and 1000-1002. Add a test that every quest's item, family, option and mode ids exist and every reward type is handled.
  - [ ] 3.2d Quest and collection screen (the original's was on the site, so its look needs a decision first), with quest names and descriptions from `Lang.getQuestName` / `getQuestDesc`.
- [ ] 3.3 Game options: mirror, nightmare, ninja, bomb expert, boost, kick and bomb control (`OPT_*` in `Data.mt`). Flags exist in `GameSession` but nothing sets them. Each option is unlocked by a quest (`give option=` in `quests.xml`), so wire them to the profile from 3.2.
- [ ] 3.4 Localization: replace French text built into the graphics (e.g. "niveau suivant") in English and Spanish. Also the quest, item and family names from `xml/lang/` in the shell screens.

## Phase 4: Other modes (`class/hammer/mode/`)

Time Attack and two-player co-op are unlocked by quests (`give mode=` in `quests.xml`), through the profile from 3.2.

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
