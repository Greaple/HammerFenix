import { expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { createHeadlessSession } from './helpers/headless';

// Level 1 has no enemies: the player falls through to level 2. The level that comes in must get
// its timed items (extends, special and score items), as when the game starts on it directly.
// They were lost when the level became ready mid-frame: the frame's level-clear check ran before
// the script added the enemies, so the level counted as cleared and its item timers were removed.
it('a level reached from the previous one gets its items', async () => {
  const s = await createHeadlessSession();
  s.startGame(1, 1234);
  let arrived = -1;
  for (let t = 0; t < 600 && arrived < 0; t++) {
    s.gameLoop.stepSingleFrame();
    if (s.game.world.currentId === 2) arrived = t;
  }
  expect(arrived).toBeGreaterThan(0);
  expect(s.game.fl_clear).toBe(false);

  for (let t = 0; t < Data.SCORE_ITEM_TIMER + 5; t++) s.gameLoop.stepSingleFrame();
  expect(s.game.fl_clear).toBe(false);
  const ids = s.game.getItems().map((i) => i.id);
  expect(ids.length).toBeGreaterThan(0);
});
