/**
 * The game was named HammerFenix until 2026-11-19, and kept its saves under `hammerfenix_*` keys
 * (and the dev switch under `hammerfenix.dev`). Same site, so the same storage: the first page
 * loaded under the new name, Igor's Quest, moves each of them to its `igorsquest_*` key, so a
 * player keeps their profile, settings, controls and choices. A key already set under the new
 * name wins. Not a port.
 *
 * `main.ts` imports this module first, so it runs before anything reads the storage.
 */
const OLD = 'hammerfenix';
const NEW = 'igorsquest';

/** Moves the old keys of `storage` to the new name; returns how many were copied. */
export function renameOldKeys(storage: Storage | null): number {
  if (!storage) return 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      const sep = k?.charAt(OLD.length);
      if (k?.startsWith(OLD) && (sep === '_' || sep === '.')) keys.push(k);
    }
  } catch {
    return 0;
  }
  let moved = 0;
  for (const k of keys) {
    try {
      const to = NEW + k.slice(OLD.length);
      const value = storage.getItem(k);
      if (value !== null && storage.getItem(to) === null) {
        storage.setItem(to, value);
        moved++;
      }
      // Only once the new key holds it (a full storage throws, and keeps the old key)
      storage.removeItem(k);
    } catch {
      // Storage refused: this key stays under its old name
    }
  }
  return moved;
}

function pageStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

renameOldKeys(pageStorage());
