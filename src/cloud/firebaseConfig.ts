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
 * The reCAPTCHA v3 site key of App Check, which keeps scripts that copy the config above from
 * using the project's quota. Empty: no App Check.
 */
export const APP_CHECK_SITE_KEY = '';
