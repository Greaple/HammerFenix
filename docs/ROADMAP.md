# Roadmap

Goal: near-perfect clone of Hammerfest. Each task is sized for about one conversation. Tick boxes as work lands.

## Next up

Phases 1 and 2 are done. Next is Phase 2B, starting with the automated data pass and the level jump for Ruffle (2B.0), then the small dimensions (2B.12) and the Adventure batches (2B.1 to 2B.11). Phase 3 comes after those; the larger dimensions (2B.13 to 2B.28) come after Phase 3 (see "Order" in Phase 2B). 3.1 is done (menu and results drawn in the game frame by `src/ui/Shell.ts`, sky and hills around it, dev controls behind the gear switch; see PORT_STATUS.md "Site screens"). 3.2 and 3.3 are done too (quests and profile, game options; see PORT_STATUS.md "Quests and profile" and "Game options"): next in Phase 3 is 3.4, localizing the French text in the graphics and the shell screens. The bosses' look in Ruffle (Bat glow, exit arrow during the fights) is left for 2B.11. Level changes now take 57 frames (IA parse + scroll) and a new game 17, so tests that start a level must step past that. After any behavior fix, check the replay snapshot diff and accept it with `npx vitest run -u`. Open deviations from the audits are listed in PORT_STATUS.md ("Audit 1.5" to "Audit 1.7").

## Bugs (found in play)

Logged during play, not yet investigated in depth. Check each against the Ruffle side-by-side before fixing.

- [ ] Shield animation seems to loop (invincibility after losing a life, or from an item). `Player.shield()` and `onShieldOut()` in `src/game/entity/Player.ts` match the original (`hammer/entity/Player.mt` `shield()`, which also sets `shieldMC.fl_loop = true`), so first compare with Ruffle. If the original only plays an intro once, look at the `hammer_player_shield` symbol's timeline (frame scripts, `stop()`) and at how `FxAnim` handles `fl_loop` and `lifeTimer`.
- [ ] Pause screen (P key) flickers fast between two frames of `hammer_interf_instructions`: the controls page and a "time label 999:00" page (the time attack page). Every text shows its placeholder ("Title Label", "moveLabel", "SPACE LABEL", "click label", "Sector label"), and the tip shows raw `<p><font …>tips...</font></p>` HTML. Compare `GameSession.onPause()` (`src/game/GameSession.ts`) with `mode/GameMode.mt` `onPause()`:
  - The port never calls `pauseMC.gotoAndStop("1")`, so the clip plays through its frames.
  - Texts not set: `click` (to `""`), `pause` (Lang 9), `space` (Lang 10). `sector` is missing the Lang 14 prefix. `title`, `move` and `attack` still show placeholders, so either `getText` doesn't find the fields or `dataStore.getStatic()` returns nothing; the port's English fallbacks (`'PAUSE'`, `'Move: Arrows / WASD'`...) are invented and should go.
  - Tip: the original sets `tip.html = true` and `htmlText = "<b>" + Lang 300 + "</b>" + tip`, cycling `tipId` through Lang 301+ until one is missing. The port writes plain text and always uses 301. Needs HTML text support in the SWF text field (or check if it exists) and a `tipId` field on the session.
  - The original also sets the music volume to 0.5 when not muted; check `onUnpause()` restores it.

## Phase 1: Stabilize and make fidelity measurable

Without reproducible runs you can't check whether the clone matches the original.

