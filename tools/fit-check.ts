/**
 * Dev check that every site screen fits the window (UI redesign, "every screen fits its
 * window"). Not part of the game: in the dev server's page,
 * `const f = await import('/tools/fit-check.ts'); await f.check()` opens each screen in each
 * language with its fullest content and returns what breaks the contract:
 *
 * - away from phones, nothing scrolls but the page's own `[data-scroll]` region, and the
 *   document never does;
 * - at most one element scrolls (on a phone, the page itself);
 * - every focusable element (`[data-nav]`), the title plank and the main button are inside the
 *   window and not cut by a box around them;
 * - nothing pokes out of its board, no text is wider than its box, no text under the floor size.
 *
 * Content is pushed to its worst in memory only (every quest shown, the biggest item family,
 * a results page full of items); nothing is saved. Window sizes are set from outside (the
 * browser's own window, or the pane's viewport emulation).
 */

type Failure = { lang: string; screen: string; layout: string; msg: string };

const MIN_FONT = 11;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const g = () => window as any;

function rectOf(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

function label(el: Element): string {
  const e = el as HTMLElement;
  const nav = e.dataset?.nav;
  if (nav) return `[${nav}]`;
  const cls = typeof e.className === 'string' ? e.className.split(' ')[0] : '';
  const text = (e.textContent ?? '').trim().slice(0, 24);
  return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
}

function visible(el: Element): boolean {
  if (el.closest('.sr-only')) return false;
  const r = rectOf(el);
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
}

function scrolls(el: Element): boolean {
  const cs = getComputedStyle(el);
  return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
}

function clips(el: Element): boolean {
  const cs = getComputedStyle(el);
  return cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
}

/** The areas the current screen draws into. */
function roots(): HTMLElement[] {
  return [
    '#site-modes',
    '#site-book',
    '#site-below',
    '#frame-overlay',
    '#site-page',
    '#site-tabbar',
  ]
    .map((s) => document.querySelector<HTMLElement>(s))
    .filter((e): e is HTMLElement => !!e && visible(e));
}

/** What breaks the contract on the screen showing now. */
export function inspect(): string[] {
  const out: string[] = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const phone = document.body.dataset.layout === 'phone';
  const doc = document.scrollingElement ?? document.documentElement;
  if (doc.scrollHeight > H + 1) out.push(`document is ${doc.scrollHeight - H}px taller`);

  // Scrolling areas
  const scrollers = [...document.querySelectorAll('body *')].filter(
    (e) => visible(e) && scrolls(e),
  );
  for (const s of scrollers) {
    // The page's own area; on a phone, or past the densest step, the page itself
    const ok =
      s.hasAttribute('data-scroll') ||
      s.matches('.site-page.is-scrolling, .site-side.is-scrolling') ||
      ((phone || document.body.dataset.layout === 'tall') &&
        s.matches('.site-page, .app-container'));
    if (!ok) out.push(`scrolls: ${label(s)} (${s.clientHeight}/${s.scrollHeight})`);
  }
  if (scrollers.length > 1) out.push(`${scrollers.length} areas scroll`);

  const top = document.querySelector('.topbar');
  const topBottom = top ? rectOf(top).bottom : 0;
  const tabbar = document.querySelector('.tabbar-inner');
  const bottom = tabbar && visible(tabbar) ? rectOf(tabbar).top : H;

  for (const root of roots()) {
    // Focusable things and the main pieces: in the window, not cut by a box around them
    const keys = root.querySelectorAll(
      '[data-nav], [data-scroll], .plank, .btn-start, .btn-continue',
    );
    for (const el of keys) {
      if (!visible(el)) continue;
      const r = rectOf(el);
      const inScroll =
        el.parentElement?.closest('[data-scroll], .is-scrolling') ??
        (phone || document.body.dataset.layout === 'tall'
          ? el.closest('.site-page, .app-container')
          : null);
      // The main button stays in view everywhere (pinned where the page scrolls)
      if (!inScroll || el.matches('.btn-start')) {
        if (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) {
          out.push(`outside the window: ${label(el)} ${fmtRect(r)}`);
          continue;
        }
        if (!el.closest('.site-tabbar') && r.bottom > bottom + 1) {
          out.push(`under the tab bar: ${label(el)}`);
        }
      }
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        // Inside a scrolling area, the area is what is checked
        if (a === inScroll) break;
        if (!clips(a)) continue;
        const ar = rectOf(a);
        if (
          r.left < ar.left - 1 ||
          r.right > ar.right + 1 ||
          r.top < ar.top - 1 ||
          r.bottom > ar.bottom + 1
        ) {
          out.push(`cut by ${label(a)}: ${label(el)}`);
          break;
        }
      }
    }
    for (const p of root.querySelectorAll('.plank')) {
      if (visible(p) && rectOf(p).top < topBottom - 2) out.push(`plank under the top bar`);
    }

    // Nothing pokes out of its board sideways, no text wider than its box, no tiny text
    for (const board of root.querySelectorAll('.board')) {
      if (!visible(board)) continue;
      const br = rectOf(board);
      for (const el of board.querySelectorAll('*')) {
        // The plank stands over the edge; a stamp is still scaling in; a pinned button is
        // over the page, not in its board
        if (!visible(el) || el.closest('.plank, .veil, .stamp')) continue;
        if (pinned(el, board)) continue;
        const r = rectOf(el);
        if (r.left < br.left - 1 || r.right > br.right + 1) {
          out.push(`sticks out of ${label(board)}: ${label(el)}`);
          break;
        }
        if (!el.closest('[data-scroll]') && r.bottom > br.bottom + 1 && !el.closest('.melted')) {
          out.push(`below ${label(board)}'s bottom: ${label(el)}`);
          break;
        }
      }
    }
    for (const el of root.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
      );
      if (!own) continue;
      const cs = getComputedStyle(el);
      // The size as drawn: a zoomed box (`Shell.fitPage`, the frame's scale) draws it smaller
      const size = parseFloat(cs.fontSize) * zoomOf(el);
      if (size < MIN_FONT) out.push(`small text ${size.toFixed(1)}px: ${label(el)}`);
      if (el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline' && el.clientWidth > 0) {
        out.push(`text wider than its box: ${label(el)}`);
      }
      const split = brokenWord(el);
      if (split) out.push(`word broken across lines "${split}": ${label(el)}`);
    }
  }

  // The frame: whole, and not under the touch controls
  const frame = document.querySelector('.game-canvas-container');
  if (document.body.dataset.page === 'playing' && (!frame || !visible(frame))) {
    out.push('no frame while playing');
  }
  if (frame && visible(frame) && document.body.dataset.page !== 'page') {
    const fr = rectOf(frame);
    if (fr.left < -1 || fr.right > W + 1 || fr.top < -1 || fr.bottom > H + 1) {
      out.push(`frame outside the window ${fmtRect(fr)}`);
    }
    for (const c of document.querySelectorAll('.pad-key, .touch-btn, .play-tools')) {
      if (!visible(c)) continue;
      const cr = rectOf(c);
      if (cr.left < -1 || cr.right > W + 1 || cr.top < -1 || cr.bottom > H + 1) {
        out.push(`control outside the window: ${label(c)} ${fmtRect(cr)}`);
      }
      if (
        cr.right > fr.left + 1 &&
        cr.left < fr.right - 1 &&
        cr.bottom > fr.top + 1 &&
        cr.top < fr.bottom - 1
      ) {
        out.push(`over the frame: ${label(c)}`);
      }
    }
  }
  return [...new Set(out)];
}

