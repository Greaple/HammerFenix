import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwfLibrary } from '../src/engine/swf/SwfLibrary';
import type { SwfMovieClip } from '../src/engine/swf/SwfMovieClip';
import { INTRO_ROOT, type SwfLibraryData } from '../src/engine/swf/types';
import { INTRO_URL, IntroMovie, introOnLaunch } from '../src/ui/Intro';

const data = JSON.parse(
  readFileSync(join(__dirname, '../public/gfx/intro.json'), 'utf-8'),
) as SwfLibraryData;

function movie(keyDown?: (code: number) => boolean): IntroMovie {
  return new IntroMovie(SwfLibrary.headless(data), 'fr', keyDown);
}

const scene1 = (m: IntroMovie) => m.root.avmGet('main') as SwfMovieClip | undefined;
const scene2 = (m: IntroMovie) => m.root.avmGet('main2') as SwfMovieClip | undefined;

/** Plays `m` until `done` (at most `max` frames); returns the frames played. */
function playUntil(m: IntroMovie, done: () => boolean, max = 5000): number {
  let n = 0;
  while (!done() && n < max) {
    m.step();
    n++;
  }
  return n;
}

describe("the site's intro (intro.swf, roadmap 3.5)", () => {
  it('is built with its root timeline and its own linkage names', () => {
    expect(data.exports[INTRO_ROOT]).toBe(50000);
    expect(data.exports.bFade).toBeDefined();
    // The typewriter's box is only in introDesert.swf
    expect(data.exports.textBox).toBeUndefined();
    // Every frame script runs as bytecode (none fell back to the simple ops)
    for (const id of [50555, 50660]) {
      const def = data.characters[id];
      if (def.kind !== 'sprite') throw new Error('not a sprite');
      for (const f of def.frames) for (const a of f.actions ?? []) expect(a.op).toBe('avm1');
    }
  });

  it('plays its first scene step by step, then the desert, then asks for its url', () => {
    const m = movie();
    expect(m.root.avmGet('url')).toBe(INTRO_URL);
    const steps: number[] = [];
    let frames = 0;
    while (scene1(m) && !scene2(m) && frames < 5000) {
      const s = scene1(m)!.avmGet('step') as number;
      if (steps[steps.length - 1] !== s) steps.push(s);
      m.step();
      frames++;
    }
    // The bananas (-1 to -9: Tuberculoz walks in, the bananas fight), then the apples fall and
    // Bouli is caught (0 to 20)
    expect(steps).toEqual([
      -1, -2, -3, -4, -5, -6, -7, -8, -9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      17, 18, 19, 20,
    ]);
    expect(frames).toBe(1437);
    // The desert: Bouli walks, the dunes scroll, the screen fades out
    const desert = scene2(m)!;
    const dune6 = desert.avmGet('dune6') as SwfMovieClip;
    const x0 = dune6._x;
    expect(playUntil(m, () => m.ended)).toBe(550);
    expect(dune6._x).toBeLessThan(x0);
    expect(desert.avmGet('fadeOut')).toBe(true);
  });

  it("the bananas fight once more before the knockout (a child's frame script runs first)", () => {
    const m = movie();
    // The bananas' frame 28 sends them to "assom" if the step is -2, which `main()` sets on that
    // very frame (81): Flash runs the child's script first, so they loop once more
    playUntil(m, () => scene1(m)!.avmGet('step') === -2);
    const bananas = scene1(m)!.avmGet('bananePlay') as SwfMovieClip;
    expect(bananas._currentframe).toBe(1);
    expect(bananas.avmGet('ban2')).toBeDefined();
    playUntil(m, () => bananas._currentframe === 29);
    expect(bananas.avmGet('ban2')).toBeUndefined(); // knocked out
  });

  it('the flipped banana tilts back a little, not round (Flash reads its `_rotation` as 180)', () => {
    const m = movie();
    playUntil(m, () => scene1(m)!.avmGet('step') === -5);
    const ban2 = (scene1(m)!.avmGet('bananePlay') as SwfMovieClip).avmGet('ban2') as SwfMovieClip;
    // Placed with `_xscale` -84.6 by its timeline: Flash reads it as 84.6, turned 180
    expect(ban2.avmGetProp(2)).toBeCloseTo(84.6, 1);
    expect(ban2.avmGetProp(10)).toBeCloseTo(-170); // 180 + 10
    const frames = playUntil(m, () => scene1(m)!.avmGet('step') === -6);
    expect(frames).toBe(74); // 15 frames, then 0.5 degree a frame from -170 to 160
  });

  it('shows no text: its texts are attached as a symbol it does not have', () => {
    const m = movie();
    playUntil(m, () => scene2(m) !== undefined);
    playUntil(m, () => false, 20);
    const desert = scene2(m)!;
    expect(desert.avmGet('currentText')).toBe(7);
    expect(desert.avmGet('textBox')).toBeUndefined();
    const texts = desert.avmGet('texts') as { txt: string; timer: number }[];
    expect(texts.map((t) => t.txt)).toContain('Parfois au péril de sa vie.');
  });

  it('a click asks for its url at once (its button over the whole stage)', () => {
    const m = movie();
    m.step();
    m.click();
    expect(m.ended).toBe(true);
  });

  it('Enter sends Tuberculoz back to his walk (`Key.isDown(13)`)', () => {
    let enter = false;
    const m = movie((code) => enter && code === 13);
    playUntil(m, () => scene1(m)!.avmGet('step') === 5);
    enter = true;
    m.step();
    expect(scene1(m)!.avmGet('step')).toBe(-2);
  });
});

