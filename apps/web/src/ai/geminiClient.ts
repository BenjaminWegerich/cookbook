/**
 * Google Gemini adapter (browser-direct).
 *
 * Talks to the Gemini REST API (`:generateContent`) straight from the browser
 * with the user's own API key — no relay, no backend (decision from the Phase 3
 * kickoff: Gemini is browser-callable, DeepSeek is not and is deferred).
 *
 * The key is sent per request via the `x-goog-api-key` header and is never
 * stored here; the caller hands it in from the session store (./sessionKey,
 * N6). Docs: https://ai.google.dev/gemini-api/docs/text-generation
 *
 * `generateContent` is the legacy (but fully supported) endpoint; Google's
 * recommended surface is the Interactions API
 * (`/v1beta/interactions`, GA since June 2026), which is where new models and
 * tools land. Migrating is a later cleanup, not needed for this feature set.
 *
 * Wire mapping: {@link AiMessage}s become the `contents` array (system
 * messages are joined into the top-level `systemInstruction`, assistant
 * messages use Gemini's `model` role). A user message's optional images become
 * `inlineData` parts next to its text (Gemini reads them directly from the
 * request, no separate file upload). The assistant's text is the joined `parts`
 * of the first candidate. Every request carries the URL context tool
 * ({@link URL_CONTEXT_TOOL}), so a link pasted into the prompt is read
 * server-side instead of being guessed at.
 */

import { AiRequestError } from './types';
import type { AiClient, AiMessage } from './types';

/** REST base URL of the Gemini API. */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/**
 * Default text model; override via the factory options.
 *
 * `gemini-3.8-flash` is the current Flash generation and is included in the
 * API's free tier (the flagship `gemini-4-argon` is paid-only). Free-tier
 * input may be used by Google to improve its products.
 */
const DEFAULT_MODEL = 'gemini-3.8-flash';

/**
 * The URL context tool, declared in every request.
 *
 * It only does something when the prompt actually contains a URL: Gemini then
 * fetches that page itself (up to 20 URLs, 34 MB per page) and uses its text.
 * Fetching server-side is what makes pasted links work at all — a browser
 * `fetch` of a third-party recipe page is blocked by CORS. The tool is free of
 * charge; the retrieved text counts as regular input tokens.
 *
 * Limits worth knowing: public pages only — paywalls, Google Workspace files
 * and YouTube videos are not retrieved.
 *
 * Google Search grounding is deliberately *not* requested: it is not part of
 * the free tier for Gemini 3 models (it requires billing enabled on the
 * project).
 */
const URL_CONTEXT_TOOL = { urlContext: {} } as const;

/**
 * HTTP statuses worth repeating the identical request for — and only those:
 *
 * - `503` is Gemini's everyday "the model is overloaded"; on the free tier it
 *   is shed capacity, not a fault of the key or the request.
 * - `429` is the free tier's per-minute limit.
 * - `500`/`502`/`504` are Google-side hiccups.
 *
 * `400`, `403` and `404` (malformed request, key without access, unknown
 * model) fail identically on every retry, so they surface immediately.
 */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** How often one `complete` call may go to the network, first try included. */
const MAX_ATTEMPTS = 3;

/** First backoff step; doubled per attempt (≈ 1 s, then ≈ 2 s). */
const RETRY_BASE_DELAY_MS = 1000;

/** Ceiling of a single backoff step (the jittered value never exceeds it). */
const RETRY_MAX_DELAY_MS = 8000;

/**
 * Hard limit per attempt. A request with the URL context tool makes Gemini
 * fetch third-party pages before it answers, so it is legitimately slow —
 * without a limit a stalled connection would leave the AI sheet spinning
 * forever.
 */
const REQUEST_TIMEOUT_MS = 75_000;

/**
 * Backoff before the next attempt: doubling base delay with ±25 % jitter, so
 * several tabs that hit the same outage do not retry in lockstep.
 */
function backoffDelayMs(attempt: number): number {
  const step = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
  return Math.round(step * (0.75 + Math.random() * 0.5));
}

/** Resolves after `ms`; the retry loop awaits it between attempts. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turns one failed HTTP answer into the error the caller sees.
 *
 * `503` and `429` are capacity conditions the user can only wait out, so they
 * get plain German wording instead of the provider's JSON body. The remaining
 * errors keep the body: a `400` from a wrong key or a model without access is
 * not self-explanatory otherwise.
 */
function httpFailure(status: number, detail: string): AiRequestError {
  const retryable = RETRYABLE_STATUSES.has(status);
  let message: string;
  if (status === 503) {
    message = 'Gemini ist gerade überlastet (503). Bitte in ein paar Minuten erneut versuchen.';
  } else if (status === 429) {
    message =
      'Gemini drosselt gerade die Anfragen (429). Bitte eine Minute warten und erneut versuchen.';
  } else if (retryable) {
    message = `Gemini hatte ein Serverproblem (${status}). Bitte erneut versuchen.`;
  } else {
    message = `Gemini API ${status}: ${detail || 'unbekannter Fehler'}`;
  }
  return new AiRequestError(message, retryable);
}

