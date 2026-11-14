# Bitmaps

Every bitmap the game draws, from `public/gfx/library.json` (and `intro.json`), listed on 2026-11-14 for a possible HD version (TV mode). Everything else on screen (characters, enemies, items, effects, most text) is vector.

200 bitmaps, 698 KB in `public/gfx/bitmaps/`. A JPEG with transparency has a mask beside it (`bNNN.a.png`, 36 files), which an upscale must follow too.

| Group                 | Count | Largest | Over 200 px |
| --------------------- | ----- | ------- | ----------- |
| level background      | 28    | 256×256 | 4           |
| platform texture      | 118   | 396×20  | 59          |
| decor                 | 30    | 420×500 | 6           |
| menu village          | 1     | 420×500 | 1           |
| interface             | 14    | 350×400 | 6           |
| intro                 | 1     | 420×325 | 1           |
| kiosk mode (fjv)      | 1     | 19×17   | 0           |
| not in a named symbol | 7     | 420×165 | 4           |

## Level background (28)

Behind every level (`hammer_bg`, 28 frames). Tiled, so most are 256×256 or narrower strips.

| File       | Size    | Format | Mask | Used by                      |
| ---------- | ------- | ------ | ---- | ---------------------------- |
| `b721.jpg` | 256×256 | jpg    |      | `hammer_bg`                  |
| `b742.png` | 256×256 | png    |      | `hammer_bg`                  |
| `b760.jpg` | 128×500 | jpg    |      | `hammer_bg`                  |
| `b735.jpg` | 420×150 | jpg    |      | `hammer_bg`                  |
| `b15.jpg`  | 128×128 | jpg    |      | `hammer_bg`, `hammer_fjv_bg` |
| `b707.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b709.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b711.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b713.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b715.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b717.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b719.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b723.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b725.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b727.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b729.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b731.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b737.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b739.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b744.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b746.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b748.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b750.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b752.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b754.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b756.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b758.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |
| `b762.jpg` | 128×128 | jpg    |      | `hammer_bg`                  |

## Platform texture (118)

The fills of the platform shapes (`tile`). The shapes are vector; these small textures are what shows.

| File       | Size   | Format | Mask | Used by |
| ---------- | ------ | ------ | ---- | ------- |
| `b441.jpg` | 396×20 | jpg    |      | `tile`  |
| `b443.jpg` | 396×20 | jpg    |      | `tile`  |
| `b445.jpg` | 396×20 | jpg    |      | `tile`  |
| `b447.jpg` | 396×20 | jpg    |      | `tile`  |
| `b449.jpg` | 396×20 | jpg    |      | `tile`  |
| `b451.jpg` | 396×20 | jpg    |      | `tile`  |
| `b453.jpg` | 396×20 | jpg    |      | `tile`  |
| `b455.jpg` | 396×20 | jpg    |      | `tile`  |
| `b469.jpg` | 396×20 | jpg    |      | `tile`  |
| `b477.jpg` | 396×20 | jpg    |      | `tile`  |
| `b519.jpg` | 396×20 | jpg    |      | `tile`  |
| `b569.jpg` | 396×20 | jpg    |      | `tile`  |
| `b457.png` | 395×20 | png    |      | `tile`  |
| `b459.png` | 395×20 | png    |      | `tile`  |
| `b461.png` | 395×20 | png    |      | `tile`  |
| `b463.png` | 395×20 | png    |      | `tile`  |
| `b465.png` | 395×20 | png    |      | `tile`  |
| `b467.png` | 395×20 | png    |      | `tile`  |
| `b471.png` | 395×20 | png    |      | `tile`  |
| `b473.png` | 395×20 | png    |      | `tile`  |
| `b475.png` | 395×20 | png    |      | `tile`  |
| `b485.png` | 395×20 | png    |      | `tile`  |
| `b487.png` | 395×20 | png    |      | `tile`  |
| `b489.png` | 395×20 | png    |      | `tile`  |
| `b491.png` | 395×20 | png    |      | `tile`  |
| `b493.jpg` | 395×20 | jpg    |      | `tile`  |
| `b495.jpg` | 395×20 | jpg    |      | `tile`  |
| `b497.png` | 395×20 | png    |      | `tile`  |
| `b499.png` | 395×20 | png    |      | `tile`  |
| `b501.png` | 395×20 | png    |      | `tile`  |
| `b503.png` | 395×20 | png    |      | `tile`  |
| `b505.png` | 395×20 | png    |      | `tile`  |
| `b507.png` | 395×20 | png    |      | `tile`  |
| `b509.png` | 395×20 | png    |      | `tile`  |
| `b511.png` | 395×20 | png    |      | `tile`  |
| `b513.png` | 395×20 | png    |      | `tile`  |
| `b515.png` | 395×20 | png    |      | `tile`  |
| `b517.png` | 395×20 | png    |      | `tile`  |
| `b521.png` | 395×20 | png    |      | `tile`  |
| `b531.png` | 395×20 | png    |      | `tile`  |
| `b533.png` | 395×20 | png    |      | `tile`  |
| `b535.png` | 395×20 | png    |      | `tile`  |
| `b537.png` | 395×20 | png    |      | `tile`  |
| `b539.png` | 395×20 | png    |      | `tile`  |
| `b541.jpg` | 395×20 | jpg    | yes  | `tile`  |
| `b543.jpg` | 395×20 | jpg    | yes  | `tile`  |
| `b545.jpg` | 395×20 | jpg    | yes  | `tile`  |
| `b547.jpg` | 395×20 | jpg    | yes  | `tile`  |
| `b549.jpg` | 395×20 | jpg    | yes  | `tile`  |
| `b551.jpg` | 395×20 | jpg    | yes  | `tile`  |
| `b553.jpg` | 395×20 | jpg    |      | `tile`  |
| `b555.jpg` | 395×20 | jpg    |      | `tile`  |
| `b557.jpg` | 395×20 | jpg    |      | `tile`  |
| `b559.jpg` | 395×20 | jpg    |      | `tile`  |
| `b561.jpg` | 395×20 | jpg    |      | `tile`  |
| `b563.jpg` | 395×20 | jpg    |      | `tile`  |
| `b565.jpg` | 395×20 | jpg    |      | `tile`  |
| `b567.jpg` | 395×20 | jpg    |      | `tile`  |
| `b571.png` | 395×20 | png    |      | `tile`  |
| `b575.png` | 5×20   | png    |      | `tile`  |
| `b577.png` | 5×20   | png    |      | `tile`  |
| `b579.png` | 5×20   | png    |      | `tile`  |
| `b581.png` | 5×20   | png    |      | `tile`  |
| `b583.png` | 5×20   | png    |      | `tile`  |
| `b585.png` | 5×20   | png    |      | `tile`  |
| `b587.png` | 5×20   | png    |      | `tile`  |
| `b589.png` | 5×20   | png    |      | `tile`  |
| `b591.png` | 5×20   | png    |      | `tile`  |
| `b593.png` | 5×20   | png    |      | `tile`  |
| `b595.png` | 5×20   | png    |      | `tile`  |
| `b597.png` | 5×20   | png    |      | `tile`  |
| `b599.png` | 5×20   | png    |      | `tile`  |
| `b601.png` | 5×20   | png    |      | `tile`  |
| `b603.png` | 5×20   | png    |      | `tile`  |
| `b605.png` | 5×20   | png    |      | `tile`  |
| `b607.png` | 5×20   | png    |      | `tile`  |
| `b609.png` | 5×20   | png    |      | `tile`  |
| `b611.png` | 5×20   | png    |      | `tile`  |
| `b616.png` | 5×20   | png    |      | `tile`  |
| `b618.png` | 5×20   | png    |      | `tile`  |
| `b620.png` | 5×20   | png    |      | `tile`  |
| `b622.png` | 5×20   | png    |      | `tile`  |
| `b624.png` | 5×20   | png    |      | `tile`  |
| `b626.png` | 5×20   | png    |      | `tile`  |
| `b628.png` | 5×20   | png    |      | `tile`  |
| `b630.png` | 5×20   | png    |      | `tile`  |
| `b632.png` | 5×20   | png    |      | `tile`  |
| `b634.png` | 5×20   | png    |      | `tile`  |
| `b636.png` | 5×20   | png    |      | `tile`  |
| `b638.png` | 5×20   | png    |      | `tile`  |
| `b640.png` | 5×20   | png    |      | `tile`  |
| `b642.png` | 5×20   | png    |      | `tile`  |
| `b644.png` | 5×20   | png    |      | `tile`  |
| `b646.png` | 5×20   | png    |      | `tile`  |
| `b648.png` | 5×20   | png    |      | `tile`  |
| `b650.png` | 5×20   | png    |      | `tile`  |
| `b652.png` | 5×20   | png    |      | `tile`  |
| `b657.png` | 5×20   | png    |      | `tile`  |
| `b659.png` | 5×20   | png    |      | `tile`  |
| `b661.png` | 5×20   | png    |      | `tile`  |
| `b663.png` | 5×20   | png    |      | `tile`  |
| `b665.png` | 5×20   | png    |      | `tile`  |
| `b667.png` | 5×20   | png    |      | `tile`  |
| `b669.png` | 5×20   | png    |      | `tile`  |
| `b671.png` | 5×20   | png    |      | `tile`  |
| `b673.png` | 5×20   | png    |      | `tile`  |
| `b675.png` | 5×20   | png    |      | `tile`  |
| `b677.png` | 5×20   | png    |      | `tile`  |
| `b679.png` | 5×20   | png    |      | `tile`  |
| `b681.png` | 5×20   | png    |      | `tile`  |
| `b683.png` | 5×20   | png    |      | `tile`  |
| `b685.png` | 5×20   | png    |      | `tile`  |
| `b687.png` | 5×20   | png    |      | `tile`  |
| `b689.png` | 5×20   | png    |      | `tile`  |
| `b691.png` | 5×20   | png    |      | `tile`  |
| `b693.png` | 5×20   | png    |      | `tile`  |
| `b695.png` | 5×20   | png    |      | `tile`  |
| `b697.png` | 5×20   | png    |      | `tile`  |

## Decor (30)

Objects placed by level scripts: doors, bed, well, statues, blocks, side columns, the portal, accessories.

| File         | Size    | Format | Mask | Used by                               |
| ------------ | ------- | ------ | ---- | ------------------------------------- |
| `b223.jpg`   | 420×500 | jpg    | yes  | `hammer_accessories`                  |
| `b356.jpg`   | 420×150 | jpg    | yes  | `hammer_level2_front`                 |
| `b313.jpg`   | 320×160 | jpg    | yes  | `jail`                                |
| `b20287.jpg` | 198×198 | jpg    | yes  | `field`, `hammer_portal`              |
| `b319.jpg`   | 240×140 | jpg    |      | `tuberculab`                          |
| `b20210.jpg` | 160×148 | jpg    | yes  | `tab`                                 |
| `b435.jpg`   | 32×500  | jpg    | yes  | `hammer_sides`                        |
| `b74.jpg`    | 77×144  | jpg    | yes  | `well`                                |
| `b316.jpg`   | 40×250  | jpg    |      | `boss_hole`                           |
| `b10.jpg`    | 97×92   | jpg    | yes  | `hellDoor`                            |
| `b48.jpg`    | 97×92   | jpg    | yes  | `hellDoorOpen`                        |
| `b51.jpg`    | 84×94   | jpg    | yes  | `beko`                                |
| `b62.jpg`    | 75×104  | jpg    | yes  | `mirror`                              |
| `b77.jpg`    | 58×126  | jpg    | yes  | `sideLeft`, `sideRight`               |
| `b321.jpg`   | 80×80   | jpg    |      | `tuberculab`                          |
| `b30228.jpg` | 80×80   | jpg    |      | `exit`, `prison_loop`                 |
| `b91.jpg`    | 51×64   | jpg    | yes  | `dimDoorOpen`                         |
| `b94.jpg`    | 51×64   | jpg    | yes  | `dimDoor`                             |
| `b20205.jpg` | 137×20  | jpg    |      | `wheels1`, `wheels2`                  |
| `b20817.jpg` | 43×60   | jpg    | yes  | `door`, `door_green`, `door_secret`   |
| `b82.jpg`    | 43×47   | jpg    |      | `menuDoor`                            |
| `b133.png`   | 40×40   | png    |      | `godStatue`                           |
| `b136.png`   | 40×40   | png    |      | `block`, `blockBroken`, `blockEnd` +1 |
| `b54.jpg`    | 45×29   | jpg    | yes  | `bedSide`, `bedSideLeft`              |
| `b85.jpg`    | 37×35   | jpg    | yes  | `dimLockOpen`                         |
| `b88.jpg`    | 37×35   | jpg    | yes  | `dimLock`                             |
| `b57.jpg`    | 39×29   | jpg    | yes  | `bed`                                 |
| `b307.jpg`   | 16×60   | jpg    | yes  | `door3`                               |
| `b310.jpg`   | 16×40   | jpg    | yes  | `door2`                               |
| `b285.png`   | 1×3     | png    |      | `hammer_fx_phone`                     |

## Menu village (1)

The village picture behind the mode menu and site screens (`menu`).

| File     | Size    | Format | Mask | Used by               |
| -------- | ------- | ------ | ---- | --------------------- |
| `b4.jpg` | 420×500 | jpg    |      | `menu`, `prison_loop` |

## Interface (14)

The score bar, the world map, the pause screen pictures, map icons, player box, pop-up.

| File       | Size    | Format | Mask | Used by                                        |
| ---------- | ------- | ------ | ---- | ---------------------------------------------- |
| `b186.jpg` | 350×400 | jpg    |      | `hammer_map`                                   |
| `b22.jpg`  | 300×250 | jpg    | yes  | `hammer_fjv_end`, `hammer_interf_instructions` |
| `b40.jpg`  | 420×84  | jpg    | yes  | `hammer_fjv_end`, `hammer_interf_pop`          |
| `b32.jpg`  | 113×108 | jpg    | yes  | `hammer_fjv_end`, `hammer_map`                 |
| `b104.jpg` | 420×20  | jpg    |      | `hammer_interf_game`                           |
| `b123.jpg` | 420×20  | jpg    |      | `hammer_interf_game`                           |
| `b127.jpg` | 420×20  | jpg    |      | `hammer_interf_game`                           |
| `b807.jpg` | 139×27  | jpg    | yes  | `hammer_player_box`                            |
| `b418.jpg` | 29×41   | jpg    | yes  | `hammer_interf_instructions`                   |
| `b417.png` | 28×40   | png    |      | `hammer_interf_instructions`                   |
| `b171.png` | 20×11   | png    |      | `hammer_interf_mapIcon`                        |
| `b175.png` | 20×11   | png    |      | `hammer_interf_mapIcon`                        |
| `b180.png` | 20×11   | png    |      | `hammer_interf_mapIcon`                        |
| `b182.png` | 20×11   | png    |      | `hammer_interf_mapIcon`                        |

## Intro (1)

The site intro (`intro.swf`, task 3.5), in `public/gfx/intro.json`.

| File         | Size    | Format | Mask | Used by     |
| ------------ | ------- | ------ | ---- | ----------- |
| `b50012.jpg` | 420×325 | jpg    |      | `intro.swf` |

## Kiosk mode (fjv) (1)

The kiosk mode (Fjv) background.

| File      | Size  | Format | Mask | Used by          |
| --------- | ----- | ------ | ---- | ---------------- |
| `b35.png` | 19×17 | png    |      | `hammer_fjv_end` |

## Not in a named symbol (7)

In the SWF but not reached from any exported symbol (left-overs or used only inside unexported clips).

| File       | Size    | Format | Mask | Used by |
| ---------- | ------- | ------ | ---- | ------- |
| `b839.jpg` | 420×165 | jpg    |      |         |
| `b871.jpg` | 249×230 | jpg    | yes  |         |
| `b866.jpg` | 231×154 | jpg    | yes  |         |
| `b835.jpg` | 200×66  | jpg    | yes  |         |
| `b886.jpg` | 92×97   | jpg    |      |         |
| `b926.jpg` | 43×60   | jpg    | yes  |         |
| `b7.png`   | 40×40   | png    |      |         |
