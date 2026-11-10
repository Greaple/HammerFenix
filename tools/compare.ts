/**
 * Dev helpers for the spot checks against the original (roadmap 2B.5, 2B.6, docs/LEVELS.md).
 * Not part of the game: load them in the dev server's page with
 * `const c = await import('/tools/compare.ts'); c.setup()`, then open the Flash dialog and click
 * the original to start it.
 *
 * Pictures go to `.cache/level-sheets/` (the dev save endpoint): strips with the port on top and
 * the original below, and close-ups of both side by side. The port is stepped tick by tick (a
 * hidden browser pane throttles real time); the original runs in real time in Ruffle and gets
 * its keys on its focused `#container`.
 */
import { DEFAULT_KEYS, PLAYER_ACTIONS, type PlayerAction } from '../src/engine/Input';
import type { GameSession } from '../src/game/GameSession';

type Action = PlayerAction;
/** `[ms, action, down]` key events from the start of a plan. */
export type Plan = [number, Action, boolean | 0 | 1][];

const W = 420;
const H = 520;
/** The original's game area in Ruffle's 1408 px wide canvas (letterboxed). */
const ORIG = { x: 330, w: 748, h: 926 };
const K = ORIG.w / W;

const w = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const g = () => window as any;
const session = (): GameSession => g().gameSession;
const ruffle = (): any => document.getElementById('ruffle-compare-player');
const ruffleCanvas = (): HTMLCanvasElement => ruffle().shadowRoot.querySelector('canvas');

/**
 * Call once after a page load, before opening the Flash dialog: Ruffle's WebGL canvas must keep
 * its drawing buffer to be read, and a hidden pane must not pause the port.
 */
export function setup(): void {
  const proto = HTMLCanvasElement.prototype as any;
  if (!proto.getContext.__keep) {
    const orig = proto.getContext;
    proto.getContext = function (type: string, attrs?: object) {
      if (/webgl/.test(type)) attrs = { ...(attrs ?? {}), preserveDrawingBuffer: true };
      return orig.call(this, type, attrs);
    };
    proto.getContext.__keep = true;
  }
  const stop = (e: Event) => e.stopImmediatePropagation();
  window.addEventListener('visibilitychange', stop, true);
  document.addEventListener('visibilitychange', stop, true);
  g().shell?.hide();
  session().startNow('solo');
  session().gameLoop.stop();
}

/** Opens the Flash dialog; click the original afterwards to start it. */
export async function openFlash(options = ''): Promise<void> {
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Flash')?.click();
  await w(6000);
  if (options) await reloadOriginal(options);
}

/** Restarts the original, with game options (`$options`: `mirror`, `nightmare`, `ninja`...). */
export async function reloadOriginal(options = ''): Promise<void> {
  const params: Record<string, string> = { lang: 'fr', mode: 'solo' };
  if (options) params.options = options;
  await ruffle().load({
    url: './original-swf/loader.swf',
    base: './original-swf/',
    parameters: params,
    letterbox: 'on',
    unmuteOverlay: 'hidden',
  });
  await w(6000);
}

/**
 * Freezes the original for a close look. `playOriginal()` did not always resume it (2B.6):
 * if a jump is refused after a pause, click the original's play button.
 */
export const pauseOriginal = () => ruffle().pause();
export const playOriginal = () => ruffle().play();

// ---------------------------------------------------------------- the port

export function step(n: number): void {
  for (let i = 0; i < n; i++) session().gameLoop.stepSingleFrame();
}

/** Plays a key plan on the port, tick by tick. Returns the player's `[ms, x, y]` every 4 ticks. */
export function planPort(plan: Plan, totalMs: number): number[][] {
  const s = session() as any;
  // Each move by its first default key (the arrows, Space)
  const press = (a: Action, down: boolean) => s.input.setKeyCode(DEFAULT_KEYS[a][0], down);
  const ev = plan.slice().sort((a, b) => a[0] - b[0]);
  const trace: number[][] = [];
  let k = 0;
  for (let t = 0; t < Math.ceil((totalMs * 32) / 1000); t++) {
    const ms = (t * 1000) / 32;
    while (k < ev.length && ev[k][0] <= ms) {
      const [, a, d] = ev[k++];
      press(a, !!d);
    }
    step(1);
    if (t % 4 === 0) trace.push([Math.round(ms), Math.round(s.player.x), Math.round(s.player.y)]);
  }
  for (const a of PLAYER_ACTIONS) press(a, false);
  return trace;
}

