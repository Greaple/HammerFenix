/**
 * Minimal AVM1 (ActionScript 1/2 bytecode) interpreter for the frame scripts embedded in the
 * original SWFs.
 *
 * These scripts are short: a body part picks its frame from its owner's fields
 * (`gotoAndStop(_parent._parent.head)`), a pop-up holds a frame until a timer runs out, a clip
 * hides itself (`_visible = _parent._parent.fl_carot`). Three define functions on their clip and
 * call them from later frames: the particle emitters of the accessories and the sphinx
 * (`init`, `main`, with `duplicateMovieClip`) and the ghosts of item 86's background
 * (`newGhost`). `tools/lib/swfShapes.ts` only ships scripts whose opcodes are all handled here.
 */

/** What a script can do to the clip it runs on. Implemented by `SwfMovieClip`. */
export interface Avm1Clip {
  avmGet(name: string): unknown;
  avmSet(name: string, value: unknown): void;
  avmGetProp(index: number): unknown;
  avmSetProp(index: number, value: unknown): void;
  avmCall(name: string, args: unknown[]): unknown;
  /** `frame` is a 1-based number or a label. */
  avmGoto(frame: unknown, play: boolean): void;
  /** Float in [0, 1) for `random(n)`. Seeded by the game, so replays stay deterministic. */
  avmRandom(): number;
  play(): void;
  stop(): void;
  removeMovieClip(): void;
  /** `duplicateMovieClip`: a copy in the same parent, at `depth` (the SWF's own numbering). */
  duplicateMovieClip(name: string, depth: number): unknown;
}

/** A running action block: a frame script, or a function body. */
interface Activation {
  b: Uint8Array;
  view: DataView;
  /** The timeline whose variables the code reads and sets. */
  clip: Avm1Clip;
  thisObj: unknown;
  /** A function's local variables; null in a frame script. */
  locals: Map<string, unknown> | null;
  regs: unknown[];
  pool: string[];
}

/** A function defined by `DefineFunction` or `DefineFunction2`. */
interface FunctionDef {
  parent: Activation;
  start: number;
  size: number;
  /** Name, and the register it goes to (0: a local variable). */
  params: [string, number][];
  regCount: number;
  flags: number;
  pool: string[];
}

/** Steps left before a script and the functions it calls are stopped (guards against loops). */
const MAX_STEPS = 10000;
let steps = 0;
let runDepth = 0;

function isClip(v: unknown): v is Avm1Clip {
  return typeof v === 'object' && v !== null && 'avmGet' in v;
}

/** Original's `Timer.tmod` / `_global.tmod`: 1 at full speed. */
const GLOBAL: Record<string, unknown> = { tmod: 1 };
const TIMER = { tmod: 1 };

const decoded = new Map<string, Uint8Array>();

function decode(code: string): Uint8Array {
  let bytes = decoded.get(code);
  if (!bytes) {
    const bin = atob(code);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    decoded.set(code, bytes);
  }
  return bytes;
}

function readString(b: Uint8Array, at: number): [string, number] {
  let end = at;
  while (end < b.length && b[end] !== 0) end++;
  let s = '';
  for (let i = at; i < end; i++) s += String.fromCharCode(b[i]);
  return [s, end + 1];
}

function toNumber(v: unknown): number {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return Number(v);
}

function getMember(obj: unknown, name: string): unknown {
  if (isClip(obj)) return obj.avmGet(name);
  if (obj !== null && obj !== undefined && typeof obj === 'object') {
    return (obj as Record<string, unknown>)[name];
  }
  return undefined;
}

function setMember(obj: unknown, name: string, value: unknown): void {
  if (isClip(obj)) obj.avmSet(name, value);
  else if (obj !== null && typeof obj === 'object') (obj as Record<string, unknown>)[name] = value;
}

/** Runs one action block with `clip` as `this`. Stops after 10000 steps to guard against loops. */
export function runAvm1(code: string, clip: Avm1Clip): void {
  const b = decode(code);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (runDepth === 0) steps = 0;
  runDepth++;
  try {
    exec({ b, view, clip, thisObj: clip, locals: null, regs: [], pool: [] }, 0, b.length);
  } finally {
    runDepth--;
  }
}

/**
 * Calls a script function. `DefineFunction2`'s flags preload registers from 1, in this order:
 * `this`, `arguments`, `super`, `_root`, `_parent`, `_global` (`super` and `_root` stay
 * undefined: no script reads them).
 */
function callFunction(d: FunctionDef, thisObj: unknown, args: unknown[]): unknown {
  const self = thisObj ?? d.parent.thisObj;
  const regs: unknown[] = [];
  const locals = new Map<string, unknown>();
  const fl = d.flags;
  let r = 1;
  if (fl & 0x01) regs[r++] = self;
  if (fl & 0x04) regs[r++] = args;
  if (fl & 0x10) r++;
  if (fl & 0x40) r++;
  if (fl & 0x80) regs[r++] = d.parent.clip.avmGet('_parent');
  if (fl & 0x100) regs[r++] = GLOBAL;
  if (!(fl & 0x08)) locals.set('arguments', args);
  d.params.forEach(([name, reg], i) => {
    if (reg !== 0) regs[reg] = args[i];
    else locals.set(name, args[i]);
  });
  const a: Activation = { ...d.parent, thisObj: self, locals, regs, pool: d.pool };
  return exec(a, d.start, d.start + d.size);
}

