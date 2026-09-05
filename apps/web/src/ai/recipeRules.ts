/**
 * The AI rules document (docs/ai_recipe_rules.md) embedded at build time.
 *
 * The site is static (GitHub Pages) and never has file access, so the rules
 * text that is embedded verbatim into every AI prompt is inlined into the
 * bundle here via Vite's `?raw` import. The Markdown file in docs/ is the
 * single source of truth — edit that file, rebuild, done.
 */

// Vite inlines the file content as a string; typed via vite/client `*?raw`.
import rulesText from '../../../../docs/ai_recipe_rules.md?raw';

/** The AI rules text, embedded verbatim into every AI-assisted prompt. */
export const AI_RULES_TEXT: string = rulesText;
