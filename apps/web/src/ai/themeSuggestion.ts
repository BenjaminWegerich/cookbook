/**
 * AI design suggestions for a recipe theme (DESIGN.md §4.8).
 *
 * The editor's Design card can ask the model for a fitting typeface and palette
 * from the recipe's title, description and (when available) photo. This module
 * owns the prompt and the strict reading of the reply; the UI only calls
 * {@link buildThemeSuggestionPrompt}, sends the turn through the shared
 * {@link AiClient}, and passes the text to {@link parseThemeSuggestion}.
 *
 * Why JSON: unlike the recipe flows, the answer is five small machine values,
 * not prose. The model is told to answer with one JSON object only, and the
 * parser validates every token against the same constants the editor uses
 * (`THEME_FONT_SHORTLIST`, `isHexColor`). A malformed answer therefore never
 * reaches the draft as a broken theme — it becomes a precise German error that
 * the caller forwards to the snackbar.
 */

import { THEME_FONT_SHORTLIST, isHexColor, type RecipeTheme } from '@cookbook/core';

/** The colour tokens the model has to fill; `font` is checked separately. */
const THEME_COLOR_KEYS = ['accent', 'paper', 'ink', 'line'] as const;

/** German names of the colour tokens, for parser error messages. */
const THEME_COLOR_LABELS: Readonly<Record<(typeof THEME_COLOR_KEYS)[number], string>> = {
  accent: 'Akzent',
  paper: 'Hintergrund',
  ink: 'Text',
  line: 'Linie',
};

/**
 * System instruction of the theme task.
 *
 * It is deliberately short and self-contained: this is a single-turn design
 * job, so it needs neither the recipe-format rules nor the collection context.
 * The font list is named explicitly so the model cannot propose a face the
 * picker does not offer; the contrast rule keeps a suggested palette usable
 * (the export derives muted text and `on-accent` from `ink`/`paper`/`accent`).
 */
export const THEME_SUGGESTION_SYSTEM_TEXT = `Du bist Art Director für die Kochansicht eines digitalen Kochbuchs. Wähle zu einem Rezept eine Schriftart und eine kleine Farbpalette, die zum Gericht und – wenn vorhanden – zum beigefügten Foto passen. Antworte ausschließlich mit einem JSON-Objekt; keine Erklärung, kein Markdown, kein Code-Fence.

# Schriftart
Wähle genau einen dieser Werte für "font":
- "Noto Sans": neutraler Grotesk, der Standard.
- "Noto Serif": klassischer Buchserif, warm und traditionell.
- "Noto Serif Display": elegante Display-Serif; sie erscheint nur in der Hauptüberschrift, der übrige Text dann in "Noto Serif".

# Farben
Setze alle vier Farben als Hex-Werte im Format #rrggbb:
- "accent": warme, appetitliche Akzentfarbe für aktive Zustände, Links und Akzente.
- "paper": heller, ruhiger Hintergrund.
- "ink": dunkle Textfarbe mit mindestens 4.5:1 Kontrast zu "paper".
- "line": dezente Trennlinie, klar sichtbar, aber zurückhaltend.
Bleibe bei warmen, essbaren Tönen (Papier, Ton, Terrakotta, Oliv, Ocker, Walnuss); vermeide kalte, grelle oder neonartige Farben. Die Palette soll zum Charakter des Gerichts passen, nicht zum Design der App.

# Ausgabeformat
Antworte mit genau diesem Objekt und keinen weiteren Feldern. Das Beispiel zeigt nur die Form; wähle eigene, zum Gericht passende Werte:
{"font":"Noto Serif","accent":"#b5532f","paper":"#fbf4e8","ink":"#2b241d","line":"#e4d6c1"}`;

/** Input of {@link buildThemeSuggestionPrompt}. */
export interface ThemeSuggestionPromptInput {
  /** The recipe title as currently edited; may be empty. */
  title: string;
  /** The optional description as currently edited; may be empty. */
  description: string;
  /** True when the photo (queued or stored) is attached to this turn. */
  hasImage: boolean;
}

/**
 * Builds the user turn for one design suggestion: the title, the optional
 * description, and — when an image is attached — a note that the model should
 * read its colours. The values are the user's recipe data; the system
 * instruction above supplies the task, so no recipe-format context is needed.
 */
export function buildThemeSuggestionPrompt(input: ThemeSuggestionPromptInput): string {
  const title = input.title.trim();
  const description = input.description.trim();
  const lines = [title === '' ? 'Rezepttitel: (noch ohne Titel)' : `Rezepttitel: ${title}`];
  if (description !== '') {
    lines.push(`Beschreibung: ${description}`);
  }
  if (input.hasImage) {
    lines.push('Das beigefügte Bild zeigt das Gericht. Berücksichtige seine Farben und Stimmung.');
  }
  return lines.join('\n');
}

/**
 * Pulls the JSON object out of the model's reply. A well-behaved answer is the
 * bare object; a fence or a short sentence around it is tolerated, because
 * models slip back into prose even when told not to. An answer without any
 * object is an error.
 */
function extractJsonObject(reply: string): string {
  let value = reply.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value);
  if (fenced !== null) {
    value = fenced[1]!.trim();
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    return value;
  }
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Gemini: Die Design-Antwort enthielt kein JSON-Objekt.');
  }
  return value.slice(start, end + 1);
}

/**
 * Validates and normalizes one theme suggestion from the model's reply.
 *
 * Every token is mandatory: a missing or invalid token is reported instead of
 * being silently replaced, so the Design card never claims a full suggestion
 * while showing half of the old theme. Colours are lower-cased to the canonical
 * stored form; the save-time normalization (RecipeEditor.normalizeTheme) still
 * drops tokens that equal their default.
 *
 * @throws Error with a German message when the reply is not a valid suggestion
 */
export function parseThemeSuggestion(reply: string): RecipeTheme {
  let payload: unknown;
  try {
    payload = JSON.parse(extractJsonObject(reply));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Gemini:')) throw err;
    throw new Error('Gemini: Die Design-Antwort war kein gültiges JSON.');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Gemini: Die Design-Antwort war kein JSON-Objekt.');
  }

  const record = payload as Record<string, unknown>;
  const font = typeof record.font === 'string' ? record.font.trim() : '';
  if (!THEME_FONT_SHORTLIST.includes(font)) {
    throw new Error('Gemini: Die Design-Antwort nannte keine gültige Schriftart.');
  }

  const theme: RecipeTheme = { font };
  for (const key of THEME_COLOR_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || !isHexColor(value)) {
      throw new Error(
        `Gemini: Die Design-Antwort nannte keine gültige Farbe für „${THEME_COLOR_LABELS[key]}“.`,
      );
    }
    theme[key] = value.toLowerCase();
  }
  return theme;
}