/** Options for {@link createGeminiClient}. */
export interface GeminiClientOptions {
  /** The user's Gemini API key (pasted per session, memory only — N6). */
  apiKey: string;
  /** Model name; defaults to {@link DEFAULT_MODEL}. */
  model?: string;
}

/**
 * One part of a Gemini `contents` entry: either the turn's text or one inline
 * image. Gemini accepts a mix of both in the same `parts` array, in order.
 */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Maps one message to Gemini parts (text first, then its images). */
function toGeminiParts(role: 'user' | 'model', message: AiMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];
  if (message.content !== '') {
    parts.push({ text: message.content });
  }
  for (const image of message.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }
  if (parts.length === 0) {
    // A completely empty turn would make Gemini reject the request with a
    // generic 400; the caller has a much clearer German message for this.
    throw new Error(`Gemini: Die ${role === 'user' ? 'Anfrage' : 'Antwort'} war leer.`);
  }
  return parts;
}

/** Maps a chat message to Gemini's `contents`/`systemInstruction` pieces. */
function toGeminiContents(messages: readonly AiMessage[]): {
  systemInstruction: string | undefined;
  contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }>;
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .reduce<Array<{ role: 'user' | 'model'; parts: GeminiPart[] }>>((acc, message) => {
      const role = (message.role === 'assistant' ? 'model' : 'user') as 'user' | 'model';
      const parts = toGeminiParts(role, message);
      // Coalesce adjacent turns of the same role: Gemini's generateContent
      // requires strictly alternating user/model turns and rejects
      // consecutive same-role entries with a 400 (relevant for the
      // multi-turn repair-loop histories of Phase 3).
      const last = acc[acc.length - 1];
      if (last !== undefined && last.role === role) {
        last.parts.push(...parts);
      } else {
        acc.push({ role, parts });
      }
      return acc;
    }, []);
  return {
    systemInstruction: system === '' ? undefined : system,
    contents,
  };
}

/**
 * Creates a Gemini {@link AiClient}.
 *
 * @param options the API key (required) and an optional model override
 */
export function createGeminiClient(options: GeminiClientOptions): AiClient {
  const apiKey = options.apiKey.trim();
  const model = options.model?.trim() || DEFAULT_MODEL;
  if (apiKey === '') {
    throw new Error('Gemini: Es wurde kein API-Schlüssel angegeben.');
  }

  return {
    providerId: 'gemini',

    async complete(messages: readonly AiMessage[]): Promise<string> {
      const { systemInstruction, contents } = toGeminiContents(messages);
      const body: Record<string, unknown> = {
        contents,
        tools: [URL_CONTEXT_TOOL],
      };
      if (systemInstruction !== undefined) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }
      const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

      // Retry loop: Gemini answers 503 "model is overloaded" in bursts, and a
      // single request has no chance against that. The same body is resent
      // unchanged; only transient failures (see RETRYABLE_STATUSES, timeouts,
      // network errors) loop, everything else throws on the first answer.
      for (let attempt = 1; ; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify(body),
            // `fetch` rejects when this fires; the catch below turns it into a
            // German timeout message instead of a bare "AbortError".
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch (err) {
          // fetch rejects on network-level failures (offline, DNS, CORS, TLS)
          // and on the timeout signal.
          const timedOut =
            err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
          const failure = new AiRequestError(
            timedOut
              ? 'Gemini hat nicht rechtzeitig geantwortet. Bitte erneut versuchen.'
              : 'Gemini API: Die Anfrage ist fehlgeschlagen (Netzwerkfehler).',
            true,
          );
          if (attempt >= MAX_ATTEMPTS) throw failure;
          await sleep(backoffDelayMs(attempt));
          continue;
        }

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          const failure = httpFailure(response.status, detail);
          if (!failure.retryable || attempt >= MAX_ATTEMPTS) throw failure;
          await sleep(backoffDelayMs(attempt));
          continue;
        }

        const data = (await response.json().catch(() => {
          throw new Error('Gemini API: Die Antwort konnte nicht gelesen werden.');
        })) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string; thought?: boolean }> };
            finishReason?: string;
          }>;
          promptFeedback?: { blockReason?: string };
        };
        if (data.promptFeedback?.blockReason !== undefined) {
          throw new AiRequestError(
            `Gemini: Die Anfrage wurde blockiert (${data.promptFeedback.blockReason}).`,
            false,
          );
        }
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        const text = parts
          // Thinking models stream their reasoning as extra parts marked
          // `thought: true`; that is not answer text and must never reach the
          // recipe parser.
          .filter((part) => part.thought !== true)
          .map((part) => part.text ?? '')
          .join('')
          .trim();
        if (text === '') {
          // Distinguish "ran out of room while thinking" from a genuinely empty
          // answer — the former is worth retrying, the latter is not.
          const finishReason = data.candidates?.[0]?.finishReason;
          if (finishReason !== undefined && finishReason !== 'STOP') {
            throw new Error(`Gemini: Die Antwort wurde abgebrochen (${finishReason}).`);
          }
          throw new Error('Gemini: Die Antwort war leer.');
        }
        return text;
      }
    },
  };
}
