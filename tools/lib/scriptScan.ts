/**
 * Static check of level scripts (`$script` of every level in `xml/levels/`) against what
 * `levels.ScriptEngine` reads, so a level the port cannot run does not break silently.
 *
 * Finding kinds:
 * - `error`: the script is broken for the original too (bad XML, unknown node, missing value).
 * - `ignored`: an attribute the original never reads. Harmless, but it hints at a typo.
 * - `unported`: something the original runs and the port does not have yet.
 * - `note`: original behavior worth knowing when reading the script.
 */
import { parseScriptXml, ScriptRunner, type ScriptNode } from '../../src/game/levels/ScriptRunner';

export type FindingKind = 'error' | 'ignored' | 'unported' | 'note';

export interface Finding {
  set: string;
  level: number;
  kind: FindingKind;
  detail: string;
}

/** What the scan checks names and ids against. */
export interface ScanContext {
  hasSymbol(linkage: string): boolean;
  /** Languages that have no text with this id. */
  missingText(id: number): string[];
  /** Ids `GameMode.attachBad` creates. */
  badIds: Set<number>;
  /** Music tracks `Mode.playMusic` can start. */
  musicIds: Set<number>;
  specialItemIds: Set<number>;
  scoreItemIds: Set<number>;
}

const R = ScriptRunner;

/** Attributes read on every trigger (`runScript`, `executeTrigger`, `clearEndTriggers`). */
const TRIGGER_COMMON = ['$key', '$repeat', '$endClear', '$base'];

/** Attributes each node reads, as `ScriptEngine` does; the required ones come first. */
const NODES: Record<string, { required: string[]; optional: string[]; trigger?: boolean }> = {
  [R.T_TIMER]: { required: ['$t'], optional: [], trigger: true },
  [R.T_POS]: { required: ['$x', '$y', '$d'], optional: [], trigger: true },
  [R.T_ATTACH]: { required: [], optional: [], trigger: true },
  [R.T_DO]: { required: [], optional: [], trigger: true },
  [R.T_END]: { required: [], optional: [], trigger: true },
  [R.T_BIRTH]: { required: [], optional: [], trigger: true },
  [R.T_DEATH]: { required: [], optional: [], trigger: true },
  [R.T_EXPLODE]: { required: ['$x', '$y'], optional: [], trigger: true },
  [R.T_ENTER]: { required: ['$x', '$y'], optional: [], trigger: true },
  [R.T_NIGHTMARE]: { required: [], optional: [], trigger: true },
  [R.T_MIRROR]: { required: [], optional: [], trigger: true },
  [R.T_MULTI]: { required: [], optional: [], trigger: true },
  [R.T_NINJA]: { required: [], optional: [], trigger: true },

  [R.E_SCORE]: { required: ['$x', '$y', '$i'], optional: ['$si', '$inf', '$sid'] },
  [R.E_SPECIAL]: { required: ['$x', '$y', '$i'], optional: ['$si', '$inf', '$sid'] },
  [R.E_EXTEND]: { required: [], optional: [] },
  [R.E_BAD]: { required: ['$x', '$y', '$i'], optional: ['$sys', '$sid'] },
  [R.E_KILL]: { required: ['$sid'], optional: [] },
  [R.E_TUTORIAL]: { required: [], optional: ['$id'] },
  [R.E_MESSAGE]: { required: [], optional: ['$id'] },
  [R.E_KILLMSG]: { required: [], optional: [] },
  [R.E_POINTER]: { required: ['$x', '$y'], optional: [] },
  [R.E_KILLPTR]: { required: [], optional: [] },
  [R.E_MC]: { required: ['$n'], optional: ['$x', '$y', '$xr', '$yr', '$sid', '$back', '$p'] },
  [R.E_PLAYMC]: { required: ['$sid'], optional: [] },
  [R.E_MUSIC]: { required: ['$id'], optional: [] },
  [R.E_ADDTILE]: { required: ['$x1', '$y1', '$x2', '$y2'], optional: ['$type'] },
  [R.E_REMTILE]: { required: ['$x1', '$y1', '$x2', '$y2'], optional: [] },
  [R.E_ITEMLINE]: { required: ['$x1', '$x2', '$y', '$i', '$t'], optional: ['$si'] },
  [R.E_GOTO]: { required: ['$id'], optional: [] },
  [R.E_HIDE]: { required: [], optional: ['$tiles', '$borders'] },
  [R.E_HIDEBORDERS]: { required: [], optional: [] },
  [R.E_CODETRIGGER]: { required: ['$id'], optional: [] },
  [R.E_PORTAL]: { required: ['$pid'], optional: [] },
  [R.E_SETVAR]: { required: ['$var', '$value'], optional: [] },
  [R.E_OPENPORTAL]: { required: ['$x', '$y', '$pid'], optional: [] },
  [R.E_DARKNESS]: { required: ['$v'], optional: [] },
  [R.E_FAKELID]: { required: [], optional: ['$lid'] },
};

