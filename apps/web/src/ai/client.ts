/**
 * Provider factory for the AI abstraction.
 *
 * The rest of the app creates an {@link AiClient} through {@link createAiClient}
 * and never imports a concrete provider module — adding a new provider later
 * (e.g. DeepSeek behind a relay) is one new branch here plus its adapter.
 */

import { createGeminiClient } from './geminiClient';
import type { AiClient } from './types';

/** Provider identifiers understood by {@link createAiClient}. */
export type AiProviderId = 'gemini';

/** Options for {@link createAiClient}. */
export interface AiClientConfig {
  /** Which provider to use. */
  provider: AiProviderId;
  /** The user's API key for that provider (pasted per session — N6). */
  apiKey: string;
  /** Optional provider-specific model override. */
  model?: string;
}

/** Creates an {@link AiClient} for the configured provider. */
export function createAiClient(config: AiClientConfig): AiClient {
  switch (config.provider) {
    case 'gemini':
      return createGeminiClient({ apiKey: config.apiKey, model: config.model });
  }
}
