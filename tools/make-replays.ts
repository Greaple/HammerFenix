/**
 * Writes the replay fixtures in `tests/replays/`: seeded random button mashing on a few levels.
 * They only exercise the engine (movement, bombs, kicks, enemies, deaths); they don't try to win.
 * Recordings made in the browser (Debug > Record) can be dropped in the same folder.
 *
 * Usage: npx tsx tools/make-replays.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_BITS, InputRecorder, type InputRuns } from '../src/engine/InputRecording';
import { Random } from '../src/game/Random';

const OUT = join(new URL('..', import.meta.url).pathname, 'tests/replays');
const { left, right, jump, down, attack } = ACTION_BITS;

/** Held-button combos the bot picks from, with weights. */
const MOVES: [number, number][] = [
  [0, 3],
  [left, 4],
  [right, 4],
  [jump, 2],
  [left | jump, 2],
  [right | jump, 2],
  [attack, 3],
  [left | attack, 1],
  [right | attack, 1],
  [down, 1],
];

function bot(seed: number, ticks: number): InputRuns {
  const rand = new Random(seed);
  const total = MOVES.reduce((n, [, w]) => n + w, 0);
  const rec = new InputRecorder();
  while (rec.ticks < ticks) {
    let r = rand.random(total);
    let mask = 0;
    for (const [m, w] of MOVES) {
      if (r < w) {
        mask = m;
        break;
      }
      r -= w;
    }
    const hold = 3 + rand.random(30);
    for (let i = 0; i < hold && rec.ticks < ticks; i++) rec.push([mask]);
    // Release between presses, so attack and jump trigger again
    for (let i = 0; i < 2 && rec.ticks < ticks; i++) rec.push([0]);
  }
  return rec.toReplay('adventure', 0, 0).input;
}

interface Fixture {
  name: string;
  level: number;
  seed: number;
  ticks: number;
  mode?: string;
  /** The level set, when it is not the mode's name. */
  set?: string;
  /** A second player, with their own bot. */
  players?: 2;
  /** The site's `$options` (the Time Attack modes need their run). */
  options?: string;
}

const FIXTURES: Fixture[] = [
  { name: 'village', level: 0, seed: 1001, ticks: 1200 },
  { name: 'level-01', level: 1, seed: 1002, ticks: 1600 },
  { name: 'level-05', level: 5, seed: 1003, ticks: 1600 },
  { name: 'level-12', level: 12, seed: 1004, ticks: 1600 },
  { name: 'level-25', level: 25, seed: 1005, ticks: 1600 },
  { name: 'level-40', level: 40, seed: 1006, ticks: 1600 },
  // The Learning mode (`$mode` tutorial): it plays its own set, from level 0
  { name: 'tutorial', level: 0, seed: 1007, ticks: 1600, mode: 'tutorial' },
  // The co-op mode (`$mode` multicoop): the adventure with two players
  {
    name: 'coop-01',
    level: 1,
    seed: 1008,
    ticks: 1600,
    mode: 'multicoop',
    set: 'adventure',
    players: 2,
  },
  // The Time Attack modes (`$mode` timeattack and multitime): run 0 of their own sets
  {
    name: 'timeattack',
    level: 0,
    seed: 1009,
    ticks: 1600,
    mode: 'timeattack',
    set: 'adventure',
    options: 'set_ta_0',
  },
  {
    name: 'multitime',
    level: 0,
    seed: 1010,
    ticks: 1600,
    mode: 'multitime',
    set: 'adventure',
    options: 'set_mta_0',
    players: 2,
  },
];

mkdirSync(OUT, { recursive: true });
for (const f of FIXTURES) {
  const replay = {
    version: 1,
    set: f.set ?? f.mode ?? 'adventure',
    level: f.level,
    seed: f.seed,
    ...(f.mode ? { mode: f.mode } : {}),
    ...(f.options ? { options: f.options } : {}),
    input: bot(f.seed, f.ticks),
    ...(f.players === 2 ? { otherInputs: [bot(f.seed + 5000, f.ticks)] } : {}),
  };
  writeFileSync(join(OUT, `${f.name}.json`), JSON.stringify(replay) + '\n');
  console.log(`tests/replays/${f.name}.json (${f.ticks} ticks)`);
}
