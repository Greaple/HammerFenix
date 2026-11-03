/**
 * Port of Motion Twin's `BitCodec` (mtypes/lib/BitCodec.mt).
 *
 * Packs and unpacks arbitrary bit fields into a custom base-64 alphabet:
 *   a-z => 0..25, A-Z => 26..51, 0-9 => 52..61, '-' => 62, '_' => 63
 *
 * Also maintains a rolling CRC identical to the original implementation, so
 * that encoded strings stay byte-compatible with the Flash game.
 */
export class BitCodec {
  errorFlag = false;
  private nbits = 0;
  private bits = 0;
  data = '';
  inPos = 0;
  private crc = 0;

  constructor(data = '') {
    this.setData(data);
  }

  setData(d: string): void {
    this.errorFlag = false;
    this.data = d;
    this.inPos = 0;
    this.nbits = 0;
    this.bits = 0;
    this.crc = 0;
  }

  crcStr(): string {
    const c = this.crc;
    return (
      BitCodec.c64(c & 63) +
      BitCodec.c64((c >> 6) & 63) +
      BitCodec.c64((c >> 12) & 63) +
      BitCodec.c64((c >> 18) & 63)
    );
  }

  read(n: number): number {
    while (this.nbits < n) {
      const c = BitCodec.d64(this.data.charAt(this.inPos++));
      if (this.inPos > this.data.length || c === null) {
        this.errorFlag = true;
        return -1;
      }
      this.updateCrc(c);
      this.nbits += 6;
      // Keep the accumulator small: only the low `nbits` bits are meaningful.
      // (AS2 relied on 32-bit int wrap; masking preserves identical results.)
      this.bits = ((this.bits << 6) | c) & 0x3fffffff;
    }
    this.nbits -= n;
    return (this.bits >> this.nbits) & ((1 << n) - 1);
  }

  nextPart(): void {
    this.nbits = 0;
  }

  hasError(): boolean {
    return this.errorFlag;
  }

  toString(): string {
    if (this.nbits > 0) this.write(6 - this.nbits, 0);
    return this.data;
  }

  write(n: number, b: number): void {
    this.nbits += n;
    this.bits = ((this.bits << n) | b) & 0x3fffffff;
    while (this.nbits >= 6) {
      this.nbits -= 6;
      const k = (this.bits >> this.nbits) & 63;
      this.updateCrc(k);
      this.data += BitCodec.c64(k);
    }
  }

  private updateCrc(c: number): void {
    // crc ^= c; crc &= 0xFFFFFF; crc *= c;  (AS2 Number semantics, then int ops)
    this.crc ^= c;
    this.crc &= 0xffffff;
    this.crc = (this.crc * c) | 0;
  }

  static d64(code: string): number | null {
    if (code.length !== 1) return null;
    if (code >= 'a' && code <= 'z') return code.charCodeAt(0) - 97;
    if (code >= 'A' && code <= 'Z') return code.charCodeAt(0) - 65 + 26;
    if (code >= '0' && code <= '9') return code.charCodeAt(0) - 48 + 52;
    if (code === '-') return 62;
    if (code === '_') return 63;
    return null;
  }

  static c64(code: number): string {
    if (code < 0) return '?';
    if (code < 26) return String.fromCharCode(code + 97);
    if (code < 52) return String.fromCharCode(code - 26 + 65);
    if (code < 62) return String.fromCharCode(code - 52 + 48);
    if (code === 62) return '-';
    if (code === 63) return '_';
    return '?';
  }
}
