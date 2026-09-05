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
 * Wire mapping: {@link AiMessage}s become the `contents` array (system
 * messages are joined into the top-level `systemInstruction`, assistant
 * messages use Gemini's `model` role). The assistant's text is the joined
 * `parts` of the first candidate.
 */

import type { AiClient, AiMessage } from './types';

/** REST base URL of the Gemini API. */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** Default text model; override via the factory options. */
const DEFAULT_MODEL = 'gemini-3.6-flash';

/** Options for {@link createGeminiClient}. */
export interface GeminiClientOptions {
  /** The user's Gemini API key (pasted per session, memory only — N6). */
  apiKey: string;
  /** Model name; defaults to {@link DEFAULT_MODEL}. */
  model?: string;
}

/** Maps a chat message to Gemini's `contents`/`systemInstruction` pieces. */
function toGeminiContents(messages: readonly AiMessage[]): {
  systemInstruction: string | undefined;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .reduce<Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>>(
      (acc, message) => {
        const role = (message.role === 'assistant' ? 'model' : 'user') as 'user' | 'model';
        // Coalesce adjacent turns of the same role: Gemini's generateContent
        // requires strictly alternating user/model turns and rejects
        // consecutive same-role entries with a 400 (relevant for the
        // multi-turn repair-loop histories of Phase 3).
        const last = acc[acc.length - 1];
        if (last !== undefined && last.role === role) {
          last.parts.push({ text: message.content });
        } else {
          acc.push({ role, parts: [{ text: message.content }] });
        }
        return acc;
      },
      [],
    );
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
      const body: Record<string, unknown> = { contents };
      if (systemInstruction !== undefined) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      const response = await fetch(
        `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        },
      ).catch(() => {
        // fetch rejects on network-level failures (offline, DNS, CORS, TLS).
        throw new Error('Gemini API: Die Anfrage ist fehlgeschlagen (Netzwerkfehler).');
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Gemini API ${response.status}: ${detail || 'unbekannter Fehler'}`);
      }
      const data = await response.json().catch(() => {
        throw new Error('Gemini API: Die Antwort konnte nicht gelesen werden.');
      }) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        promptFeedback?: { blockReason?: string };
      };
      if (data.promptFeedback?.blockReason !== undefined) {
        throw new Error(`Gemini: Die Anfrage wurde blockiert (${data.promptFeedback.blockReason}).`);
      }
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((part) => part.text ?? '')
        .join('')
        .trim();
      if (text === '') {
        throw new Error('Gemini: Die Antwort war leer.');
      }
      return text;
    },
  };
}
