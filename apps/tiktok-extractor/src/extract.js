/**
 * Pure caption extraction from a TikTok video page.
 *
 * Kept free of Worker APIs so the parser can be unit-tested with plain
 * `node --test` (see extract.test.js). The page ships the full caption in its
 * hydration JSON — no API, no login, no oEmbed (TikTok's oEmbed is rate-limited
 * and returns no caption).
 *
 * Two shapes have been observed under `__DEFAULT_SCOPE__`:
 *   webapp.reflow.video.detail   (current)
 *   webapp.video-detail          (older pages)
 * Both carry `itemInfo.itemStruct.desc`; `shareMeta.desc` is a fallback.
 */

/** Hosts whose links are accepted. A host allowlist keeps the endpoint from
 *  becoming a generic URL fetcher (SSRF). */
const TIKTOK_HOSTS = new Set(['vm.tiktok.com', 'www.tiktok.com', 'tiktok.com', 'm.tiktok.com']);

/** Hydration scope keys that have held the video detail across page versions. */
const DETAIL_KEYS = ['webapp.reflow.video.detail', 'webapp.video-detail'];

/** The hydration script's id. */
const HYDRATION_SCRIPT_ID = '__UNIVERSAL_DATA_FOR_REHYDRATION__';

/**
 * True for a TikTok share link. Only https is accepted: the Worker follows the
 * short-link redirect itself, and an http URL would allow a downgrade hop.
 */
export function isTikTokUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && TIKTOK_HOSTS.has(parsed.hostname.toLowerCase());
}

/** Reads one script tag's JSON payload by id, or null. */
function readHydrationJson(html) {
  const pattern = new RegExp(
    `<script id="${HYDRATION_SCRIPT_ID}" type="application/json">([\\s\\S]*?)</script>`,
  );
  const match = html.match(pattern);
  if (match === null) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** The `<meta property="og:description">` content, or null (a last resort). */
function readOgDescription(html) {
  const match = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i);
  if (match === null) return null;
  const decoded = match[1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
  return decoded.trim() === '' ? null : decoded;
}

/**
 * Extracts the caption from a video page's HTML.
 *
 * Returns `{ caption, videoId, author }` — caption is the only guaranteed field
 * (null when the page carries none, e.g. a captcha page or a video without
 * text). Never throws.
 */
export function extractCaption(html) {
  const payload = readHydrationJson(html);
  const scope = payload?.__DEFAULT_SCOPE__;
  if (scope !== undefined && scope !== null) {
    for (const key of DETAIL_KEYS) {
      const detail = scope[key];
      const item = detail?.itemInfo?.itemStruct;
      const caption = item?.desc ?? detail?.shareMeta?.desc;
      if (typeof caption === 'string' && caption.trim() !== '') {
        return {
          caption: caption.trim(),
          videoId: item?.id ?? null,
          author: item?.author?.uniqueId ?? null,
        };
      }
    }
  }
  return { caption: readOgDescription(html), videoId: null, author: null };
}

/** Best-effort video id from a canonical URL (used for logging only). */
export function videoIdFromUrl(value) {
  try {
    return new URL(value).pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}