/** The zoom `el` is drawn at: the product of its own and its boxes' `zoom`. */
function zoomOf(el: Element): number {
  let z = 1;
  for (let a: Element | null = el; a; a = a.parentElement) {
    const v = parseFloat(getComputedStyle(a).zoom);
    if (v > 0) z *= v;
  }
  return z;
}

/**
 * A word of `el`'s own text that the browser cut across two lines (a name too long for its
 * card), or null. Hyphens and slashes are places a word may break.
 */
function brokenWord(el: Element): string | null {
  for (const n of el.childNodes) {
    if (n.nodeType !== Node.TEXT_NODE) continue;
    const text = n.textContent ?? '';
    for (const m of text.matchAll(/[^\s\-/]+/g)) {
      const range = document.createRange();
      range.setStart(n, m.index);
      range.setEnd(n, m.index + m[0].length);
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      if (tops.size > 1) return m[0];
    }
  }
  return null;
}

/** Whether `el`, or a box around it inside `board`, is pinned to the window. */
function pinned(el: Element, board: Element): boolean {
  for (let a: Element | null = el; a && a !== board; a = a.parentElement) {
    if (getComputedStyle(a).position === 'fixed') return true;
  }
  return false;
}

function fmtRect(r: DOMRect): string {
  return `(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`;
}

