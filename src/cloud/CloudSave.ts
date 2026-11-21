import type { FirebaseApp } from 'firebase/app';
import type { AppCheck } from 'firebase/app-check';
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
  /** Loaded with the rest when App Check has a key; turned on by `protect()`. */
  appCheckLib: typeof import('firebase/app-check') | null;
};

/** Milliseconds between a change and its upload. */
const PUSH_DELAY = 5000;
/** How often a signed-in page looks for saves that changed. */
const CHECK_EVERY = 15000;
/** Google's reCAPTCHA Enterprise script, as Firebase App Check loads it. */
const RECAPTCHA_URL = 'https://www.google.com/recaptcha/enterprise.js?render=explicit';
/** Milliseconds the script may take before App Check stays off for now. */
const RECAPTCHA_WAIT = 10000;

/**
 * The optional cloud save (not a port: the hammerfest.fr server kept the player's data). The
 * saves stay in `localStorage`; a player signed in with Google also has them in Firestore,
 * `saves/{uid}`, merged with the other devices' (`merge.ts`). Firebase loads only with the settings
 * page (its sign-in button), or at launch for a player who was signed in.
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
  /** Firebase once loaded, so a press can open Google's popup at once. */
  private ready: Sdk | null = null;
  /** The sync under way. */
  private running: Promise<void> | null = null;
  /** Set while the account is being deleted: no sync may write the save again. */
  private deleting = false;
  private user: User | null = null;
  /** App Check, once Google's reCAPTCHA script loaded. */
  private appCheck: AppCheck | null = null;
  private protecting: Promise<void> | null = null;
  /** The last try to load reCAPTCHA failed (an ad blocker, or offline). */
  private blocked = false;
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

  /** Google's reCAPTCHA guards the requests (App Check): the settings page says so. */
  get recaptcha(): boolean {
    return this.available && APP_CHECK_SITE_KEY !== '';
  }

  /** At launch: a player who was signed in is signed in again, and synced. */
  restore(): void {
    if (!this.available || !this.meta.uid) return;
    this.setState({ kind: 'busy' });
    void this.firebase()
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

  /**
   * Loads Firebase ahead of a press, with an App Check token (the settings page shows the
   * buttons). Google's popups wait for that token before they open, and Safari blocks a popup
   * opened after a wait.
   */
  preload(): void {
    if (!this.available) return;
    this.firebase()
      .then((s) => {
        if (this.appCheck) return s.appCheckLib?.getToken(this.appCheck);
      })
      .catch(() => {});
  }

  async signIn(): Promise<void> {
    if (!this.available || this.syncing || this.user) return;
    const popup = this.popup((s) =>
      s.authLib.signInWithPopup(s.auth, new s.authLib.GoogleAuthProvider()),
    );
    this.setState({ kind: 'busy' });
    try {
      const { user } = await popup;
      // Another account's progress on this device: the player chooses before anything merges,
      // and the account is remembered only then
      const other =
        this.meta.lastUid !== null &&
        this.meta.lastUid !== user.uid &&
        !isNewProfile(this.readLocal().snap.profile);
      this.signedIn(user, !other);
      if (other) {
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
    const user = this.user;
    if (this.state.kind !== 'choose' || !user) return;
    this.setState({ kind: 'busy' });
    if (!keepDevice) {
      try {
        const { db, fs } = await this.firebase();
        const got = await fs.getDoc(fs.doc(db, 'saves', user.uid));
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
    this.saveMeta({ uid: user.uid });
    this.startTimers();
    await this.sync();
  }

  async signOut(): Promise<void> {
    if (!this.sdk || this.deleting) return;
    const { auth } = await this.load();
    await auth.signOut().catch(() => {});
    this.signedOut();
  }

  /** Deletes the cloud save and the account, and signs out. This device keeps its saves. */
  async deleteCloudSave(): Promise<void> {
    const user = this.user;
    if (!user || this.deleting) return;
    // Deleting an account needs a recent sign-in: Google asks again, in the press itself
    const reauth = this.popup((s) =>
      s.authLib.reauthenticateWithPopup(user, new s.authLib.GoogleAuthProvider()),
    );
    this.deleting = true;
    this.stopTimers();
    this.setState({ kind: 'busy' });
    try {
      await reauth;
      await this.running;
      const { db, fs, authLib } = await this.firebase();
      await fs.deleteDoc(fs.doc(db, 'saves', user.uid));
      await authLib.deleteUser(user);
      this.saveMeta({ lastUid: null });
      this.signedOut();
    } catch (e) {
      this.startTimers();
      if (code(e) === 'auth/popup-closed-by-user' || code(e) === 'auth/cancelled-popup-request') {
        this.setState({ kind: 'synced', at: this.meta.lastSync });
      } else this.fail(e);
    } finally {
      this.deleting = false;
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
  sync(): Promise<void> {
    const user = this.user;
    // Only a confirmed account syncs (`meta.uid` waits for the choice of `choose`)
    if (!user || this.deleting || this.meta.uid !== user.uid || this.state.kind === 'choose') {
      return Promise.resolve();
    }
    if (this.syncing) {
      this.again = true;
      return Promise.resolve();
    }
    if (this.isBusy()) {
      this.dirty = true;
      return Promise.resolve();
    }
    this.syncing = true;
    this.dirty = false;
    this.setState({ kind: 'busy' });
    this.running = this.runSync(user).finally(() => (this.running = null));
    return this.running;
  }

  private async runSync(user: User): Promise<void> {
    try {
      const { db, fs } = await this.firebase();
      const before = this.readLocal();
      this.notePrefs(before);
      before.snap.settingsAt = this.meta.settingsAt;
      const ref = fs.doc(db, 'saves', user.uid);
      const merged = await fs.runTransaction(db, async (tx) => {
        const got = await tx.get(ref);
        const remote = got.exists() ? fromCloudDoc(got.data(), this.lang()) : null;
        const m = mergeSnapshots(before.snap, remote, this.quests);
        if (!remote || !sameSnapshot(m, remote)) tx.set(ref, toCloudDoc(m, fs.serverTimestamp()));
        return m;
      });
      // The cloud has the merge; this device takes it unless its saves changed meanwhile
      if (this.readLocal().raw !== before.raw || this.isBusy()) this.dirty = true;
      else if (!sameSnapshot(merged, before.snap)) this.apply(before.snap, merged);
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

  /** `remember`: kept for the next launch (not before the player chose whose progress to keep). */
  private signedIn(user: User, remember = true): void {
    this.user = user;
    this.email = user.email ?? '';
    // No timer while the player chooses whose progress to keep: a push then would merge
    if (!remember) return;
    this.saveMeta({ uid: user.uid });
    this.startTimers();
  }

  private signedOut(): void {
    this.user = null;
    this.email = '';
    this.stopTimers();
    this.saveMeta({ uid: null });
    this.setState({ kind: 'signedOut' });
  }

  private startTimers(): void {
    this.checkTimer ??= setInterval(() => {
      if (this.syncing) return;
      this.checkLocal();
      if (this.dirty) this.markDirty();
    }, CHECK_EVERY);
  }

  private stopTimers(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.checkTimer = this.pushTimer = null;
  }

  /**
   * Opens one of Google's popups. With Firebase loaded it opens in the press itself; Safari
   * blocks a popup opened after a wait.
   */
  private popup<T>(open: (s: Sdk) => Promise<T>): Promise<T> {
    return this.ready ? open(this.ready) : this.load().then(open);
  }

  private fail(e: unknown): void {
    console.warn('Cloud save:', e);
    // Refused while reCAPTCHA could not load: Firestore wants the App Check token
    const refused = code(e) === 'permission-denied' || code(e) === 'unauthenticated';
    this.setState({ kind: 'error', code: this.blocked && refused ? 'recaptcha-blocked' : code(e) });
  }

  private setState(s: CloudState): void {
    this.state = s;
    this.onChange?.();
  }

  /** Firebase, loaded the first time it is needed. */
  private load(): Promise<Sdk> {
    this.sdk ??= (async () => {
      const [appLib, authLib, fs, appCheckLib] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore/lite'),
        APP_CHECK_SITE_KEY ? import('firebase/app-check') : null,
      ]);
      const app = appLib.initializeApp(FIREBASE_CONFIG);
      const auth = authLib.getAuth(app);
      this.ready = { app, auth, db: fs.getFirestore(app), authLib, fs, appCheckLib };
      return this.ready;
    })();
    this.sdk.catch(() => (this.sdk = null));
    return this.sdk;
  }

  /** Firebase with App Check on, or off for now if Google's script could not load. */
  private async firebase(): Promise<Sdk> {
    const s = await this.load();
    await this.protect(s);
    return s;
  }

  /**
   * Turns App Check on once Google's reCAPTCHA script has loaded. Firebase would wait forever
   * for a script that an ad blocker or a lost connection stops, and every request with it; so
   * the script is loaded here first, and App Check stays off until a later call manages to (the
   * requests then go without a token, which Firestore refuses once App Check is enforced).
   */
  private protect(s: Sdk): Promise<void> {
    const lib = s.appCheckLib;
    if (!lib || this.appCheck) return Promise.resolve();
    this.protecting ??= loadRecaptcha().then((ok) => {
      this.protecting = null;
      this.blocked = !ok;
      if (!ok || this.appCheck) return;
      if (isLocalhost()) {
        // The key does not list localhost: the debug provider, with a token from the console
        (
          globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }
        ).FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
      }
      // No refresh in the background: a token is fetched when a request needs one, and when the
      // settings page shows (`preload`), so idle pages use none of the free assessments
      this.appCheck = lib.initializeAppCheck(s.app, {
        provider: new lib.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: false,
      });
    });
    return this.protecting;
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

/**
 * Loads Google's reCAPTCHA Enterprise script. False when it fails or takes longer than
 * `RECAPTCHA_WAIT`; a script that still arrives later is used by the next call.
 */
function loadRecaptcha(): Promise<boolean> {
  const loaded = () =>
    Boolean((globalThis as { grecaptcha?: { enterprise?: unknown } }).grecaptcha?.enterprise);
  if (loaded()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    const done = (ok: boolean) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (!ok) script.remove();
      resolve(ok && loaded());
    };
    const timer = setTimeout(() => done(false), RECAPTCHA_WAIT);
    script.onload = () => done(true);
    script.onerror = () => done(false);
    script.async = true;
    script.src = RECAPTCHA_URL;
    document.head.appendChild(script);
  });
}

function isLocalhost(): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

/** Two snapshots that make the same cloud document. */
function sameSnapshot(a: CloudSnapshot, b: CloudSnapshot): boolean {
  return JSON.stringify(toCloudDoc(a, 0)) === JSON.stringify(toCloudDoc(b, 0));
}

function code(e: unknown): string {
  return (e as { code?: unknown })?.code && typeof (e as { code: unknown }).code === 'string'
    ? (e as { code: string }).code
    : 'unknown';
}