- [x] 1.1 Bug: `GameSession.initGame()` attaches a new player without destroying the old one. Restart, the level picker and set switching leave extra players running.
- [x] 1.2 Bug: `GameSession.changeSet()` replaces `this.view` without destroying the old view (`switchLevelSet()` does destroy it). Merge the two functions.
- [x] 1.3 Port `RandomManager.mt` (rarity-weighted draws) and a seeded generator. Replace all ~83 `Math.random` calls in `src/game` with it. Also: `initGame()` now resets game-wide state (visited levels, keys, pick counts, combos, portals) as the original's fresh `GameMode` does.
- [x] Bug (found in play): the player's head and skin cycled through every frame and the carrot showed on his neck. The SWF frame scripts that pick those frames were dropped at build time; they now run in an AVM1 interpreter.
- [x] 1.4 Input recorder and headless replay: record key events per tick, replay with `stepSingleFrame()`, snapshot entity state. Add Vitest regression tests from replays. Also: animation steps are tied to logic ticks (5 per 4), Flash scripts use a seeded random source, and `_width` / `_height` (hit boxes) come from vector bounds instead of rendered sprites, so a browser recording replays identically in Node.
- [x] 1.5 Line-by-line audit of `Player.ts` and `Bad.ts` against the original, logging deviations in PORT_STATUS.md. About 30 deviations fixed; the open ones are listed under "Audit 1.5" there.
- [x] 1.6 Same audit for `GameSession.ts` (against `mode/GameMode.mt`, `mode/Adventure.mt`), `Bomb.ts`, `Shoot.ts` and `Item.ts`. Shots were rewritten; the level flow, hurry-up and portals now follow the original.
- [x] 1.7 Same audit for `levels/ScriptRunner.ts` (against `levels/ScriptEngine.mt`), `levels/LevelWorld.ts` (`SetManager.mt`, `GameMechanics.mt`) and `levels/LevelView.ts` (`View.mt`). The script engine now follows Flash's XML behavior (a removed trigger ends the cycle's scan, nested triggers move to the script end), tile changes and the enemy fall map follow the original, and the script is saved when a dimension is left. `tools/scan-scripts.ts` and `tests/scripts.test.ts` check every level script of every set.
- [x] Bug (found in 1.7): on level 86 (torches) and other dark levels, the darkness shows two large red discs near the top of the screen instead of light around the torches. Fixed in 2.7: the discs are the light holes, which erase the darkness (Flash `LAYER` + `ERASE`) and now follow the players.

## Phase 2: Finish the Adventure (critical path)

