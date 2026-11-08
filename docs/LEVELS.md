# Level spot checks

Levels checked by hand against the original (roadmap Phase 2B, tasks 2B.4 to 2B.6). All other levels are covered by the automated checks: data (2B.0), portals (2B.1), level images (2B.2) and level scripts (`tests/scripts.test.ts`).

The list holds the levels with something few or no other levels have. It was built from the level data on 2026-11-08: the rarest script tags, the music changes, the bosses, and the first level of each enemy type.

Result: **ok** = matches the original · **fixed** = was different, fixed · **open** = still different (say why in Notes, with the roadmap task that owns it) · **needs play** = needs real play, for the user · empty = not checked yet

## Adventure (2B.4)

| Level          | What to check                                                                                                               | Result | Notes |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ | ----- |
| 0              | Village: hidden borders, menu decor, ninja timer, bucket warp to level 10, door portal                                      |        |       |
| 1              | Hidden borders, dimension door and lock (key 10)                                                                            |        |       |
| 2              | Code trigger, portal, messages                                                                                              |        |       |
| 30             | First boss warning: music change, message                                                                                   |        |       |
| 40, 60, 70, 90 | Boss warnings: music change, message                                                                                        |        |       |
| 47             | Enemies spawned by script (Bombe)                                                                                           |        |       |
| 49             | `multi` block                                                                                                               |        |       |
| 50             | Boss warning with music, `night` block                                                                                      |        |       |
| 54             | Torches beside the hell door (`$birth` trigger): the hamm4all screenshot has none                                           |        |       |
| 53, 75         | Tiles removed and added by script (`e_rem`, `e_add`)                                                                        |        |       |
| 78             | Item line (`e_itemLine`), decor                                                                                             |        |       |
| 80             | Boss warning with music; first Baleine                                                                                      |        |       |
| 82, 83, 84     | Special effects by script (`e_spec`), portal at 82                                                                          |        |       |
| 86             | `mirror` block, enemies spawned by script, portal                                                                           |        |       |
| 87             | Enemies spawned by script                                                                                                   |        |       |
| 100            | Boss Bat: music, fight, exit; Bat glow and exit arrow (left from Phase 2)                                                   |        |       |
| 101            | Boss Tuberculoz: music, fight, exit arrow                                                                                   |        |       |
| 102 to 106     | The ending: code triggers, `night` and `multi` at 103, special effects; door at 102 (12, 6), not in the hamm4all screenshot |        |       |

## Enemies (2B.5)

Each type at the first level that has it, in a set players can reach (Saw and Crawler come first in hiko, which no portal leads to). Tzongre is in no level: it comes from item 89 (mutant egg), so spawn the item from the debug toolkit.

| Enemy                            | Level              | Result | Notes |
| -------------------------------- | ------------------ | ------ | ----- |
| Cerise                           | adventure 2        |        |       |
| Orange                           | adventure 4        |        |       |
| Pomme                            | adventure 7        |        |       |
| Banane                           | adventure 15       |        |       |
| Citron                           | adventure 30       |        |       |
| Spear                            | adventure 33       |        |       |
| Bombe                            | adventure 40       |        |       |
| Poire                            | adventure 50       |        |       |
| Abricot                          | adventure 56       |        |       |
| Litchi (and LitchiWeak when hit) | adventure 58       |        |       |
| Fraise                           | adventure 60       |        |       |
| Abricot2                         | adventure 66       |        |       |
| Kiwi                             | adventure 70       |        |       |
| Baleine                          | adventure 80       |        |       |
| Ananas                           | adventure 90       |        |       |
| Saw                              | deepnight 55       |        |       |
| Crawler                          | deepnight 80       |        |       |
| LitchiWeak (placed directly)     | ayame 51           |        |       |
| Framboise                        | deepnight 154      |        |       |
| Tzongre                          | item 89, any level |        |       |

## Dimensions (2B.6)

No row for bumdum (its level 42 has the only `e_goto` outside the mode sets): the original game does not load that set (`swfmake.xml`). Hiko can't be reached by portal in the original (the village's link to it comes after the deepnight one, and `Data.getLink` takes the first), so its rows need the level jump (2B.3).

| Level             | What to check                                                               | Result | Notes |
| ----------------- | --------------------------------------------------------------------------- | ------ | ----- |
| hiko 0            | Enemies spawned and killed by script, code trigger                          |        |       |
| hiko 4            | Darkness set by script                                                      |        |       |
| ayame 19          | Item line, explosion trigger                                                |        |       |
| deepnight 1       | Start of the dark sequence (1 to 10): birth trigger, darkness, code trigger |        |       |
| deepnight 10      | Pointer, `death` trigger (the only one), messages                           |        |       |
| deepnight 59, 66  | Fake level numbers (`e_fakelid`, 59 to 66)                                  |        |       |
| deepnight 70      | Script variables (`e_setVar`, 70 to 76)                                     |        |       |
| deepnight 86, 127 | Pointer and messages                                                        |        |       |
| deepnight 125     | `multi` block                                                               |        |       |
| deepnight 134     | `mirror` block                                                              |        |       |
| deepnight 141     | `ninja` block                                                               |        |       |
| deepnight 185     | `night` block                                                               |        |       |