/** A new game in the port, entered into deepnight by the village door (as in the original). */
export function portToDeepnight(): void {
  const s = session() as any;
  s.startNow('solo');
  step(40);
  s.usePortal(0, null);
  for (let i = 0; i < 400 && (s.world.set?.name === 'adventure' || s.fl_lock); i++) step(1);
  step(20);
}

/** `GameMode.forcedGoto`, then the level change (57 ticks) and `extra` ticks. */
export function gotoPort(n: number, extra = 0): number {
  session().forcedGoto(n);
  step(57 + extra);
  return session().world.currentId;
}

// ---------------------------------------------------------------- the original

const KEYS: Record<Action, [string, number]> = {
  left: ['ArrowLeft', 37],
  right: ['ArrowRight', 39],
  jump: ['ArrowUp', 38],
  down: ['ArrowDown', 40],
  attack: ['Space', 32],
};

function keyOrig(type: string, code: string, key: string, keyCode: number, location = 0) {
  const p = ruffle();
  const t = p.shadowRoot.querySelector('#container') ?? p;
  t.dispatchEvent(
    new KeyboardEvent(type, {
      code,
      key,
      keyCode,
      which: keyCode,
      location,
      bubbles: true,
      composed: true,
      cancelable: true,
    } as KeyboardEventInit),
  );
}

function focusOrig(): void {
  const p = ruffle();
  (p.shadowRoot.querySelector('#container') ?? p).focus();
}

export async function holdOrig(code: string, key: string, keyCode: number, ms = 150) {
  focusOrig();
  keyOrig('keydown', code, key, keyCode);
  await w(ms);
  keyOrig('keyup', code, key, keyCode);
}

/** Three numpad digits: a special item (`Player.getDebugControls`), or with Ctrl a level jump. */
export async function digitsOrig(str: string): Promise<void> {
  focusOrig();
  await w(50);
  for (const d of str) {
    const kc = 96 + Number(d);
    keyOrig('keydown', `Numpad${d}`, d, kc, 3);
    await w(120);
    keyOrig('keyup', `Numpad${d}`, d, kc, 3);
    await w(120);
  }
}

/**
 * Jumps the original to level `n` of its current dimension, once: a second jump to the same
 * level finds it visited (no enemies). Backspace first clears a digit left from a refused jump.
 * It works only while the player can move.
 */
export async function gotoOrig(n: number): Promise<void> {
  playOriginal();
  await holdOrig('Backspace', 'Backspace', 8, 120);
  await w(100);
  const input = document.getElementById('flash-goto-level') as HTMLInputElement;
  input.value = String(n);
  (document.getElementById('flash-goto-form') as HTMLFormElement).requestSubmit();
  await w(2000);
}

/** Plays a key plan on the original in real time. */
export async function planOrig(plan: Plan, totalMs: number): Promise<void> {
  focusOrig();
  const ev = plan.slice().sort((a, b) => a[0] - b[0]);
  const t0 = performance.now();
  for (const [ms, a, d] of ev) {
    const left = ms - (performance.now() - t0);
    if (left > 0) await w(left);
    const [code, kc] = KEYS[a];
    keyOrig(d ? 'keydown' : 'keyup', code, code, kc);
  }
  const left = totalMs - (performance.now() - t0);
  if (left > 0) await w(left);
}

/** Extra lives in the original (item 36, picked up on the spot), so a setup survives a hit. */
export async function livesOrig(n = 4): Promise<void> {
  for (let i = 0; i < n; i++) {
    await digitsOrig('036');
    await w(700);
    const a: Action = i % 2 ? 'right' : 'left';
    await planOrig(
      [
        [0, a, 1],
        [200, a, 0],
      ],
      500,
    );
  }
}

/**
 * Takes the original from the village to deepnight 78 by the door (K gives the key). The well
 * jump is touchy in real time: check with `shotOrig` and redo the last step if the player fell
 * into the well (level 1). Doing it by hand takes 30 seconds.
 */