async function setLang(id: string): Promise<void> {
  const sel = document.getElementById('lang-select') as HTMLSelectElement | null;
  if (!sel || sel.value === id) return;
  sel.value = id;
  sel.dispatchEvent(new Event('change'));
  await wait(600);
}

/** A results page as full as a long game makes it. */
function bigResult(): unknown {
  const item2: number[] = [];
  for (let i = 0; i < 40; i++) item2[i * 3] = 1 + (i % 7);
  for (let i = 0; i < 30; i++) item2[1000 + i * 2] = 2 + i;
  return {
    kind: 'gameOver',
    score: 8684323,
    runId: null,
    stats: { reachedLevel: 54, item2, data: [] },
    uniqueItems: 70,
  };
}

type Scene = { name: string; open: () => void | Promise<void> };

function scenes(): Scene[] {
  const s = g().shell;
  const q = s.profile.quests;
  const out: Scene[] = [];
  const modes: string[] = [
    'solo',
    'multicoop',
    'timeattack',
    'multitime',
    'bossrush',
    'soccer',
    'tutorial',
  ];
  for (const m of modes) {
    out.push({
      name: `home ${m}`,
      open: () => {
        s.chosen = m;
        s.focusKey = `mode:${m}`;
        s.showMenu();
      },
    });
    out.push({
      name: `home ${m} hint`,
      open: () => {
        s.chosen = m;
        s.showMenu();
        const opt = document.querySelector<HTMLElement>('[data-nav^="opt:"], [data-nav^="run:"]');
        if (!opt) return;
        s.focusKey = opt.dataset.nav;
        s.showHint();
      },
    });
  }
  for (const tab of ['progress', 'done', 'all']) {
    out.push({
      name: `quests ${tab}`,
      open: () => {
        s.showQuests();
        s.questTab = tab;
        s.questId = s.questList()[0] ?? null;
        s.render();
      },
    });
  }
  out.push({
    name: 'quests biggest',
    open: () => {
      s.showQuests();
      s.questTab = 'all';
      const ids: number[] = s.questList();
      ids.sort((a, b) => q.requirements(b).length - q.requirements(a).length);
      s.questId = ids[0] ?? null;
      s.render();
    },
  });
  for (const f of ['all', 'almost', 'never']) {
    out.push({
      name: `fridge ${f}`,
      open: () => {
        s.showFridge();
        s.fridgeFilter = f;
        s.fridgePage = 0;
        s.fridgeId = s.fridgeIds()[0] ?? null;
        s.render();
      },
    });
  }
  out.push({
    name: 'fridge biggest family',
    open: () => {
      s.showFridge();
      let best: number | null = null;
      let size = 0;
      for (const id of q.itemIds as number[]) {
        const fid = q.familyOf(id);
        const n = fid === undefined ? 0 : q.itemsOf(fid).length;
        if (n > size) {
          size = n;
          best = id;
        }
      }
      s.fridgeId = best;
      s.render();
    },
  });
  out.push({ name: 'settings', open: () => s.showSettings() });
  out.push({ name: 'controls', open: () => s.showControls() });
  out.push({ name: 'sound', open: () => s.showSound(() => s.showMenu()) });
  out.push({
    name: 'result',
    open: () => {
      const quests = (q.quests as { id: number }[]).slice(0, 4).map((x) => x.id);
      const fridge = (q.itemIds as number[]).slice(0, 6);
      s.showResult(bigResult(), { quests, fridge });
    },
  });
  out.push({
    name: 'result one quest',
    open: () => {
      const quests = (q.quests as { id: number }[]).slice(0, 1).map((x) => x.id);
      s.showResult(bigResult(), { quests, fridge: [(q.itemIds as number[])[0]] });
    },
  });
  out.push({
    name: 'time result',
    open: () =>
      s.showResult(
        {
          kind: 'gameOver',
          score: 0,
          runId: 0,
          stats: { reachedLevel: 3, item2: null, data: null },
          uniqueItems: 0,
        },
        null,
        {
          mode: 'timeattack',
          runId: 0,
          time: 123456,
          best: 120000,
          isNew: true,
        },
      ),
  });
  return out;
}

