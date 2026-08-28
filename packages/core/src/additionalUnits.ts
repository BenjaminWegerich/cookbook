/**
 * Additional-quantity selection and display
 * (docs/additional_quantity_specifications.md).
 *
 * Given an ingredient, its stored base quantity (bq) and base unit (bu), this
 * module decides whether an additional quantity specification (AQS) applies and
 * renders the display line. The additional quantity is always computed from the
 * stored base quantity — it is never stored, authored, or scaled directly
 * (§1): after scaling, the display is simply recomputed from the scaled bq.
 *
 * Selection (§6): the ingredient's mappings are tried in ascending priority
 * order; for each, raw = bq ÷ factor is rounded to the nearest AQ ladder value
 * (§6.1, tie → larger) and checked against the unit's number scheme; the first
 * mapping whose AQ passes is selected. If none passes, the base form is shown.
 *
 * The AQ ladder values are the fraction column of the standard number ladder
 * (docs/quantity_scaling.md §2); their numeric values are derived from
 * LADDER_RUNGS here so that the ladder table stays the single source of truth.
 *
 * Naming: identifiers use the spec's abbreviations for the domain terms — aq
 * (additional quantity), au (additional unit), bq (base quantity), bu (base
 * unit) — consistently across functions, parameters and properties
 * (docs/CODING_CONVENTIONS.md).
 */

import {
  ADDITIONAL_UNITS,
  INGREDIENT_MAPPINGS,
  NUMBER_SCHEMES,
  type AdditionalUnit,
  type IngredientMapping,
} from './additionalUnitsData.js';
import { LADDER_RUNGS } from './ladderData.js';
import { pos } from './ladder.js';

/** Smallest AQ ladder value (1/10); below it no additional quantity exists (§6.1). */
const MIN_AQ = 0.1;
/** Largest AQ ladder value (1000); above it no additional quantity exists (§6.1). */
const MAX_AQ = 1000;
/** Narrow no-break space (U+202F), substituted for the <NNBSP> placeholder (§8). */
const NNBSP = '\u202F';

/** One distinct AQ ladder value together with its numeric form. */
interface AQEntry {
  readonly aq: string;
  readonly value: number;
}

/** Additional units by name (names are unique — validated by the generator). */
const AU_BY_NAME: ReadonlyMap<string, AdditionalUnit> = new Map(
  ADDITIONAL_UNITS.map((au) => [au.name, au]),
);

const EMPTY_MAPPINGS: readonly IngredientMapping[] = [];
const EMPTY_SCHEME: readonly string[] = [];

/**
 * All ingredient names present in the additional-unit master data
 * (docs/ingredient_unit_mappings.csv), sorted alphabetically.
 *
 * Used by the recipe editor's ingredient autocomplete: as the user types a
 * name, the matching master-data ingredients are suggested. The list is
 * currently small (the CSVs are curated over time); anything else is entered
 * as free text and simply renders in the base form (§4).
 */
