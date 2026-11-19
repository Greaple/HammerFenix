import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore/lite';
import { BINDINGS_KEY, loadBindings, saveBindings } from '../engine/Bindings';
import { loadSettings, saveSettings, SETTINGS_KEY } from '../game/GameParameters';
import { SAVE_KEY } from '../game/GameSession';
import { decodeProfile, encodeProfile, PROFILE_KEY } from '../game/Profile';
import { newProfile, type QuestEngine } from '../game/Quests';
import { fromCloudDoc, readSave, toCloudDoc } from './CloudDoc';
import { APP_CHECK_SITE_KEY, FIREBASE_CONFIG } from './firebaseConfig';
import { type CloudSnapshot, isNewProfile, mergeSnapshots } from './merge';

/** `localStorage` key of the cloud save's own state on this device. */
export const CLOUD_KEY = 'igorsquest_cloud_v1';

/** What the settings page shows. */
export type CloudState =
  | { kind: 'off' }
  | { kind: 'signedOut' }
  | { kind: 'busy' }
  | { kind: 'synced'; at: number }
  | { kind: 'error'; code: string }
  /** Another account than the last one on this device: the player chooses whose progress to keep. */
  | { kind: 'choose' };

interface CloudMeta {
  /** The account signed in, restored at the next launch; null when signed out. */
  uid: string | null;
  /** The last account this device synced with, kept after signing out. */
  lastUid: string | null;
  /** When the preferences last changed on this device, in ms; 0 if never seen changing. */
  settingsAt: number;
  /** The preferences as last seen, to notice a change. */
  prefs: string;
  lastSync: number;
}

interface Local {
  snap: CloudSnapshot;
  /** The four saves as stored, to notice a change. */
  raw: string;
}

type Sdk = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  authLib: typeof import('firebase/auth');
  fs: typeof import('firebase/firestore/lite');
};

/** Milliseconds between a change and its upload. */
const PUSH_DELAY = 5000;
/** How often a signed-in page looks for saves that changed. */
const CHECK_EVERY = 15000;

/**
 * The optional cloud save (not a port: the hammerfest.fr server kept the player's data). The
 * saves stay in `localStorage`; a player signed in with Google also has them in Firestore,
 * `saves/{uid}`, merged with the other devices' (`merge.ts`). Firebase loads only once the player
 * signs in, or at launch for a player who was signed in.
 */
export class CloudSave {
  state: CloudState;
  /** The signed-in account's address, shown on the settings page. */
  email = '';
  /** Called when `state` changes. */
  onChange: (() => void) | null = null;
  /** True while a game plays: the saves are not touched then. */
  isBusy: () => boolean = () => false;
  /** Called after a sync changed the saves, to read them again. */
  onApplied: ((before: CloudSnapshot, after: CloudSnapshot) => void) | null = null;

  private readonly quests: QuestEngine;
  private readonly lang: () => string;
  private meta: CloudMeta;
  private sdk: Promise<Sdk> | null = null;
  private user: User | null = null;
  private dirty = false;
  private syncing = false;
  private again = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private lastRaw = '';

  constructor(quests: QuestEngine, lang: () => string) {
    this.quests = quests;
    this.lang = lang;
    this.meta = this.loadMeta();
    this.state = FIREBASE_CONFIG.apiKey ? { kind: 'signedOut' } : { kind: 'off' };
    this.notePrefs(this.readLocal());
  }

  get available(): boolean {
    return this.state.kind !== 'off';
  }

  get signedInNow(): boolean {
    return this.user !== null;
  }

  /** At launch: a player who was signed in is signed in again, and synced. */
  restore(): void {
    if (!this.available || !this.meta.uid) return;
    this.setState({ kind: 'busy' });
    void this.load()
      .then(async ({ auth }) => {
        await auth.authStateReady();
        const user = auth.currentUser;
        if (user && user.uid === this.meta.uid) {
          this.signedIn(user);
          await this.sync();
        } else {
          this.saveMeta({ uid: null });
          this.setState({ kind: 'signedOut' });
        }
      })
      .catch((e) => this.fail(e));
  }

  async signIn(): Promise<void> {
    if (!this.available || this.syncing) return;
    this.setState({ kind: 'busy' });
    try {
      const { auth, authLib } = await this.load();
      const { user } = await authLib.signInWithPopup(auth, new authLib.GoogleAuthProvider());
      this.signedIn(user);
      const local = this.readLocal();
      if (
        this.meta.lastUid &&
        this.meta.lastUid !== user.uid &&
        !isNewProfile(local.snap.profile)
      ) {
        this.setState({ kind: 'choose' });
        return;
      }
      await this.sync();
    } catch (e) {
      if (code(e) === 'auth/popup-closed-by-user' || code(e) === 'auth/cancelled-popup-request') {
        this.setState({ kind: 'signedOut' });
      } else this.fail(e);
    }
  }