/**
 * Opens every screen in each language of `langs` and returns what breaks the contract.
 * `only` keeps the screens whose name starts with it.
 */
export async function check(
  opts: { langs?: string[]; only?: string; settle?: number } = {},
): Promise<{ size: string; failures: Failure[] }> {
  const s = g().shell;
  const q = s.profile.quests;
  const sel = document.getElementById('lang-select') as HTMLSelectElement | null;
  const lang0 = sel?.value ?? 'fr';
  const chosen0 = s.chosen;
  // Every quest shown, in memory only
  const status0 = q.status;
  q.status = (p: unknown, id: number) => {
    const real = status0.call(q, p, id);
    return real === 'none' ? 'progress' : real;
  };
  // Items found, in memory only: a new profile would show none of the counts and names
  const data = s.profile.data;
  const items0 = data.items;
  const items = Array.isArray(items0) ? [...items0] : { ...items0 };
  for (const id of q.itemIds as number[]) {
    if (!items[id] && id % 3 !== 0) items[id] = 1 + (id % 12);
  }
  data.items = items;
  const failures: Failure[] = [];
  try {
    for (const lang of opts.langs ?? ['fr', 'en', 'es']) {
      await setLang(lang);
      for (const sc of scenes()) {
        if (opts.only && !sc.name.startsWith(opts.only)) continue;
        await sc.open();
        await wait(opts.settle ?? 120);
        const layout = `${document.body.dataset.page}/${document.body.dataset.layout}`;
        for (const msg of inspect()) failures.push({ lang, screen: sc.name, layout, msg });
      }
    }
  } finally {
    q.status = status0;
    data.items = items0;
    await setLang(lang0);
    s.chosen = chosen0;
    s.focusKey = `mode:${chosen0}`;
    s.showMenu();
  }
  return { size: `${window.innerWidth}x${window.innerHeight}`, failures };
}

/** The failures grouped by message, with the screens and languages they show on. */
export function summary(failures: Failure[]): string[] {
  const by = new Map<string, Set<string>>();
  for (const f of failures) {
    const key = f.msg.replace(/\(\d+\/\d+\)|\(.*?\)/g, '').trim();
    if (!by.has(key)) by.set(key, new Set());
    by.get(key)!.add(`${f.screen}:${f.lang}`);
  }
  return [...by].map(
    ([k, v]) => `${k}  <- ${[...v].slice(0, 6).join(', ')}${v.size > 6 ? ` +${v.size - 6}` : ''}`,
  );
}

/**
 * Starts an Adventure game, checks the playing page (the frame whole, the toolbar or the touch
 * controls beside it, not over it), and goes back to the home page. `touch` marks the page as a
 * touch screen first, as a phone or tablet does.
 */
export async function checkPlaying(opts: { touch?: boolean } = {}): Promise<string[]> {
  const s = g().shell;
  const session = g().gameSession;
  const root = document.documentElement;
  const touch0 = root.classList.contains('touch');
  if (opts.touch) root.classList.add('touch');
  try {
    s.chosen = 'solo';
    s.startChosen();
    await wait(3000);
    return inspect();
  } finally {
    session.stop?.();
    s.showMenu();
    root.classList.toggle('touch', touch0);
    await wait(300);
  }
}
