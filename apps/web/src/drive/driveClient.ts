/**
 * Minimal Google Drive API client (REST via fetch).
 *
 * Uses the access token from ./auth/googleAuth with the "drive.file" scope,
 * i.e. only files this app created (or opened) are visible — the rest of the
 * user's Drive stays hidden.
 *
 * The recipe storage format (Markdown + YAML files, folder structure) is
 * defined in docs/storage_format.md; this module provides the low-level
 * primitives the storage layer (./recipeStorage) builds on:
 * - file listing (folder-scoped) and metadata access,
 * - plain-text file content (recipes are text/markdown),
 * - create / update with content via a multipart upload,
 * - metadata-only rename (used for the image sibling).
 *
 * Docs: https://developers.google.com/drive/api/reference/rest/v3
 */

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
/** MIME type of Google Drive folders. */
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

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

/** Returns the metadata of one file; throws (404) when it no longer exists. */
export async function getFile(token: string, fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: 'id, name, mimeType' });
  return driveRequest(token, `/files/${encodeURIComponent(fileId)}?${params.toString()}`);
}

/** Finds visible folders with the exact name (e.g. to reuse the recipe folder). */
export async function findFoldersByName(token: string, name: string): Promise<DriveFile[]> {
  // Drive query strings use single-quoted literals; a quote inside the name is
  // escaped with a backslash.
  const escapedName = name.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `name = '${escapedName}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: '100',
  });
  const data = await driveRequest<{ files: DriveFile[] }>(token, `/files?${params.toString()}`);
  return data.files;
}

/** Creates a folder with the given name and returns its metadata. */
export async function createFolder(token: string, name: string): Promise<DriveFile> {
  return driveRequest(token, '/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE }),
  });
}

/** Lists all non-trashed files directly inside a folder. */
export async function listFilesInFolder(token: string, folderId: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: '1000',
  });
  const data = await driveRequest<{ files: DriveFile[] }>(token, `/files?${params.toString()}`);
  return data.files;
}

/** Returns the plain-text content of a file (used for recipes). */
export async function getFileContent(token: string, fileId: string): Promise<string> {
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Drive API ${response.status}: ${detail || 'unbekannter Fehler'}`);
  }
  return response.text();
}

/**
 * Download URL for a file's content (Drive API `alt=media`). Requires the
 * `Authorization: Bearer <token>` header, so it is only usable via `fetch`
 * (e.g. to show a recipe photo as an object URL), not as an `<img src>`.
 */
export function getFileDownloadUrl(fileId: string): string {
  return `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
}

/** A file to write: metadata plus text content. */
export interface FileUpload {
  name: string;
  mimeType: string;
  content: string;
  /** Parent folder; omitted to write to the root. */
  parents?: string[];
}

/**
 * Builds a multipart/related body: one JSON metadata part plus one content
 * part. The boundary is random so recipe content can never collide with it.
 */
function buildMultipartBody(
  metadata: Record<string, unknown>,
  content: string,
  contentType: string,
): { body: string; boundary: string } {
  const boundary = `cookbookBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const parts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n${content}\r\n`,
    `--${boundary}--\r\n`,
  ];
  return { body: parts.join(''), boundary };
}

/** Sends one multipart upload (create or update) and returns the file resource. */
async function uploadFile(
  token: string,
  method: 'POST' | 'PATCH',
  path: string,
  metadata: Record<string, unknown>,
  content: string,
  contentType: string,
): Promise<DriveFile> {
  const { body, boundary } = buildMultipartBody(metadata, content, contentType);
  const response = await fetch(`${DRIVE_UPLOAD_BASE}${path}?uploadType=multipart`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Drive API ${response.status}: ${detail || 'unbekannter Fehler'}`);
  }
  return (await response.json()) as DriveFile;
}

/** Creates a file with content (metadata + content in one request). */
export async function createFileWithContent(token: string, upload: FileUpload): Promise<DriveFile> {
  const metadata: Record<string, unknown> = { name: upload.name, mimeType: upload.mimeType };
  if (upload.parents !== undefined) metadata.parents = upload.parents;
  return uploadFile(token, 'POST', '/files', metadata, upload.content, upload.mimeType);
}

/** Updates a file's metadata and content in one request. */
export async function updateFileWithContent(
  token: string,
  fileId: string,
  upload: Pick<FileUpload, 'name' | 'mimeType' | 'content'>,
): Promise<DriveFile> {
  const metadata: Record<string, unknown> = { name: upload.name, mimeType: upload.mimeType };
  return uploadFile(
    token,
    'PATCH',
    `/files/${encodeURIComponent(fileId)}`,
    metadata,
    upload.content,
    upload.mimeType,
  );
}

/** Renames a file without touching its content (used for the image sibling). */
export async function renameFile(token: string, fileId: string, name: string): Promise<DriveFile> {
  return driveRequest(token, `/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}
