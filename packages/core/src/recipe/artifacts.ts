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
 *   {{1 26 cm Backring|size}}   size marker (equipment, display-only)
 *
 * A name always requires a unit (so `{{100 Teig}}` is never ambiguous); a
 * quantity-only mention may omit it (unitless count).
 *
 * The stored text uses the canonical family form (g/ml, '.' decimals, plain
 * integers): `{{1500 ml Wasser}}`. A unitless count stores its amount in the
 * canonical AQ fraction notation of its standard number (`{{1/3}}`,
 * `{{1+1/4}}`, `{{3}}`); hand-written files may spell those as decimals too.
 * Hand-written files may use German comma decimals and kg/l
 * (`{{1,5 l Wasser}}`); `parseIngredientPhrase` normalizes these
 * (comma → dot, kg/l → g/ml ×1000) so the in-memory model and every
 * downstream writer are canonical.
 *
 * A size marker is the third artifact kind: display-only equipment whose
 * nominal size follows the recipe quantity. It stores the written arrangement
 * (`count`, `size`, marker key) and is resolved by ../sizeMarkers.ts; it never
 * enters an ingredient list and deliberately has no precision.
 *
 * Artifacts never carry a reference flag and never link a sub-recipe
 * explicitly: when the name equals the title of an `ingredient_recipe` it *is*
 * that sub-recipe (implicit link, §4). An ingredient mention renders with the
 * ingredient's display arrangement (renderAQS) and scales with the number of
 * servings; a quantity-only mention renders as the formatted base quantity
 * (formatBQ). Rows of the step lists (`- 250 g Tortillas`) use the exact same
 * natural phrase grammar with a *required* name — see ./parse.ts.
 */

import { aqNotation, isAQValue } from '../aqLadder.js';
import { formatStoredNumber } from '../quantityValues.js';
import { parsePrecisionLevel, type PrecisionLevel } from '../precision.js';
import type { Unit } from './types.js';

/**
 * A quantity artifact (`{{1500 ml Wasser}}`, `{{100 g}}`, `{{1/2}}`). The
 * optional precision is the quantity-level override of the precision cascade.
 */
export interface QuantityArtifact {
  kind: 'quantity';
  /** Unrounded target amount; any positive finite number. */
  quantity: number;
  /**
   * Stored base unit (g or ml after normalization). Only quantity-only
   * artifacts may omit it (unitless count, e.g. `{{3}}`); an ingredient
   * mention always carries a unit.
   */
  unit?: Unit;
  /** Ingredient name; absent = quantity-only artifact (`{{100 g}}`). */
  name?: string;
  /**
   * Optional per-artifact precision (the quantity-level override). Stored as a
   * trailing `|precision: high` inside the braces, e.g.
   * `{{1/2|precision: high}}`. Absent = the ingredient-level value; a unitless
   * count has none and uses the internal neutral level.
   */
  precision?: PrecisionLevel;
}

/**
 * A size marker (`{{1 26 cm Backring|size}}`) — display-only equipment whose
 * nominal size follows the recipe quantity with the marker's own scaling law.
 * It carries no precision: there is no BQ/AQ candidate to score.
 */
export interface SizeArtifact {
  kind: 'size';
  /** Canonical marker key (e.g. `Backring`). */
  marker: string;
  /** Written count of molds; a positive integer. */
  count: number;
  /** Written nominal size of one mold, in the marker's unit. */
  size: number;
  /** Unit as written (e.g. `cm`); the marker definition owns the canonical unit. */
  unit: string;
}

/** One parsed inline artifact: a quantity or a size marker. */
export type TextArtifact = QuantityArtifact | SizeArtifact;

/** A parsed amount-first phrase, before it is classified as an artifact. */
export interface ParsedQuantityPhrase {
  quantity: number;
  unit?: Unit;
  name?: string;
}

/** True when the artifact is a size marker. */
export function isSizeArtifact(artifact: TextArtifact): artifact is SizeArtifact {
  return artifact.kind === 'size';
}

