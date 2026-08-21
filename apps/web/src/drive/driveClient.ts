/**
 * Minimal Google Drive API client (REST via fetch).
 *
 * Uses the access token from ./auth/googleAuth with the "drive.file" scope,
 * i.e. only files this app created (or opened) are visible — the rest of the
 * user's Drive stays hidden.
 *
 * The recipe storage format (Markdown + YAML files, folder structure) is
 * defined in the "Core functionality" roadmap tasks; this module provides the
 * low-level primitives that storage layer will build on.
 *
 * Docs: https://developers.google.com/drive/api/reference/rest/v3
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

/** Metadata of a file in Google Drive. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

/** Authenticated JSON request against the Drive API. */
async function driveRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Drive API ${response.status}: ${detail || 'unbekannter Fehler'}`);
  }
  return (await response.json()) as T;
}

/**
 * Lists the app's files in Drive (files not in the trash).
 *
 * With the "drive.file" scope this returns only files the app itself created
 * or explicitly opened. Used as the connectivity smoke test.
 */
export async function listFiles(token: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: 'trashed = false',
    fields: 'files(id, name, mimeType)',
    pageSize: '100',
  });
  const data = await driveRequest<{ files: DriveFile[] }>(token, `/files?${params.toString()}`);
  return data.files;
}