/** Runs `a`'s code from `start` to `end`; returns what `Return` gives. */
function exec(a: Activation, start: number, end: number): unknown {
  const { b, view, clip } = a;
  const regs = a.regs;
  const stack: unknown[] = [];
  const pop = (): unknown => stack.pop();

  const getVariable = (name: string): unknown => {
    if (a.locals?.has(name)) return a.locals.get(name);
    switch (name) {
      case 'this':
        return a.thisObj;
      case '_global':
        return GLOBAL;
      case 'Math':
        return Math;
      case 'Timer':
        return TIMER;
    }
    const v = clip.avmGet(name);
    return v !== undefined ? v : GLOBAL[name];
  };

  const setVariable = (name: string, value: unknown): void => {
    if (a.locals?.has(name)) a.locals.set(name, value);
    else clip.avmSet(name, value);
  };

  const resolveTarget = (t: unknown): Avm1Clip | null => {
    if (t === '' || t === undefined || t === 'this') return clip;
    if (isClip(t)) return t;
    if (typeof t === 'string') {
      const v = getVariable(t);
      return isClip(v) ? v : null;
    }
    return null;
  };

  let pc = start;
  while (pc < end && steps++ < MAX_STEPS) {
    const op = b[pc++];
    if (op === 0x00) return undefined;
    let len = 0;
    if (op >= 0x80) {
      len = view.getUint16(pc, true);
      pc += 2;
    }
    const p = pc;
    pc += len;

    switch (op) {
      case 0x04: // NextFrame
        clip.avmCall('nextFrame', []);
        break;
      case 0x05: // PrevFrame
        clip.avmCall('prevFrame', []);
        break;
      case 0x06: // Play
        clip.play();
        break;
      case 0x07: // Stop
        clip.stop();
        break;
      case 0x0a: // Add (legacy, numeric)
      case 0x0b: // Subtract
      case 0x0c: // Multiply
      case 0x0d: {
        // Divide
        const y = toNumber(pop());
        const x = toNumber(pop());
        stack.push(op === 0x0a ? x + y : op === 0x0b ? x - y : op === 0x0c ? x * y : x / y);
        break;
      }
      case 0x10: {
        // And
        const y = pop();
        const x = pop();
        stack.push(Boolean(x) && Boolean(y));
        break;
      }
      case 0x11: {
        // Or
        const y = pop();
        const x = pop();
        stack.push(Boolean(x) || Boolean(y));
        break;
      }
      case 0x12: // Not
        stack.push(!pop());
        break;
      case 0x17: // Pop
        pop();
        break;
      case 0x18: // ToInteger
        stack.push(Math.trunc(toNumber(pop())));
        break;
      case 0x1c: // GetVariable
        stack.push(getVariable(String(pop())));
        break;
      case 0x1d: {
        // SetVariable
        const value = pop();
        setVariable(String(pop()), value);
        break;
      }
      case 0x3c: {
        // DefineLocal (a frame script has no locals: it sets the timeline's variable)
        const value = pop();
        const name = String(pop());
        if (a.locals) a.locals.set(name, value);
        else clip.avmSet(name, value);
        break;
      }
      case 0x22: {
        // GetProperty
        const index = toNumber(pop());
        const target = resolveTarget(pop());
        stack.push(target ? target.avmGetProp(index) : undefined);
        break;
      }
      case 0x23: {
        // SetProperty
        const value = pop();
        const index = toNumber(pop());
        resolveTarget(pop())?.avmSetProp(index, value);
        break;
      }
      case 0x24: {
        // CloneSprite (`duplicateMovieClip`)
        const depth = toNumber(pop());
        const name = String(pop());
        resolveTarget(pop())?.duplicateMovieClip(name, depth);
        break;
      }
      case 0x25: // RemoveSprite
        resolveTarget(pop())?.removeMovieClip();
        break;
      case 0x30: // RandomNumber
        stack.push(Math.floor(clip.avmRandom() * toNumber(pop())));
        break;
      case 0x3d: {
        // CallFunction
        const name = String(pop());
        const n = toNumber(pop());
        const args = Array.from({ length: n }, () => pop());
        const fn = getVariable(name);
        stack.push(typeof fn === 'function' ? fn.apply(clip, args) : undefined);
        break;
      }
      case 0x3e: // Return
        return pop();
      case 0x47: {
        // Add2
        const y = pop();
        const x = pop();
        stack.push(
          typeof x === 'string' || typeof y === 'string'
            ? String(x) + String(y)
            : toNumber(x) + toNumber(y),
        );
        break;
      }
      case 0x48: {
        // Less2
        const y = pop();
        const x = pop();
        stack.push(toNumber(x) < toNumber(y));
        break;
      }
      case 0x49: {
        // Equals2
        const y = pop();
        const x = pop();
        stack.push(x == y);
        break;
      }
      case 0x4c: // PushDuplicate
        stack.push(stack[stack.length - 1]);
        break;
      case 0x4e: {
        // GetMember
        const name = String(pop());
        stack.push(getMember(pop(), name));
        break;
      }
      case 0x4f: {
        // SetMember
        const value = pop();
        const name = String(pop());
        setMember(pop(), name, value);
        break;
      }
      case 0x50: // Increment
        stack.push(toNumber(pop()) + 1);
        break;
      case 0x51: // Decrement
        stack.push(toNumber(pop()) - 1);
        break;
      case 0x52: {
        // CallMethod
        const name = pop();
        const obj = pop();
        const n = toNumber(pop());
        const args = Array.from({ length: n }, () => pop());
        if (name === undefined || name === '') {
          stack.push(typeof obj === 'function' ? obj(...args) : undefined);
        } else if (isClip(obj)) {
          stack.push(obj.avmCall(String(name), args));
        } else if (obj !== null && typeof obj === 'object') {
          const fn = (obj as Record<string, unknown>)[String(name)];
          stack.push(typeof fn === 'function' ? fn.apply(obj, args) : undefined);
        } else {
          stack.push(undefined);
        }
        break;
      }
      case 0x67: {
        // Greater
        const y = pop();
        const x = pop();
        stack.push(toNumber(x) > toNumber(y));
        break;
      }
      case 0x81: // GotoFrame (0-based, stops)
        clip.avmGoto(view.getUint16(p, true) + 1, false);
        break;
      case 0x87: // StoreRegister
        regs[b[p]] = stack[stack.length - 1];
        break;
      case 0x88: {
        // ConstantPool
        const n = view.getUint16(p, true);
        let q = p + 2;
        a.pool = [];
        for (let k = 0; k < n; k++) {
          const [s, next] = readString(b, q);
          a.pool.push(s);
          q = next;
        }
        break;
      }
      case 0x8e: // DefineFunction2
      case 0x9b: {
        // DefineFunction: no registers, every parameter is a local
        const [name, q0] = readString(b, p);
        let q = q0;
        const count = view.getUint16(q, true);
        q += 2;
        let regCount = 0;
        let flags = 0;
        if (op === 0x8e) {
          regCount = b[q++];
          flags = view.getUint16(q, true);
          q += 2;
        }
        const params: [string, number][] = [];
        for (let k = 0; k < count; k++) {
          const reg = op === 0x8e ? b[q++] : 0;
          const [s, next] = readString(b, q);
          params.push([s, reg]);
          q = next;
        }
        const size = view.getUint16(q, true);
        const d: FunctionDef = {
          parent: a,
          start: pc,
          size,
          params,
          regCount,
          flags,
          pool: a.pool,
        };
        pc += size;
        const fn = function (this: unknown, ...args: unknown[]) {
          return callFunction(d, this, args);
        };
        if (name === '') stack.push(fn);
        else if (a.locals) a.locals.set(name, fn);
        else clip.avmSet(name, fn);
        break;
      }
      case 0x8c: // GoToLabel (stops)
        clip.avmGoto(readString(b, p)[0], false);
        break;
      case 0x96: {
        // Push
        let q = p;
        while (q < p + len) {
          const t = b[q++];
          switch (t) {
            case 0: {
              const [s, next] = readString(b, q);
              stack.push(s);
              q = next;
              break;
            }
            case 1:
              stack.push(view.getFloat32(q, true));
              q += 4;
              break;
            case 2:
              stack.push(null);
              break;
            case 3:
              stack.push(undefined);
              break;
            case 4:
              stack.push(regs[b[q]]);
              q += 1;
              break;
            case 5:
              stack.push(b[q] !== 0);
              q += 1;
              break;
            case 6: {
              // Double, stored high word first
              const tmp = new DataView(new ArrayBuffer(8));
              tmp.setUint32(0, view.getUint32(q + 4, true), true);
              tmp.setUint32(4, view.getUint32(q, true), true);
              stack.push(tmp.getFloat64(0, true));
              q += 8;
              break;
            }
            case 7:
              stack.push(view.getInt32(q, true));
              q += 4;
              break;
            case 8:
              stack.push(a.pool[b[q]]);
              q += 1;
              break;
            case 9:
              stack.push(a.pool[view.getUint16(q, true)]);
              q += 2;
              break;
            default:
              return undefined; // unknown type: abort the script
          }
        }
        break;
      }
      case 0x99: // Jump
        pc += view.getInt16(p, true);
        break;
      case 0x9d: // If
        if (pop()) pc += view.getInt16(p, true);
        break;
      case 0x9f: {
        // GotoFrame2
        const flags = b[p];
        clip.avmGoto(pop(), (flags & 1) !== 0);
        break;
      }
      default:
        return undefined; // unsupported opcode: the build should not ship such scripts
    }
  }
  return undefined;
}
