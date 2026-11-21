/**
 * The Firebase web app of the cloud save (project `igor-s-quest`). These values are public: the
 * page needs them to reach Firebase, and `firestore.rules` is what keeps each save to its owner.
 * Without an `apiKey` the settings page has no cloud save row.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCotozORF-K4bg-AqfrzfUEgu3W5yq7mbI',
  authDomain: 'igor-s-quest.firebaseapp.com',
  projectId: 'igor-s-quest',
  storageBucket: 'igor-s-quest.firebasestorage.app',
  messagingSenderId: '518039857229',
  appId: '1:518039857229:web:75e93c04188750bd0e1404',
};

/**
 * The reCAPTCHA Enterprise key of App Check (Google Cloud console, Security > reCAPTCHA), which
 * keeps scripts that copy the config above from using the project's quota: once App Check is
 * enforced for Firestore, only this site's pages reach the saves. Public too. Empty: no App Check.
 *
 * The key lists only the site's domain, as Firebase asks. On localhost App Check uses its debug
 * provider instead, with the token in `VITE_APPCHECK_DEBUG_TOKEN` (`.env.local`, never
 * committed), registered in the Firebase console (App Check > Apps > Manage debug tokens).
 */
export const APP_CHECK_SITE_KEY: string = '';
