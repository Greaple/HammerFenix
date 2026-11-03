import { BitCodec } from './BitCodec';

/**
 * Port of Motion Twin's `PersistCodec` (mtypes/lib/PersistCodec.mt).
 *
 * Serializes a JSON-like value graph into a compact bit stream encoded with
 * {@link BitCodec}. Used by Hammerfest for level data, cookies and saves.
 *
 * Type bits:
 *   int 00 | float 010 | NaN 0110 | +Inf 01110 | -Inf 01111
 *   array 100 | object 101 | false 1100 | true 1101 | string 1110 | null 1111
 *
 * The original decoder runs incrementally (one field per loop iteration); its
 * traversal is depth-first, which is exactly what this recursive version does.
 */
export type PersistValue =
  number | boolean | string | null | undefined | PersistValue[] | { [key: string]: PersistValue };

export interface PersistCodecOptions {
  /** Strip/restore the `$` prefix of field names (MotionTypes obfuscation mode). */
  obfuMode?: boolean;
  /** Append/verify a 4-char CRC at the end of the stream. */
  crc?: boolean;
}

export class PersistCodec {
  private readonly obfuMode: boolean;
  private readonly crc: boolean;

  private bc = new BitCodec();
  private fields = new Map<string, number>();
  private fieldTbl: string[] = [];
  private nfields = 0;
  private nextFieldBits = 1;
  private nfieldsBits = 0;

  constructor(options: PersistCodecOptions = {}) {
    this.obfuMode = options.obfuMode ?? false;
    this.crc = options.crc ?? false;
  }

  // ---------------------------------------------------------------- decoding

  decode<T = PersistValue>(data: string): T | null {
    this.bc = new BitCodec(data);
    this.fieldTbl = [];
    this.nfields = 0;
    this.nextFieldBits = 1;
    this.nfieldsBits = 0;

    const result = this.doDecode();
    if (this.bc.errorFlag) return null;
    if (this.crc) {
      const expected = this.bc.crcStr();
      const actual = this.bc.data.substr(this.bc.inPos, 4);
      if (expected !== actual) return null;
    }
    return result as T;
  }

  private doDecode(): PersistValue {
    const bc = this.bc;
    if (bc.read(1) === 0) {
      // number
      if (bc.read(1) === 1) {
        // float / special
        if (bc.read(1) === 1) {
          if (bc.read(1) === 1) {
            return bc.read(1) === 1 ? -Infinity : Infinity;
          }
          return NaN;
        }
        return this.decodeFloat();
      }
      return this.decodeInt();
    }
    if (bc.read(1) === 0) {
      return bc.read(1) === 1 ? this.decodeObject() : this.decodeArray();
    }
    switch (bc.read(2)) {
      case 0:
        return false;
      case 1:
        return true;
      case 2:
        return this.decodeString();
      default:
        return null;
    }
  }

  private decodeInt(): number {
    const bc = this.bc;
    const nbits = bc.read(2);
    if (nbits === 3) {
      if (bc.read(1) === 1) return -this.decodeInt();
      if (bc.read(1) === 1) {
        const lo = bc.read(16);
        const hi = bc.read(16);
        return lo | (hi << 16);
      }
      return bc.read(16);
    }
    return bc.read((nbits + 1) * 2);
  }

  private decodeFloat(): number {
    const len = this.bc.read(5);
    let s = '';
    for (let i = 0; i < len; i++) {
      const k = this.bc.read(4);
      if (k < 10) s += String.fromCharCode(k + 48);
      else if (k === 10) s += '.';
      else if (k === 11) s += '+';
      else if (k === 12) s += '-';
      else s += 'e';
    }
    return parseFloat(s);
  }

  private decodeString(): string {
    const bc = this.bc;
    const len = this.decodeInt();
    let s = '';
    if (bc.read(1) === 0) {
      for (let i = 0; i < len; i++) s += BitCodec.c64(bc.read(6));
    } else {
      const ascii = bc.read(1) === 0;
      const width = ascii ? 7 : 8;
      for (let i = 0; i < len; i++) s += String.fromCharCode(bc.read(width));
    }
    return s;
  }

  private decodeArray(): PersistValue[] {
    const bc = this.bc;
    const a: PersistValue[] = [];
    let pos = 0;
    for (;;) {
      if (bc.read(1) === 0) {
        a[pos++] = this.doDecode();
      } else {
        if (bc.read(1) === 1) break;
        pos += this.decodeInt();
        // Preserve trailing holes so `.length` matches the original.
        if (pos > a.length) a.length = pos;
      }
      if (bc.errorFlag) break;
    }
    return a;
  }