export async function origToDeepnight(): Promise<void> {
  await holdOrig('KeyK', 'k', 75);
  await w(300);
  await planOrig(
    [
      [0, 'right', 1],
      [1300, 'right', 0],
    ],
    1600,
  );
  await planOrig(
    [
      [0, 'right', 1],
      [30, 'jump', 1],
      [430, 'jump', 0],
      [700, 'right', 0],
    ],
    1300,
  );
  await planOrig(
    [
      [0, 'right', 1],
      [30, 'jump', 1],
      [430, 'jump', 0],
      [260, 'right', 0],
    ],
    1200,
  );
  await planOrig(
    [
      [0, 'right', 1],
      [30, 'jump', 1],
      [430, 'jump', 0],
      [200, 'right', 0],
    ],
    1200,
  );
  // On the well's left post: over the well to the door
  await planOrig(
    [
      [0, 'jump', 1],
      [40, 'right', 1],
      [440, 'jump', 0],
      [2600, 'right', 0],
    ],
    3600,
  );
}

// ---------------------------------------------------------------- pictures

async function save(c: HTMLCanvasElement, name: string): Promise<string> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  await fetch(`/__save?file=${name}.png`, { method: 'POST', body: blob });
  return `.cache/level-sheets/${name}.png`;
}

function drawPort(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fw: number,
  fh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const app = g().pixiApp;
  const fr = app.screen.clone();
  fr.x = x;
  fr.y = y;
  fr.width = fw;
  fr.height = fh;
  const pc = app.renderer.extract.canvas({
    target: app.stage,
    frame: fr,
    resolution: (dw / fw) * 1.5,
  });
  ctx.drawImage(pc, 0, 0, pc.width, pc.height, dx, dy, dw, dh);
}

function drawOrig(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fw: number,
  fh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const src = ruffleCanvas();
  const sx = src.width / 1408;
  ctx.drawImage(src, (ORIG.x + x * K) * sx, y * K * sx, fw * K * sx, fh * K * sx, dx, dy, dw, dh);
}

/**
 * A strip of `n` frames `dt` ms apart: the port on top (stepped), the original below (real time).
 * `rows`: 'both', 'port' or 'orig'.
 */
export async function strip(
  name: string,
  n = 6,
  dt = 1000,
  width = 200,
  rows: 'both' | 'port' | 'orig' = 'both',
) {
  const h = Math.round((width * H) / W);
  const both = rows === 'both';
  const out = document.createElement('canvas');
  out.width = width * n + (n - 1) * 4;
  out.height = both ? h * 2 + 4 : h;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#f0f';
  ctx.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    if (rows !== 'orig') {
      if (i > 0) step(Math.round((dt * 32) / 1000));
      drawPort(ctx, 0, 0, W, H, i * (width + 4), 0, width, h);
    }
    if (rows !== 'port') {
      drawOrig(ctx, 0, 0, W, H, i * (width + 4), both ? h + 4 : 0, width, h);
      const left = dt - (performance.now() - t0);
      if (i < n - 1 && left > 0) await w(left);
    }
  }
  return save(out, name);
}

/** One frame of each game, side by side (`width` each). */
export async function shot(name: string, width = 300, rows: 'both' | 'port' | 'orig' = 'both') {
  return strip(name, 1, 0, width, rows);
}

/** Close-up of the same area in both games (game coordinates), port left, original right. */
export async function zoom(
  name: string,
  x: number,
  y: number,
  fw: number,
  fh: number,
  z = 6,
  ox = x,
  oy = y,
) {
  const out = document.createElement('canvas');
  out.width = fw * z * 2 + 6;
  out.height = fh * z;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#f0f';
  ctx.fillRect(0, 0, out.width, out.height);
  drawPort(ctx, x, y, fw, fh, 0, 0, fw * z, fh * z);
  drawOrig(ctx, ox, oy, fw, fh, fw * z + 6, 0, fw * z, fh * z);
  return save(out, name);
}

/** The entities of a type in the port, as `[class, x, y]`. */
export function list(type: number): (string | number)[][] {
  return (session() as any)
    .getList(type)
    .map((e: any) => [e.constructor.name, Math.round(e.x), Math.round(e.y)]);
}