  /**
   * The answer to `choose`: `keepDevice` merges this device's progress into the account,
   * otherwise this device takes the account's save (a new profile if it has none).
   */
  async choose(keepDevice: boolean): Promise<void> {
    if (this.state.kind !== 'choose' || !this.user) return;
    if (!keepDevice) {
      this.setState({ kind: 'busy' });
      try {
        const { db, fs } = await this.load();
        const got = await fs.getDoc(fs.doc(db, 'saves', this.user.uid));
        const before = this.readLocal();
        const remote = got.exists() ? fromCloudDoc(got.data(), this.lang()) : null;
        const fresh: CloudSnapshot = {
          ...before.snap,
          profile: newProfile(),
          save: { ...before.snap.save, highScore: 0, highestLevel: {} },
        };
        this.apply(before.snap, remote ?? fresh);
      } catch (e) {
        this.fail(e);
        return;
      }
    }
    await this.sync();
  }

  async signOut(): Promise<void> {
    if (!this.sdk) return;
    const { auth } = await this.load();
    await auth.signOut().catch(() => {});
    this.signedOut();
  }

  /** Deletes the cloud save and the account, and signs out. This device keeps its saves. */
  async deleteCloudSave(): Promise<void> {
    const user = this.user;
    if (!user) return;
    this.setState({ kind: 'busy' });
    try {
      const { db, fs, authLib } = await this.load();
      await fs.deleteDoc(fs.doc(db, 'saves', user.uid));
      try {
        await authLib.deleteUser(user);
      } catch (e) {
        if (code(e) !== 'auth/requires-recent-login') throw e;
        await authLib.reauthenticateWithPopup(user, new authLib.GoogleAuthProvider());
        await authLib.deleteUser(user);
      }
      this.saveMeta({ lastUid: null });
      this.signedOut();
    } catch (e) {
      this.fail(e);
    }
  }

