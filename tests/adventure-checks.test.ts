/**
 * Fixes from the Adventure spot checks against the original in Ruffle (roadmap 2B.4,
 * docs/LEVELS.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseFlashHtml } from '../src/engine/swf/SwfMovieClip';
import type { SwfLibraryData } from '../src/engine/swf/types';
import { Data } from '../src/game/Data';
import type { GameSession } from '../src/game/GameSession';
import { createHeadlessSession } from './helpers/headless';

let session: GameSession;

beforeAll(async () => {
  session = await createHeadlessSession();
});

function step(n: number): void {
  for (let i = 0; i < n; i++) session.gameLoop.stepSingleFrame();
}

describe('level name banner (Adventure.onLevelReady)', () => {
  it('shows only on levels with a name of their own (Lang.getLevelName)', () => {
    session.startGame(0, 1234);
    step(20);
    session.game.forcedGoto(1);
    step(60);
    expect(session.game.world.currentId).toBe(1);
    expect(session.game.fxMan.levelName).toBeNull();
    session.game.forcedGoto(2);
    step(60);
    expect(session.game.world.currentId).toBe(2);
    expect(session.game.fxMan.levelName?.getText('field')?.text).toBe(
      session.dataStore.getLevelName(0, 2),
    );
  });
});

describe('SWF data', () => {
  it('keeps an identity color transform that ends a fade (the darkness veil, frame 10)', () => {
    const lib: SwfLibraryData = JSON.parse(
      readFileSync(join(__dirname, '../public/gfx/library.json'), 'utf-8'),
    );
    const darkness = lib.characters[lib.exports.hammer_fx_darkness];
    if (darkness.kind !== 'sprite') throw new Error('not a sprite');
    const veil = darkness.frames[9].cmds.find((c) => c.op === 'place' && c.d === 1);
    expect(veil && 'cx' in veil ? veil.cx : undefined).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });
});

describe('HTML text', () => {
  it('Data.replaceTag wraps every other piece', () => {
    expect(Data.replaceTag('des *Sorbex* !', '*', '<i>', '</i>')).toBe('des <i>Sorbex</i> !');
    expect(Data.replaceTag('odd * count', '*', '<i>', '</i>')).toBe('odd * count');
  });

  it('parseFlashHtml keeps colors, bold and line breaks', () => {
    const r = parseFlashHtml(
      '<p align="center">a <font color="#F7E8D5">b</font><br><b>c</b> &amp; <font size="2">d</font></p>',
    );
    expect(r.plain).toBe('a b\nc & d');
    expect(r.tagged).toBe('a <c_f7e8d5>b</c_f7e8d5>\n<b>c</b> & d');
    expect(r.tags).toEqual({ c_f7e8d5: { fill: '#f7e8d5' }, b: { fontWeight: 'bold' } });
  });
});
