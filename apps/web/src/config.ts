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