  /** The saves changed: upload them soon. */
  markDirty(): void {
    this.dirty = true;
    if (!this.user || this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.sync();
    }, PUSH_DELAY);
  }

  /** The page is being hidden or closed: upload now what changed. */
  flush(): void {
    if (!this.user) return;
    this.checkLocal();
    if (this.dirty) void this.sync();
  }

  /** Merges this device's saves with the cloud's, and keeps the result on both. */
  async sync(): Promise<void> {
    const user = this.user;
    if (!user || this.state.kind === 'choose') return;
    if (this.syncing) {
      this.again = true;
      return;
    }
    if (this.isBusy()) {
      this.dirty = true;
      return;
    }
    this.syncing = true;
    this.dirty = false;
    this.setState({ kind: 'busy' });
    try {
      const { db, fs } = await this.load();
      const before = this.readLocal();
      this.notePrefs(before);
      before.snap.settingsAt = this.meta.settingsAt;
      const ref = fs.doc(db, 'saves', user.uid);
      const merged = await fs.runTransaction(db, async (tx) => {
        const got = await tx.get(ref);
        const remote = got.exists() ? fromCloudDoc(got.data(), this.lang()) : null;
        const m = mergeSnapshots(before.snap, remote, this.quests);
        tx.set(ref, toCloudDoc(m, fs.serverTimestamp()));
        return m;
      });
      // The cloud has the merge; this device takes it unless its saves changed meanwhile
      if (this.readLocal().raw === before.raw && !this.isBusy()) this.apply(before.snap, merged);
      else this.dirty = true;
      this.lastRaw = this.readLocal().raw;
      this.saveMeta({ lastUid: user.uid, lastSync: Date.now() });
      this.setState({ kind: 'synced', at: this.meta.lastSync });
    } catch (e) {
      this.dirty = true;
      this.fail(e);
    } finally {
      this.syncing = false;
      if (this.again || this.dirty) {
        this.again = false;
        if (this.state.kind !== 'error') this.markDirty();
      }
    }
  }

  // ------------------------------------------------------------------ Local saves

  /** This device's saves as stored. */
  private readLocal(): Local {
    const get = (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    };
    const rawProfile = get(PROFILE_KEY);
    const rawSave = get(SAVE_KEY);
    let save: unknown = null;
    try {
      save = rawSave ? JSON.parse(rawSave) : null;
    } catch {
      // damaged: the defaults
    }
    const snap: CloudSnapshot = {
      profile: (rawProfile && decodeProfile(rawProfile)) || newProfile(),
      save: readSave(save, this.lang()),
      settings: loadSettings(),
      controls: loadBindings(),
      settingsAt: this.meta.settingsAt,
    };
    return {
      snap,
      raw: JSON.stringify([rawProfile, rawSave, get(SETTINGS_KEY), get(BINDINGS_KEY)]),
    };
  }

  /** Writes a sync's result to this device, through the same savers the game uses. */
  private apply(before: CloudSnapshot, after: CloudSnapshot): void {
    if (before === after) return;
    try {
      localStorage.setItem(PROFILE_KEY, encodeProfile(after.profile));
      let stored: Record<string, unknown> = {};
      try {
        stored = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') ?? {};
      } catch {
        // damaged: rewritten
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify({ ...stored, ...after.save }));
    } catch {
      // storage full or blocked: the cloud keeps the merge
    }
    saveSettings(after.settings);
    saveBindings(after.controls);
    this.meta.settingsAt = after.settingsAt;
    this.notePrefs(this.readLocal(), false);
    this.onApplied?.(before, after);
  }

  /** Notes a change of the preferences, and when it happened. */
  private notePrefs(local: Local, dated = true): void {
    const s = local.snap;
    const prefs = JSON.stringify([s.settings, s.controls, s.save.preferredLang, s.save.muted]);
    if (prefs === this.meta.prefs) return;
    const first = this.meta.prefs === '';
    this.saveMeta({ prefs, settingsAt: dated && !first ? Date.now() : this.meta.settingsAt });
  }

  /** Looks for saves changed since the last sync. */
  private checkLocal(): void {
    const local = this.readLocal();
    this.notePrefs(local);
    if (local.raw !== this.lastRaw) this.dirty = true;
  }

  // ------------------------------------------------------------------ Account

  private signedIn(user: User): void {
    this.user = user;
    this.email = user.email ?? '';
    this.saveMeta({ uid: user.uid });
    this.checkTimer ??= setInterval(() => {
      if (this.syncing) return;
      this.checkLocal();
      if (this.dirty) this.markDirty();
    }, CHECK_EVERY);
  }

  private signedOut(): void {
    this.user = null;
    this.email = '';
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.checkTimer = this.pushTimer = null;
    this.saveMeta({ uid: null });
    this.setState({ kind: 'signedOut' });
  }

  private fail(e: unknown): void {
    console.warn('Cloud save:', e);
    this.setState({ kind: 'error', code: code(e) });
  }

  private setState(s: CloudState): void {
    this.state = s;
    this.onChange?.();
  }

  /** Firebase, loaded the first time it is needed. */
  private load(): Promise<Sdk> {
    this.sdk ??= (async () => {
      const [appLib, authLib, fs] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore/lite'),
      ]);
      const app = appLib.initializeApp(FIREBASE_CONFIG);
      if (APP_CHECK_SITE_KEY) {
        const ac = await import('firebase/app-check');
        ac.initializeAppCheck(app, {
          provider: new ac.ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
      }
      return { app, auth: authLib.getAuth(app), db: fs.getFirestore(app), authLib, fs };
    })();
    this.sdk.catch(() => (this.sdk = null));
    return this.sdk;
  }

  private loadMeta(): CloudMeta {
    const meta: CloudMeta = { uid: null, lastUid: null, settingsAt: 0, prefs: '', lastSync: 0 };
    try {
      const v = JSON.parse(localStorage.getItem(CLOUD_KEY) ?? 'null') as Partial<CloudMeta> | null;
      if (v && typeof v === 'object') {
        if (typeof v.uid === 'string') meta.uid = v.uid;
        if (typeof v.lastUid === 'string') meta.lastUid = v.lastUid;
        if (typeof v.settingsAt === 'number') meta.settingsAt = v.settingsAt;
        if (typeof v.prefs === 'string') meta.prefs = v.prefs;
        if (typeof v.lastSync === 'number') meta.lastSync = v.lastSync;
      }
    } catch {
      // storage blocked or damaged: start over
    }
    return meta;
  }

  private saveMeta(change: Partial<CloudMeta>): void {
    Object.assign(this.meta, change);
    try {
      localStorage.setItem(CLOUD_KEY, JSON.stringify(this.meta));
    } catch {
      // storage blocked: this page only
    }
  }
}

function code(e: unknown): string {
  return (e as { code?: unknown })?.code && typeof (e as { code: unknown }).code === 'string'
    ? (e as { code: string }).code
    : 'unknown';
}