/** True when the artifact is a quantity artifact. */
export function isQuantityArtifact(artifact: TextArtifact): artifact is QuantityArtifact {
  return artifact.kind === 'quantity';
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
export type TextSegment =
  { type: 'text'; value: string } | { type: 'artifact'; artifact: TextArtifact };

/**
 * Any `{{ … }}` block (candidates for artifacts; the rest of a malformed block
 * is never silently treated as prose — see ./parse.ts).
 */
const CURLY_BLOCK_RE = /\{\{([^{}]*)\}\}/g;

/**
 * The natural amount-first phrase grammar shared by artifact contents and step
 * rows: `MENGE [EINHEIT] [NAME]`. The amount is an integer, a decimal with a
 * single `.` or `,` separator, a fraction (`1/3`) or a mixed number (`1+1/4`) —
 * the canonical AQ notation used for unitless quantities (the fractions are
 * plain display forms of the stored numeric value). The unit (g/kg/ml/l) is
 * optional — but only for a quantity-only phrase without a name (`{{100}}`); a
 * name requires a unit (otherwise `{{100 Teig}}` would be ambiguous). The name
 * is the trailing remainder (no `{`/`}`).
 */
const PHRASE_RE =
  /^\s*(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?(?:\s*\+\s*\d+\s*\/\s*\d+)?)\s*(kg|ml|l|g)?\s*([^{}]*)$/;

/**
 * The size-marker grammar: `{{ COUNT SIZE UNIT MARKER|size }}`, e.g.
 * `{{1 26 cm Backring|size}}` or `{{2 20 cm Backring|size}}`. The count is
 * always present — the display always shows it, including 1 — so the numbers
 * cannot be confused and the stored form states the written arrangement
 * explicitly. The unit is a free token; the marker definition validates it
 * against its canonical unit.
 */
const SIZE_PHRASE_RE = /^\s*(\d+)\s+(\d+(?:[.,]\d+)?)\s+([^\s{}|]+)\s+([^{}|]+?)\s*$/;

/**
 * Parses an amount written as an integer, a decimal (`.` or German `,`), a
 * fraction (`1/3`) or a mixed number (`1+1/4`) into its numeric value. Optical
 * spaces around `/` and `+` are tolerated. A zero denominator yields Infinity,
 * which the caller rejects via its finiteness check.
 */
function parseAmount(raw: string): number {
  const compact = raw.replace(/\s+/g, '');
  const plus = compact.indexOf('+');
  if (plus !== -1) {
    const integer = Number(compact.slice(0, plus).replace(',', '.'));
    const [numerator, denominator] = compact.slice(plus + 1).split('/');
    return integer + Number(numerator!.replace(',', '.')) / Number(denominator);
  }
  const slash = compact.indexOf('/');
  if (slash !== -1) {
    const [numerator, denominator] = compact.split('/');
    return Number(numerator!.replace(',', '.')) / Number(denominator);
  }
  return Number(compact.replace(',', '.'));
}

/**
 * Parses a natural amount-first phrase and normalizes it to the canonical
 * form. Returns null when the phrase is not a valid quantity phrase.
 *
 * @param phrase the phrase, e.g. `1500 ml Wasser`, `100 g`, `100`, `1,5 l Wasser`,
 *   `1/2` or `1+1/4`
 * @param requireName when true (rows), a phrase without a name is invalid
 * @returns the canonical phrase, or null
 */
export function parseIngredientPhrase(
  phrase: string,
  requireName = false,
): ParsedQuantityPhrase | null {
  const match = PHRASE_RE.exec(phrase);
  if (match === null) return null;
  const rawQuantity = parseAmount(match[1]!);
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

/**
 * Parses the phrase part of a size artifact (`1 26 cm Backring`). Returns null
 * for a missing count, a non-positive/non-integer count, a non-positive size,
 * or an empty unit/marker. Marker existence and the allowed size list are
 * checked by the recipe validator, which can report a precise issue.
 */
export function parseSizePhrase(phrase: string): SizeArtifact | null {
  const match = SIZE_PHRASE_RE.exec(phrase);
  if (match === null) return null;
  const count = Number(match[1]);
  const size = Number(match[2]!.replace(',', '.'));
  const marker = match[4]!.trim();
  if (!Number.isSafeInteger(count) || count < 1) return null;
  if (!Number.isFinite(size) || size <= 0) return null;
  if (marker === '') return null;
  return {
    kind: 'size',
    marker,
    count,
    size,
    unit: match[3]!,
  };
}

/**
 * Parses one `{{ … }}` content into an artifact.
 *
 * Two suffix forms exist:
 * - `|size` marks a size marker (`{{1 26 cm Backring|size}}`), whose phrase is
 *   the count/size/unit/marker grammar above;
 * - `|precision: high` marks the optional quantity-level precision of a
 *   quantity artifact.
 *
 * Returns null when the phrase is invalid, the precision level is unknown, or
 * a size marker also carries a precision suffix (a size marker has no
 * precision). The caller reports it as a malformed artifact.
 */
export function parseArtifactContent(content: string): TextArtifact | null {
  const sizeMatch = /\|\s*size\s*$/i.exec(content);
  if (sizeMatch !== null) {
    const phrase = content.slice(0, sizeMatch.index).trimEnd();
    return parseSizePhrase(phrase);
  }

  const precisionMatch = /\|precision:\s*([^|}]*)\s*$/i.exec(content);
  const phrase =
    precisionMatch === null ? content : content.slice(0, precisionMatch.index).trimEnd();
  const parsed = parseIngredientPhrase(phrase);
  if (parsed === null) return null;
  if (precisionMatch === null) return { kind: 'quantity', ...parsed };
  const precision = parsePrecisionLevel(precisionMatch[1]!);
  if (precision === undefined) return null;
  return { kind: 'quantity', ...parsed, precision };
}

/**
 * Returns the canonical stored text of an artifact (§4).
 *
 * A unitless quantity-only artifact stores its amount in the canonical AQ
 * fraction notation (`{{1/3}}`, `{{1+1/4}}`, `{{3}}`) — never as a decimal,
 * which for a fraction like 1/3 would be a long non-terminating value. An
 * amount that is not an AQ ladder value (a rejected hand-written file) falls
 * back to its plain numeric form so normalization never crashes; the parser
 * reports the value as invalid separately. Weighted and named artifacts keep
 * the family-unit decimal form (`{{1500 ml Wasser}}`).
 *
 * A size marker always writes its explicit count and the `|size` suffix:
 * `{{1 26 cm Backring|size}}`.
 */
export function artifactToText(artifact: TextArtifact): string {
  if (artifact.kind === 'size') {
    return (
      `{{${artifact.count} ${formatStoredNumber(artifact.size)} ` +
      `${artifact.unit} ${artifact.marker}|size}}`
    );
  }
  const base =
    artifact.unit === undefined
      ? isAQValue(artifact.quantity)
        ? aqNotation(artifact.quantity)
        : formatStoredNumber(artifact.quantity)
      : `${formatStoredNumber(artifact.quantity)} ${artifact.unit}`;
  const precision = artifact.precision === undefined ? '' : `|precision: ${artifact.precision}`;
  return artifact.name === undefined
    ? `{{${base}${precision}}}`
    : `{{${base} ${artifact.name}${precision}}}`;
}

/**
 * Splits a step text into prose segments and validated artifact spans (in
 * order). Every `{{ … }}` block is classified: a block whose content parses as
 * a quantity phrase or a `|size` marker becomes an artifact; anything else is
 * kept as prose text — the validator (./parse.ts) rejects such blocks before
 * they reach the editor, so a block is never silently dropped here.
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
    const artifact = parseArtifactContent(content);
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
