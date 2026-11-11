import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { BadEntity } from '../src/game/entity/Bad';
import { SpecialItem } from '../src/game/entity/Item';
import {
  ArrowSupa,
  BallSupa,
  BubbleSupa,
  IceMeteorSupa,
  SmokeSupa,
  SupaItem,
  TonsSupa,
} from '../src/game/entity/Supa';
import type { GameSession } from '../src/game/GameSession';
import type { Adventure } from '../src/game/mode/Adventure';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;
const adventure = () => session.game as Adventure;

beforeAll(async () => {
  session = await createHeadlessSession();
});

/** A fresh game on level 6 (two enemies), run until they are in. */
function startLevel6(): void {
  session.startGame(6, 1234);
  for (let i = 0; i < 20; i++) session.gameLoop.stepSingleFrame();
  expect(session.game.getBads().length).toBeGreaterThan(1);
}

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

function supas() {
  return session.game.getList(Data.SUPA);
}

/** Runs a special item effect as if the player picked item `id`. */
function useItem(id: number): void {
  const item = SpecialItem.attach(session.game, 100, 100, id, null)!;
  session.game.player!.executeSpecialItem(item);
  item.destroy();
}

describe('super items (entity/supa)', () => {
  it.each([
    [3, BallSupa, 1],
    [8, BubbleSupa, 2],
    [9, TonsSupa, 1],
    [19, SmokeSupa, 1],
    [24, IceMeteorSupa, 1],
    [38, ArrowSupa, 1],
  ])('item %i attaches its super entity', (id, cls, count) => {
    startLevel6();
    useItem(id);
    const l = supas();
    expect(l.length).toBe(count);
    for (const s of l) expect(s).toBeInstanceOf(cls);
  });

  it('the totem arrow lasts SUPA_DURATION, then is gone', () => {
    startLevel6();
    useItem(38);
    expect(supas()[0].lifeTimer).toBe(Data.SUPA_DURATION);
    step(Data.SUPA_DURATION + 2);
    expect(supas().length).toBe(0);
  });

  it('the ice meteor freezes the enemies it touches', () => {
    startLevel6();
    const b = session.game.getBads()[0];
    const s = IceMeteorSupa.attach(session.game);
    s.moveTo(b.x, b.y);
    step(1);
    expect(b.fl_freeze).toBe(true);
  });

  it('the beach ball knocks the enemies it touches and leaves on the right', () => {
    startLevel6();
    const b = session.game.getBads()[0];
    const s = BallSupa.attach(session.game);
    s.moveTo(b.x, b.y);
    s.dy = 0;
    step(1);
    expect(b.fl_knock).toBe(true);
    step(600);
    expect(supas().length).toBe(0);
  });

  it('the weight kills enemies and the player, and falls again', () => {
    startLevel6();
    const b = session.game.getBads()[0];
    const p = session.game.player!;
    const s = TonsSupa.attach(session.game);
    s.moveTo(b.x, b.y);
    step(1);
    expect(b.fl_kill).toBe(true);
    s.moveTo(p.x, p.y);
    step(1);
    expect(p.fl_kill).toBe(true);
    s.moveTo(10, Data.GAME_HEIGHT * 2 + 1);
    step(2);
    expect(s.y).toBeLessThan(0);
    expect(s.fl_destroy).toBe(false);
  });

  it('the star bubbles stay in the screen and last 10 seconds', () => {
    startLevel6();
    useItem(8);
    let inside = true;
    for (let i = 0; i < Data.SECOND * 10 - 2; i++) {
      step(1);
      for (const s of supas()) {
        if (s.x < -20 || s.x > Data.GAME_WIDTH + 20 || s.y < -20 || s.y > Data.GAME_HEIGHT + 20) {
          inside = false;
        }
      }
    }
    expect(inside).toBe(true);
    expect(supas().length).toBe(2);
    step(4);
    expect(supas().length).toBe(0);
  });

  it('super items are removed when the player comes back to life', () => {
    startLevel6();
    useItem(9);
    session.game.onResurrect();
    step(1);
    expect(supas().length).toBe(0);
  });
});

describe('super item of a perfect clear (Adventure.onLevelClear)', () => {
  function killAll(bads: BadEntity[]): void {
    for (const b of bads) {
      b.killHit(0);
      step(1);
    }
    for (let i = 0; i < 200 && !session.game.fl_clear; i++) step(1);
    expect(session.game.fl_clear).toBe(true);
  }

  it('falls when the enemies are killed in their order of appearance', () => {
    startLevel6();
    const bads = [...session.game.getBads()].sort(
      (a, b) =>
        adventure().perfectOrder!.indexOf(a.uniqId) - adventure().perfectOrder!.indexOf(b.uniqId),
    );
    killAll(bads);
    const l = supas();
    expect(l.length).toBe(1);
    const item = l[0] as SupaItem;
    expect(item).toBeInstanceOf(SupaItem);
    expect(item.supaId).toBe(adventure().perfectCount - 1);
    expect(session.game.player!.baseStopAnim).toBe(Data.ANIM_PLAYER_STOP_V);
  });

  it('does not fall when they are killed out of order', () => {
    startLevel6();
    const bads = [...session.game.getBads()].sort(
      (a, b) =>
        adventure().perfectOrder!.indexOf(b.uniqId) - adventure().perfectOrder!.indexOf(a.uniqId),
    );
    killAll(bads);
    expect(supas().length).toBe(0);
  });

  it('gives crystal value x5 when caught, and the player cries when it is missed', () => {
    startLevel6();
    const p = session.game.player!;
    const caught = SupaItem.attach(session.game, 2);
    const before = p.score;
    caught.moveTo(p.x, p.y - Data.CASE_HEIGHT * 1.5);
    step(1);
    expect(p.score - before).toBe(Data.getCrystalValue(2) * 5);
    expect(caught.fl_destroy).toBe(true);

    const missed = SupaItem.attach(session.game, 0);
    missed.moveTo(10, Data.GAME_HEIGHT + 49);
    step(2);
    expect(missed.fl_destroy).toBe(true);
    expect(p.baseStopAnim).toBe(Data.ANIM_PLAYER_STOP_L);
  });
});
