/**
 * Inline text artifacts (docs/storage_format.md §4) — display-only quantity
 * mentions inside a step's prose.
 *
 * The step text is free prose. Where the author wants a *scaled, code-styled*
 * quantity to appear inside a sentence — without counting toward any
 * ingredient list — it is written as a natural-language artifact:
 *
 *   {{1500 ml Wasser}}          ingredient mention (name after the unit)
 *   {{100 g}}                   quantity-only mention
 *   {{100}}                     quantity-only mention without a unit
 *
 * A name always requires a unit (so `{{100 Teig}}` is never ambiguous); a
 * quantity-only mention may omit it (unitless count).
 *
 * The stored text uses the canonical family form (g/ml, '.' decimals, plain
 * integers): `{{1500 ml Wasser}}`. Hand-written files may use German comma
 * decimals and kg/l (`{{1,5 l Wasser}}`); `parseIngredientPhrase` normalizes
 * these (comma → dot, kg/l → g/ml ×1000) so the in-memory model and every
 * downstream writer are canonical.
 *
 * Artifacts never carry a reference flag and never link a sub-recipe
 * explicitly: when the name equals the title of an `ingredient_recipe` it *is*
 * that sub-recipe (implicit link, §4). An ingredient mention renders with the
 * ingredient's display arrangement (renderAQS) and scales with the number of
 * servings; a quantity-only mention renders as the formatted base quantity
 * (formatBQ). Rows of the step lists (`- 250 g Tortillas`) use the exact same
 * natural phrase grammar with a *required* name — see ./parse.ts.
 */

import type { Ingredient, Unit } from './types.js';

/** One parsed inline artifact (ingredient or quantity-only mention). */
export interface TextArtifact {
  /** Base quantity; a standard number (ladder value). */
  quantity: number;
  /**
   * Stored base unit (g or ml after normalization). Only quantity-only
   * artifacts may omit it (unitless count, e.g. `{{3}}`); an ingredient
   * mention always carries a unit.
   */
  unit?: Unit;
  /** Ingredient name; absent = quantity-only artifact (`{{100 g}}`). */
  name?: string;
}

/** A validated artifact with its character span inside the step text. */
export interface ArtifactSpan {
  artifact: TextArtifact;
  /** Offset of the opening `{{` in the step text. */
  start: number;
  /** Offset one past the closing `}}`. */
  end: number;
}

/** One segment of the step text: plain prose or a validated artifact. */
export type TextSegment = { type: 'text'; value: string } | { type: 'artifact'; artifact: TextArtifact };

/**
 * Any `{{ … }}` block (candidates for artifacts; the rest of a malformed block
 * is never silently treated as prose — see ./parse.ts).
 */
const CURLY_BLOCK_RE = /\{\{([^{}]*)\}\}/g;

/**
 * The natural amount-first phrase grammar shared by artifact contents and step
 * rows: `MENGE [EINHEIT] [NAME]`. The number is an integer or a decimal with a
 * single `.` or `,` separator; the unit (g/kg/ml/l) is optional — but only for
 * a quantity-only phrase without a name (`{{100}}`); a name requires a unit
 * (otherwise `{{100 Teig}}` would be ambiguous). The name is the trailing
 * remainder (no `{`/`}`).
 */
const PHRASE_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|ml|l|g)?\s*([^{}]*)$/;

/** Normalizes a decimal written with a German comma to a JS number. */
function parseDecimal(raw: string): number {
  return Number(raw.replace(',', '.'));
}

/**
 * Parses a natural amount-first phrase and normalizes it to the canonical
 * form. Returns null when the phrase is not a valid quantity phrase.
 *
 * @param phrase the phrase, e.g. `1500 ml Wasser`, `100 g`, `100`, `1,5 l Wasser`
 * @param requireName when true (rows), a phrase without a name is invalid
 * @returns the canonical ingredient/artifact, or null
 */
