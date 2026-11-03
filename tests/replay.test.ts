import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_BITS, type Replay } from '../src/engine/InputRecording';
import { createHeadlessSession, runReplay, snapshotState } from './helpers/headless';

const REPLAY_DIR = join(__dirname, 'replays');
const CHECKPOINT = 200;

async function trace(replay: Replay) {
  const session = await createHeadlessSession(replay.set);
  const out: unknown[] = [];
  const total = await runReplay(session, replay, (t) => {
    if (t % CHECKPOINT === 0) out.push({ tick: t, ...snapshotState(session) });
  });
  out.push({ tick: total, ...snapshotState(session) });
  return out;
}

/**
 * Replay regression tests. Each file in `tests/replays/` is played headless and its state is
 * compared with the stored snapshot. A diff means game behavior changed: if the change is
 * intended (a fix), review it and update the snapshots with `npx vitest run -u`.
 */
describe('replays', () => {
  const files = readdirSync(REPLAY_DIR).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    it(`${file} matches its snapshot and replays identically`, async () => {
      const replay = JSON.parse(readFileSync(join(REPLAY_DIR, file), 'utf-8')) as Replay;
      const first = await trace(replay);
      const second = await trace(replay);
      expect(second).toEqual(first);
      expect(first).toMatchSnapshot();
    }, 60000);
  }
});

describe('recorder', () => {
  it('a recording replays to the same state as the live game', async () => {
    const session = await createHeadlessSession();
    session.startRecording(3);

    // Live play through touch input (the same path as keys, without a DOM)
    const script: [number, string[]][] = [
      [20, ['right']],
      [10, ['right', 'jump']],
      [15, []],
      [3, ['attack']],
      [30, ['left']],
      [5, ['attack']],
      [40, ['right']],
      [8, ['down']],
      [60, []],
    ];
    const live: unknown[] = [];
    for (const [ticks, held] of script) {
      for (const act of Object.keys(ACTION_BITS) as (keyof typeof ACTION_BITS)[]) {
        session.input.setTouch(act, held.includes(act));
      }
      for (let i = 0; i < ticks; i++) {
        session.gameLoop.stepSingleFrame();
        live.push(snapshotState(session));
      }
    }
    for (const act of Object.keys(ACTION_BITS) as (keyof typeof ACTION_BITS)[]) {
      session.input.setTouch(act, false);
    }
    const replay = session.stopRecording()!;
    expect(replay.level).toBe(3);

    const replayed: unknown[] = [];
    await runReplay(session, replay, () => replayed.push(snapshotState(session)));
    expect(replayed).toEqual(live);
  }, 60000);
});
