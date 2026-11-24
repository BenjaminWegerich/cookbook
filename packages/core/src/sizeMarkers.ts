/**
 * Size markers — display-only equipment sizes that scale with the recipe.
 *
 * A size marker is a third kind of inline artifact beside an ingredient use and
 * a plain quantity (docs/storage_format.md §4):
 *
 *   {{1 26 cm Backring|size|case:akk}}   prose: "einen 26er Backring"
 *   {{2 20 cm Backring|size|case:akk}}   prose: "zwei 20er Backringe"
 *
 * The recipe stores the written arrangement (count + nominal size) and the
 * grammatical case of its sentence slot. Scaling is derived at render time from
 * the same exact factor that scales the ingredients. The scaling law belongs to
 * the marker definition, not to the recipe:
 *
 * - `linear` — the size is proportional to the quantity (exponent 1);
 * - `area`   — the quantity is proportional to the size squared (exponent 2),
 *              e.g. a round cake ring whose height stays constant;
 * - `volume` — the quantity is proportional to the size cubed (exponent 3).
 *
 * For `area` a doubled recipe therefore increases the ring's diameter by √2,
 * not by 2. The diameter is a physical dimension; the *batter quantity* is the
 * quadratic quantity the user sees in the ingredient list.
 *
 * Two surfaces render the same resolved arrangement with deliberately different
 * grammar:
 *
 * - `prose` is a sentence slot. A count of 1 becomes the indefinite article in
 *   the stored case and the marker's gender ("ein/einen/einem"), counts 2–12 are
 *   written out ("zwei" … "zwölf"), counts 13+ stay numerals, and the noun
 *   follows the case (the dative plural takes its mandatory -n, e.g.
 *   "Backringen"). A legacy artifact without a `|case:` suffix keeps the old
 *   numeral form ("1 26er Backring") so stored recipes do not change silently.
 * - `readout` is the bare nominative label of the reference readout. A count of
 *   1 is omitted ("26er Backring"); 2+ stay numerals ("2 22er Backringe").
 *
 * Count rule: if the calculated equivalent diameter exceeds the largest
 * available size, the batter is split into equal molds. `N` is the smallest
 * number of molds whose ideal per-mold diameter still fits the largest size;
 * the nominal size is then the nearest available one (relative distance, tie
 * to the larger size). This is the “above 30 I use multiple cakes” rule, made
 * data-driven by the marker's `Sizes` list.
 *
 * Precision is deliberately absent: there is no BQ/AQ candidate to score and
 * no target amount to display differently. The result is fully determined by
 * the marker definition, the written arrangement, the stored case and the
 * recipe factor.
 */

import { formatDecimal } from './additionalUnits.js';
import {
  SIZE_MARKERS,
  type SizeMarkerDefinition,
  type SizeMarkerGender,
  type SizeMarkerScale,
} from './sizeMarkersData.js';

/** Exponent of each scaling law: quantity ∝ size^exponent. */
const SCALE_EXPONENTS: Readonly<Record<SizeMarkerScale, number>> = {
  linear: 1,
  area: 2,
  volume: 3,
};

/** Floating-point noise guard for the ceiling count and the nearest-size tie. */
const EPSILON = 1e-9;

/** Grammatical case of a prose size phrase (genitive is not supported yet). */
export type SizeMarkerCase = 'nom' | 'akk' | 'dat';

/** Which surface renders the derived arrangement. */
export type SizeMarkerSurface = 'prose' | 'readout';

/** Options for formatting one derived arrangement. */
export interface SizeMarkerFormatOptions {
  /** Prose inflects; readout is the bare nominative reference label. */
  readonly surface: SizeMarkerSurface;
  /**
   * Case of the prose slot. Absent = legacy numeral prose ("1 26er Backring");
   * `resolveSizeMarker` falls back to the stored artifact's case.
   */
  readonly grammaticalCase?: SizeMarkerCase;
}

/**
 * Written German cardinal numbers 2–12. They are invariant in nom/akk/dat
 * before a noun; only "ein" declines, so the article table below is enough for
 * the supported cases. Counts 13 and above stay numerals (Duden convention).
 */
const NUMBER_WORDS: Readonly<Record<number, string>> = {
  2: 'zwei',
  3: 'drei',
  4: 'vier',
  5: 'fünf',
  6: 'sechs',
  7: 'sieben',
  8: 'acht',
  9: 'neun',
  10: 'zehn',
  11: 'elf',
  12: 'zwölf',
};

/** Counts up to this value are written out in prose; numerals start above it. */
const NUMBER_WORD_LIMIT = 12;

