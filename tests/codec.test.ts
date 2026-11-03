import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BitCodec } from '../src/engine/codec/BitCodec';
import { PersistCodec, type PersistValue } from '../src/engine/codec/PersistCodec';

const LEVELS_DIR = join(__dirname, '../assets-src/original/xml/levels');

describe('BitCodec', () => {
  it('maps the custom base64 alphabet both ways', () => {
    for (let i = 0; i < 64; i++) expect(BitCodec.d64(BitCodec.c64(i))).toBe(i);
    expect(BitCodec.d64('$')).toBeNull();
    expect(BitCodec.c64(64)).toBe('?');
  });

  it('round-trips arbitrary bit fields', () => {
    const fields: [number, number][] = [
      [1, 1],
      [3, 5],
      [16, 0xbeef],
      [7, 99],
      [2, 2],
      [16, 1],
    ];
    const w = new BitCodec();
    for (const [n, v] of fields) w.write(n, v);
    const r = new BitCodec(w.toString());
    for (const [n, v] of fields) expect(r.read(n)).toBe(v);
    expect(r.hasError()).toBe(false);
  });

  it('flags reads past the end of data', () => {
    const r = new BitCodec('a');
    r.read(6);
    expect(r.read(1)).toBe(-1);
    expect(r.hasError()).toBe(true);
  });
});

describe('PersistCodec', () => {
  const roundTrip = (v: PersistValue) => new PersistCodec().decode(new PersistCodec().encode(v));

  it.each<[string, PersistValue]>([
    ['small int', 3],
    ['medium int', 1234],
    ['big int', 123456789],
    ['negative int', -42],
    ['float', 3.25],
    ['negative float', -0.001],
    ['true', true],
    ['false', false],
    ['null', null],
    ['b64 string', 'hammer_Fest-01'],
    ['ascii string', 'Hello, world! <$do/>'],
    ['latin1 string', 'Clé de Méluzzine'],
    ['empty string', ''],
    ['nested', { $map: [[1, 0], [2]], $name: 'x', list: [{ a: 1 }, { a: 2, b: [true] }] }],
  ])('round-trips %s', (_, v) => {
    expect(roundTrip(v)).toEqual(v);
  });

  it('round-trips special numbers', () => {
    expect(roundTrip(NaN)).toBeNaN();
    expect(roundTrip(Infinity)).toBe(Infinity);
    expect(roundTrip(-Infinity)).toBe(-Infinity);
  });

  it('preserves array holes as jumps', () => {
    const a: PersistValue[] = [];
    a[0] = 1;
    a[5] = 2;
    a[9] = null;
    const out = roundTrip(a) as PersistValue[];
    expect(out[0]).toBe(1);
    expect(out[5]).toBe(2);
    expect(out[3]).toBeUndefined();
  });

  it('supports obfuscation mode and CRC', () => {
    const codec = new PersistCodec({ obfuMode: true, crc: true });
    const s = codec.encode({ $score: 1500, $name: 'igor' });
    expect(s).not.toContain('$');
    expect(new PersistCodec({ obfuMode: true, crc: true }).decode(s)).toEqual({
      $score: 1500,
      $name: 'igor',
    });
    // Corrupted CRC is rejected.
    const bad = s.slice(0, -1) + (s.endsWith('a') ? 'b' : 'a');
    expect(new PersistCodec({ obfuMode: true, crc: true }).decode(bad)).toBeNull();
  });

  describe('original level sets', () => {
    const files = readdirSync(LEVELS_DIR).filter((f) => f.endsWith('.xml'));

    it.each(files)('%s decodes and re-encodes byte-for-byte', (file) => {
      const raw = readFileSync(join(LEVELS_DIR, file), 'utf8')
        .replace(/^\uFEFF/, '')
        .trim();
      for (const chunk of raw.split(':')) {
        const level = new PersistCodec().decode<Record<string, unknown>>(chunk);
        expect(level).not.toBeNull();
        expect(level!.$map).toHaveLength(20);
        expect(new PersistCodec().encode(level as PersistValue)).toBe(chunk);
      }
    });
  });
});