export function masterIngredientNames(): string[] {
  return Object.keys(INGREDIENT_MAPPINGS).sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Parses a canonical AQ fraction ("a", "a/b" or "a+b/c") to its numeric value.
 * The strings come from the generated ladder data (validated at generation
 * time), so no error handling is needed here.
 */
function aqToNumber(aq: string): number {
  const plus = aq.indexOf('+');
  const slash = aq.indexOf('/');
  if (plus !== -1) {
    const integer = Number(aq.slice(0, plus));
    const fraction = aq.slice(plus + 1);
    const slashInFraction = fraction.indexOf('/');
    return (
      integer +
      Number(fraction.slice(0, slashInFraction)) / Number(fraction.slice(slashInFraction + 1))
    );
  }
  if (slash !== -1) {
    return Number(aq.slice(0, slash)) / Number(aq.slice(slash + 1));
  }
  return Number(aq);
}

/**
 * The distinct AQ ladder values with numeric forms, ascending — the lookup
 * table for the §6.1 rounding. Duplicate strings (e.g. "1/4" on two rungs)
 * occur once: the rounding result is the displayed fraction, not the rung.
 */
const AQ_VALUES: readonly AQEntry[] = [
  ...new Map(LADDER_RUNGS.map((rung) => [rung.aq, aqToNumber(rung.aq)])),
]
  .map(([aq, value]) => ({ aq, value }))
  .sort((a, b) => a.value - b.value);

/**
 * Rounds a raw quantity to the nearest AQ ladder value (§6.1), measured by
 * absolute difference on the value scale. Exact ties resolve toward the larger
 * value. Returns null when `raw` lies below the smallest AQ value (1/10) or
 * above the largest (1000) — the ingredient is then rendered in its base form.
 */
export function roundToAQ(raw: number): string | null {
  if (!(raw > 0) || !Number.isFinite(raw)) {
    throw new Error(`roundToAQ: raw must be a positive finite number, got ${raw}`);
  }
  if (raw < MIN_AQ || raw > MAX_AQ) {
    return null;
  }
  let best: AQEntry | undefined;
  let bestDiff = Infinity;
  for (const entry of AQ_VALUES) {
    const diff = Math.abs(raw - entry.value);
    // AQ_VALUES is ascending, so on an exact tie the later entry is the larger
    // value — exactly the §6.1 tie rule.
    if (best === undefined || diff < bestDiff || (diff === bestDiff && entry.value > best.value)) {
      best = entry;
      bestDiff = diff;
    }
  }
  // Unreachable: AQ_VALUES is non-empty and `raw` is within [MIN_AQ, MAX_AQ].
  return best!.aq;
}

/** The result of a successful additional-quantity selection (§6). */
export interface AdditionalQuantity {
  /** Canonical AQ fraction form, e.g. "1+1/2" (§8). */
  readonly aq: string;
  /** The selected additional unit. */
  readonly au: AdditionalUnit;
}

/**
 * Selects the additional quantity specification for an ingredient (§6).
 *
 * Mappings are evaluated in ascending priority order (the generated data is
 * pre-sorted); the first mapping whose rounded AQ passes its number scheme
 * wins. Mappings whose base unit differs from `bu` are skipped — the
 * conversion factor is expressed in the ingredient's fixed base unit (§7).
 *
 * @param ingredient ingredient name (key into INGREDIENT_MAPPINGS)
 * @param bq stored base quantity — must be a standard ladder value (§3, else throws)
 * @param bu stored base unit (g / kg / ml / l)
 * @returns the selected AQ + AU, or null when no AQS applies (base form)
 */
export function selectAQ(ingredient: string, bq: number, bu: string): AdditionalQuantity | null {
  // Rejects non-standard base quantities (§3): they do not exist in the app.
  pos(bq);
  for (const mapping of INGREDIENT_MAPPINGS[ingredient] ?? EMPTY_MAPPINGS) {
    if (mapping.bu !== bu) {
      continue;
    }
    const aq = roundToAQ(bq / mapping.factor);
    if (aq === null) {
      continue;
    }
    const au = AU_BY_NAME.get(mapping.au);
    if (au === undefined) {
      // Unreachable with generator-validated data (mappings reference existing units).
      continue;
    }
    const allowed = NUMBER_SCHEMES[au.numberScheme] ?? EMPTY_SCHEME;
    if (allowed.includes(aq)) {
      return { aq, au };
    }
  }
  return null;
}

/**
 * Formats a base quantity for display (decided with the user): quantities are
 * stored in the family unit g or ml, and the display switches to kg / l at
 * 1000 ("right between 750 and 1000, the unit changes"). Values below 1000
 * are shown as-is ("400 g", "750 ml"); at and above 1000 the unit steps up
 * ("1 kg", "1.2 kg", "1 l"). Stored kg/l (legacy files) are shown unchanged.
 * Number and unit are separated by a narrow no-break space (U+202F), like all
 * quantity displays in the app (§8).
 */
export function formatBQ(bq: number, bu: string): string {
  if (bu === 'g' && bq >= 1000) {
    return `${bq / 1000}${NNBSP}kg`;
  }
  if (bu === 'ml' && bq >= 1000) {
    return `${bq / 1000}${NNBSP}l`;
  }
  return `${bq}${NNBSP}${bu}`;
}

/**
 * Renders the full display line for an ingredient (§4): the selected unit's
 * arrangement template with <AQ> <AU> <IN> <BQ> <BU> and <NNBSP> (U+202F)
 * substituted, or the base form "<BQ> <BU> <IN>" when no AQS applies. The base
 * quantity is displayed with the kg/l conversion (`formatBQ`) — the stored
 * value and the AQ computation are untouched (rounding affects only the
 * additional quantity, §4).
 */
export function renderAQS(ingredient: string, bq: number, bu: string): string {
  const selected = selectAQ(ingredient, bq, bu);
  if (selected === null) {
    return `${formatBQ(bq, bu)} ${ingredient}`;
  }
  // The arrangement binds <BQ> and <BU> together with a narrow no-break
  // space; substitute that pair with the formatted base quantity first (the
  // <NNBSP> placeholder is consumed here, before the general substitution).
  return selected.au.arrangement
    .replace('<BQ><NNBSP><BU>', formatBQ(bq, bu))
    .replaceAll('<AQ>', selected.aq)
    .replaceAll('<AU>', selected.au.name)
    .replaceAll('<IN>', ingredient)
    .replaceAll('<NNBSP>', NNBSP);
}
