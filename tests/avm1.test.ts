import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Avm1Clip, runAvm1 } from '../src/engine/swf/Avm1';
import { SwfLibrary } from '../src/engine/swf/SwfLibrary';
import { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
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
      duplicateMovieClip: () => undefined,
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

describe('script functions (2C.6)', () => {
  const swf = SwfLibrary.headless(lib);
  const clip = (charId: number) => {
    const mc = swf.instantiateCharacter(20000 + charId) as SwfMovieClip;
    mc.goLive();
    return mc;
  };
  const num = (mc: SwfMovieClip, name: string) => Number(mc.avmGet(name));

  it("runs the sphinx's particle emitter: init() duplicates 16 particles, main() moves them", () => {
    const mc = clip(150);
    mc.stepAnimation(); // frame 2: init()
    // `for (i = 0; i <= max; i++)` with max = 15
    const parts = Array.from({ length: 16 }, (_, i) => mc.getClip(`l${i}`)!);
    expect(parts.every((p) => p !== null)).toBe(true);
    expect(num(mc, 'max')).toBe(15);
    const x0 = parts.map((p) => p._x);
    for (const p of parts) {
      expect(num(p, 'taille')).toBeGreaterThanOrEqual(50);
      expect(num(p, 'taille')).toBeLessThan(100);
      expect(p._xscale).toBeCloseTo(num(p, 'taille'));
      expect(p._yscale).toBeCloseTo(p._xscale);
      expect(p._x).toBeGreaterThanOrEqual(0);
      expect(p._x).toBeLessThan(80);
      expect(p.zIndex).toBeGreaterThanOrEqual(16384);
    }
    mc.stepAnimation(); // frame 3: main()
    parts.forEach((p, i) => expect(p._x).toBeCloseTo(x0[i] + num(p, 'vit')));
    // Frame 4 goes back to 3: main() runs every frame, and init() never again
    for (let i = 0; i < 40; i++) mc.stepAnimation();
    expect(mc.children.filter((c) => c instanceof SwfMovieClip && c.zIndex >= 16384)).toHaveLength(
      16,
    );
    for (const p of parts) expect(Math.abs(p._x - 40)).toBeLessThan(45);
  });

  it("places item 86's ghosts with newGhost() and moves them", () => {
    const mc = clip(3200); // frame 1: newGhost($ghost1, null), newGhost($ghost2, $ghost1)
    const g1 = mc.getClip('$ghost1')!;
    const g2 = mc.getClip('$ghost2')!;
    expect(num(g1, 'sens')).toBe(-1);
    expect(num(g2, 'sens')).toBe(1);
    for (const g of [g1, g2]) {
      expect(num(g, 'speed')).toBeGreaterThanOrEqual(10);
      expect(num(g, 'speed')).toBeLessThan(20);
      expect(g._y).toBeGreaterThanOrEqual(50);
      expect(g._y).toBeLessThan(450);
    }
    expect(Math.abs(g2._y - g1._y)).toBeGreaterThanOrEqual(50);
    const x1 = g1._x;
    mc.stepAnimation(); // frame 2: each ghost moves by speed * sens
    expect(g1._x).toBeCloseTo(x1 - num(g1, 'speed'));
  });
});
