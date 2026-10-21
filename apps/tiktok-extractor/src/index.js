/**
 * The TikTok caption extractor: a small Cloudflare Worker that turns a shared
 * TikTok link into the video's caption text.
 *
 * Why it exists: the Cookbook PWA receives TikTok links from the Android share
 * sheet, but a browser cannot fetch tiktok.com (CORS) and Gemini's URL context
 * tool is blocked by TikTok. This Worker fetches the public video page and
 * returns the caption as JSON, which the app puts into the AI screen's
 * "Quelltext" field (apps/web/src/share/incomingShare.ts).
 *
 * Contract:
 *   GET /?url=https://vm.tiktok.com/…  → 200 { caption, videoId, author, url }
 *                                       400 { error: 'invalid_url' }
 *                                       405 { error: 'method_not_allowed' }
 *                                       422 { error: 'no_caption' }
 *                                       502 { error: 'upstream_failed', … }
 *   GET /health                        → 200 { ok: true }
 *
 * It holds no credential and serves only public data, so it may be called from
 * the browser without authentication. The host allowlist in extract.js is what
 * keeps it from being an open fetch proxy.
 */

import { extractCaption, isTikTokUrl } from './extract.js';

/** A realistic mobile UA: TikTok serves the full page to browsers, less to bots. */
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/** Upper bound for the upstream fetch; the share sheet waits for the answer. */
const UPSTREAM_TIMEOUT_MS = 15_000;

/** CORS headers. Deliberately open: the endpoint serves public pages and holds
 *  no credential, so a wildcard gives away nothing a `curl` could not get. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept',
  'Access-Control-Max-Age': '86400',
};

/** JSON response with CORS and no caching (a caption may change). */
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

/** Fetches the page and extracts the caption; throws a coded error otherwise. */
async function extractFromTikTok(target) {
  const response = await fetch(target, {
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error(`TikTok antwortete mit HTTP ${response.status}.`);
    error.code = response.status === 429 ? 'upstream_rate_limited' : 'upstream_failed';
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }

  const html = await response.text();
  const extracted = extractCaption(html);
  if (extracted.caption === null) {
    const error = new Error('Die Seite enthielt keinen Beschreibungstext.');
    error.code = 'no_caption';
    error.status = 422;
    throw error;
  }
  return { ...extracted, url: response.url };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405);
    }
    if (url.pathname === '/health') {
      return json({ ok: true }, 200);
    }

    const target = url.searchParams.get('url');
    if (target === null || !isTikTokUrl(target)) {
      return json({ error: 'invalid_url' }, 400);
    }

    try {
      return json(await extractFromTikTok(target), 200);
    } catch (cause) {
      const status = typeof cause?.status === 'number' ? cause.status : 502;
      const code = typeof cause?.code === 'string' ? cause.code : 'upstream_failed';
      // The upstream message stays in the log, not in the public response.
      console.warn(`caption extraction failed for ${target}:`, cause?.message ?? cause);
      return json({ error: code }, status);
    }
  },
};
