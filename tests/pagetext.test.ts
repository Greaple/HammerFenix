import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/ui/Language';
import { PAGE_TEXT_KEYS } from '../src/ui/PageText';

describe('page texts', () => {
  it('has every key in every language', () => {
    const en = [...PAGE_TEXT_KEYS.en].sort();
    for (const l of LANGS) expect([...PAGE_TEXT_KEYS[l]].sort()).toEqual(en);
  });
});