/** Indefinite articles by gender and case (genitive is not supported). */
const INDEFINITE_ARTICLES: Readonly<
  Record<SizeMarkerGender, Readonly<Record<SizeMarkerCase, string>>>
> = {
  m: { nom: 'ein', akk: 'einen', dat: 'einem' },
  f: { nom: 'eine', akk: 'eine', dat: 'einer' },
  n: { nom: 'ein', akk: 'ein', dat: 'einem' },
};

/** The current marker registry; starts as the built-in seed. */
let registry: readonly SizeMarkerDefinition[] = SIZE_MARKERS;

/** One size marker use as stored in the recipe (a structural subset of the artifact). */
export interface SizeMarkerUse {
  /** Canonical marker key, e.g. `Backring`. */
  readonly marker: string;
  /** Written count of molds (a positive integer). */
  readonly count: number;
  /** Written nominal size of one mold, in the marker's unit. */
  readonly size: number;
  /**
   * Grammatical case of the prose slot, stored as `|case:akk` etc. Absent for a
   * legacy artifact, which renders the old numeral prose.
   */
  readonly grammaticalCase?: SizeMarkerCase;
}

/**
 * The derived display of one size marker at a recipe size.
 *
 * `idealSize` is the exact per-mold size before snapping to the available list;
 * it is kept for the live preview (e.g. “rechnerisch 22,5 cm”) and tests. The
 * displayed `size` is always one of the marker's allowed nominal sizes.
 */
export interface ResolvedSizeMarker {
  /** Number of equal molds to use (always at least 1). */
  readonly count: number;
  /** Nominal size of one mold, chosen from the marker's allowed sizes. */
  readonly size: number;
  /** Exact per-mold size before snapping (calculated, not displayed). */
  readonly idealSize: number;
  /** Complete display text for the requested surface, e.g. `zwei 22er Backringe`. */
  readonly text: string;
}

/** All registered size markers, in master-data order. */
export function allSizeMarkers(): readonly SizeMarkerDefinition[] {
  return registry;
}

/** The definition of one marker, or undefined when the key is unknown. */
export function sizeMarkerFor(marker: string): SizeMarkerDefinition | undefined {
  const key = marker.trim();
  return registry.find((definition) => definition.marker === key);
}

/**
 * Replaces the whole marker registry (used later when the collection's master
 * data is loaded from Drive). The built-in seed remains the default.
 */
export function setSizeMarkers(markers: readonly SizeMarkerDefinition[]): void {
  registry = markers;
}

/** Restores the built-in seed (used by tests between cases). */
export function resetSizeMarkers(): void {
  registry = SIZE_MARKERS;
}

/**
 * The nearest allowed nominal size to `ideal`, by relative distance (the same
 * log-distance idea as the quantity optimizer). A tie goes to the larger size,
 * mirroring the optimizer's higher-BQ tie-break; a value below the smallest
 * entry therefore snaps up to the smallest mold.
 */
function nearestSize(sizes: readonly number[], ideal: number): number {
  let best = sizes[0]!;
  let bestDistance = Math.abs(Math.log(best / ideal));
  for (const size of sizes.slice(1)) {
    const distance = Math.abs(Math.log(size / ideal));
    if (distance < bestDistance - EPSILON) {
      best = size;
      bestDistance = distance;
    } else if (Math.abs(distance - bestDistance) <= EPSILON && size > best) {
      best = size;
    }
  }
  return best;
}

/**
 * The noun form of a prose phrase: singular for one mold; plural otherwise,
 * with the dative plural's mandatory -n (German rule: add -n unless the plural
 * already ends in -n or -s). Strong equipment nouns therefore need no extra
 * master-data column for the dative.
 */
function proseNoun(
  definition: SizeMarkerDefinition,
  count: number,
  grammaticalCase: SizeMarkerCase,
): string {
  if (count === 1) return definition.singular;
  const plural = definition.plural;
  if (grammaticalCase === 'dat' && !plural.endsWith('n') && !plural.endsWith('s')) {
    return `${plural}n`;
  }
  return plural;
}

/**
 * The `<DET>` slot of a prose phrase:
 * - count 1 takes the indefinite article in the stored case and the marker's
 *   gender ("ein/einen/einem", "eine/einer", "ein/einem");
 * - counts 2–12 take the written number word (invariant in nom/akk/dat);
 * - counts 13+ keep the numeral.
 */
function proseDeterminer(
  definition: SizeMarkerDefinition,
  count: number,
  grammaticalCase: SizeMarkerCase,
): string {
  if (count === 1) return INDEFINITE_ARTICLES[definition.gender][grammaticalCase];
  if (count <= NUMBER_WORD_LIMIT) return NUMBER_WORDS[count] ?? String(count);
  return String(count);
}

