/**
 * Provider-agnostic AI client contract (Phase 3 foundation).
 *
 * The app talks to an AI model through this seam only — the concrete
 * provider (currently Google Gemini, browser-direct; DeepSeek or others may
 * follow behind the same interface, see docs/ROADMAP.md Phase 3) is hidden
 * behind {@link AiClient}. The contract is deliberately minimal: every Phase 3
 * use case (AI create, AI edit, the validate→repair loop, the theme suggestion)
 * is "send a prompt (system rules + conversation, optionally with images) and
 * get text back".
 *
 * The API key never crosses this module: callers obtain it from the session
 * store (./sessionKey, N6 — pasted per session, held in memory only).
 */

/**
 * An image attached to a user turn.
 *
 * The bytes travel inline (base64) with the request, because the browser has no
 * provider-side file to reference. `data` is the base64 payload *without* the
 * `data:` URL prefix; the provider adapter adds its own wire envelope.
 */
export interface AiImage {
  /** MIME type of the payload; the supported photo formats of the app. */
  mimeType: 'image/jpeg' | 'image/png';
  /** Base64-encoded image bytes (no data URL prefix). */
  data: string;
}

/** A chat message in the provider-neutral form. */
export interface AiMessage {
  /** System messages carry standing instructions (e.g. the format rules). */
  role: 'system' | 'user' | 'assistant';
  content: string;
  /**
   * Images that belong to this turn. Only user turns carry images today; a
   * provider adapter that cannot read them should be explicit about it rather
   * than silently dropping the attachment.
   */
  images?: readonly AiImage[];
}

/**
 * A provider-agnostic text-generation client.
 *
 * Implementations translate {@link AiMessage}s into the provider's wire
 * format and return the assistant's answer as plain text. No streaming, no
 * tool use, no structured output — those are added to this contract only when
 * a real use case needs them.
 */
export interface AiClient {
  /** Stable provider identifier, e.g. "gemini" (used for labels/errors). */
  readonly providerId: string;

  /**
   * Runs a chat completion and resolves with the assistant's text answer.
   * Throws an Error with a German message when the provider call fails.
   */
  complete(messages: readonly AiMessage[]): Promise<string>;
}
