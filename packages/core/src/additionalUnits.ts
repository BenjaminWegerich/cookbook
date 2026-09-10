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
 * Exactness (§6.3): a unit marked exact in the master data fixes the base
 * amount per unit (a 400 g Becher, a 200 g Block). For those, the shown base
 * quantity is derived from the rounded AQ (AQ × factor), so count and amount
 * never contradict each other; approximate units (a carrot varies in weight)
 * keep showing the stored/scaled base quantity.
 *
 * The AQ ladder values are the fraction column of the standard number ladder
 * (docs/quantity_scaling.md §2); they live in ./aqLadder.ts, which derives them
 * from LADDER_RUNGS so that the ladder table stays the single source of truth.
 *
 * Naming: identifiers use the spec's abbreviations for the domain terms — aq
 * (additional quantity), au (additional unit), bq (base quantity), bu (base
 * unit) — consistently across functions, parameters and properties
 * (docs/CODING_CONVENTIONS.md).
 */

import { aqNotation, aqToNumber, roundToAQValue } from './aqLadder.js';
import { ADDITIONAL_UNITS, NUMBER_SCHEMES, type AdditionalUnit } from './additionalUnitsData.js';
import { pos } from './ladder.js';
import { allIngredientMappings, mappingsFor } from './ingredientRegistry.js';

/**
 * Narrow no-break space (U+202F), substituted for the <NNBSP> placeholder
 * (§8). Single definition of the typographic space between a number and its
 * unit for every display helper in core — the web app and the HTML export
 * render all quantity/duration text with it (docs/CODING_CONVENTIONS.md).
 * Stored files always keep plain ASCII spaces.
 */
export const NNBSP = '\u202F';

/** Additional units by name (names are unique — validated by the generator). */
const AU_BY_NAME: ReadonlyMap<string, AdditionalUnit> = new Map(
  ADDITIONAL_UNITS.map((au) => [au.name, au]),
);

const EMPTY_SCHEME: readonly string[] = [];

/**
 * All ingredient names present in the additional-unit master data
 * (docs/ingredient_unit_mappings.csv), sorted alphabetically.
 *
 * Used by the recipe editor's ingredient autocomplete: as the user types a
 * name, the matching master-data ingredients are suggested. Reads the runtime
 * registry (ingredientRegistry.ts), so user-added ingredients from the Drive
 * master data appear too; anything unregistered renders in the base form (§4).
 */
export function masterIngredientNames(): string[] {
  return Object.keys(allIngredientMappings()).sort((a, b) => a.localeCompare(b, 'de'));
}

/**
 * Rounds a raw quantity to the nearest AQ ladder value (§6.1), measured by
 * absolute difference on the value scale. Exact ties resolve toward the larger
 * value. Returns null when `raw` lies below the smallest AQ value (1/10) or
 * above the largest (1000) — the ingredient is then rendered in its base form.
 */
export function roundToAQ(raw: number): string | null {
  const value = roundToAQValue(raw);
  return value === null ? null : aqNotation(value);
}

/** The result of a successful additional-quantity selection (§6). */
export interface AdditionalQuantity {
  /** Canonical AQ fraction form, e.g. "1+1/2" (§8). */
  readonly aq: string;
  /** The selected additional unit. */
  readonly au: AdditionalUnit;
  /**
   * The selected mapping's conversion factor (base unit per one AU). Used by
   * §6.3 to derive the shown base quantity for exact units.
   */
  readonly factor: number;
}

/**
 * Selects the additional quantity specification for an ingredient (§6).
 *
 * Mappings are evaluated in ascending priority order (the generated data is
 * pre-sorted); the first mapping whose rounded AQ passes its number scheme
 * wins. An ingredient whose master-data base unit differs from `bu` has no
 * applicable AQS (§7) — the conversion factor is expressed in the
 * ingredient's fixed base unit.
 *
 * @param ingredient ingredient name (key into INGREDIENT_MAPPINGS)
 * @param bq stored base quantity — must be a standard ladder value (§3, else throws)
 * @param bu stored base unit (g / kg / ml / l)
 * @returns the selected AQ + AU, or null when no AQS applies (base form)
 */
export function selectAQ(ingredient: string, bq: number, bu: string): AdditionalQuantity | null {
  // Rejects non-standard base quantities (§3): they do not exist in the app.
  pos(bq);
  const entry = mappingsFor(ingredient);
  // No master-data entry (unregistered name) or a mismatched base unit — and
  // bare ingredients (empty entries) — have no AQS (§7): base form only.
  if (entry === undefined || entry.bu !== bu) {
    return null;
  }
  for (const mapping of entry.entries) {
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
      return { aq, au, factor: mapping.factor };
    }
  }
  return null;
}

/**
 * Formats a number for display with the German decimal comma
 * (docs/CODING_CONVENTIONS.md): whole numbers stay as-is ("400"), fractional
 * values use a comma ("1,5", "0,25"). This is a display-layer rule only —
 * stored files always keep the canonical plain forms. Never build numbers by
 * hand for user-visible text; always pass them through this helper (or a
 * formatter built on it like `formatBQ`).
 */
export function formatDecimal(value: number): string {
  return String(value).replace('.', ',');
}