describe('the intro on the first launch', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(): Map<string, string> {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    return store;
  }

  it('plays once for a new player', () => {
    stubStorage();
    expect(introOnLaunch(false)).toBe(true);
    expect(introOnLaunch(false)).toBe(false);
  });

  it('does not play for a player with a profile', () => {
    const store = stubStorage();
    expect(introOnLaunch(true)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('does not play when the storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(introOnLaunch(false)).toBe(false);
  });
});

describe('clips moved by frame scripts (Flash semantics the intro needs)', () => {
  /** A clip whose child `c` is at x 10 on frame 1 and moved to x 20 on frame 2. */
  function parent(): SwfMovieClip {
    const lib = SwfLibrary.headless({
      version: 1,
      sounds: {},
      exports: { p: 2 },
      characters: {
        1: { kind: 'sprite', frameCount: 1, frames: [{ cmds: [] }] },
        2: {
          kind: 'sprite',
          frameCount: 2,
          frames: [
            { cmds: [{ op: 'place', d: 1, id: 1, n: 'c', m: [1, 0, 0, 1, 10, 0] }] },
            { cmds: [{ op: 'place', d: 1, u: true, m: [1, 0, 0, 1, 20, 0] }] },
          ],
        },
      },
    });
    const p = lib.attach('p');
    p.stop();
    return p;
  }

  it('the timeline places a child no script moved', () => {
    const p = parent();
    const c = p.getClip('c')!;
    p.gotoAndStop(2);
    expect(c._x).toBe(20);
    p.gotoAndStop(1);
    expect(c._x).toBe(10);
  });

  it('a child a script moved stays where the script put it', () => {
    const p = parent();
    const c = p.getClip('c')!;
    c.avmSetProp(0, 50);
    p.gotoAndStop(2);
    expect(c._x).toBe(50);
    p.gotoAndStop(1);
    expect(c._x).toBe(50);
  });

  it('a flipped clip reads as turned 180, and a script keeps its own negative `_xscale`', () => {
    const lib = SwfLibrary.headless({
      version: 1,
      sounds: {},
      exports: { p: 2 },
      characters: {
        1: { kind: 'sprite', frameCount: 1, frames: [{ cmds: [] }] },
        2: {
          kind: 'sprite',
          frameCount: 1,
          frames: [{ cmds: [{ op: 'place', d: 1, id: 1, n: 'c', m: [-0.5, 0, 0, 0.5, 0, 0] }] }],
        },
      },
    });
    const c = lib.attach('p').getClip('c')!;
    expect(c.avmGetProp(2)).toBeCloseTo(50);
    expect(c.avmGetProp(3)).toBeCloseTo(50);
    expect(c.avmGetProp(10)).toBeCloseTo(180);
    c.avmSetProp(10, 0); // keeps the flip (its skew): now upside down
    expect(c.scale.x * Math.cos(c.rotation + c.skew.y)).toBeCloseTo(0.5);
    c.avmSetProp(2, -50);
    expect(c.avmGetProp(2)).toBeCloseTo(-50);
    expect(c.avmGetProp(10)).toBeCloseTo(0);
  });

  it('`_rotation` reads back between -180 and 180', () => {
    const c = parent().getClip('c')!;
    c.avmSetProp(10, 175);
    c.avmSetProp(10, (c.avmGetProp(10) as number) + 10);
    expect(c.avmGetProp(10)).toBeCloseTo(-175);
    c.avmSetProp(10, -190);
    expect(c.avmGetProp(10)).toBeCloseTo(170);
  });
});
