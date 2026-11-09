import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Values the original computes at run time (from a function or the XML), not constants. */
const RUNTIME_VALUES = new Set(['manager', 'LINKAGES', 'WATCH']);

/**
 * Reads the constants of `class/hammer/Data.mt`, in order: each `static var` with a value,
 * evaluated as the Flash player would (the `auto_inc++` counters, `SECOND*30`, arrays, objects).
 * The private counters (`auto_inc`, `type_bit`...) are left out of the result.
 */
export function readOriginalData(): Map<string, unknown> {
  const file = resolve(__dirname, '../../assets-src/original/class/hammer/Data.mt');
  const src = stripComments(
    new TextDecoder('latin1').decode(readFileSync(file)).replace(/\r\n?/g, '\n'),
  );

  const decls: { name: string; expr: string; isPrivate: boolean }[] = [];
  const re = /(private\s+)?static\s+var\s+(\w+)\s*(?::[^=;\n]+)?=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // The value runs to the first `;` or line end outside brackets (some lines lack the `;`).
    let depth = 0;
    let i = re.lastIndex;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (depth === 0 && (c === ';' || c === '\n')) break;
    }
    decls.push({ name: m[2], expr: src.slice(re.lastIndex, i).trim(), isPrivate: !!m[1] });
    re.lastIndex = i;
  }

  // One function body so the counters and earlier constants are in scope for later ones.
  const body = decls
    .filter((d) => !RUNTIME_VALUES.has(d.name))
    .map((d) => `var ${d.name} = (${d.expr}); out.push([${JSON.stringify(d.name)}, ${d.name}]);`)
    .join('\n');
  const out: [string, unknown][] = [];
  new Function('out', body)(out);

  const privates = new Set(decls.filter((d) => d.isPrivate).map((d) => d.name));
  return new Map(out.filter(([name]) => !privates.has(name) && name !== 'stat_inc'));
}

function stripComments(s: string): string {
  let r = '';
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      r += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      r += c;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      r += '\n';
    } else if (c === '/' && s[i + 1] === '*') {
      i = s.indexOf('*/', i + 2) + 1;
    } else r += c;
  }
  return r;
}
