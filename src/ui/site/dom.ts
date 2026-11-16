/**
 * A small element builder for the site pages (port addition, UI redesign D.2): the pages are
 * rebuilt from the shell's state on each change, so there is no framework to keep in sync.
 */

export type Child = Node | string | number | null | undefined | false | Child[];

export type Props = Record<string, unknown>;

/**
 * An element `tag` with `props` (`class`, `style` as text, `on<event>` listeners, any other
 * attribute; `false`, `null` and `undefined` leave an attribute out, `true` sets it empty)
 * and its children (text, nodes, nested arrays; falsy ones are skipped).
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'style') {
        el.style.cssText = String(v);
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** Replaces the children of `el`. */
export function fill(el: Element | null, ...children: Child[]): void {
  if (!el) return;
  el.replaceChildren();
  append(el, children);
}

/** An inline stroke icon (24 x 24 view box) from path data, hidden from screen readers. */
export function svgIcon(d: string, opts: { fill?: boolean; size?: number } = {}): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const size = String(opts.size ?? 22);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  if (opts.fill) {
    path.setAttribute('fill', 'currentColor');
  } else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

/** Path data of the site's few drawn icons (the rest are the game's own clips). */
export const ICON = {
  back: 'M15 6l-6 6 6 6',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  pause: 'M8 5v14M16 5v14',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  music:
    'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0zM19 16a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0z',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  giveUp: 'M5 21V4h11l-1.5 4L16 12H5',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};
