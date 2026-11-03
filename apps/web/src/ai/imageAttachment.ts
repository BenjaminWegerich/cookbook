/**
 * Prepares a recipe photo for an inline AI request.
 *
 * Gemini accepts image bytes only inline (`inlineData`), so the photo blob has
 * to be base64-encoded. Phone photos are often several megabytes, which inflates
 * the request and the token bill without helping the design task — the model
 * only needs the dish's colours and mood. Large images are therefore downscaled
 * to a modest longest edge and re-encoded as JPEG first; a small image is sent
 * unchanged so it is never recompressed for no reason.
 *
 * The helper never invents a MIME type from thin air: the blob's declared type
 * wins, and the caller's extension fallback covers Drive downloads that arrive
 * without a useful `Content-Type`.
 */

import type { AiImage } from './types';

/** Longest edge of a downscaled prompt image, in pixels. */
const MAX_IMAGE_EDGE = 1280;

/** Images above this size are downscaled before sending. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** JPEG quality of a downscaled prompt image. */
const DOWNSCALE_JPEG_QUALITY = 0.85;

/** Reads a blob as a base64 data URL. */
function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Bild konnte nicht gelesen werden.'));
    };
    reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

/** Drops the `data:<mime>;base64,` prefix of a data URL. */
function dataUrlPayload(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Bild konnte nicht gelesen werden.');
  return dataUrl.slice(comma + 1);
}

/**
 * Decodes and downscales one image blob.
 *
 * @throws when the browser cannot decode the image or cannot encode the
 *         canvas result; callers may then fall back to the original blob
 */
async function downscaleImage(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
      element.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('Canvas wird nicht unterstützt.');
    }
    context.drawImage(image, 0, 0, width, height);
    const scaled = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', DOWNSCALE_JPEG_QUALITY),
    );
    if (scaled === null) {
      throw new Error('Bild konnte nicht verarbeitet werden.');
    }
    return scaled;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Converts a photo blob into an inline {@link AiImage}.
 *
 * @param blob            the photo bytes (a stored download or a queued crop)
 * @param fallbackMimeType MIME type used when the blob carries none, derived
 *                         from the recipe photo's extension
 */
export async function toAiImage(
  blob: Blob,
  fallbackMimeType: AiImage['mimeType'],
): Promise<AiImage> {
  let source = blob;
  let mimeType: AiImage['mimeType'] =
    blob.type === 'image/png'
      ? 'image/png'
      : blob.type === 'image/jpeg' || blob.type === 'image/jpg'
        ? 'image/jpeg'
        : fallbackMimeType;

  if (blob.size > MAX_IMAGE_BYTES) {
    try {
      source = await downscaleImage(blob);
      mimeType = 'image/jpeg';
    } catch {
      // A decode/encode failure must not take the AI feature down with it; the
      // original bytes are still a readable image for the model.
      source = blob;
    }
  }

  return { mimeType, data: dataUrlPayload(await readAsDataUrl(source)) };
}
