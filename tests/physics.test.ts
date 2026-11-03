import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Data } from '../src/game/Data';
import type { LevelSet } from '../src/game/data/types';
import { BaseEntity } from '../src/game/entity/Entity';
import { LevelWorld } from '../src/game/levels/LevelWorld';

const DATA_DIR = join(__dirname, '../public/data');

describe('Game Physics, Grid, and Coordinates', () => {
  it('verifies fundamental Hammerfest grid constants', () => {
    expect(Data.CASE_WIDTH).toBe(20);
    expect(Data.CASE_HEIGHT).toBe(20);
    expect(Data.LEVEL_WIDTH).toBe(20);
    expect(Data.LEVEL_HEIGHT).toBe(25);
    expect(Data.GAME_WIDTH).toBe(400);
    expect(Data.GAME_HEIGHT).toBe(500);
  });

  it('verifies coordinate conversions (x_ctr, y_ctr, x_rtc, y_rtc)', () => {
    // Cell to pixel center / baseline
    expect(BaseEntity.x_ctr(0)).toBe(10);
    expect(BaseEntity.y_ctr(0)).toBe(20);
    expect(BaseEntity.x_ctr(5)).toBe(110);
    expect(BaseEntity.y_ctr(7)).toBe(160);

    // Pixel to cell
    expect(BaseEntity.x_rtc(10)).toBe(0);
    expect(BaseEntity.x_rtc(25)).toBe(1);
    expect(BaseEntity.y_rtc(150)).toBe(7);
  });

  it('loads adventure level 0 and parses walls correctly', () => {
    const raw = readFileSync(join(DATA_DIR, 'levels/adventure.json'), 'utf-8');
    const set = JSON.parse(raw) as LevelSet;

    const world = new LevelWorld(set, 0, true);
    expect(world.currentId).toBe(0);
    expect(world.inBound(0, 0)).toBe(true);
    expect(world.inBound(19, 24)).toBe(true);
    expect(world.inBound(20, 25)).toBe(false);

    // Out of bounds checks
    expect(world.getCase(-1, 5)).toBe(Data.OUT_WALL);
    expect(world.getCase(20, 5)).toBe(Data.OUT_WALL);
  });

  it('verifies level navigation (goto, levelCount, visited)', () => {
    const raw = readFileSync(join(DATA_DIR, 'levels/tutorial.json'), 'utf-8');
    const set = JSON.parse(raw) as LevelSet;
    const world = new LevelWorld(set, 0, true);

    expect(world.levelCount).toBe(set.levels.length);
    expect(world.isVisited()).toBe(false);
    world.markVisited();
    expect(world.isVisited()).toBe(true);

    if (world.levelCount > 1) {
      const ok = world.goto(1);
      expect(ok).toBe(true);
      expect(world.currentId).toBe(1);
      expect(world.isVisited()).toBe(false);
    }
  });

  it('tests flagMap and wall collision helpers', () => {
    const raw = readFileSync(join(DATA_DIR, 'levels/adventure.json'), 'utf-8');
    const set = JSON.parse(raw) as LevelSet;
    const world = new LevelWorld(set, 0, true);

    // Platform at column 10 row 7 is solid
    const hasPlatform = world.getCase(10, 7) > 0;
    expect(hasPlatform).toBe(true);
  });
});