/** Attributes read as text (`getString`); every other one goes through `getInt`. */
const STRING_ATTRS = new Set(['$n', '$var', '$value']);

/** Checks every script of a level set. */
export function scanLevelSet(
  set: string,
  scripts: (string | null | undefined)[],
  badLists: { id: number }[][],
  levelCount: number,
  ctx: ScanContext,
): Finding[] {
  const out: Finding[] = [];
  scripts.forEach((script, level) => {
    const add = (kind: FindingKind, detail: string) => out.push({ set, level, kind, detail });

    for (const b of badLists[level] ?? []) {
      if (!ctx.badIds.has(b.id)) add('unported', `bad list: bad #${b.id}`);
    }
    if (!script) return;

    const errors: string[] = [];
    const nodes = parseScriptXml(script, errors);
    for (const e of errors) add('error', `XML: ${e}`);

    for (const n of nodes) {
      if (!NODES[n.name]?.trigger) {
        add('error', `<${n.name}> at the top level is not a trigger: it never fires`);
      }
      checkNode(n, null, add, levelCount, ctx);
    }
  });
  return out;
}

function checkNode(
  n: ScriptNode,
  parent: ScriptNode | null,
  add: (kind: FindingKind, detail: string) => void,
  levelCount: number,
  ctx: ScanContext,
): void {
  const def = NODES[n.name];
  if (!def) {
    add('error', `unknown node <${n.name}>`);
    return;
  }
  const known = [...def.required, ...def.optional, ...(def.trigger ? TRIGGER_COMMON : [])];
  for (const a of def.required) {
    if (n.attrs[a] === undefined) add('error', `<${n.name}> without ${a}`);
  }
  for (const [a, v] of Object.entries(n.attrs)) {
    if (!known.includes(a)) {
      add('ignored', `<${n.name}> ${a}="${v}" is never read`);
    } else if (!STRING_ATTRS.has(a) && v !== '' && Number.isNaN(parseInt(v, 10))) {
      add('error', `<${n.name}> ${a}="${v}" is not a number`);
    }
  }
  if ((n.name === R.E_TUTORIAL || n.name === R.E_MESSAGE) && n.attrs.$id === undefined) {
    add('note', `<${n.name}> uses inline text instead of a Lang id`);
  }

  const int = (a: string) => parseInt(n.attrs[a] ?? '', 10);
  switch (n.name) {
    case R.E_BAD:
      if (!ctx.badIds.has(int('$i'))) add('unported', `<${n.name}> bad #${n.attrs.$i}`);
      break;
    case R.E_MC:
      if (n.attrs.$n !== undefined && !ctx.hasSymbol(n.attrs.$n)) {
        // The library holds every symbol of the original graphics SWFs
        add('note', `<${n.name}> symbol "${n.attrs.$n}" is in no original SWF: nothing shows`);
      }
      break;
    case R.E_TUTORIAL:
    case R.E_MESSAGE:
      if (n.attrs.$id !== undefined) {
        const missing = ctx.missingText(int('$id'));
        if (missing.length > 0) {
          add(
            'note',
            `<${n.name}> text #${n.attrs.$id} is missing in ${missing.join(', ')}: no message`,
          );
        }
      }
      break;
    case R.E_MUSIC:
      if (!ctx.musicIds.has(int('$id'))) add('unported', `<${n.name}> music #${n.attrs.$id}`);
      break;
    case R.E_CODETRIGGER: {
      const id = int('$id');
      if (id in R.UNPORTED_CODE_TRIGGERS) {
        add('unported', `code trigger #${id}: ${R.UNPORTED_CODE_TRIGGERS[id]}`);
      } else if (!(id >= 0 && id <= 15)) {
        add('error', `code trigger #${n.attrs.$id} does not exist`);
      }
      break;
    }
    case R.E_GOTO:
      if (int('$id') >= levelCount) add('note', `<${n.name}> to level ${n.attrs.$id} ends the set`);
      break;
    case R.E_SPECIAL:
      if (!ctx.specialItemIds.has(int('$i'))) {
        add('error', `<${n.name}> special item #${n.attrs.$i} does not exist`);
      }
      break;
    case R.E_SCORE:
    case R.E_ITEMLINE: {
      // ScoreItem.attach takes 1000 off; the item data numbers score items from 1000
      let id = int('$i');
      if (id >= 1000) id -= 1000;
      if (!ctx.scoreItemIds.has(id + 1000)) {
        add('error', `<${n.name}> score item #${n.attrs.$i} does not exist`);
      }
      break;
    }
  }

  if (def.trigger && parent) {
    const siblings = parent.children;
    if (siblings.indexOf(n) < siblings.length - 1) {
      add(
        'note',
        `<${n.name}> nested in <${parent.name}> is moved to the script end: the events after it are skipped`,
      );
    }
    if (parent.attrs.$repeat !== undefined) {
      add('note', `<${n.name}> nested in a repeating <${parent.name}> is only added once`);
    }
  }
  for (const c of n.children) checkNode(c, n, add, levelCount, ctx);
}

