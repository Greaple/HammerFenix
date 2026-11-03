import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SwfLibraryData } from '../src/engine/swf/types';

const GFX_DIR = join(__dirname, '../public/gfx');

describe('SWF Asset Pipeline & Library', () => {
  it('loads and validates public/gfx/library.json', () => {
    const raw = readFileSync(join(GFX_DIR, 'library.json'), 'utf-8');
    const lib = JSON.parse(raw) as SwfLibraryData;

    expect(lib.characters).toBeDefined();
    expect(lib.exports).toBeDefined();
    expect(Object.keys(lib.exports).length).toBeGreaterThanOrEqual(250);

    // Verify vital Hammerfest linkages
    expect(lib.exports['hammer_player']).toBeDefined();
    expect(lib.exports['hammer_bomb_classic']).toBeDefined();
    expect(lib.exports['hammer_fx_flame']).toBeDefined();
    expect(lib.exports['hammer_interf_game']).toBeDefined();
    expect(lib.exports['hammer_interf_instructions']).toBeDefined();
    expect(lib.exports['hammer_interf_life']).toBeDefined();
    expect(lib.exports['tile']).toBeDefined();
  });

  it('verifies movie clip frame definitions and placement commands', () => {
    const raw = readFileSync(join(GFX_DIR, 'library.json'), 'utf-8');
    const lib = JSON.parse(raw) as SwfLibraryData;

    const playerCharId = lib.exports['hammer_player'];
    const playerDef = lib.characters[playerCharId];
    expect(playerDef).toBeDefined();
    expect(playerDef.kind).toBe('sprite');

    if (playerDef.kind === 'sprite') {
      expect(playerDef.frameCount).toBeGreaterThan(0);
      expect(playerDef.frames.length).toBeGreaterThan(0);
      expect(playerDef.frames[0].cmds.length).toBeGreaterThan(0);
    }
  });

  it('verifies extracted bitmap files on disk match library definitions', () => {
    const raw = readFileSync(join(GFX_DIR, 'library.json'), 'utf-8');
    const lib = JSON.parse(raw) as SwfLibraryData;

    let bitmapCount = 0;
    for (const char of Object.values(lib.characters)) {
      if (char.kind === 'bitmap') {
        bitmapCount++;
        const p = join(GFX_DIR, 'bitmaps', char.file);
        expect(existsSync(p)).toBe(true);
      }
    }
    expect(bitmapCount).toBeGreaterThan(50);
  });
});
