/**
 * Recipe theme (docs/DESIGN.md §4.8, docs/storage_format.md §3).
 *
 * A theme is a recipe's visual skin for the exported cooking view: a typeface
 * and a small palette, plus optional decorative details. It is stored with the
 * recipe in the `theme` front-matter field; each of the five tokens is optional
 * and falls back to the default theme independently.
 *
 * This module is the single source of truth for the token defaults and the
 * export font shortlist. parse.ts validates against them, serialize.ts writes
 * the stored subset back, and exportHtml.ts resolves a recipe's theme to its
 * five concrete tokens before rendering.
 *
 * The derived colours of §4.8 — `muted` (ink blended toward paper) and
 * `on-accent` (ink or paper chosen for contrast) — are not part of the stored
 * format and are therefore not resolved here; the export's rendering step
 * computes them (no UI is built yet).
 */

import type { RecipeTheme } from './types.js';

/**
 * The export font shortlist (DESIGN §4.8): eleven typefaces deliberately unlike
 * each other. `font` must name exactly one of these — no other typeface is
 * selectable.
 */
export const THEME_FONT_SHORTLIST: readonly string[] = [
  'Source Sans 3',
  'Inter',
  'Montserrat',
  'Nunito',
  'Source Serif 4',
  'Fraunces',
  'Playfair Display',
  'Bitter',
  'IBM Plex Sans Condensed',
  'Caveat',
  'IBM Plex Mono',
];

/** The default theme: the web app's palette and typeface (DESIGN §4.8). */
export const DEFAULT_THEME: Required<RecipeTheme> = {
  font: 'Source Sans 3',
  accent: '#b85c38', // clay — active state, forward actions, links
  paper: '#faf5ec', // page background
  ink: '#2b241d', // primary text
  line: '#e6dbc8', // hairlines, borders, dividers
};

/** A theme with every token filled in (recipe overrides merged over defaults). */
export type ResolvedTheme = Required<RecipeTheme>;

/** A 6-digit hex colour (`#rrggbb`), case-insensitive — the canonical form. */
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** True when `value` is a 6-digit hex colour in the canonical form. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/**
 * Resolves a recipe's theme: every token of `theme` overrides its default; the
 * remaining tokens fall back to {@link DEFAULT_THEME}. Each token falls back
 * independently (§4.8), and a recipe without theme data resolves to the app's
 * look — so a caller always gets all five concrete tokens.
 */
export function resolveTheme(theme?: RecipeTheme): ResolvedTheme {
  return { ...DEFAULT_THEME, ...theme };
}
