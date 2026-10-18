// Appli Android TV native « Movix TV » : adresses du manifeste et de l'APK,
// publiés dans le dépôt MovixOpenSource (dossier app-tv/).

export const TV_APP_MANIFEST_URL = 'https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app-tv/version.json';
export const TV_APP_APK_URL = 'https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app-tv/movix-tv.apk';

// Code court de l'appli Downloader (AFTVnews), qui pointe vers l'APK. La page
// l'affiche avec l'adresse de l'APK en secours ; à null, seule l'adresse reste.
export const TV_APP_DOWNLOADER_CODE: string | null = '8674383';

/** Manifeste publié avec l'APK (`app-tv/version.json`). Tous les champs sont facultatifs côté site. */
export interface TvAppManifest {
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
  apkSize?: number;
  apkSha256?: string;
  minSdk?: number;
  notes?: { fr?: string; en?: string };
}