- [x] 2.1 Super-item entities (`entity/supa/*`: Ball, Bubble, Tons, IceMeteor, Arrow, Smoke, SupaItem), in `entity/Supa.ts`. Item effects 3, 8, 9, 24, 38 and the smoke of 19 use them, and the super item falls after a perfect-order clear (`Adventure.onLevelClear`). Tested in `tests/supa.test.ts`.
- [x] 2.2 Missing projectiles and bombs: FireRain, Hammer, BossFireBall, FramBall (`Shoot.ts`); BossBomb, SoccerBall (`Bomb.ts`). Item 85 (hammer), code trigger 6 (soccer balls) and the repel bomb's push on balls use them; BossFireBall, FramBall and BossBomb wait for their owners (2.8, 2.12, 2.9). MineFrozen and PoireBombFrozen are not ported: the original never creates them (`Mine.getFrozen` and `PoireBomb.getFrozen` are commented out). Tested in `tests/projectiles.test.ts`.
- [x] Bug (found in 2.2): SWF clip masks (`clipDepth`) are drawn as plain rectangles (`SwfMaskClip`), not the mask shape. The soccer ball shows a strip of its pattern instead of a round ball; 30 exported symbols use masks (player, bombs, items, portals, the boss bar). Fixed: masks are vector `Graphics` built from the mask character's paths (`SwfLibrary.getMaskContext`, holes kept); `_width` / `_height` scale them. Limit: a sprite mask uses its first frame only.
- [x] 2.3 The 24 missing item effects. All 118 effects of `SpecialManager.execute` are now a faithful port (no more "+2500 points" fallback), with screen flips (`GameMode.flipX/flipY`), the end-of-level stack, level conversion into pearls and the perfect bonus, and warps that stop at boss and empty levels. Several existing effects were fixed on the way (wrong curse icons, missing global flag, darkness). Special backgrounds stay for 2.6. Tested in `tests/specials.test.ts`.
- [x] 2.4 Zodiac items 40-63: add the constellation background (`fxMan.attachBg(BG_CONSTEL)`). Each sign shows its constellation (`sub` frame) for 4 seconds.
- [x] 2.5 Particle system (`entity/fx/Particle.mt`, `PARTICLE_*` constants), in `entity/Particle.ts`. Every caller uses its original type; the missing calls were added (Crawler, Saw, Bombe, portal opening, Guu doll rain, aqua bubbles), with `MAX_FX` and `destroySome`. Soccer, Framboise's other calls and the bosses' wait for 4.4, 2.12, 2.8 and 2.9. Tested in `tests/particles.test.ts`.
- [x] 2.6 Special backgrounds: `FxManager.attachBg/detachBg/clearBg` and the `BG_*` effects. `View.attachSpecialBg` hides the level background under `hammer_special_bg`; items 19, 21, 28, 83, 84, 86 and 100 use it. Tested in `tests/specials.test.ts`.
- [x] 2.7 Level transition scroll (`levels/ViewManager.mt`) and lighting. The IA map is parsed 30 cases per frame (17 frames), then the level scrolls up over a snapshot of the old one (40 frames); portals scroll sideways, or fade when arriving at no portal. Darkness (`GameMode.updateDarkness`) fully ported: light holes on the players and torches, candle and light bulb. `ViewLight.mt` turned out to be a wireframe preview for the `Browser` dev tool, out of scope. Replay snapshots re-recorded. Tested in `tests/transitions.test.ts`.
- [x] 2.8 Boss: Bat (`entity/boss/Bat.mt`, level 100) and `isBossLevel` logic, boss music. In `entity/Boss.ts`; its glow is a new WebGL `GlowFilter` (`SwfMovieClip.setGlow`). Boss music comes from the level script. Tested in `tests/bosses.test.ts`.
- [x] 2.9 Boss: Tuberculoz (`entity/boss/Tuberculoz.mt`, level 101) and the ending. Also in `entity/Boss.ts`, with his life bar, bullet time (`GameMode.bulletTime`, approximated by slowing the loop's clock) and the exit to level 102. The ending (elevator on 103, then the game ends) already worked; its game over hand-off is 2.11 and its results screen 3.1c.
- [x] 2.10 `StatsManager.mt` (extend and perfect rules) and `Chrono.mt`. In `StatsManager.ts` and `Chrono.ts`. The best combo of a level sets how many distinct letters (1 to 7) the next level with special slots drops; the letters are drawn when the level starts. `GameMode.lock/unlock` now stop and start the game chrono (level changes, pause). The perfect extend and perfect bonus were already ported. The other stats (kicks, bombs, jumps...) are counted but unused, as in the original. Tested in `tests/stats.test.ts`.
- [x] 2.11 Game over and end-of-set hand-off, as the original does it. `Adventure.onGameOver` rebuilds the history (version, game chrono, illegal flag) and `saveScore` hands the score, `reachedLevel` and `getPicks2` to the Loader; `onEndOfSet` calls `exitGame` (picks encoded with `PersistCodec`, sent to `endGame.html`). The Loader's end-of-game part is in `Loader.ts`, with the original `loading` clip (`_loader.swf` is now in the asset build): the save screen fades in over 44 frames and the game is removed. The result is a typed `GameResult` (`GameSession.onGameResult`, `lastResult`) for 3.1c and 3.2b. Also ported: `GameManager.logAction` and its callers, the score checksum (`Player.scoreCS`, which marks the game illegal), `registerScore` and `duration`. The placeholder text now shows after the fade, and a restart is only possible then. Replay snapshots with a game over were re-recorded. Tested in `tests/gameover.test.ts`.
- [x] 2.12 Simplified enemies: Framboise and Baleine, in `Bad.ts`. Framboise now follows the original: a close player bomb (or a random 0.7% per frame) makes it burst into 6 `FramBall` fragments and hide off screen; the fragments fly to a random platform top at least 8 cases away and it rebuilds there piece by piece (`sub` frames, then `o1` / `o2`). A freeze, knock or kill brings it back at once; its own particles are in. Its white glow is kept but never shows, as in the original (`white = 1` is commented out). Baleine is a plain `Flyer` of its own class. Not compared in Ruffle: Framboise only appears in `deepnight`, reached by portal (2B.0 adds the level jump). Tested in `tests/framboise.test.ts`.

## Phase 2B: Level-by-level comparison with the original

Start once Phase 2 is done; before that, most differences are features already listed there. 2B.0 runs first and checks the data of every level automatically, so the batches only cover what needs eyes. Progress is tracked per level in [LEVELS.md](LEVELS.md).

Order: 2B.0, then 2B.12 (small dimensions, a short first run of the checklist), then the Adventure (2B.1 to 2B.11), then Phase 3, then the larger dimensions (2B.13 to 2B.28) alongside Phase 4. Reason: the Ruffle side-by-side starts the original without the site (only `lang`), so with the base item families, no options and no profile, which is what the port runs today; Phase 3 changes the item pool and adds options, so the core levels are compared before it. 2B.0 must also find out which item families the original uses without the site, so item drops are compared on the same pool: found in 3.2a, `0,7,1000,18` (`GameManager`, "sysfam"), which the port now uses for games not started from the menu.

Checklist for every batch task (2B.1 onward), the same each time:

1. Open each level in the port and in the original (Ruffle side-by-side, "Flash" button), using the level jump from 2B.0. Player screenshots and notes for every level are on [hamm4all.net](https://hamm4all.net/games) ("Les Cavernes de Hammerfest"), and its rules pages list the original's known bugs.
2. Check, and fill the level's row in LEVELS.md: look (tiles, background, decor), enemies (types, spawn points, behavior), items (spawn spots, timing), script events, portals and secret passages, darkness, music, level clear and exit.
3. Fix each difference in the port, or log it in the Notes column with the roadmap task that owns it.
4. Record a short replay of the level as a regression fixture in `tests/replays/`.
5. Tick the batch here when every row of it is filled.

- [ ] 2B.0 Automated pass over every set in `xml/levels/`: compare the built level data with the original XML (tiles, enemy and item slots, scripts, portal links, backgrounds) and report differences as a test. Add a way to open a given level in both the port and Ruffle, if the original allows it (check the debug and dev entry points). Mark the Data column of LEVELS.md. Level scripts are already checked by `tests/scripts.test.ts` (1.7).
- Adventure (107 levels), 10 per batch:
  - [ ] 2B.1 Adventure 0-9
  - [ ] 2B.2 Adventure 10-19
  - [ ] 2B.3 Adventure 20-29 (boss warning at 30 starts here)
  - [ ] 2B.4 Adventure 30-39
  - [ ] 2B.5 Adventure 40-49
  - [ ] 2B.6 Adventure 50-59
  - [ ] 2B.7 Adventure 60-69
  - [ ] 2B.8 Adventure 70-79
  - [ ] 2B.9 Adventure 80-89
  - [ ] 2B.10 Adventure 90-99
  - [ ] 2B.11 Adventure 100-106 (bosses Bat and Tuberculoz, the ending)
- Dimensions reached by portals (`xml/portalLinks.xml`), about 20 per batch:
  - [ ] 2B.12 Small dimensions: hiko (18), hof (4), hk (1)
  - [ ] 2B.13 bumdum 0-19
  - [ ] 2B.14 bumdum 20-42
  - [ ] 2B.15 ayame 0-19
  - [ ] 2B.16 ayame 20-39
  - [ ] 2B.17 ayame 40-57
  - [ ] 2B.18 deepnight 0-19
  - [ ] 2B.19 deepnight 20-39
  - [ ] 2B.20 deepnight 40-59
  - [ ] 2B.21 deepnight 60-79
  - [ ] 2B.22 deepnight 80-99
  - [ ] 2B.23 deepnight 100-119
  - [ ] 2B.24 deepnight 120-139
  - [ ] 2B.25 deepnight 140-159
  - [ ] 2B.26 deepnight 160-179
  - [ ] 2B.27 deepnight 180-199
  - [ ] 2B.28 deepnight 200-226
- The sets of the other modes (tutorial, shareware, timeAttack, multiTime, soccer, fjv: 79 levels) are checked with their mode in Phase 4, using the same checklist.

## Phase 3: Shell and progression

- 3.1 Screens that replace the hammerfest.fr site. In the original, the title, the mode menu, the results page after a game and the end-of-game page were all on the website, not in the client (see `HammerClient.as`, `GameManager.mt`, `Loader.mt`). They cannot be ported from the source, so they share one research task and one design.
  - [x] 3.1a Research and design: what each site screen showed (title, mode menu, options, results page after game over, `endGame.html` after the set, quest and collection pages), from archives of the hammerfest.fr site and player wikis, together with the quest rules of 3.2a. Archived site files (pages, menu and help graphics, public profiles with quests and fridge, forum screenshots) are in `assets-src/site-archive/` (README there; finish the download with `npx tsx tools/fetch-site-archive.ts`). Then one design decision for all site-replacement screens (3.1b, 3.1c, 3.2d), reusing the game's own graphics where they exist. Write the findings in PORT_STATUS.md. Done: findings and the design in PORT_STATUS.md ("Site screens"). The site pages are rebuilt in HTML from the archived CSS and images; the loader screens stay in the canvas.
  - [x] 3.1b Title screen and mode menu, starting the modes through `GameManager.startMode` as the site did. Done: `src/ui/Shell.ts` draws the menu in the game frame with the game's graphics (Adventure, and Learning listed as coming soon; texts from the site guide in FR/EN/ES; keys or mouse), images copied by `tools/build-site.ts`. A first version rebuilt the site in HTML; it was replaced as it did not fit the app. "Start game" goes through the Loader as the original did: "click to start" (frame 2), frame 3, then the game starts under frame 6, which fades out (`Loader.gameReady`, `queryStart`, `startGame`). The debug toolbar still starts a game directly. Left: the Paramètres page (`$volume`, `$sound`, `$music`, `$detail`, `$shake`) and the mode options (3.3). Tested in `tests/start.test.ts`.
  - [x] 3.1c Results screen after game over and after the end of the set. It reads the result from 2.11 (score, reached level, items found, new uniques), saves it through the profile (3.2b) and returns to the menu (3.1b). Replaces the placeholder in `GameSession.onGameEnd()`. Done: `Shell.showResult`, in the game frame. A game over shows the reached level, its area name and the score; both show the items found as game item clips with their count; the end of the set decodes the picks sent to `endGame.html`. The Loader now shows "Sauvegarde réussie ! :)" (lang 73) before handing over, as on the server's answer. "Cliquez pour continuer..." (lang 6) goes back to the mode menu. The placeholder restart is gone (3 replay snapshots that restarted after a game over were updated). Left for 3.2b: saving to the profile and the new fridge items; for 3.2c: quest progress. Screen titles with no archived text are the port's own. Tested in `tests/shell.test.ts` and `tests/gameover.test.ts`.
- 3.2 Quests and progression. The original client never runs quests: the hammerfest.fr server counted items, checked `xml/quests.xml` (76 quests) and sent back the unlocked families as the `$families` parameter (`Loader.mt`, `GameParameters.hasFamily`). That server code is not in the released source, so the rules must come from `quests.xml` and outside evidence, and every guess must be logged in PORT_STATUS.md.
  - [x] 3.2a Research (done together with 3.1a): settle what the server did. Do item counts add up across games? When are quests checked (end of game or live)? What do the `tokens`, `bank` and `log` rewards do? What is the starting family set? Sources: `quests.xml` comments, `Lang.mt`, `QuestBrowser.mt`, `HammerClient.as`, archives of the hammerfest.fr site (`assets-src/site-archive/`) and player wikis, above all [hamm4all.net/objects/quests](https://hamm4all.net/objects/quests) (requirements, rewards and known breakages such as "Maître des bombes", which called a server and has been broken since March 2017). Write the findings in PORT_STATUS.md. Done: PORT_STATUS.md "Quests and profile". Counts add up over Adventure games, quests are checked at the end of a game and apply from the next one, `tokens` are free games and `bank` more games per purchase (both without effect in the port), `log` has no known effect, the fridge threshold is the items' `unlock` (10 by default). The no-site families are `0,7,1000,18` (`GameManager`); a new player's are guessed as those plus 1020, 1024 and 1028.
  - [x] 3.2b Player profile save: item collection (count per item id, as the server kept it), quests done, unlocked families, options and modes. Versioned, with the save codec in `src/engine/`, stored in `localStorage` (no remote database for now). Done: `src/game/Profile.ts`, key `hammerfenix_profile_v1`, `PersistCodec` with CRC. Only Adventure games started from the menu are recorded (`GameSession.siteMode`).
  - [x] 3.2c Quest engine: read `quests.json`, check requirements, apply `give` / `remove` (families, options, modes, tokens, bank, log) and pass the families to `GameSession` instead of the fixed 0-2 and 1000-1002. Add a test that every quest's item, family, option and mode ids exist and every reward type is handled. Done: `src/game/Quests.ts`, and a port of the families and options of `GameParameters` (`GameSession.config`, `setParameters`). Games the menu starts get the profile's families; others the system families. Replays store their families. Tested in `tests/quests.test.ts`.
  - [x] 3.2d Quest and collection screen (the original's was on the site; its look follows the design of 3.1a), with quest names and descriptions from `Lang.getQuestName` / `getQuestDesc`. Done: "Quêtes" and "Réfrigérateur" tabs on the mode menu (the site's icons), a quest screen (done and in progress, items found / needed, description once done), a fridge screen (353 items, 60 a page, count, family) and the quests completed on the results screen.
- [x] 3.3 Game options: mirror, nightmare, ninja, bomb expert, boost, kick and bomb control (`OPT_*` in `Data.mt`). Flags exist in `GameSession` but nothing sets them. Each option is unlocked by a quest (`give option=` in `quests.xml`), so wire them to the profile from 3.2. Done: the flags are set from `$options` at each new game; mirror (`flip`, `flipPortals`), ninja (`onBadsReady`) and the Tornade boost are ported. The menu shows Adventure's options as checkboxes (locked ones greyed, ticks saved in the profile); Tornade is always on once unlocked (quest 62). Kick control (Soccer), bomb control and the other multiplayer options wait for their modes (Phase 4). See PORT_STATUS.md "Game options". Tested in `tests/options.test.ts`.
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
