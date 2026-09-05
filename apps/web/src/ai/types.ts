/**
 * Provider-agnostic AI client contract (Phase 3 foundation).
 *
 * The app talks to an AI text model through this seam only — the concrete
 * provider (currently Google Gemini, browser-direct; DeepSeek or others may
 * follow behind the same interface, see docs/ROADMAP.md Phase 3) is hidden
 * behind {@link AiClient}. The contract is deliberately minimal: every Phase 3
 * use case (AI create, AI edit, the validate→repair loop) is "send a prompt
 * (system rules + conversation) and get text back".
 *
 * The API key never crosses this module: callers obtain it from the session
 * store (./sessionKey, N6 — pasted per session, held in memory only).
 */

/** A chat message in the provider-neutral form. */
export interface AiMessage {
  /** System messages carry standing instructions (e.g. the format rules). */
  role: 'system' | 'user' | 'assistant';
  content: string;
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
