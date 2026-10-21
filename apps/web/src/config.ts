/**
 * Central app configuration, read from environment variables at build time.
 * See .env.example for the available variables.
 */

/**
 * Google OAuth client ID for Google Drive access.
 *
 * Created in the Google Cloud Console (APIs & Services → Credentials →
 * OAuth client ID → Web application). Required for the Drive integration;
 * not set until the OAuth client exists.
 */
export const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/**
 * Base URL of the export host — the Apps Script web app that serves a recipe's
 * HTML export to the cooking view (see apps/export-host/README.md).
 *
 * The cooking view's size picker and step navigation need its embedded script
 * to run, and the size the meal plan promised must reach the page. A Drive link
 * gives neither: Keep's in-app browser renders the stored file without letting
 * the script run and does not pass the fragment through, so the buttons stay
 * dead there. With this set, every export link points at the host, which serves
 * the file itself and takes the size as a query parameter.
 *
 * Not a secret — the URL ships in the browser bundle — and it serves only
 * `<title>.html` files from the Cookbook folder's `Exporte` subfolder. Leave it
 * empty and the app falls back to the Drive viewer link, which still works in a
 * desktop browser and in Chrome on Android, just without the size selection
 * inside Keep.
 */
export const EXPORT_HOST_URL: string | undefined = import.meta.env.VITE_EXPORT_HOST_URL;

/**
 * Base URL of the TikTok caption extractor (see apps/tiktok-extractor/).
 *
 * The Android share target hands a TikTok link to the app; the browser cannot
 * fetch tiktok.com itself (CORS) and the AI's URL context tool is blocked by
 * TikTok, so the caption comes from this small Worker. Not a secret — the URL
 * ships in the browser bundle; the Worker only fetches public TikTok pages.
 *
 * Leave it empty and the share flow degrades: a shared TikTok link still opens
 * the AI screen, but the user has to paste the caption by hand.
 */
export const TIKTOK_EXTRACTOR_URL: string | undefined = import.meta.env.VITE_TIKTOK_EXTRACTOR_URL;
