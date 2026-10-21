/**
 * Incoming shares: the Android share target (manifest `share_target`) hands a
 * TikTok link to the app, and this module turns it into the two prefills of the
 * AI-create screen — the description field and the "Quelltext" (source) field.
 *
 * Why a backend is involved at all: the app cannot read tiktok.com from the
 * browser (CORS), and the URL context tool of the AI is blocked by TikTok, so
 * the caption is extracted by a small Worker (`apps/tiktok-extractor/`) and
 * requested here. Every other link goes into the description field unchanged —
 * the AI reads those pages itself. Text that arrives *as text* (some sharing
 * apps pass the caption instead of a link) goes into the source field directly.
 *
 * The two fields are the AI screen's own vocabulary: `prompt` is the
 * description, `source` is the optional page text below it. The mapping lives
 * here, not in App, so the share path and the manual path agree on it.
 */

/** A share that arrived with the page load (query parameters of the share target). */
export interface IncomingShare {
  /** The shared URL, when the sharing app passed one. */
  url: string | null;
  /** The shared text, when the sharing app passed one (a caption or the link). */
  text: string | null;
}

/** The AI screen's two prefills, built from one incoming share. */
export interface SharedSource {
  /** Prefill of the description field (a link the AI can read itself). */
  prompt?: string;
  /** Prefill of the "Quelltext" field (text extracted from a blocked page). */
  source?: string;
}

/** Failure of a share that needs extracting, with a code the caller can map to
 *  a German message (this module stays free of UI strings). */
export class ShareResolveError extends Error {
  /** `'no-extractor'`: no Worker configured; `'extractor-failed'`: the Worker
   *  refused or errored; `'no-caption'`: the video has no text. */
  readonly code: 'no-extractor' | 'extractor-failed' | 'no-caption';

  constructor(code: 'no-extractor' | 'extractor-failed' | 'no-caption', message: string) {
    super(message);
    this.name = 'ShareResolveError';
    this.code = code;
  }
}

/**
 * Hosts whose links need the extractor. TikTok's share sheet produces
 * `vm.tiktok.com` short links; the others cover links pasted or shared in their
 * canonical form. A host allowlist keeps the endpoint from becoming a generic
 * URL fetcher.
 */
const TIKTOK_HOSTS = new Set(['vm.tiktok.com', 'www.tiktok.com', 'tiktok.com', 'm.tiktok.com']);

/** How long the extractor may take before the share is treated as failed. */
const EXTRACT_TIMEOUT_MS = 15_000;

/**
 * Reads the share parameters off a location search string.
 *
 * The manifest maps Chrome's `url`, `text` and `title` slots to the same names,
 * so a shared link normally arrives as `?url=…`. Some apps pass the link in
 * `text` instead; {@link resolveIncomingShare} handles both.
 *
 * Returns null when the page was opened without a share — a normal start.
 */
export function readIncomingShare(search: string): IncomingShare | null {
  const params = new URLSearchParams(search);
  const url = params.get('url')?.trim() ?? '';
  const text = params.get('text')?.trim() ?? '';
  if (url === '' && text === '') return null;
  return { url: url === '' ? null : url, text: text === '' ? null : text };
}

/** True when the URL belongs to TikTok and needs the extractor. */
export function isTikTokUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isWeb = parsed.protocol === 'https:' || parsed.protocol === 'http:';
    return isWeb && TIKTOK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The text as a URL when the *whole* text is one, otherwise null (a caption). */
function asCompleteUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

/** Asks the extractor Worker for the caption of a TikTok video. */
async function fetchTikTokCaption(url: string, extractorUrl: string): Promise<string> {
  let endpoint: URL;
  try {
    endpoint = new URL(extractorUrl);
  } catch {
    throw new ShareResolveError('no-extractor', 'Der Extraktor ist nicht konfiguriert.');
  }
  endpoint.searchParams.set('url', url);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ShareResolveError(
      'extractor-failed',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  if (!response.ok) {
    throw new ShareResolveError('extractor-failed', `HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ShareResolveError(
      'extractor-failed',
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  const caption = (payload as { caption?: unknown }).caption;
  if (typeof caption !== 'string' || caption.trim() === '') {
    throw new ShareResolveError('no-caption', 'Die Antwort enthielt keinen Text.');
  }
  return caption.trim();
}

/**
 * Turns an incoming share into the AI screen's prefills.
 *
 * - Text that is not a bare URL is a caption the sharing app handed over —
 *   take it as the source.
 * - A TikTok link is extracted into the source (the AI cannot read TikTok).
 * - Every other link goes into the description, where the AI's URL context
 *   tool reads it.
 */
export async function resolveIncomingShare(
  share: IncomingShare,
  extractorUrl: string | undefined,
): Promise<SharedSource> {
  const textUrl = share.text === null ? null : asCompleteUrl(share.text);
  if (share.text !== null && textUrl === null) {
    return { source: share.text };
  }
  const url = share.url ?? textUrl;
  if (url === null) return {};
  if (!isTikTokUrl(url)) return { prompt: url };
  if (extractorUrl === undefined || extractorUrl.trim() === '') {
    throw new ShareResolveError('no-extractor', 'VITE_TIKTOK_EXTRACTOR_URL ist nicht gesetzt.');
  }
  return { source: await fetchTikTokCaption(url, extractorUrl) };
}