  private decodeObject(): { [key: string]: PersistValue } {
    const bc = this.bc;
    const o: { [key: string]: PersistValue } = {};
    for (;;) {
      let k: string;
      if (bc.read(1) === 0) {
        k = this.fieldTbl[bc.read(this.nfieldsBits)] ?? '';
      } else {
        if (bc.read(1) === 1) break;
        k = this.decodeString();
        if (this.obfuMode && k.charAt(0) !== '$') k = '$' + k;
        this.fieldTbl[this.nfields++] = k;
        this.growFieldBits();
      }
      o[k] = this.doDecode();
      if (bc.errorFlag) break;
    }
    return o;
  }

  private growFieldBits(): void {
    if (this.nfields >= this.nextFieldBits) {
      this.nfieldsBits++;
      this.nextFieldBits *= 2;
    }
  }

  // ---------------------------------------------------------------- encoding

  encode(value: PersistValue): string {
    this.bc = new BitCodec();
    this.fields = new Map();
    this.nfields = 0;
    this.nextFieldBits = 1;
    this.nfieldsBits = 0;

    this.doEncode(value);
    let s = this.bc.toString();
    if (this.crc) s += this.bc.crcStr();
    return s;
  }

  private doEncode(o: PersistValue): void {
    const bc = this.bc;
    if (o === null || o === undefined) {
      bc.write(4, 15);
    } else if (Array.isArray(o)) {
      bc.write(3, 4);
      this.encodeArray(o);
    } else {
      switch (typeof o) {
        case 'string':
          bc.write(4, 14);
          this.encodeString(o);
          break;
        case 'number':
          if (Number.isNaN(o)) bc.write(4, 6);
          else if (o === Infinity) bc.write(5, 14);
          else if (o === -Infinity) bc.write(5, 15);
          else if (Number.isInteger(o) && o >= -0x80000000 && o <= 0xffffffff) {
            bc.write(2, 0);
            this.encodeInt(o);
          } else {
            bc.write(3, 2);
            this.encodeFloat(o);
          }
          break;
        case 'boolean':
          bc.write(4, o ? 13 : 12);
          break;
        default:
          bc.write(3, 5);
          this.encodeObject(o);
      }
    }
  }

  private encodeArray(a: PersistValue[]): void {
    let njumps = 0;
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (v === null || v === undefined) {
        njumps++;
      } else {
        if (njumps > 0) {
          this.bc.write(2, 2);
          this.encodeInt(njumps);
          njumps = 0;
        }
        this.bc.write(1, 0);
        this.doEncode(v);
      }
    }
    this.bc.write(2, 3);
  }

  private encodeObject(o: { [key: string]: PersistValue }): void {
    for (const key of Object.keys(o)) {
      const d = o[key];
      if (d === null || d === undefined || typeof d === 'function') continue;
      let k = key;
      if (this.obfuMode && k.charAt(0) === '$') k = k.substring(1);
      const idx = this.fields.get(k);
      if (idx !== undefined) {
        this.bc.write(1, 0);
        this.bc.write(this.nfieldsBits, idx);
      } else {
        this.fields.set(k, this.nfields++);
        this.growFieldBits();
        this.bc.write(2, 2);
        this.encodeString(k);
      }
      this.doEncode(d);
    }
    this.bc.write(2, 3);
  }

  private encodeString(s: string): void {
    let isB64 = true;
    let isAscii = true;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 127) {
        isB64 = false;
        isAscii = false;
        break;
      } else if (isB64 && BitCodec.d64(s.charAt(i)) === null) {
        isB64 = false;
      }
    }
    this.encodeInt(s.length);
    if (isB64) {
      this.bc.write(1, 0);
      for (let i = 0; i < s.length; i++) this.bc.write(6, BitCodec.d64(s.charAt(i))!);
    } else {
      this.bc.write(2, isAscii ? 2 : 3);
      const width = isAscii ? 7 : 8;
      for (let i = 0; i < s.length; i++) this.bc.write(width, s.charCodeAt(i) & 0xff);
    }
  }

  private encodeInt(o: number): void {
    const bc = this.bc;
    if (o < 0) {
      bc.write(3, 7);
      this.encodeInt(-o);
    } else if (o < 4) {
      bc.write(2, 0);
      bc.write(2, o);
    } else if (o < 16) {
      bc.write(2, 1);
      bc.write(4, o);
    } else if (o < 64) {
      bc.write(2, 2);
      bc.write(6, o);
    } else if (o < 65536) {
      bc.write(4, 12);
      bc.write(16, o);
    } else {
      bc.write(4, 13);
      bc.write(16, o & 0xffff);
      bc.write(16, (o >>> 16) & 0xffff);
    }
  }

  private encodeFloat(o: number): void {
    const s = String(o);
    this.bc.write(5, s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 48 && c <= 58) this.bc.write(4, c - 48);
      else if (c === 46) this.bc.write(4, 10);
      else if (c === 43) this.bc.write(4, 11);
      else if (c === 45) this.bc.write(4, 12);
      else this.bc.write(4, 13);
    }
  }
}
