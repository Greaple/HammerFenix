import { beforeAll, describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import { BossBomb, ClassicBomb, RepelBomb, SoccerBall } from '../src/game/entity/Bomb';
import { SpecialItem } from '../src/game/entity/Item';
import {
  BossFireBallShoot,
  FireRainShoot,
  type FramBallOwner,
  FramBallShoot,
  HammerShoot,
} from '../src/game/entity/Shoot';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** A fresh game on level 6 (two enemies), run until they are in. */
function startLevel6(): void {
  session.startGame(6, 1234);
  step(20);
  expect(session.game.getBads().length).toBeGreaterThan(1);
}

function useItem(id: number): void {
  const item = SpecialItem.attach(session.game, 100, 100, id, null)!;
  session.game.player!.executeSpecialItem(item);
  item.destroy();
}

describe('shots (task 2.2)', () => {
  it('the hammer (item 85) follows the player and kills the enemies in reach', () => {
    startLevel6();
    const p = session.game.player!;
    useItem(85);
    const h = session.game.getList(Data.SHOOT).find((s) => s instanceof HammerShoot) as HammerShoot;
    expect(h).toBeDefined();
    expect(p.actives[85]).toBe(true);
    step(1);
    expect(h.x).toBeCloseTo(p.x + p.dir * Data.CASE_WIDTH * 0.7, 0);

    const b = session.game.getBads()[0];
    b.moveTo(h.x, h.y);
    step(1);
    expect(b.fl_kill).toBe(true);
  });

  it('the hammer goes away when the player dies, and ends item 85', () => {
    startLevel6();
    const p = session.game.player!;
    useItem(85);
    const h = session.game.getList(Data.SHOOT).find((s) => s instanceof HammerShoot)!;
    p.killHit(0);
    step(1);
    expect(h.fl_destroy).toBe(true);
    expect(p.actives[85]).toBe(false);
  });

  it('a fire rain drop burns the enemy it hits', () => {
    startLevel6();
    const b = session.game.getBads()[0];
    const s = FireRainShoot.attach(session.game, b.x, b.y - Data.CASE_HEIGHT * 2);
    s.moveToAng(90, s.shootSpeed);
    expect(s.shootSpeed).toBeGreaterThanOrEqual(10);
    expect(s.shootSpeed).toBeLessThan(15);
    for (let i = 0; i < 10 && !b.fl_destroy; i++) step(1);
    expect(b.fl_destroy).toBe(true);
    expect(s.fl_destroy).toBe(true);
  });

  it('a fire rain drop ends on the left border', () => {
    startLevel6();
    const s = FireRainShoot.attach(session.game, 5, 100);
    s.moveLeft(10);
    step(2);
    expect(s.fl_destroy).toBe(true);
  });

  it('a boss fire ball spirals out to 5 cells and is stopped by a bomb', () => {
    startLevel6();
    const bat = { x: 200, y: 200 };
    const s = BossFireBallShoot.attach(session.game, bat.x, bat.y);
    s.initBossShoot(bat, 0);
    step(60);
    expect(s.dist).toBe(Data.CASE_WIDTH * 5);
    expect(Math.hypot(s.x - bat.x, s.y + 1 - bat.y)).toBeCloseTo(Data.CASE_WIDTH * 5, 0);

    const bomb = ClassicBomb.attach(session.game, s.x, s.y);
    s.hit(bomb);
    expect(bomb.fl_destroy).toBe(true);
    expect(s.fl_destroy).toBe(true);
  });

  it('a boss fire ball kills the player', () => {
    startLevel6();
    const p = session.game.player!;
    const s = BossFireBallShoot.attach(session.game, p.x, p.y);
    s.initBossShoot({ x: p.x, y: p.y }, 0);
    s.hit(p);
    expect(p.fl_kill).toBe(true);
  });

  it('a Framboise fragment flies to its target and reports once', () => {
    startLevel6();
    const arrived: FramBallShoot[] = [];
    const owner: FramBallOwner = {
      tx: 300,
      ty: 100,
      anger: 0,
      onArrived: (fb) => {
        arrived.push(fb);
        fb.destroy();
      },
    };
    const s = FramBallShoot.attach(session.game, 100, 300);
    s.setOwner(owner);
    step(Data.SECOND * 4 + 2);
    expect(arrived).toEqual([s]);
    expect(s.fl_destroy).toBe(true);
  });
});

describe('bombs (task 2.2)', () => {
  it('a boss bomb hatches an Orange that drops nothing, outside the level count', () => {
    startLevel6();
    const bads = session.game.getBads().length;
    const badCount = session.game.badCount;
    const b = BossBomb.attach(session.game, 200, 200);
    expect(b.duration).toBeGreaterThanOrEqual(Data.SECOND * 2 - 4.9);
    expect(b.duration).toBeLessThanOrEqual(Data.SECOND * 2 + 4.9);
    expect(b.lifeTimer).toBe(b.duration);
    step(Math.ceil(b.duration) + 1);
    expect(b.fl_explode).toBe(true);
    const all = session.game.getBads();
    expect(all.length).toBe(bads + 1);
    expect(session.game.badCount).toBe(badCount);
    const orange = all[all.length - 1];
    expect(orange.badId).toBe(Data.BAD_ORANGE);
    expect(orange.fl_knock).toBe(true);
    const items = session.game.getItems().length;
    orange.dropReward();
    expect(session.game.getItems().length).toBe(items);
  });

  it('a soccer ball never explodes, and a repel bomb pushes and burns it', () => {
    startLevel6();
    const ball = SoccerBall.attach(session.game, 200, 100);
    expect(ball.isType(Data.SOCCERBALL)).toBe(true);
    step(Data.SECOND * 10);
    expect(ball.fl_destroy).toBe(false);
    expect(ball.fl_explode).toBe(false);

    const r = RepelBomb.attach(session.game, ball.x - 10, ball.y);
    r.setOwner(session.game.player);
    r.onExplode();
    expect(ball.dx).toBeGreaterThan(0);
    expect(ball.dy).toBe(-8);
    expect(ball.burnTimer).toBe(Data.SECOND);
    expect(ball.lastPlayer).toBe(session.game.player);
  });

  it('kicking a soccer ball triples its speed', () => {
    startLevel6();
    const ball = SoccerBall.attach(session.game, 200, 100);
    ball.dx = 2;
    ball.dy = 1;
    ball.onKick(session.game.player!);
    expect(ball.dx).toBe(6);
    expect(ball.dy).toBeCloseTo(1.1);
    expect(ball.lastPlayer).toBe(session.game.player);
  });
});

describe('level script code trigger 6 (soccer balls on special slots)', () => {
  it('soccer level 7 throws its balls', async () => {
    const soccer = await createHeadlessSession('soccer');
    soccer.startGame(7, 1234);
    // The level starts after its IA parse (17 frames)
    for (let i = 0; i < 17 + 40; i++) soccer.gameLoop.stepSingleFrame();
    // Timers at 10, 20, 30 and "4²0", which parseInt reads as 4
    expect(soccer.game.getList(Data.SOCCERBALL).length).toBe(4);
  });
});
