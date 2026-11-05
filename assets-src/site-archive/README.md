# hammerfest.fr site archive

Files from the original Hammerfest website, taken from the Wayback Machine, for the screens that
replaced the site (roadmap 3.1 and 3.2). Every file is listed in `manifest.json` with its original
URL and capture timestamp. To download the files that are missing:

    npx tsx tools/fetch-site-archive.ts

It is slow on purpose (one file every ~7 s): the Wayback Machine refuses connections above about
15 requests a minute.

## What is here

- `hammerfest.fr/pages/`: logged-out pages as the visitor saw them
  - `home_YYYYMM.html`: the home page from 2006 to 2020 (texts: "plus de 70 quêtes", 5 free games, then 1 a day)
  - `user_<id>_<year>.html`: public player profiles. Each lists best score, best level, weekly
    score, pyramid rank, **completed quests, quests in progress**, and the **fridge** ("Objets du
    réfrigérateur", `N objets sur 353`, one small icon per item id, `a.gif` for an item not found yet)
  - `scores*.html`, `halloffame.html`: rankings
  - `play_result_*.html`: what every archived results page contains: the "Not owner" error (see below)
- `hammerfest.fr/img/design/`: site graphics. Mode menu buttons `choice_*.gif` (`_off` when locked),
  later menu `menu/i*.gif`, help pictures `help_adventure|fridge|quest|opt|pyr.gif`, icons
  (`icon_quests`, `icon_inventory`, `icon_endGame`, `icon_pyramid_*`…), headers, backgrounds
- `hammerfest.fr/img/items/` and `img/items/small/`: the item icons the site used, by item id
- `hammerfest.fr/css/`: `main.css` at several versions (styles of the logged-in pages too)
- `hammerfest.fr/swf/`: `pyramid.swf` (ranking pyramid) and `game_v96.swf` (the site's 2008
  `game.swf`, a different build from `assets-src/original/swf/game.swf`)
- `hammerfest.es/`, `hfest.net/`: Spanish and English home pages and language CSS
- `wiki/`: WikiTeam dump (2022) of hammerfest.fandom.com, the small English player wiki

## Other sources

- [hamm4all.net](https://hamm4all.net/) (open source: gitlab.com/BlessedRaccoon/hamm4all): French
  player help site, still maintained. Quests with requirements and rewards, families,
  coefficients, keys, crystals, letters, known bugs of the original, and player screenshots of
  every level. A guide written later, not a copy of the site: it has none of the site screens.

## What could not be found

- **The results page after a game** (`/play.html/<id>/result`): about 27,000 captures exist on the
  three sites, but the page only showed a game to its owner, so every capture is the
  "EVNI … Not owner" error.
- **Forum screenshots**: players posted about 110 screenshots of their fridge, one results screen
  (`resultatjour3rm2.png`) and a quest flowchart, on imageshack, hiboox, casimages and others.
  None of them was archived.
- **The logged-in quest and fridge pages** (`/user.html/quests`, `/user.html/inventory`) and the
  mode menu page: behind the login, only redirects were archived. The public profile and the
  `choice_*` / `help_*` images show most of their content.
- `endGame.html` (end of set): only a 404 was archived.
- The live hammerfest.fr now answers from a Twinoid server with no game.
