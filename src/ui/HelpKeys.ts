import { type Bindings, DEFAULT_BINDINGS, keyName } from '../engine/Bindings';
import type { PlayerAction } from '../engine/Input';
import { padButtonOf } from '../game/gui/PadGlyphs';

/**
 * The help dialog's rows for the moves, set to the player's keys and buttons (G.4). A row whose
 * keys are the defaults keeps the page's own markup ("← → · A D · Q D"); a changed one lists
 * the first slot's keys as keycaps and the second slot's after a dot. Controller buttons are
 * `kbd[data-pad]`, which `main.ts` fills with the icons of the controller in use.
 */
export function showHelpKeys(b: Bindings, lang: string): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLElement>('[data-help-keys]').forEach((el) => {
    const moves = movesOf(el.dataset.helpKeys);
    keep(el);
    if (moves.every((m) => same(b.keys[m], DEFAULT_BINDINGS.keys[m]))) {
      el.innerHTML = el.dataset.defaultHtml!;
      return;
    }
    const first = moves.flatMap((m) => b.keys[m][0]);
    const second = moves.flatMap((m) => b.keys[m][1]);
    const caps = first.map((kc) =>
      kc === 32
        ? '<kbd class="wide" data-i18n="spaceKey"></kbd>'
        : `<kbd>${escape(keyName(kc, lang) ?? '?')}</kbd>`,
    );
    const alt = second.map((kc) => escape(keyName(kc, lang) ?? '?')).join(' ');
    el.innerHTML = caps.join(' ') + (alt ? ` <span class="alt">· ${alt}</span>` : '');
  });
  document.querySelectorAll<HTMLElement>('[data-help-pad]').forEach((el) => {
    const moves = movesOf(el.dataset.helpPad);
    keep(el);
    if (moves.every((m) => same([b.pad[m]], [DEFAULT_BINDINGS.pad[m]]))) {
      el.innerHTML = el.dataset.defaultHtml!;
      return;
    }
    const buttons = moves.flatMap((m) => b.pad[m]).map(padButtonOf);
    el.innerHTML = buttons
      .map((p) => (p ? `<kbd class="pad" data-pad="${p}"></kbd>` : ''))
      .join(' ');
  });
}

/** The moves of a row: "move" is left and right. */
function movesOf(row: string | undefined): PlayerAction[] {
  return row === 'move' ? ['left', 'right'] : [row as PlayerAction];
}

/** Keeps the page's own markup of a row, the first time. */
function keep(el: HTMLElement): void {
  el.dataset.defaultHtml ??= el.innerHTML;
}

function same(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
  return a.length === b.length && a.every((s, i) => s.join() === b[i].join());
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