/**
 * Formats one derived arrangement with the marker's display pattern.
 *
 * The pattern contains `<DET>`, `<SIZE>`, `<UNIT>` and `<INF>`; this function
 * decides what `<DET>` and `<INF>` contain for the requested surface, while the
 * pattern only controls where they sit. A new marker with a different phrase
 * order is therefore a CSV row, not a code change.
 *
 * Prose inflects the phrase (see {@link proseDeterminer} and {@link proseNoun});
 * a legacy artifact without a case keeps the old numeral form. The readout is a
 * bare nominative label: a count of 1 is omitted, 2+ keep the numeral.
 */
export function formatSizeMarker(
  definition: SizeMarkerDefinition,
  count: number,
  size: number,
  options: SizeMarkerFormatOptions = { surface: 'prose' },
): string {
  let determiner: string;
  let noun: string;
  if (options.surface === 'readout') {
    // The readout is an amount label, not a sentence: no article, no written
    // number, no case inflection. One mold reads "26er Backring", two read
    // "2 22er Backringe".
    determiner = count === 1 ? '' : String(count);
    noun = count === 1 ? definition.singular : definition.plural;
  } else if (options.grammaticalCase === undefined) {
    // Legacy artifact (no |case: suffix): keep the old numeral prose so an
    // unedited stored recipe does not change silently.
    determiner = String(count);
    noun = count === 1 ? definition.singular : definition.plural;
  } else {
    determiner = proseDeterminer(definition, count, options.grammaticalCase);
    noun = proseNoun(definition, count, options.grammaticalCase);
  }
  const text = definition.pattern
    .replaceAll('<DET>', determiner)
    .replaceAll('<SIZE>', formatDecimal(size))
    .replaceAll('<UNIT>', definition.unit)
    .replaceAll('<INF>', noun);
  // An empty determiner (readout of one mold) leaves the pattern's separating
  // space; one collapsed pass keeps "26er Backring" free of a leading space.
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Derives the displayed arrangement for one marker use at a recipe factor.
 *
 * @param use the written arrangement (marker key, count, nominal size, case)
 * @param factor exact recipe scale factor (requested / written size)
 * @param options surface to render; the case defaults to the artifact's stored
 *   `grammaticalCase`, and an explicit option overrides it
 * @returns the derived display, or undefined for an unknown marker, an
 *   invalid factor, or a non-positive base count/size (draft data). Callers
 *   fall back to the written text in that case; validation reports the issue.
 */
export function resolveSizeMarker(
  use: SizeMarkerUse,
  factor: number,
  options: SizeMarkerFormatOptions = { surface: 'prose' },
): ResolvedSizeMarker | undefined {
  const definition = sizeMarkerFor(use.marker);
  if (definition === undefined) return undefined;
  if (!Number.isFinite(factor) || factor <= 0) return undefined;
  if (!Number.isInteger(use.count) || use.count < 1) return undefined;
  if (!Number.isFinite(use.size) || use.size <= 0) return undefined;

  const sizes = definition.sizes;
  if (sizes.length === 0) return undefined;
  const largest = sizes[sizes.length - 1]!;
  const exponent = SCALE_EXPONENTS[definition.scale];
  const grammaticalCase = options.grammaticalCase ?? use.grammaticalCase;
  const formatOptions: SizeMarkerFormatOptions =
    grammaticalCase === undefined
      ? { surface: options.surface }
      : { surface: options.surface, grammaticalCase };

  // f = 1 is the written recipe: keep its arrangement identity, even when a
  // larger available mold would happen to cover the same area with fewer molds.
  if (factor === 1) {
    return {
      count: use.count,
      size: use.size,
      idealSize: use.size,
      text: formatSizeMarker(definition, use.count, use.size, formatOptions),
    };
  }

  // Quantity proxy: the total batter area/volume the written arrangement
  // represents, scaled by the recipe factor. Splitting into N equal molds
  // divides it by N.
  const total = factor * use.count * use.size ** exponent;
  const rawCount = total / largest ** exponent;
  const count = Math.max(1, Math.ceil(rawCount - EPSILON));
  const idealSize = (total / count) ** (1 / exponent);
  const size = nearestSize(sizes, idealSize);

  return {
    count,
    size,
    idealSize,
    text: formatSizeMarker(definition, count, size, formatOptions),
  };
}

/**
 * The written text of a size artifact, used as a safe fallback while a draft
 * references an unknown marker or an invalid arrangement. It never throws and
 * never consults the registry.
 */
export function sizeMarkerFallbackText(use: SizeMarkerUse & { readonly unit: string }): string {
  return `${use.count} ${formatDecimal(use.size)} ${use.unit} ${use.marker}`;
}
