import { beforeAll, describe, expect, it } from 'vitest';
import { Timer } from '../src/engine/Timer';
import { Data } from '../src/game/Data';
import { createBad } from '../src/game/entity/Bad';
import { BossBomb, ClassicBomb } from '../src/game/entity/Bomb';
import { BatBoss, TuberculozBoss } from '../src/game/entity/Boss';
import { BaseEntity } from '../src/game/entity/Entity';
import { type ItemEntity, ScoreItem, SpecialItem } from '../src/game/entity/Item';
import { BossFireBallShoot, EnemyFireBallShoot } from '../src/game/entity/Shoot';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

/** A fresh game on a boss level, run until the boss is in; the player cannot die. */
function start(level: number) {
  session.startGame(level, 1234);
  step(20);
  session.game.player!.fl_godMode = true;
  const boss = session.game.getList(Data.BOSS)[0];
  expect(boss).toBeDefined();
  return boss;
}

function live<T>(type: number, cls: abstract new (...a: never[]) => T): T[] {
  return session.game.getList(type).filter((e) => !e.fl_kill && e instanceof cls) as T[];
}

/** Steps until `cond` holds; returns the number of frames, or -1. */
function stepUntil(cond: () => boolean, max = 2000): number {
  for (let i = 1; i <= max; i++) {
    step(1);
    if (cond()) return i;
  }
  return -1;
}

describe('Bat (entity.boss.Bat, level 100)', () => {
  it('arrives on level 100 as an enemy and a boss, and the level does not clear', () => {
    const bat = start(Data.BAT_LEVEL) as BatBoss;
    expect(bat).toBeInstanceOf(BatBoss);
    expect(bat.isType(Data.BAD)).toBe(true);
    expect(bat.isType(Data.BAD_CLEAR)).toBe(false);
    expect(session.game.fl_clear).toBe(false);
    expect(session.game.isBossLevel(Data.BAT_LEVEL)).toBe(true);
    // The level script plays the boss music
    expect(session.game.currentTrack).toBe(1);
    expect(bat.animId).toBe(Data.ANIM_BAT_INTRO.id);
    // After the intro it is shielded and flies somewhere
    expect(stepUntil(() => bat.animId !== Data.ANIM_BAT_INTRO.id)).toBeGreaterThan(0);
    expect(bat.fl_shield).toBe(true);
    expect(Math.abs(bat.tx - bat.x)).toBeGreaterThanOrEqual(Data.BOSS_BAT_MIN_X_DIST);
  });

  it('turns off the hurry up while alive', () => {
    start(Data.BAT_LEVEL);
    step(Data.HU_STEPS[0] + 10);
    expect(session.game.huState).toBe(0);
  });

  it('a first bomb takes the shield off and angers it, a second one costs a life', () => {
    const bat = start(Data.BAT_LEVEL) as BatBoss;
    stepUntil(() => bat.fl_shield);
    bat.freeze(Data.FREEZE_DURATION);
    expect(bat.fl_shield).toBe(false);
    expect(bat.fl_anger).toBe(true);
    expect(bat.glow.color).toBe(0xffd78c);
    expect(live(Data.SHOOT, BossFireBallShoot)).toHaveLength(6);

    bat.freeze(Data.FREEZE_DURATION);
    expect(bat.lives).toBe(BatBoss.LIVES - 1);
    expect(bat.fl_immune).toBe(true);
    expect(bat.fl_shield).toBe(true);
    expect(bat.fl_anger).toBe(false);
    step(1);
    expect(live(Data.SHOOT, BossFireBallShoot)).toHaveLength(0);

    // Immune for 3 seconds
    bat.freeze(Data.FREEZE_DURATION);
    expect(bat.fl_shield).toBe(true);
    step(Data.SECOND * 3);
    expect(bat.fl_immune).toBe(false);
  });

  it('player bombs reach it like any enemy', () => {
    const bat = start(Data.BAT_LEVEL) as BatBoss;
    stepUntil(() => bat.fl_shield);
    const b = ClassicBomb.attach(session.game, bat.x, bat.y);
    b.onExplode();
    expect(bat.fl_shield).toBe(false);
    expect(bat.fl_anger).toBe(true);
  });

  it('calms down when the player dies (resetHurry)', () => {
    const bat = start(Data.BAT_LEVEL) as BatBoss;
    stepUntil(() => bat.fl_shield);
    bat.freeze(Data.FREEZE_DURATION);
    session.game.resetHurry();
    expect(bat.fl_anger).toBe(false);
    expect(bat.fl_shield).toBe(true);
  });

  it('kills a player that touches it', () => {
    const bat = start(Data.BAT_LEVEL) as BatBoss;
    stepUntil(() => bat.fl_shield);
    const p = session.game.player!;
    p.fl_godMode = false;
    p.moveTo(bat.x, bat.y);
    step(1);
    expect(p.fl_kill).toBe(true);
  });

  it('dies after 3 lives: rises, dives, then the level clears', () => {
    const bat = start(Data.BAT_LEVEL) as BatBoss;
    stepUntil(() => bat.fl_shield);
    for (let i = 0; i < BatBoss.LIVES; i++) {
      bat.fl_immune = false;
      bat.freeze(0); // shield off
      bat.freeze(0); // life
    }
    expect(bat.fl_death).toBe(true);
    expect(bat.fl_deathUp).toBe(true);
    expect(session.game.fl_clear).toBe(false);
    expect(stepUntil(() => !bat.fl_deathUp)).toBeGreaterThan(0);
    expect(bat.animId).toBe(Data.ANIM_BAT_FINAL_DIVE.id);
    expect(stepUntil(() => bat.fl_destroy)).toBeGreaterThan(0);
    expect(session.game.fl_clear).toBe(true);
  });
});