export function parseIngredientPhrase(
  phrase: string,
  requireName = false,
): Ingredient | TextArtifact | null {
  const match = PHRASE_RE.exec(phrase);
  if (match === null) return null;
  const rawQuantity = parseDecimal(match[1]!);
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return null;
  const name = match[3]!.trim();
  const rawUnit = match[2] as Unit | undefined;
  // A name needs a unit (grammar rule above); rows need a name.
  if (rawUnit === undefined) {
    if (name !== '' || requireName) return null;
    return { quantity: rawQuantity };
  }
  // kg/l are display units: hand-written files may use them, the model stores
  // the family value (×1000, always still a ladder value — decade rule).
  const isKilo = rawUnit === 'kg';
  const isLiter = rawUnit === 'l';
  const unit: Unit = isKilo ? 'g' : isLiter ? 'ml' : rawUnit;
  const quantity = isKilo || isLiter ? rawQuantity * 1000 : rawQuantity;
  if (name === '') {
    if (requireName) return null;
    return { quantity, unit };
  }
  return { name, quantity, unit };
}

/** Returns the canonical stored text of an artifact (§4). */
export function artifactToText(artifact: TextArtifact): string {
  const base = artifact.unit === undefined ? `${artifact.quantity}` : `${artifact.quantity} ${artifact.unit}`;
  return artifact.name === undefined ? `{{${base}}}` : `{{${base} ${artifact.name}}}`;
}

/**
 * Splits a step text into prose segments and validated artifact spans (in
 * order). Every `{{ … }}` block is classified: a block whose content parses as
 * a natural amount phrase becomes an artifact; anything else is kept as prose
 * text — the validator (./parse.ts) rejects such blocks before they reach the
 * editor, so a block is never silently dropped here.
 */
export function splitArtifacts(text: string): { segments: TextSegment[]; spans: ArtifactSpan[] } {
  const segments: TextSegment[] = [];
  const spans: ArtifactSpan[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CURLY_BLOCK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, index) });
    }
    const content = match[1] ?? '';
    const artifact = parseIngredientPhrase(content);
    if (artifact !== null) {
      const start = index;
      const end = index + match[0].length;
      spans.push({ artifact, start, end });
      segments.push({ type: 'artifact', artifact });
    } else {
      segments.push({ type: 'text', value: match[0] });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return { segments, spans };
}

/**
 * Replaces every valid artifact in a step via `update` (return null to delete
 * the artifact). Non-artifact text is passed through unchanged.
 */
export function replaceArtifacts(
  text: string,
  update: (artifact: TextArtifact) => TextArtifact | null,
): string {
  const { segments } = splitArtifacts(text);
  return segments
    .map((segment) =>
      segment.type === 'text'
        ? segment.value
        : (() => {
            const result = update(segment.artifact);
            return result === null ? '' : artifactToText(result);
          })(),
    )
    .join('');
}

/**
 * HTML-escapes a text value for safe insertion into HTML content or
 * attributes (shared by the HTML export and the artifact renderer).
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Substitutes every validated artifact in a step with the string produced by
 * `render` (used by the HTML export to embed the scaled display form). All
 * non-artifact text is HTML-escaped here; `render` must therefore return
 * already-escaped HTML — this is what lets an artifact be rendered as a link
 * (e.g. a sub-recipe reference) without the surrounding text being able to
 * inject markup. Malformed `{{…}}` blocks pass through escaped (they are
 * rejected by the parser before any export runs).
 */
export function renderArtifacts(text: string, render: (artifact: TextArtifact) => string): string {
  let result = '';
  let lastIndex = 0;
  for (const span of splitArtifacts(text).spans) {
    result += escapeHtml(text.slice(lastIndex, span.start));
    result += render(span.artifact);
    lastIndex = span.end;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

/**
 * Inserts an artifact's text into a step at the given character offset.
 * Returns the updated step.
 */
export function insertArtifact(text: string, at: number, artifact: TextArtifact): string {
  const content = artifactToText(artifact);
  const offset = Math.max(0, Math.min(at, text.length));
  return `${text.slice(0, offset)}${content}${text.slice(offset)}`;
}
