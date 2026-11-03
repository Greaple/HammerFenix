import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Avm1Clip, runAvm1 } from '../src/engine/swf/Avm1';
import type { SpriteDef, SwfLibraryData } from '../src/engine/swf/types';

const lib = JSON.parse(
  readFileSync(join(__dirname, '../public/gfx/library.json'), 'utf-8'),
) as SwfLibraryData;

/** `_anims.swf` characters are offset by 20000 in the library. */
function frameScript(charId: number): string {
  const def = lib.characters[20000 + charId] as SpriteDef;
  const act = def.frames[0].actions?.find((a) => a.op === 'avm1');
  if (!act || act.op !== 'avm1') throw new Error(`no script on #${charId}`);
  return act.code;
}

/** A body part inside `sub`, inside the player clip whose fields come from `host`. */
function makePart(host: Record<string, unknown>) {
  const calls: { goto: unknown[]; visible: unknown[] } = { goto: [], visible: [] };
  const fake = (get: (n: string) => unknown): Avm1Clip => {
    const vars = new Map<string, unknown>();
    return {
      avmGet: (n) => (vars.has(n) ? vars.get(n) : get(n)),
      avmSet: (n, v) => vars.set(n, v),
      avmGetProp: () => undefined,
      avmSetProp: (i, v) => {
        if (i === 7) calls.visible.push(v);
      },
      avmCall: () => undefined,
      avmRandom: () => 0,
      avmGoto: (f, play) => calls.goto.push([f, play]),
      play: () => {},
      stop: () => {},
      removeMovieClip: () => {},
    };
  };
  const player = fake((n) => host[n]);
  const sub = fake((n) => (n === '_parent' ? player : undefined));
  const part = fake((n) => (n === '_parent' ? sub : undefined));
  return { part, calls };
}

describe('AVM1 frame scripts of the player body', () => {
  it('head part stops on the player head frame', () => {
    const { part, calls } = makePart({ head: 5 });
    runAvm1(frameScript(429), part);
    expect(calls.goto).toEqual([[5, false]]);
  });

  it('skin part stops on the player skin frame', () => {
    const { part, calls } = makePart({ skin: 2 });
    runAvm1(frameScript(442), part);
    expect(calls.goto).toEqual([[2, false]]);
  });

  it('weapon hand shows currentWeapon + 1, and frame 12 for no weapon (-1)', () => {
    const a = makePart({ currentWeapon: 1 });
    runAvm1(frameScript(436), a.part);
    expect(a.calls.goto).toEqual([[2, false]]);

    const b = makePart({ currentWeapon: -1 });
    runAvm1(frameScript(436), b.part);
    expect(b.calls.goto).toEqual([[12, false]]);
  });

  it('carrot and tuft follow fl_carot and fl_chourou', () => {
    const a = makePart({ fl_carot: false });
    runAvm1(frameScript(479), a.part);
    expect(a.calls.visible).toEqual([false]);

    const b = makePart({ fl_chourou: true });
    runAvm1(frameScript(483), b.part);
    expect(b.calls.visible).toEqual([true]);
  });
});
