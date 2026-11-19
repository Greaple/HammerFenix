import type { Bindings } from '../engine/Bindings';
import type { PlayerSettings } from '../game/GameParameters';
import { encodeProfile } from '../game/Profile';
import { newProfile, type ProfileData, type QuestEngine } from '../game/Quests';

/** The part of `igorsquest_save_v1` (`GameSaveData`) the cloud keeps. */
export interface CloudSaveData {
  highScore: number;
  highestLevel: Record<string, number>;
  preferredLang: string;
  muted: boolean;
}

/** One device's saves, or the cloud's: what a merge combines. */
export interface CloudSnapshot {
  profile: ProfileData;
  save: CloudSaveData;
  settings: PlayerSettings;
  controls: Bindings;
  /** When the preferences (settings, controls, language, sound switch) last changed, in ms; 0 if never. */
  settingsAt: number;
}

/**
 * Combines this device's saves with the cloud's (not a port: the site kept one copy on its
 * server). Progress only grows, so it keeps the most of each side: item counts, games and scores
 * at their highest, best times at their lowest. The quests and what they give are replayed, not
 * joined, as quests also take families away. The preferences come from the side that changed
 * them last. Two devices that play offline from the same save do not add up their finds: each
 * item keeps the higher count.
 */
export function mergeSnapshots(
  local: CloudSnapshot,
  remote: CloudSnapshot | null,
  quests: QuestEngine,
): CloudSnapshot {
  if (!remote) return local;
  const prefs = local.settingsAt > remote.settingsAt ? local : remote;
  const highestLevel: Record<string, number> = { ...remote.save.highestLevel };
  for (const [set, level] of Object.entries(local.save.highestLevel)) {
    highestLevel[set] = Math.max(highestLevel[set] ?? 0, level);
  }
  return {
    profile: mergeProfiles(local.profile, remote.profile, quests),
    save: {
      highScore: Math.max(local.save.highScore, remote.save.highScore),
      highestLevel,
      preferredLang: prefs.save.preferredLang,
      muted: prefs.save.muted,
    },
    settings: prefs.settings,
    controls: prefs.controls,
    settingsAt: prefs.settingsAt,
  };
}

/** A profile with nothing played: a new player's. */
export function isNewProfile(p: ProfileData): boolean {
  return (
    p.games === 0 &&
    p.quests.length === 0 &&
    !p.items.some((n) => n > 0) &&
    Object.values(p.times).every((list) => !list.some((t) => t != null))
  );
}

/**
 * The two profiles combined. When one side is new or both are the same, the other is kept as
 * it is; otherwise the profile is rebuilt from a new one.
 */
export function mergeProfiles(a: ProfileData, b: ProfileData, quests: QuestEngine): ProfileData {
  if (isNewProfile(b) || encodeProfile(a) === encodeProfile(b)) return a;
  if (isNewProfile(a)) return b;
  // The quests of the side with more, in the order they were done there, then the other's
  const [base, other] = a.quests.length >= b.quests.length ? [a, b] : [b, a];
  const p = newProfile();
  quests.replay(p, base.quests);
  quests.replay(p, other.quests);
  const items: number[] = [];
  for (const src of [a.items, b.items]) {
    src.forEach((n, id) => {
      if (n > 0) items[id] = Math.max(items[id] ?? 0, n);
    });
  }
  p.items = items;
  p.games = Math.max(a.games, b.games);
  for (const src of [a.times, b.times]) {
    for (const [mode, list] of Object.entries(src)) {
      const out = (p.times[mode] ??= []);
      list.forEach((t, run) => {
        if (t != null) out[run] = out[run] == null ? t : Math.min(out[run], t);
      });
    }
  }
  // Quests the items of both sides complete together
  quests.check(p);
  // The menu ticks of the side that played most
  p.chosen = [...(a.games >= b.games ? a : b).chosen];
  return p;
}
