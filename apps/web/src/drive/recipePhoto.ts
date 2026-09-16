/**
 * Page-session cache for recipe photos.
 *
 * The same photo is shown in several places — the card on the home screen, the
 * overview sheet's hero and the editor's preview — and phone photos are large,
 * so downloading the file again for every mount adds a visible delay. The
 * downloaded blob is cached by Drive file id for the page session; each
 * consumer creates its own object URL from the cached blob and revokes that URL
 * on unmount, so no consumer outlives the blob it shows.
 *
 * A photo is optional (§2): a failed download is not cached, callers simply
 * keep their fallback (avatar / placeholder) and the next mount retries.
 */

import { getFileDownloadUrl } from './driveClient';

/** Downloaded photo blobs, keyed by Drive file id. */
const photoBlobs = new Map<string, Blob>();

/**
 * In-flight downloads, keyed by Drive file id: concurrent mounts of the same
 * photo (e.g. card → list refresh) share a single request.
 */
const pendingPhotos = new Map<string, Promise<Blob | null>>();

/**
 * Downloads a recipe photo, cached and de-duplicated by file id. Resolves to
 * `null` when the photo cannot be loaded (missing, no permission, network) —
 * never rejects, so callers can use it without their own try/catch.
 */
export async function loadRecipePhoto(token: string, fileId: string): Promise<Blob | null> {
  const cached = photoBlobs.get(fileId);
  if (cached !== undefined) return cached;
  const pending = pendingPhotos.get(fileId);
  if (pending !== undefined) return pending;
  const request = (async (): Promise<Blob | null> => {
    try {
      const response = await fetch(getFileDownloadUrl(fileId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      photoBlobs.set(fileId, blob);
      return blob;
    } catch {
      return null;
    } finally {
      pendingPhotos.delete(fileId);
    }
  })();
  pendingPhotos.set(fileId, request);
  return request;
}

/** Caches an already-downloaded blob (e.g. the photo just uploaded to Drive). */
export function cacheRecipePhoto(fileId: string, blob: Blob): void {
  photoBlobs.set(fileId, blob);
}

/** Drops the cached photo of a file after it was changed, removed or deleted. */
export function invalidateRecipePhoto(fileId: string): void {
  photoBlobs.delete(fileId);
}
