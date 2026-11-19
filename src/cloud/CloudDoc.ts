import { loadBindings } from '../engine/Bindings';
import { loadSettings } from '../game/GameParameters';
import { decodeProfile, encodeProfile } from '../game/Profile';
import { newProfile } from '../game/Quests';
import type { CloudSaveData, CloudSnapshot } from './merge';

/** The version of the cloud document's format. */
export const CLOUD_DOC_VERSION = 1;

/**
 * The Firestore document `saves/{uid}` (fields checked by `firestore.rules`). The profile is the
 * same `PersistCodec` string as in `localStorage`, with its CRC. The controls are a JSON string,
 * as Firestore has no arrays in arrays.
 */
export interface CloudDoc {
  v: number;
  profile: string;
  save: CloudSaveData;
  settings: Record<string, number>;
  controls: string;
  settingsAt: number;
  updatedAt: unknown;
}

export function toCloudDoc(s: CloudSnapshot, updatedAt: unknown): CloudDoc {
  return {
    v: CLOUD_DOC_VERSION,
    profile: encodeProfile(s.profile),
    save: {
      highScore: s.save.highScore,
      highestLevel: { ...s.save.highestLevel },
      preferredLang: s.save.preferredLang,
      muted: s.save.muted,
    },
    settings: { ...s.settings },
    controls: JSON.stringify(s.controls),
    settingsAt: s.settingsAt,
    updatedAt,
  };
}

/**
 * A cloud document read back, every field checked as the local loaders check theirs. A damaged
 * profile counts as a new one, so a merge keeps this device's.
 */
export function fromCloudDoc(data: unknown, fallbackLang: string): CloudSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<Record<keyof CloudDoc, unknown>>;
  if (d.v !== CLOUD_DOC_VERSION) return null;
  const profile = (typeof d.profile === 'string' && decodeProfile(d.profile)) || newProfile();
  return {
    profile,
    save: readSave(d.save, fallbackLang),
    settings: loadSettings(oneItem(JSON.stringify(d.settings ?? null))),
    controls: loadBindings(oneItem(typeof d.controls === 'string' ? d.controls : null)),
    settingsAt:
      typeof d.settingsAt === 'number' && Number.isFinite(d.settingsAt) ? d.settingsAt : 0,
  };
}

/** `igorsquest_save_v1`'s fields, each checked. */
export function readSave(v: unknown, fallbackLang: string): CloudSaveData {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof CloudSaveData, unknown>>;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);
  const highestLevel: Record<string, number> = {};
  if (s.highestLevel && typeof s.highestLevel === 'object') {
    for (const [set, level] of Object.entries(s.highestLevel)) highestLevel[set] = num(level);
  }
  return {
    highScore: num(s.highScore),
    highestLevel,
    preferredLang: typeof s.preferredLang === 'string' ? s.preferredLang : fallbackLang,
    muted: s.muted === true,
  };
}

/** A storage holding one value under every key, for the loaders that read from a `Storage`. */
function oneItem(value: string | null): Storage {
  return { getItem: () => value } as unknown as Storage;
}