/** Scans every level set in `public/data/levels` (run `npm run assets` first). */
export async function scanAllSets(root: string): Promise<Finding[]> {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { Data } = await import('../../src/game/Data');
  const { MUSIC_TRACKS } = await import('../../src/game/GameSession');
  const json = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

  const lib = json('public/gfx/library.json') as { exports: Record<string, number> };
  const langs = readdirSync(join(root, 'public/data/lang')).map(
    (f) => json(`public/data/lang/${f}`) as { id: string; statics: Record<string, string> },
  );
  const items = json('public/data/items.json') as Record<
    'special' | 'score',
    { items: { id: number }[] }[]
  >;
  const ids = (fams: { items: { id: number }[] }[]) =>
    new Set(fams.flatMap((f) => f.items.map((i) => i.id)));

  const ctx: ScanContext = {
    // SwfLibrary.attach: linkage names are tried with and without the "$" escape
    hasSymbol: (n) =>
      lib.exports[n] !== undefined ||
      lib.exports[n.startsWith('$') ? n.slice(1) : '$' + n] !== undefined,
    missingText: (id) => langs.filter((l) => l.statics[id] === undefined).map((l) => l.id),
    badIds: new Set(Data.BAD_LINKAGES.map((_, i) => i)),
    musicIds: new Set(MUSIC_TRACKS.map((_, i) => i)),
    specialItemIds: ids(items.special),
    scoreItemIds: ids(items.score),
  };

  const out: Finding[] = [];
  for (const f of readdirSync(join(root, 'public/data/levels')).sort()) {
    const set = json(`public/data/levels/${f}`) as {
      name: string;
      levels: { script?: string; badList: { id: number }[] }[];
    };
    out.push(
      ...scanLevelSet(
        set.name,
        set.levels.map((l) => l.script),
        set.levels.map((l) => l.badList),
        set.levels.length,
        ctx,
      ),
    );
  }
  return out;
}
