import { describe, expect, it } from 'vitest';
import { renameOldKeys } from '../src/engine/StorageRename';

/** A `Storage` over a map, in insertion order. */
function memoryStorage(init: Record<string, string>, full = false): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

function entries(s: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < s.length; i++) out[s.key(i)!] = s.getItem(s.key(i)!)!;
  return out;
}

describe('the HammerFenix saves under the Igor’s Quest keys', () => {
  it('moves every old key to the new name', () => {
    const s = memoryStorage({
      hammerfenix_save_v1: '{"muted":true}',
      hammerfenix_profile_v1: 'abc',
      hammerfenix_settings_v1: 's',
      hammerfenix_controls_v1: 'c',
      hammerfenix_hd_v1: '2',
      hammerfenix_intro_v1: '1',
      'hammerfenix.dev': '1',
      other: 'x',
    });
    expect(renameOldKeys(s)).toBe(7);
    expect(entries(s)).toEqual({
      other: 'x',
      igorsquest_save_v1: '{"muted":true}',
      igorsquest_profile_v1: 'abc',
      igorsquest_settings_v1: 's',
      igorsquest_controls_v1: 'c',
      igorsquest_hd_v1: '2',
      igorsquest_intro_v1: '1',
      'igorsquest.dev': '1',
    });
  });

  it('keeps a key already saved under the new name', () => {
    const s = memoryStorage({ hammerfenix_profile_v1: 'old', igorsquest_profile_v1: 'new' });
    expect(renameOldKeys(s)).toBe(0);
    expect(entries(s)).toEqual({ igorsquest_profile_v1: 'new' });
  });

  it('does nothing without old keys or without storage', () => {
    const s = memoryStorage({ igorsquest_save_v1: '{}', hammerfenixish: 'y' });
    expect(renameOldKeys(s)).toBe(0);
    expect(entries(s)).toEqual({ igorsquest_save_v1: '{}', hammerfenixish: 'y' });
    expect(renameOldKeys(null)).toBe(0);
  });

  it('keeps the old key when the storage is full', () => {
    const s = memoryStorage({ hammerfenix_profile_v1: 'abc' }, true);
    expect(renameOldKeys(s)).toBe(0);
    expect(entries(s)).toEqual({ hammerfenix_profile_v1: 'abc' });
  });
});