/**
 * Formats a base quantity for display (decided with the user): quantities are
 * stored in the family unit g or ml, and the display switches to kg / l at
 * 1000 ("right between 750 and 1000, the unit changes"). Values below 1000
 * are shown as-is ("400 g", "750 ml"); at and above 1000 the unit steps up
 * ("1 kg", "1,2 kg", "1 l"). Stored kg/l (legacy files) are shown unchanged.
 * Decimal fractions always use the German comma (`formatDecimal`). Number and
 * unit are separated by a narrow no-break space (U+202F), like all quantity
 * displays in the app (§8).
 */
export function formatBQ(bq: number, bu: string): string {
  if (bu === 'g' && bq >= 1000) {
    return `${formatDecimal(bq / 1000)}${NNBSP}kg`;
  }
  if (bu === 'ml' && bq >= 1000) {
    return `${formatDecimal(bq / 1000)}${NNBSP}l`;
  }
  return `${formatDecimal(bq)}${NNBSP}${bu}`;
}

/**
 * The Unicode fraction glyphs of the AQ fractions (docs/additional_quantity_
 * specifications.md §8): a proper fraction displays as a single glyph, a mixed
 * number as integer + narrow no-break space + glyph ("1 ¼"). AQ values that are
 * whole numbers (1, 2, 10, 12, …) have no glyph and stay as they are.
 */
const AQ_GLYPHS: Readonly<Record<string, string>> = {
  '1/10': '\u2152', // ⅒
  '1/9': '\u2151', // ⅑
  '1/8': '\u215B', // ⅛
  '1/6': '\u2159', // ⅙
  '1/5': '\u2155', // ⅕
  '1/4': '\u00BC', // ¼
  '1/3': '\u2153', // ⅓
  '3/8': '\u215C', // ⅜
  '2/5': '\u2156', // ⅖
  '1/2': '\u00BD', // ½
  '3/5': '\u2157', // ⅗
  '2/3': '\u2154', // ⅔
  '3/4': '\u00BE', // ¾
  '7/8': '\u215E', // ⅞
};

/**
 * Formats a canonical AQ fraction ("1/2", "1+1/4") in the display typography
 * of §8: glyphs for the proper fractions and a narrow no-break space between
 * the integer and the glyph of a mixed number ("1 ¼"). Whole AQ values pass
 * through unchanged. A fraction without a glyph (none exists today) keeps its
 * canonical form so a new ladder row never renders as garbage.
 */
export function formatAQ(aq: string): string {
  const glyph = AQ_GLYPHS[aq];
  if (glyph !== undefined) return glyph;
  const plus = aq.indexOf('+');
  if (plus === -1) return aq;
  const integer = aq.slice(0, plus);
  const fraction = aq.slice(plus + 1);
  return `${integer}${NNBSP}${AQ_GLYPHS[fraction] ?? fraction}`;
}

/**
 * Formats a numeric AQ value in the §8 typography (0.25 → "¼", 1.25 → "1 ¼").
 * Used for unitless inline quantities, which are AQ ladder values. Throws when
 * `value` is not an AQ value — non-standard numbers do not exist in the app.
 */
export function formatAQValue(value: number): string {
  return formatAQ(aqNotation(value));
}

/**
 * Renders the full display line for an ingredient (§4): the selected unit's
 * arrangement template with <AQ> <AU> <IN> <BQ> <BU> and <NNBSP> (U+202F)
 * substituted, or the base form "<BQ> <BU> <IN>" when no AQS applies. The AQ
 * itself is rendered in the §8 glyph typography (`formatAQ`).
 *
 * The shown base quantity is the stored value (`formatBQ`) — except for an
 * **exact** unit (§6.3): its factor defines the base amount (a 200 g Block),
 * so rounding the AQ to the nearest fraction of that unit would contradict the
 * shown count ("8 Blöcke (1,5 kg)"). For exact units the shown base quantity is
 * therefore derived from the rounded AQ instead (AQ × factor), even when the
 * result is not a ladder value. Approximate units (a carrot varies in weight)
 * keep the stored/scaled value, which is the preferred reading there: the
 * rounding stays visible in the count only. Storage and scaling are untouched
 * either way.
 */
export function renderAQS(ingredient: string, bq: number, bu: string): string {
  const selected = selectAQ(ingredient, bq, bu);
  if (selected === null) {
    return `${formatBQ(bq, bu)} ${ingredient}`;
  }
  // Exact unit (§6.3): the count is the source of truth for the shown amount.
  const shownBq = selected.au.exact ? aqToNumber(selected.aq) * selected.factor : bq;
  // The arrangement binds <BQ> and <BU> together with a narrow no-break
  // space; substitute that pair with the formatted base quantity first (the
  // <NNBSP> placeholder is consumed here, before the general substitution).
  return selected.au.arrangement
    .replace('<BQ><NNBSP><BU>', formatBQ(shownBq, bu))
    .replaceAll('<AQ>', formatAQ(selected.aq))
    .replaceAll('<AU>', selected.au.name)
    .replaceAll('<IN>', ingredient)
    .replaceAll('<NNBSP>', NNBSP);
}
