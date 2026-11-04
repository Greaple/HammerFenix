import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Data } from '../src/game/Data';
import { FireRainShoot } from '../src/game/entity/Shoot';
import { type ItemEntity, ScoreItem, SpecialItem } from '../src/game/entity/Item';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

/** A fresh game on a level, run until its enemies are in. */
function start(level = 6): void {
  session.initGame(level, 1234);
  step(20);
}

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** Runs a special item effect as if the player picked item `id`. */
function useItem(id: number, x = 100, y = 100): void {
  const item = SpecialItem.attach(session, x, y, id, null)!;
  session.player!.executeSpecialItem(item);
  item.destroy();
}

function items(type = Data.ITEM): ItemEntity[] {
  return session.getList(type).filter((e) => !e.fl_kill) as ItemEntity[];
}

function scoreItems(): ItemEntity[] {
  return items().filter((e) => e instanceof ScoreItem);
}

function bads() {
  return session.getBads().filter((b) => !b.fl_kill);
}

describe('item effects (SpecialManager.execute)', () => {
  it('30 and 31: the glasses flip the screen for 30 seconds', () => {
    start();
    const root = session.gameRoot;
    useItem(30);
    expect(session.fl_flipX).toBe(true);
    expect(root._xscale).toBe(-100);
    expect(root._x).toBe(Data.GAME_WIDTH + session.xOffset);
    useItem(31);
    expect(session.fl_flipY).toBe(true);
    expect(root._yscale).toBe(-100);
    expect(root._y).toBe(Data.GAME_HEIGHT + 20);
    step(Data.SECOND * 30 + 1);
    expect(session.fl_flipX).toBe(false);
    expect(session.fl_flipY).toBe(false);
    expect(root._xscale).toBe(100);
    expect(root._x).toBe(session.xOffset);
    expect(root._y).toBe(0);
  });

  it('a new game resets the flips', () => {
    start();
    useItem(30);
    start();
    expect(session.fl_flipX).toBe(false);
    expect(session.gameRoot._xscale).toBe(100);
  });

  it('77-79: the fish drop 5 crystals when the level is cleared', () => {
    start();
    useItem(78);
    expect(session.endLevelStack.length).toBe(1);
    const before = items(Data.ITEM).length;
    session.destroyList(Data.BAD);
    session.cleanKills();
    step(1);
    expect(session.fl_clear).toBe(true);
    expect(session.endLevelStack.length).toBe(0);
    const crystals = items(Data.ITEM).filter((it) => it.id === 0 && it.subId === 2);
    expect(crystals.length).toBe(5);
    expect(items(Data.ITEM).length).toBe(before + 5);
  });

  it('81: the blue pearl turns the level into pearls; picking them all gives the perfect bonus', () => {
    start();
    useItem(81);
    expect(bads().length).toBe(0);
    const n = session.perfectItemCpt;
    expect(n).toBeGreaterThan(4);
    // Pearls come in through the script: the first 4 at once, then one every 2 cycles
    step(n * 2 + 5);
    // The player may already have walked over some of them
    const pearls = items(Data.PERFECT_ITEM);
    expect(pearls.length).toBe(session.perfectItemCpt);
    expect(pearls.length).toBeGreaterThan(1);
    for (const p of pearls) {
      expect(p.id).toBe(Data.CONVERT_DIAMANT);
      expect(p.subId).toBe(0);
    }
    const player = session.player!;
    for (const p of pearls.slice(0, -1)) player.hit(p);
    expect(session.perfectItemCpt).toBe(1);
    const score = player.score;
    const last = pearls[pearls.length - 1];
    player.hit(last);
    // pearl value for subId 0 is 75, plus the perfect bonus
    expect(player.score).toBe(score + 75 + 50000);
    expect(player.actives[81]).toBe(false);
  });

  it('96-98: the other pearls use their own pearl kind, and vanish after 19 seconds', () => {
    start();
    useItem(97);
    step(Data.SECOND * 5);
    const pearls = items(Data.PERFECT_ITEM);
    expect(pearls.length).toBeGreaterThan(0);
    for (const p of pearls) expect(p.subId).toBe(2);
    step(Data.SECOND * 15);
    session.cleanKills();
    expect(items(Data.PERFECT_ITEM).length).toBe(0);
  });

  it('picking an item with the pearl id before any conversion does nothing (unset counter)', () => {
    start();
    const score = session.player!.score;
    const it = ScoreItem.attach(session, 100, 100, Data.CONVERT_DIAMANT, 0);
    session.player!.hit(it);
    expect(Number.isNaN(session.perfectItemCpt)).toBe(true);
    expect(session.player!.score).toBe(score + 75);
  });

  it('84: the fire rain talisman brings clouds and fire drops until the level ends', () => {
    start();
    useItem(84);
    const shots = () => session.getList(Data.SHOOT).filter((s) => s instanceof FireRainShoot);
    expect(shots().length).toBe(1);
    const clouds = session.player!['clouds'];
    expect(clouds.length).toBe(2);
    step(Math.ceil(Data.SECOND * 0.8));
    expect(shots().length).toBeGreaterThanOrEqual(2);
    session.player!.clearTemp();
    expect(session.player!['clouds'].length).toBe(0);
  });

  it('87: the blue larva turns an enemy into another larva, or a diamond for the last one', () => {
    start();
    const count = bads().length;
    expect(count).toBeGreaterThan(1);
    useItem(87);
    session.cleanKills();
    expect(bads().length).toBe(count - 1);
    expect(items(Data.SPECIAL_ITEM).some((it) => it.id === 87)).toBe(true);

    while (bads().length > 1) {
      bads()[0].destroy();
      session.cleanKills();
    }
    useItem(87);
    session.cleanKills();
    expect(bads().length).toBe(0);
    expect(scoreItems().some((it) => it.id === Data.DIAMANT)).toBe(true);
  });

  it('93: the mailbox spawns 6 parcels away from the player, with no life timer', () => {
    start();
    useItem(93);
    session.cleanKills();
    expect(bads().length).toBe(0);
    const parcels = items(Data.SPECIAL_ITEM).filter((it) => it.id === 101);
    expect(parcels.length).toBe(6);
    const p = session.player!;
    for (const it of parcels) {
      expect(p.distance(it.x, it.y)).toBeGreaterThanOrEqual(100);
      expect(it.totalLife).toBe(null);
    }
  });

  it('100: the Guu doll sticks a cloud to the player for 30 seconds', () => {
    start();
    const p = session.player!;
    useItem(100);
    expect(p.hasSticker).toBe(true);
    step(Data.SECOND * 30 + 1);
    expect(p.hasSticker).toBe(false);
  });

  it.each([
    [106, 1047, 1050],
    [107, 0, 0],
  ])('%i: the book throws 5 score items', (id, min, max) => {
    start();
    const before = scoreItems().length;
    useItem(id);
    const l = scoreItems();
    expect(l.length).toBe(before + 5);
    for (const it of l.slice(before)) {
      expect(it.id + (min >= 1000 ? 1000 : 0)).toBeGreaterThanOrEqual(min);
      expect(it.id + (min >= 1000 ? 1000 : 0)).toBeLessThanOrEqual(max);
    }
  });

  it('108: the green umbrella warps 3 levels ahead', () => {
    start(6);
    useItem(108);
    expect(session.world.currentId).toBe(9);
  });

  it('warps stop at a boss level', () => {
    start(29);
    useItem(108);
    expect(session.world.currentId).toBe(30);
  });

  it.each([
    [112, Data.HEAD_PIOU],
    [113, Data.HEAD_TUB],
  ])('%i changes the head', (id, head) => {
    start();
    useItem(id);
    expect(session.player!.head).toBe(head);
  });

  it('116, 113, 117: scores, life and key', () => {
    start();
    const p = session.player!;
    // 116 first: 113 on top would cross the 100000 points extra life
    const lives = p.lives;
    let score = p.score;
    useItem(116);
    expect(p.lives).toBe(lives + 1);
    expect(p.score).toBe(score + 70000);
    score = p.score;
    useItem(113);
    expect(p.score).toBe(score + 75000);
    score = p.score;
    useItem(117);
    expect(session.hasKey(12)).toBe(true);
    expect(p.score).toBe(score + 10000);
  });

  it('10, 109-111 give no points (no more generic fallback)', () => {
    start();
    const p = session.player!;
    const score = p.score;
    for (const id of [10, 109, 110, 111]) useItem(id);
    expect(p.score).toBe(score);
  });

  it('an unknown id only warns', () => {
    start();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const score = session.player!.score;
    useItem(150);
    expect(warn).toHaveBeenCalledWith('illegal item id=150');
    expect(session.player!.score).toBe(score);
    warn.mockRestore();
  });

  it('94 sets its global flag; 114 is temporary', () => {
    start();
    useItem(94);
    expect(session.globalActives[94]).toBe(true);
    useItem(114);
    session.player!.clearTemp();
    expect(session.player!.actives[114]).toBe(false);
    expect(session.player!.actives[94]).toBe(true);
  });
});