describe('Tuberculoz (entity.boss.Tuberculoz, level 101)', () => {
  it('arrives on level 101 as a boss only, with a life bar', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    expect(tub).toBeInstanceOf(TuberculozBoss);
    expect(tub.isType(Data.BAD)).toBe(false);
    expect(session.game.fl_clear).toBe(false);
    expect(tub.lifeBar).not.toBeNull();
    expect(tub.lifeBar!.bar).not.toBeNull();
    expect(tub.y).toBe(TuberculozBoss.GROUND_Y);
    expect(stepUntil(() => tub.action === TuberculozBoss.WALK)).toBeGreaterThan(0);
  });

  it('loses a life per bomb in reach, then is immune for 3 seconds', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    stepUntil(() => tub.action === TuberculozBoss.WALK);
    session.game.onExplode(tub.x, tub.y + TuberculozBoss.CENTER_OFFSET, 50);
    expect(tub.lives).toBe(99);
    expect(tub.lifeBar!.bar!._xscale).toBe(99);
    session.game.onExplode(tub.x, tub.y, 50);
    expect(tub.lives).toBe(99);
    step(Data.SECOND * 3);
    expect(tub.fl_immune).toBe(false);
  });

  it('a frozen enemy thrown at him costs 10 lives and knocks him up', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    stepUntil(() => tub.action === TuberculozBoss.WALK);
    const b = createBad(session.game, Data.BAD_ORANGE, 0, 0);
    b.freeze(Data.FREEZE_DURATION);
    b.moveTo(tub.x, tub.y + TuberculozBoss.CENTER_OFFSET);
    b.dx = 10;
    tub.checkHits();
    expect(tub.lives).toBe(90);
    expect(tub.action).toBe(TuberculozBoss.HIT);
    expect(tub.dy).toBe(-9);
    expect(b.fl_destroy).toBe(true);
    expect(tub.badKills).toBe(1);
  });

  it('kicks player bombs away once each', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    stepUntil(() => tub.action === TuberculozBoss.WALK);
    const b = ClassicBomb.attach(session.game, tub.x + 10 * tub.dir, tub.y);
    tub.checkHits();
    expect(b.dy).toBe(-7);
    expect(Math.sign(b.dx)).toBe(tub.dir);
    b.dy = 0;
    tub.checkHits();
    expect(b.dy).toBe(0);
  });

  it('cycles fire, tornado and dash every 9 seconds of walking', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    stepUntil(() => tub.action === TuberculozBoss.WALK);
    tub.seqTimer = 1;
    step(1);
    expect(tub.action).toBe(TuberculozBoss.BURN);
    expect(tub.seq).toBe(1);
    // The fire rises 3.5 seconds later (the delay already ran once in the frame of the attack)
    expect(stepUntil(() => live(Data.SHOOT, EnemyFireBallShoot).length > 0)).toBe(
      Data.SECOND * 3.5 - 1,
    );
    const shots = live(Data.SHOOT, EnemyFireBallShoot);
    expect(shots.length).toBeGreaterThanOrEqual(7);
    expect(shots.every((s) => s.dy < 0)).toBe(true);

    tub.tornado();
    expect(tub.fl_twister).toBe(false);
    expect(stepUntil(() => tub.fl_twister)).toBe(TuberculozBoss.TORNADO_INTRO);

    tub.dash();
    expect(tub.dashCount).toBe(0);
    expect(stepUntil(() => tub.fl_hitBorder === false)).toBeGreaterThan(0);
    expect(Math.abs(tub.dx)).toBe(TuberculozBoss.DASH_SPEED);
    // Three passes across the screen, then a jump back in
    expect(stepUntil(() => tub.action === TuberculozBoss.JUMP)).toBeGreaterThan(0);
    expect(tub.dashCount).toBe(3);
  });

  it('drops boss bombs that hatch oranges', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    stepUntil(() => tub.action === TuberculozBoss.WALK);
    tub.spawnBombs(2);
    const bombs = live(Data.BAD_BOMB, BossBomb);
    expect(bombs).toHaveLength(2);
    expect(bombs[0].distance(bombs[1].x, bombs[1].y)).toBeGreaterThan(Data.CASE_WIDTH * 6);
  });

  it('kills give the multi-bomb items and an extra life', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    const specials = () =>
      (session.game.getList(Data.SPECIAL_ITEM) as ItemEntity[]).filter((i) => !i.fl_kill);
    for (let i = 0; i < 5; i++) tub.onKillBad();
    expect(specials().map((i) => i.id)).toEqual([4]);
    for (let i = 0; i < 5; i++) tub.onKillBad();
    step(1);
    expect(specials().map((i) => i.id)).toEqual([4, 5]);
    for (let i = 0; i < 20; i++) tub.onKillBad();
    step(1);
    expect(specials().some((i) => i.id === 36)).toBe(true);
  });

  it('dies: bullet time, then the cloak, the key, the door and the exit to level 102', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    stepUntil(() => tub.action === TuberculozBoss.WALK);
    const scoreBefore = session.game.player!.score;
    tub.lives = 1;
    session.game.onExplode(tub.x, tub.y + TuberculozBoss.CENTER_OFFSET, 50);
    expect(tub.fl_death).toBe(true);
    expect(tub.lifeBar).toBeNull();
    expect(Timer.tmod).toBe(1);
    step(1);
    expect(Timer.tmod).toBeCloseTo(0.3);
    // counted in real frames, the clips keep their 40 fps
    step(Data.SECOND * 2 - 2);
    expect(Timer.tmod).toBeCloseTo(0.3);
    step(1);
    expect(Timer.tmod).toBe(1);

    expect(stepUntil(() => tub.fl_defeated)).toBeGreaterThan(0);
    expect(session.game.fl_clear).toBe(true);
    expect(tub.animId).toBe(Data.ANIM_BOSS_DEATH.id);
    const items = session.game.getItems().filter((i) => !i.fl_kill);
    expect(items.some((i) => i instanceof SpecialItem && i.id === 113)).toBe(true);
    expect(items.some((i) => i instanceof ScoreItem && i.id === 199)).toBe(true);
    // Life bonus: 20000 per spare life
    expect(session.game.player!.score - scoreBefore).toBe(session.game.player!.lives * 20000);
    expect(session.game.currentTrack).toBe(0);

    // Code trigger 5: the door at (5, 6) leads to level 102
    session.game.player!.moveTo(BaseEntity.x_ctr(5), BaseEntity.y_ctr(6));
    expect(stepUntil(() => session.game.world.currentId === 102, 400)).toBeGreaterThan(0);
    expect(session.game.getList(Data.BOSS)).toHaveLength(0);
  });

  it('a defeat time-out ends the fight if he never lands', () => {
    const tub = start(Data.TUBERCULOZ_LEVEL) as TuberculozBoss;
    stepUntil(() => tub.action === TuberculozBoss.WALK);
    tub.die();
    tub.fl_gravity = false;
    tub.dy = 0;
    tub.dx = 0;
    tub.y = 100;
    // 15 s of game time, counted with `tmod`: the 2 s of bullet time only count for 0.3 each
    const ticks = stepUntil(() => tub.fl_defeated, Data.SECOND * 17);
    expect(ticks).toBeGreaterThan(Data.SECOND * 16);
  });
});
