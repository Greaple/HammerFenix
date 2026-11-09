# Port status

Original path is relative to `assets-src/original/class/hammer/`. Assessed 2026-11-03.

Status: **done** = faithful port · **partial** = ported with gaps · **approx** = simplified behavior · **missing** = not started

## Core

| Original                                                      | TypeScript                                        | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Data.mt`                                                     | `src/game/Data.ts`                                | done    | Every constant of `Data.mt` is in, with its value: `tests/data-constants.test.ts` reads and evaluates `Data.mt` itself (2C.8). `ACTION_*` were 1 to 4 and are now the original's 19 to 22 (only compared to each other). Editor, walking bomb and item browser constants are there unused                                                                                                                                       |
| `Entity.mt`                                                   | `entity/Entity.ts` BaseEntity                     | done    | Audited (1.5). No `fl_stickRot` / `fl_stickBound` (no caller yet)                                                                                                                                                                                                                                                                                                                                                               |
| `entity/Animator.mt`                                          | `entity/Entity.ts` AnimatorEntity                 | done    | Audited (1.5)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `entity/Physics.mt`                                           | `entity/Entity.ts` PhysicsEntity                  | done    | Audited (1.5). Aqua bubbles in `endUpdate` (2.5)                                                                                                                                                                                                                                                                                                                                                                                |
| `entity/Mover.mt`                                             | `entity/Entity.ts` MoverEntity                    | done    | Audited (1.5)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `entity/Player.mt`, `PlayerController.mt`                     | `entity/Player.ts`                                | done    | Audited (1.5), see "Audit 1.5" below                                                                                                                                                                                                                                                                                                                                                                                            |
| `SpecialManager.mt`                                           | `entity/Player.ts`                                | partial | all 118 effects, with special backgrounds; the ghost glow missing, see below                                                                                                                                                                                                                                                                                                                                                    |
| `entity/Item.mt`, `item/*`                                    | `entity/Item.ts`                                  | done    | Audited (1.6)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `entity/Trigger.mt`                                           | `entity/Entity.ts`                                | done    |                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FxManager.mt`                                                | `src/game/FxManager.ts`                           | done    | `inGameParticles` / `inGameParticlesDir` (2.5); no low-detail mode, so particles always show                                                                                                                                                                                                                                                                                                                                    |
| `entity/fx/Particle.mt`                                       | `entity/Particle.ts`                              | done    | All 15 types (2.5). `Std.random(sub._totalframes)` with no `sub` is 0, without a draw                                                                                                                                                                                                                                                                                                                                           |
| `RandomManager.mt`                                            | `src/game/RandomManager.ts`, `src/game/Random.ts` | done    | Seeded generator (`game.rand`) replaces `Std.random` and `Math.random`. Item families come from `GameSession.config` (3.2)                                                                                                                                                                                                                                                                                                      |
| `StatsManager.mt`, `Stat.mt`, `Chrono.mt`                     | `src/game/StatsManager.ts`, `src/game/Chrono.ts`  | done    | Extend letters per level from the best combo (2.10). `gameChrono` runs on real time (`GameSession.getTimer`); its `formatTime` is computed as in UTC+1, where the original's hour fix-up was right                                                                                                                                                                                                                              |
| `Cookie.mt`, `Lang.mt`, `GameManager.mt`, `GameParameters.mt` | `src/main.ts`, `Data.ts` (lang)                   | approx  | Language choice in `src/ui/Language.ts` (3.4). `GameParameters` families and options in `src/game/GameParameters.ts` (3.2), its volumes and `hasMusic` (5.1, at the site's defaults: no settings page yet); `$detail` and `$shake` not yet. `GameManager`'s sound channel volumes are `GameSession.initSoundChannels` (5.1). `GameManager.history`, `logAction`, `logIllegal`, `redirect` and `KEY` are on `GameSession` (2.11) |
| `Loader.mt` (end of game)                                     | `src/game/Loader.ts`                              | partial | `gameOver`, `exitGame`, `attachLoading` and the fades of `mainGame` (2.11), with the `loading` clip of `_loader.swf`. Not ported: the page start (`startGame`, its fade-out, 3.1b), music loading, the server (sending the score, retries, `saveAgain`, redirections)                                                                                                                                                           |

## Engine

- Blend modes: Flash `LAYER` is `SwfMovieClip.setLayerBlend` (an `AlphaFilter` that also carries `_alpha`), `ERASE` is Pixi's `erase`. Only set from code (the darkness); timeline blend modes other than multiply, screen and add still draw as normal. `OVERLAY` (`FxManager.attachExplosion`, every explosion) is not ported: Pixi's advanced overlay drew the level shifted and banded inside the zone, so explosions show as a pale disc where the original tints the level (2B.4).
- Color transforms: a timeline update with an identity color transform resets the previous one (the end of a fade); the build used to drop it, so fades froze one step short (the darkness veil at 79%, the message panel, the pointer, the lives, 24 clips in all). `tools/build-swf.ts` keeps it on updates, as it does for matrices (2B.4).
- SWF frame scripts: 86 of 89 run in `src/engine/swf/Avm1.ts`. Not run: 2 particle emitters (`_gfx` #234, `_anims` #150) and a ghost effect (`_anims` #3200), which define functions.
- Frame scripts of a frame reached by `gotoAndStop`, `nextFrame` or `prevFrame` from game code are queued and run after the logic tick or animation step (`runQueuedFrameActions`), as Flash runs them once the running script ends. This lets FX stepped by `Animation.update` loop from their own label (the shield, `hammer_fx_exit`, `hammer_fx_pointer`) and FX that end in `removeMovieClip` remove themselves. `gotoAndPlay` and AVM1 gotos still run them at once.
- Backward timeline seeks keep children that stay on the same depth, as Flash does.
- Text fields bound to a variable (`DefineEditText` `variableName`, e.g. `label`, `_parent.label`) show it: `SwfMovieClip.setVariable` (the original's `mc.label = ...`) updates them, and a field placed later reads it (3.4). HTML fields start with their text, not their markup. HTML text keeps `<b>`, `<font color>` and `<br>` (Pixi tag styles, `parseFlashHtml`); other tags are dropped (2B.4).
- `_width` / `_height` are the exact vector bounds, hidden children included, as in Flash. Hit boxes no longer include the 1 px rasterization margin.
- Animation runs at 40 Hz, tied to the 32 Hz logic (5 steps per 4 ticks).
- Input is sampled once per tick (`InputController.poll`), and can be recorded and replayed (`InputRecording.ts`). `SwfLibrary.headless()` runs the game in Node.
- Controllers (G.1, port addition: the Flash game had the keyboard only): `src/engine/Gamepad.ts` reads player 1's controller, the first one connected (the others are ignored until G.2; the next one takes over when it is unplugged), with the standard mapping: D-pad and left stick move (dead zone with hysteresis, up asks a firmer push), A or up jumps, B, X or the right trigger (R2) drops a bomb, Start pauses, Back / Select switches the music, Y changes the disguise (2C.3). It goes through the same action mask as the keyboard, so recordings work. Menus read their own moves (`InputController.consumeMenu`): the D-pad or stick, A or Start confirm, B goes back; the keyboard keeps arrows, the bomb key and P / Escape. While a dialog is open the controller's presses close it (A, B, Start) or scroll it (D-pad), and the game ignores the controller until it is let go. The screens show the buttons of the device used last (`InputController.device`, `html[data-input]`): the menu's action button (keycap, A or B, nothing on touch), the pause screen (its keyboard keys, depths 9 to 37 of `hammer_interf_instructions` frame 1, are hidden under the controller's buttons), the Loader's "click to start", the help dialog (controller block first) and the touch buttons (hidden). Buttons follow the controller (`padLayout`: Xbox, PlayStation, Nintendo, or generic with Xbox's buttons and Start / Select). They are the icons of three Figma Community sheets (CC BY 4.0, credited in the help dialog), cleaned by `tools/build-pad-icons.ts` from `assets-src/pad-icons/` (README there) and drawn in each screen's colors; a button with no icon would be drawn by `PadGlyphs.ts` (today every button has one). A notice shows when a controller is plugged in or unplugged; unplugging it during a game pauses it (`GameSession.requestPause`, which waits for the end of a level change). Tested in `tests/gamepad.test.ts`. No give-up (Ctrl+Shift+K) on the controller.
- Disguises (2C.3, `GameMode.getControls`): each press changes the player's head to the next one whose quest family the profile has (109 afro, 110 cerbère, 111 piou, 112 mario, 113 Tuberculoz cape), then back to the normal head. Read every tick, also in pause, as the original does; `fl_disguise` is on (only the boss rush, soccer and co-op modes turn it off). Deviation: the key is E, not the original's D, which moves right with WASD and ZQSD here; the quest texts still say "D". It is in the recorded action mask. Named in the help dialog; the original's pause screen does not name it. Tested in `tests/disguise.test.ts`.
- Offline play (5.3, port addition): the build's service worker (`tools/vite-plugin-offline.ts`) caches every built file and serves them cache first; the cache name is a hash of the files. Not in the dev server.
- Rendering (5.2): the page draws the stage only after a logic tick (`FixedGameLoop.stepCount`), as nothing in the game changes between ticks; site screens, their fade and a stopped loop draw every frame. Flash drew at the movie's 40 Hz.
- Sound (5.1): `src/engine/Audio.ts` ports `SoundManager` from Motion Twin's `mtypes` library (`lib/SoundManager.mt`, github.com/motion-twin/mtypes, not in this repo) and the Loader's music `Sound` objects. A channel (`Data.CHAN_*`) is only a volume: sounds on it overlap, as Flash's `Sound.start` never stops the instance already playing (checked in Ruffle's `avm1/globals/sound.rs`). At most 32 sounds play at once, new ones are dropped (Ruffle's `AudioManager.MAX_SOUNDS`). Volumes are the original's for the site's settings (`$volume=100`, `$sound=1`, `$music=1` in the archived `try.html` and `soccer.html`): player, bomb, item and field sounds 50, enemies and interface 40, music 33 (16 paused, 0 muted with M). `Mode.playMusicAt` restarts a track even when it is already playing. Not ported: `SoundManager.fade` and `loop` (unused by the game, except the silent `sound_kick` loop when the music is off). Port additions: the page's sound switch, the pause of a hidden tab, and the files fetched at start and decoded on the first click or key (Flash had the sounds in the SWF, and the Loader downloaded the musics before the game). Tested in `tests/audio.test.ts`.

## Modes

| Original                                                                                                     | TypeScript                | Status  | Notes                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Mode.mt`, `mode/GameMode.mt`, `mode/Adventure.mt`                                                           | `src/game/GameSession.ts` | partial | Audited (1.6), see "Audit 1.6". Darkness with light holes (2.7). Bosses and bullet time (2.8, 2.9). Stats and game chrono (2.10). Game over and end of set hand off to the Loader (2.11). Started from the site's mode menu through the Loader (3.1b), ends on the site's results page (3.1c). Missing: map, options |
| `mode/TimeAttack*.mt`, `MultiCoop.mt`, `Soccer*.mt`, `BossRush.mt`, `Tutorial.mt`, `Shareware.mt`, `Fjv*.mt` |                           | missing | Level sets load but run with Adventure rules                                                                                                                                                                                                                                                                         |

## Levels

| Original                                                     | TypeScript                               | Status  | Notes                                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `levels/SetManager.mt`, `GameMechanics.mt`                   | `levels/LevelWorld.ts`                   | done    | Audited (1.7). Mirror mode (`flip`, 3.3). IA map parsed 30 cases per frame (2.7). Editor and serialization skipped on purpose                                    |
| `levels/ScriptEngine.mt`                                     | `levels/ScriptRunner.ts`                 | done    | Audited (1.7). `tools/scan-scripts.ts` checks every level script                                                                                                 |
| `levels/View.mt`                                             | `levels/LevelView.ts`                    | partial | Audited (1.7). Special backgrounds hide `_bg` (same picture as the Flash 8 cache path). Snapshots via Pixi `generateTexture` (2.7). No bitmap cache, editor grid |
| `levels/ViewManager.mt`                                      | `GameSession.ts` ("ViewManager")         | done    | Level scroll, portal side scroll and fade (2.7), with the old view as a snapshot (`fake`); no snapshot when headless. `flipPortals` in mirror mode (3.3)         |
| `levels/ViewLight.mt`                                        |                                          | skipped | Wireframe level preview used only by the `Browser` dev tool (out of scope). The darkness is `GameMode.updateDarkness`, ported in 2.7                             |
| `levels/PortalLink.mt`, `PortalData.mt`, `TeleporterData.mt` | `levels/LevelWorld.ts`, `GameSession.ts` | partial | Portals follow the original (arrival portal, late players, floating portal pull-in, side scroll or fade). Map events (`EVENT_EXIT_*`) not ported                 |

**Level data and portals (2B.0, 2B.1).** `tests/level-data.test.ts` checks the 662 levels of the 17 sets: `PersistCodec` decodes each one losslessly (encoding it again gives the original string), the built JSON holds the same data, every value is in range, the port reads each level as `SetManager.unserialize` + `parseWalls` do (mirrored too), and every background, tile skin, field and enemy id has its SWF frame or class. `tests/portals.test.ts` checks the 96 links of `portalLinks.xml` and takes the 95 that can be used headless, normal and mirrored: the player enters the portal (field portals, or floating ones opened by their own script trigger, given the key when locked) and must arrive at the target level, on the case `getPortalEntrance` gives. Quirks of the original data, kept: the village's portal has two links and `getLink` takes the first (deepnight), so the link to hiko is never used and no portal leads to hiko; `main51 > d_temple` arrives at portal 0, which is only a floating portal there, so the player starts at the level start; ayame 28 and 34 open portals that have no link. The original game only loads 14 sets (`swfmake.xml`): `adventure_english`, `basicAdventure` and `bumdum` are not in it.

## Enemies (`entity/Bad.ts`)

All 21 species are registered in the factory at the end of `Bad.ts`.

- done: `Bad`, `Walker`, `Jumper`, `Shooter`, `Flyer`, `WallWalker`, `Spear`, `FireBall`, Pomme, Cerise, Banane, Ananas, Abricot, Poire, Bombe, Orange, Fraise, Citron, Tzongre, Crawler, Saw, Litchi, LitchiWeak, Kiwi
- done (2.12): Baleine (a plain `Flyer` in the original too, now its own `BaleineBad` class), Framboise (bursts into `FramBall` fragments and rebuilds at the target; not audited in 1.5, ported line by line in 2.12)
- unused: `walker/Coward.mt`, `walker/Hunter.mt` (the original's `attachBad` never creates them)
- All classes above audited line by line in 1.5, see "Audit 1.5" below.
- Spot checks (2B.5): every species compared with the original in Ruffle at its first level, all match. See [LEVELS.md](LEVELS.md).
- done (2.8, 2.9): `boss/Bat.mt` (level 100), `boss/Tuberculoz.mt` (level 101), in `entity/Boss.ts`. See "Bosses" below.

## Bombs and projectiles

- `entity/Bomb.ts` done (audited 1.6): Bomb, PlayerBomb, Classic, Black, Blue, Green, Red, RepelBomb, BadBomb, PoireBomb, Mine
- done (2.2): `bomb/bad/BossBomb` (used by Tuberculoz, 2.9), `bomb/player/SoccerBall` (no glow: `FxManager.addGlow` is not ported, though `SwfMovieClip.setGlow` now exists; round since the clip mask fix)
- unused: `bomb/player/MineFrozen`, `PoireBombFrozen` (`Mine.getFrozen` and `PoireBomb.getFrozen` are commented out in the original, so nothing creates them)
- missing: `entity/WalkingBomb.mt`
- `entity/Shoot.ts` done (rewritten from the original in 1.6): Shoot, Pepin, Zeste, FireBall, Ball, PlayerArrow, PlayerFireBall, PlayerPearl
- done (2.2): `shoot/FireRain`, `Hammer` (item 85), `BossFireBall` (used by the Bat, 2.8), `FramBall` (used by Framboise since 2.12)
- `entity/Supa.ts` done (2.1): `entity/Supa.mt` and all of `entity/supa/*` (Arrow, Ball, Bubble, IceMeteor, Smoke, SupaItem, Tons).

## Interface

| Original               | TypeScript                | Status  | Notes                                                        |
| ---------------------- | ------------------------- | ------- | ------------------------------------------------------------ |
| `gui/GameInterface.mt` | `src/game/gui/GameHud.ts` | partial | Single player only (no `initMulti`, `initTime`, `lightMode`) |

Spot checks (2B.4): the level name banner shows only on levels with a name of their own (`Lang.getLevelName`, not the area's name), and messages show `*word*` in the lighter color (`GameMode.attachPop`, `Data.replaceTag`); both were plain differences. The rest is in [LEVELS.md](LEVELS.md).
| `gui/SoccerInterface.mt`, `ExtendBox.mt`, `Container.mt`, `SimpleButton.mt`, `Field.mt`, `Label.mt`, `Item.mt` | | missing | |

## Site screens (3.1a research)

The original client never showed a title, a mode menu or a results page: hammerfest.fr did, in HTML around the Flash `loader.swf`. Sources: `assets-src/site-archive/` (pages, `img/design/`, `css/main_v77.css`), `Loader.mt`, `GameParameters.mt`, `GameManager.startDefaultGame`, `xml/lang/*.xml`.

**What the site passed to the client** (flash variables, read by `Loader` / `GameParameters`):

- `$mode`: `solo` (Adventure), `tutorial`, `timeattack`, `multitime`, `multicoop`, `soccer`, `bossrush`. `GameManager.startDefaultGame` picks the mode from it.
- `$options`: comma list of `Data.OPT_*` (`mirror`, `nightmare`, `ninja`, `bombexpert`, `boost`, `kickcontrol`, `bombcontrol`, `mirrormulti`, `nightmaremulti`, `lifesharing`, `soccerbomb`) and the level set choice `set_ta_N`, `set_mta_N`, `set_soc_N`.
- `$volume`, `$sound`, `$music`, `$detail`, `$shake`: the player's settings ("Paramètres" on the site). `$music=0` skips the music download.
- `$lang`: `fr`, `es` or `en`. `$families` came back from the server's start query (3.2).

**In-client screens (ported exactly, not site):** the `loading` clip of `_loader.swf`, frames 1 "Voyage vers Hammerfest... / km" (download), 7 "Chargement des musiques...", 2 "Vous y êtes ! / Cliquez pour commencer... / Une partie vous sera décomptée." (or "Ce mode est gratuit et illimité !" for tutorial and soccer), 3 "Démarrage de la partie...", 6 the fade into the game, 5 "Sauvegarde en cours !" at the end. Texts are `Lang` statics 50 to 63.

**Site screens and what is known of each:**

- Home / title: the public home page (archived 2006 to 2020): header `headers/fr/header.jpg` on `stars.jpg`, `landscape.jpg`, the four `icon_*` tabs (Jouer, Réfrigérateur, Quêtes, Classement). Nothing to play there without an account.
- Mode menu ("MENU CHOOSE GAME" in the CSS): the HTML is behind the login and was never archived; the CSS rules and images are. A 454 px box (`menu/menutop|menubg|menubot.gif`): left column of 137 px, right aligned, one link per mode with a 23 px icon (`iadv`, `itutorial`, `itatt`, `imulticoop`, `imultitime`, `isoccer`, `ibossrush`, each with `_over`); right column of 268 px with the mode's title (`h2`), its text, the option checkboxes (`.mopt`, `ul.moptl`, disabled ones `.lidis`), a level set `select` (`.slc`) and the "Commencer" button (`.button`). Under it a second box (`menub*.gif`) with bullet links (`imenub.gif`), the `.arrow` and the `igorWonder` picture. The guide (`guide.html`): "select a mode and click Commencer"; Adventure costs one game (snowflake), Apprentissage is free; other modes are unlocked by quests. An older (2006) menu used the 214x102 cards `choice_*.gif` (`_off` when locked). `choice_timeattack_off.gif` in the archive is a wrong capture (it shows the Introduction card).
- Options ("Paramètres"): detail, shaking, sound, music, volume (guide section 8, `help_opt.gif`), i.e. the `$detail`, `$shake`, `$sound`, `$music`, `$volume` variables.
- Results page after a game (`/play.html/<id>/result`): never archived (owner only). The CSS gives its parts: `h2.gameOver` title, `.artResult` picture (a melted Igor under "GAME OVER": given by the maintainer, shown since UI batch U.2), `.levelResult` (reached level and score, with an `icon_endGame.gif` when the end was reached), `ul.collected` (items found, 30 px icons, `asterisk.gif` bullets), `table.result` (quest progress: title column, progress, `.statusCompleted` in green), `.continue` box.
- `endGame.html` (end of the set): only a 404 was archived; `icon_endGame.gif` marks a finished game on profiles.
- Fridge (`/user.html/inventory`) and quests (`/user.html/quests`): behind the login. The CSS has `table.fridge` (item, quantity, name, `unknown` cells, per family `familyStatus` headers) and `table.quest` (`questTitle`, `notYetQuest`). Public profiles show the same data: completed quests, quests in progress, and "N objets sur 353" with one small icon per item (`a.gif` for one not found). The guide: an item needs about 10 finds to enter the fridge; the fridge has no effect on play.

**Design (decided 2026-11-06, replacing an HTML rebuild of the site tried the day before):** the site screens are drawn inside the game frame with the game's own graphics (`src/ui/Shell.ts`). Since UI batch U.2: the village scene (`menu`, vector), the game's title logo (`assets-src/original/images/mainTitle.png`, upscaled to 2000 x 857 by the maintainer in `assets-src/upscaled/`, copied to `public/images/` by `tools/build-site.ts`), vector parchment panels, the pause screen's space key, item clips as icons, and the game's fonts, extracted from the SWF's `DefineFont3` outlines by `tools/build-fonts.ts` (Satans lacks accents: they are composed from its own glyphs). The site's banners and GIF icons are no longer used. Built: the mode menu (3.1b) and the results screen (3.1c). The page around the frame is the port's own (UI batch U.1): a landscape picture (`public/scenery/landscape.jpg`), a floating header and the help dialog in the parchment colors, texts in `src/ui/PageText.ts`; the dev controls are switched on in the help dialog (or `?dev`). The loader screens stay as ported from `Loader.mt`, except the start from the menu: `Loader.startNow` (port addition) builds the game at once, without frame 2 ("click to start", which covered the game's download on the site) or the frame 6 cover, and the menu fades out over the first level. `gameReady` and the click remain, unused by the menu. Texts: mode names and descriptions from the site guide, level, area names and "click to continue" from the game's lang files; the screen titles ("Game modes", "Game over", "Items found") are the port's own.

## Quests and profile (3.2a research)

The original client never runs quests: the hammerfest.fr server counted the items each game sent, checked `xml/quests.xml` and answered the next start query with `$families` (`Loader.mt`). Its code was never released. The port rebuilds it in `src/game/Quests.ts` (rules) and `src/game/Profile.ts` (save). Sources: `GameManager.mt`, `GameParameters.mt`, `mode/QuestBrowser.mt`, `xml/quests.xml` and `xml/items`, the site guide (`guide.html` FR/EN/ES), the archived public profiles (`user_*.html`), and hamm4all.net (its API: `/api/v1/quests`, `/api/v1/families`, `/api/v1/items`).

**Settled from evidence:**

- **Item counts add up over all games.** Guide section 6: a quest "consiste à accumuler une série d'objets précis", and the fridge keeps "sa collection". Only the Adventure mode counts (guide section 4: items "sont acquis au cours du jeu dans le mode Aventure").
- **Quests are checked at the end of a game**, by the server, from the items the game sent (`$item2` of a game over, or the picks sent to `endGame.html`). The rewards apply "de manière permanente pour vos prochaines parties" (guide section 6), so never during a game. The results page had a quest progress table (`table.result`, `.statusCompleted` in green `#51cc15`).
- **Quest status:** the profiles list "Quêtes completées" and "Quêtes en cours" (in progress: started, not done), each in quest id order, and "Aucune! Il va falloir jouer plus!" when none is in progress.
- **Rewards** (`QuestBrowser.mt` lists all but `log`; the texts are the quests' `Lang` descriptions and hamm4all): `family` adds or removes an item family (families 100 to 113 are powers read by `Player` and `GameMode`, 5000 to 5099 world keys); `option` unlocks a game option (3.3); `mode` unlocks a game mode (Phase 4); `tokens` gives N free games (quests 32 to 34, "Vous avez gagné 5 parties supplémentaires"); `bank` raises the games each shop purchase gives (quest 35, "Vos appels dans la boutique vous rapporteront dorénavant plus de flocons"). `log` is only on quest 74 ("Maître des Bombes") and has no known effect.
- **Fridge:** an item shows once found `unlock` times, an attribute of `xml/items` (`<item ... unlock="1"/>`), 10 when absent. Guide section 4: "vous devez avoir trouvé au moins 10 fois un objet"; hamm4all uses the same values. 353 items (the profiles' "N objets sur 353").
- **No-site families:** `GameManager` uses `0,7,1000,18` ("using sysfam") for the tutorial and when the game runs with no site. In dev mode (the set `xml_dev` is present) it uses `0,7,1000,1001,1002,1` to `19` instead; `game.swf` embeds `xml_dev`, so the Ruffle side-by-side runs with those (2B.3). The port uses it for games the menu does not start (debug toolbar), and replays store their families (`Replay.families`; the first 6 replays were recorded with 0-2 and 1000-1002 and keep them).

**Guesses (no direct evidence):**

- **Starting families of a new player:** `0, 7, 18, 1000, 1020, 1024, 1028`. 7 and 18 are in the system set and removed by quests 2 and 35, but no quest gives them. 1020 (ice keys), 1024 (game pads) and 1028 (Sandy's kit) hold items with a rarity above 0, no quest gives them, and archived profiles completed "Sandy commence l'aventure !" (1028) and had "Meilleur joueur" (1024) in progress, so the server gave them. 1019, 1027 and 1029 only hold rarity 0 items (placed by scripts or events), so they make no difference and are left out.
- Quests do not use up their items (the fridge keeps counting, and several quests share items).
- Quests are checked in id order, once each; a quest's `give` and `remove` entries apply in document order.
- The end of the set (`endGame.html`) counts its picks like a game over.
- Games marked illegal (`$!` in the history) still count: what the server did with them is unknown.
- `tokens` and `bank` are kept in the profile but do nothing: the port has no game cost and no shop.

**Built (3.2b to 3.2d):** the profile (items, quests, families, options, modes, tokens, bank, games) is saved in `localStorage` under `hammerfenix_profile_v1`, encoded with `PersistCodec` and its CRC; a damaged save starts a new profile. Games started from the menu send the profile's families (`GameSession.setParameters`), and only those Adventure games are recorded (`GameSession.siteMode`). The menu has the site's "Quêtes" and "Réfrigérateur" tabs (`icon_quests`, `icon_inventory`): the quest screen lists quests done and in progress with their items ("found / needed") and, once done, the description; the fridge shows the 353 items in `items.xml` order, 60 per page, with their count, family and the site's `a.gif` for an item not in it yet. The results screen adds the quests completed and the new fridge items. The options unlocked are offered on the mode menu (3.3, see "Game options"). Tested in `tests/quests.test.ts`.

## Game options (3.3)

The site sent the options ticked on its mode menu as `$options`; `GameMode`'s constructor reads them through `GameManager.CONFIG.hasOption`. The port does the same at each new game (`GameSession.initOptions`, from `config`), and the menu (`Shell.drawOptions`) sends the profile's ones (`Profile.optionsParam`). Tested in `tests/options.test.ts`.

- **Ported:** mirror (`SetManager.flip` of the map and the start case, `flipPortals` after each transition; enemies, slots and scripts were already placed through `flipCoordCase`), nightmare, ninja (`GameMode.onBadsReady`: one foe, friends by depth), unstable explosives (`fl_bombExpert`), the Tornade boost (`Player.initPlayer`, `resurrect`).
- **Fixed:** the player's start and respawn went through `flipCoordCase`, which would have flipped them twice: the original reads the start case of the flipped level as is.
- **Menu:** Adventure lists Miroir, Cauchemar, Ninjutsu and Explosifs instables as checkboxes, the locked ones greyed (the site's CSS: `.mopt` box with an uppercase title, `ul.moptl`, `.lidis` for disabled items; the HTML was never archived). The ticks are saved in the profile (`chosen`). The names are the quests' (`xml/lang`, quests 63, 64, 72, 74); the quest texts say these four are for the Adventure mode.
- **Tornade** has no checkbox: quest 62 says it applies "quelles que soient les options choisies", so once unlocked it is always sent (in every mode; `Player` skips it in Time Attack). It is shown ticked. "Tornado" in English and Spanish is the port's own name: only the French text names it.
- Multiplayer options (`mirrormulti`, `nightmaremulti`, `lifesharing`, `bombcontrol`), `kickcontrol` (Soccer) and the level set choices come with their modes in Phase 4.
- Not checked in Ruffle: the side-by-side runs `game.swf` with no site, so no `$options`.

## Localization (3.4)

The original has no translated graphics: one set of SWFs served hammerfest.fr, hfest.net and hammerfest.es, and every text the game shows comes from `xml/lang/` (`Lang.get`), set by the code or through a field's variable. The French words in the SWFs are defaults that the code replaces. Sources: every SWF text listed with its clip, and every bitmap checked by eye (none has words but "PAUSE" and "Tuberculoz", used in all three languages).

- **Fixed (French or placeholder text on screen):** the exit arrow's "niveau suivant" (its field appears on frame 8, bound to `label`), the hurry-up alert, "PERFECT" and its bonus, and the score pops (all bound to `_parent.*` variables). The pause screen (`GameMode.onPause`) is now ported whole: frame 1 (it played on into the two-player and Soccer frames, with "moveLabel", "kickLab" and the tip's raw HTML), the `pause`, `space` and `click` labels, `Lang` 14 before the area, and the tips 301 to 313 in turn. Its music volume change (0.5 while paused, `Mode.setMusicVolume`) came with the M key in UI batch U.1. Tested in `tests/localization.test.ts`, which plays the replays in English and fails on any SWF default text on screen.
- **Not shown by the original in Adventure:** `hammer_fjv_end` ("Partie terminée !", the kiosk mode, Phase 4), `hammer_interf_menuTip` and `levelPopUp` ("NIVEAU", attached by no code), the key setup screen (`#910`). `hammer_map` ("Strates supérieures...", the world map of `onMap`) is not ported yet; its field is set from `Lang`.
- **Site screens:** the title logo is the game's French one in every language (the sites' per-language banners were dropped in UI batch U.2). Quest, item, family and area names come from the current lang file.
- **Language at start:** the last one chosen (`hammerfenix_save_v1`, `preferredLang`), else the browser's (`navigator.languages`), else English (`src/ui/Language.ts`). The original got it from the site as `$lang`.
- The English lang file lacks texts 158 to 163 (level script messages), so those show nothing in English, as in the original.

## Item effects (`SpecialManager.execute`)

All 118 effects are ported (task 2.3, 2026-11-04), with `interrupt`, `levelConversion`, `warpZone`, `onPerfect` and the recurring events. The id is the `// *** N.` comment in the original. Tested in `tests/specials.test.ts`.

- Special backgrounds (2.4, 2.6): `fxMan.attachBg` queues them and shows one at a time; any effect ending (`interrupt`) and every level change clear them. Tested in `tests/specials.test.ts`.
- 86 ghost candy: the glow filters on the player and the enemies are not ported yet (`SwfMovieClip.setGlow` from 2.8 can do them).
- 84: the clouds' `BlurFilter` (4 px box blur) is approximated with Pixi's gaussian blur (`SwfMovieClip.setBlur`).
- 10 phone does nothing, as in the original (the effect is commented out).
- Original quirks kept: picking any item with id 17 (`CONVERT_DIAMANT`, also the gold mushroom) counts as a pearl, so after a finished conversion it gives the 50000 perfect bonus again; the fish callbacks (77-79) are not cleared on a level change and run at the next level clear; interrupting the shoe (7) resets the speed to 1.0 even in nightmare mode.
- Fixed in the existing effects while porting: warp umbrellas (11, 12) stop at boss and empty levels and show the alert; 22, 88 and 91 showed the wrong curse icon; 26 and 68 now update the darkness; 94 sets its global flag; 114 is temporary, not permanent; 102 plays script clip 100; random draws of 23, 83, 101 and strikes match the original.

## Dev keys (2C.1)

The original's dev mode keys (`Mode`/`GameMode.getDebugControls`, `Player.getDebugControls`, the bosses', `GameMode.getControls`' F and B, H in `GameMode.main`), listed in the help dialog when the dev switch is on. Tested in `tests/devkeys.test.ts`.

- The page's dev switch (help dialog, or `?dev`) stands for `GameManager.fl_debug` and `isDev()` (`GameSession.fl_debug`). It only turns on the keys: the port loads no `xml_dev` world and keeps its families (the debug toolbar already uses the no-site ones).
- Keys are read with `InputController.isKeyDown(flashKeyCode)`, sampled per tick like the controls. They are not in the recorded action mask, so they are off while recording or replaying. The letters keep their game use too (W jumps and changes weapon; K gives the keys and kills the Bat, as in the original).
- Port addition: the top-row digits count as numpad digits (laptops have no numpad). Ctrl and a digit no longer switch browser tabs while the keys are on.
- `Log` (MotionTypes, not in the source) drew on screen; `src/game/Log.ts` writes to the browser console, each tick's `print` lines only when they change. `GameManager.warning` (the G key's grid name) is a `console.warn`.
- Shift: `game.swf`'s `Timer` recomputes `tmod` each frame from real time (`calc_tmod`), so Shift slows the game only while held, and Home (`tmod` 1.0) only matters during bullet time, which it cancels. Like bullet time, it slows the loop's clock (`FixedGameLoop.bulletScale`), so movie clips slow down too.
- B prints the build time (Vite `define`, `__BUILD_TIME__`) without the Flash version line. F prints the logic ticks run per real second (`FixedGameLoop.fps`).
- The pause screen prints `printDebugInfos` to the console, the parts the port has (no cookie, `fl8` or local flags).
- Not ported: Escape gives up the game in the original's dev mode (it still pauses here, to keep pausing at hand); `Adventure`'s Ctrl+Shift+M (the co-op mode, Phase 4); the entity mouse handlers (`Entity.release`, `rollOver`: Shift-click traces an entity, Shift-hover lights it up).

## Bosses (`entity/Boss.ts`)

Ported line by line (tasks 2.8, 2.9, 2026-11-05). Tested in `tests/bosses.test.ts`. Boss music and the ending (code triggers 4 and 5, the elevator of level 103) come from the level scripts and were already ported.

- Bat: registers as `Data.BAD`, so bombs, shots and item effects reach it like any enemy. The `entity.Bad` methods it lacks (`setCombo`, `calmDown`, `onHurryUp`, `burn`, ...) are no-ops, as undefined methods are in AS2.
- Bat glow (shield off): `GlowFilter` (`src/engine/swf/GlowFilter.ts`), a WebGL shader for Flash's outer glow at quality 1 (13 x 13 alpha samples per pixel). Kept beside the blink tint (`SwfMovieClip.setGlow` / `clearGlow`).
- Tuberculoz life bar: `bar` is a mask (`SwfMovieClip.getMask`), scaled to show the fill.
- Bullet time (`GameMode.bulletTime`, Tuberculoz's death): the original sets `Timer.tmod` to 0.3 for 2 s. Logic here always steps by 1, so the loop's clock slows to 0.3 (`FixedGameLoop.bulletScale`) for about 20 ticks: same moves, but movie clips slow down too (in Flash they kept 40 fps).
- The exit arrow attached at level start (no enemies in the level data) stays during both fights, as the original's code reads. Not checked in Ruffle.
- Boss lookups (`getOne(Data.BOSS)`) are where the original has them: always in `resetHurry`, only on Tuberculoz's level in `onKillBad` and `onExplode`. On an empty list `Std.random(0)` gives 0 and draws nothing (Flash's `random`, as Ruffle's `action_random_number` reads), as the port's `getOne` does (2C.2).
- Dev keys of the original: K kills the Bat, Enter kills Tuberculoz, Shift takes one of his lives per frame (2C.1, see "Dev keys").

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
- `resurrect()` keeps `speedFactor` unless in nightmare mode or with the Tornade boost.
- `Bad.killHit`, `burn` and `knock` had invented `fl_kill` guards; `checkHits` re-checked `fl_kill` between the two `hit` calls.
- `Physics.calcSteps` could not return 0 steps; the stair patch reset `fallStart`; `shockWave` clamped its ratio; `killHit(null)` drew a random `dx`.
- `Animator`: invented blink fallback timer; `disableAnimator` now lets the clip play.
- Soft recal (`activateSoftRecal`, Wall walkers turning corners) is ported.
- Ninja icons reattach when the sticker is gone; `fl_showIA` taunt icon; Ananas taunt icon.
- FireBall anger uses `diffFactor`; its eye frame clamps instead of wrapping.
- Random draws use the original's integer forms (`Std.random(1000) < chance`, `Std.random(2)*2-1`), and Bombe draws its unused random duration.
- Session: the HUD reads the new player's lives and score on each new game; `shake()` keeps a stronger running shake (`||`, not `&&`).
- `Physics` portals: a portal case that matches no portal calls `onPortal(null)`, as the original does (the player is refused, a bomb destroyed). No level has such a case (2B.1).
- Key locks (2C.2): the player's (`PlayerController.keyLocks`) are a set of their own (`InputController.keyIsDown`, `lockKey`), released at the start of the controller's update only, so not while the controls are locked: a bomb key pressed again during a lock drops nothing until it is released. The menus' and the game's keys (`consumePress`, `GameMode.keyLock`) still release on every tick. No replay changed.
- `Spear` attached after the level's first second (script cycle above `Data.SECOND`) appears with a `hammer_fx_pop` (2C.2).
- `Bad.onDeathLine` attaches `hammer_fx_death` as a bare clip at plan `Data.FX` (512, an entity type the original uses as a plan, so above everything), which plays at 40 Hz and removes itself, not as an fx stepped by the logic (2C.2).
- Particles (2.5): every call uses its original type, count and position. Added the missing ones: Bombe's sparks, Crawler's attack and landing (with its squash), Saw's stun, hits, wake-up and stun sparks, the portal opening, the Guu doll's rain (with the player shrinking, growing back and dying too small) and the aqua bubbles.

### Open

- Options for the multiplayer modes (Phase 4): `fl_bombControl` (`WalkingBomb`, `MultiCoop`), life sharing, kick control (`Soccer`).
- `Jumper.checkClimb` skips a null or zero climb height; the original would jump with a NaN speed.
- `Kiwi.clearMines` is never called in the original, not ported.

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
- `FxManager` (2C.2): `attachShine` draws its flip with `Std.random(2)`, and `dust` was rewritten from the original: 7 clips (not 6), `Std.random(50)+50*(±1)` as x scale (the sign applies to the 50 only), y scale 10 to 89, a start frame 5 to 9, and the draws happen even when the fx is not attached (the game is locked). Its low detail skip waits for 2C.5. The 4 replays with dust changed their random sequence.

### Open

- Not ported yet: the map and its events, wind timer, aqua screen wobble. X/Y flips are ported (items 30, 31).
- Game over and end of set (2.11): the Loader hands a `GameResult` to `GameSession.onGameResult` once its fade is over, where the original waited for the server or left the page. A placeholder ("GAME OVER" or "THE END", restart on a key) then shows until the results screen (3.1c).
- `Adventure.saveScore` skips the set checksum and the fatal error for sets other than the adventure: the port's set picker plays every set in this mode.
- `F=` in the history is the port's version (`package.json`); the original sent the site's `$version` parameter. The two `GameManager` constructor entries (`$B` build time, `$using sysfam`) are not logged; they are dropped at the game over anyway.
- `GameManager.KEY` is drawn from the game's seed with its own generator, so the main random sequence does not move.
- `ScoreItem` gives 500 points for an unknown id; the original stops with a fatal error.

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

- When a trigger repeats after its nested trigger moved out, Ruffle still follows the old sibling link and adds the nested trigger again; the port adds it once. Only deepnight 184 has this.
- Data notes from the scan (the original ignores them too): three `$t_timer` with `repeat` instead of `$repeat` (adventure 100), `$s` instead of `$si` (adventure 102), sprites missing from every original SWF (`$jail_large`, `$mcMarioBlock`, `$doorSideRight`, not in the Adventure set).
