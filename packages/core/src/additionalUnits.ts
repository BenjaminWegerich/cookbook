/**
 * Additional-quantity selection and display
 * (docs/additional_quantity_specifications.md).
 *
 * Given an ingredient, its unrounded target (V0) and base unit (bu), this
 * module decides whether an additional quantity specification (AQS) applies and
 * renders the display line. The target is stored in the recipe; the BQ/AQ pair
 * is a display convenience computed by `quantityOptimizer.ts` on every render.
 *
 * Selection: the optimizer scores every compatible unit and every
 * scheme-allowed AQ value (docs/recipe_scaling_algorithm.md §5–§6); the old
 * priority scan is gone. If no candidate fits, the plain base form is shown.
 *
 * Exactness (§6.3): a unit marked exact in the master data fixes the base
 * amount per unit (a 400 g Becher, a 200 g Block). For those, the shown base
 * quantity is derived from the rounded AQ (AQ × factor), so count and amount
 * never contradict each other; approximate units (a carrot varies in weight)
 * keep showing the stored/scaled base quantity.
 *
 * The AQ values live in the generated `quantityData.ts` (docs/AQs.csv). The
 * legacy `aqLadder.ts` is kept only for the shopping/pantry helpers until their
 * migration; the recipe display uses the optimizer directly.
 *
 * Naming: identifiers use the spec's abbreviations for the domain terms — aq
 * (additional quantity), au (additional unit), bq (base quantity), bu (base
 * unit) — consistently across functions, parameters and properties
 * (docs/CODING_CONVENTIONS.md).
 */

import { AQ_MAX, aqNotation, aqToNumber, isAQValue, roundToAQValue } from './aqLadder.js';
import {
  ADDITIONAL_UNITS,
  NUMBER_SCHEMES,
  type AdditionalUnit,
  type IngredientEntry,
} from './additionalUnitsData.js';
import { allIngredientMappings, mappingsFor } from './ingredientRegistry.js';
import {
  optimizeAggregateQuantity,
  optimizeMasterQuantity,
  optimizeQuantity,
  type AggregateQuantityUse,
  type MasterQuantityUse,
  type OptimizedQuantity,
} from './quantityOptimizer.js';
import type { PrecisionContext } from './precision.js';

/**
 * Narrow no-break space (U+202F), substituted for the <NNBSP> placeholder
 * (§8). Single definition of the typographic space between a number and its
 * unit for every display helper in core — the web app and the HTML export
 * render all quantity/duration text with it (docs/CODING_CONVENTIONS.md).
 * Stored files always keep plain ASCII spaces.
 */
export const NNBSP = '\u202F';

/**
 * En space (U+2002) that separates a display line from its note (§4): the web
 * app and the HTML export put it before the muted, italic note that used to
 * stand in parentheses. A step text keeps a regular space and its brackets
 * instead (docs/DESIGN.md §5.11).
 */
export const EN_SPACE = '\u2002';

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
 * The parts of an ingredient entry that drive the arrangement: its fixed base
 * unit, its AU mappings and its Singular/Plural display forms. The reorder point
 * takes no part in it, so a **draft** entry — the create form's not-yet-saved
 * mapping rows — can be rendered from directly (see selectAQForEntry and
 * renderSelectedAQ).
 */
export type AuSelectableEntry = Pick<
  IngredientEntry,
  'bu' | 'entries' | 'singular' | 'plural' | 'precision'
>;

/**
 * Selects the additional quantity specification for an explicit entry — the
 * optimizer-backed replacement of the old priority scan.
 *
 * The optimizer scores every compatible unit and every scheme-allowed AQ
 * value; a null result means no AQ candidate won, so the caller renders the
 * base form. The precision context is passed through unchanged (quantity /
 * ingredient); the entry's own precision is the mandatory ingredient level.
 *
 * @param entry the ingredient's base unit, precision and AU mappings, or
 *   undefined when the name is not registered
 * @param bq the unrounded target V0 in `bu`
 * @param bu the base unit family the target is expressed in (g / ml)
 * @param context optional quantity/ingredient precision overrides
 * @returns the selected AQ + AU, or null when the base form is the winner
 */
export function selectAQForEntry(
  entry: AuSelectableEntry | undefined,
  bq: number,
  bu: string,
  context: PrecisionContext = {},
): AdditionalQuantity | null {
  const result = optimizeQuantity(bq, entry, bu, context);
  if (result.aq === undefined) return null;
  return { aq: result.aq.notation, au: result.aq.au, factor: result.aq.factor };
}

/**
 * Selects the additional quantity specification for a registered ingredient
 * (§6) — the registry-backed shorthand of selectAQForEntry.
 *
 * @param ingredient ingredient name (key into INGREDIENT_MAPPINGS)
 * @param bq the unrounded target V0 (any positive finite number)
 * @param bu stored base unit (g / kg / ml / l)
 * @returns the selected AQ + AU, or null when no AQS applies (base form)
 */
export function selectAQ(
  ingredient: string,
  bq: number,
  bu: string,
  context: PrecisionContext = {},
): AdditionalQuantity | null {
  return selectAQForEntry(mappingsFor(ingredient), bq, bu, context);
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
 * The display step each family base unit takes at 1000 (`formatBQ`): a gram
 * quantity reads as kilograms ("1,15 kg"), a millilitre quantity as litres.
 * This table is the single source of the step, so the formatter and the line
 * vocabulary (`BASE_UNIT_TOKENS`) cannot drift apart.
 */
const DISPLAY_STEP: Readonly<Record<string, string>> = { g: 'kg', ml: 'l' };

/**
 * The base-unit tokens the app itself writes on a shopping line: the g/ml
 * family plus the display steps of `formatBQ` ("850 g Mehl", "1,15 kg Butter").
 *
 * This is half of the unit vocabulary a shopping line's decoration is undone
 * with (docs/shopping_item_identity.md §2); the other half is the additional
 * units that some ingredient–unit mapping flags as its shopping unit. Both
 * halves are derived, never a hand-kept copy of the whole vocabulary, so adding
 * a unit to the master data cannot silently stop the app's own lines from
 * resolving.
 */
export const BASE_UNIT_TOKENS: readonly string[] = [
  ...Object.keys(DISPLAY_STEP),
  ...Object.values(DISPLAY_STEP),
];

/**
 * Formats a base quantity number for display: at most two decimals, German
 * comma, no trailing zeros. Two decimals are enough for the optimizer's exact
 * `q·c` values and for the unrounded fallback target, while hiding binary
 * floating-point noise (e.g. 166.66666666666666 → "166,67"). The stored value is
 * never rounded — this is a display formatter only.
 */
function formatQuantityNumber(value: number): string {
  return formatDecimal(Math.round(value * 100) / 100);
}

/**
 * The numeric part of `formatBQ` on its own: the base quantity with the German
 * decimal comma and the kg / l switch at 1000, but **without the unit**.
 * `formatBQ` builds on it; it exists on its own for callers that want the number
 * without appending the unit themselves.
 */
export function formatBQNumber(bq: number, bu: string): string {
  if (bu === 'g' && bq >= 1000) {
    return formatQuantityNumber(bq / 1000);
  }
  if (bu === 'ml' && bq >= 1000) {
    return formatQuantityNumber(bq / 1000);
  }
  return formatQuantityNumber(bq);
}

/**
 * The base unit as displayed for a quantity: the family unit (g / ml), or the
 * display step (kg / l) from 1000 up — the same rule `formatBQ` applies to the
 * number+unit atom. It exists on its own so an arrangement may place `<BQ>` and
 * `<BU>` apart, with free text (or a plain space) between them (§4).
 */
export function formatBU(bq: number, bu: string): string {
  return bq >= 1000 ? (DISPLAY_STEP[bu] ?? bu) : bu;
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
  return `${formatBQNumber(bq, bu)}${NNBSP}${formatBU(bq, bu)}`;
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
  '5/8': '\u215D', // ⅝
  '3/5': '\u2157', // ⅗
  '2/3': '\u2154', // ⅔
  '3/4': '\u00BE', // ¾
  '5/6': '\u215A', // ⅚
  '7/8': '\u215E', // ⅞
};

/**
 * Formats a canonical AQ fraction ("1/2", "1+1/4") in the display typography
 * of §8: glyphs for the proper fractions and a narrow no-break space between
 * the integer and the glyph of a mixed number ("1 ¼"). Whole AQ values pass
 * through unchanged. A fraction without a glyph (e.g. a master sum of 7/24)
 * keeps its canonical form so it never renders as garbage.
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
 * Used for unitless inline quantities that are AQ values, in both the web app
 * and the HTML export. Throws when `value` is not an AQ value; callers with an
 * arbitrary target use `optimizeUnitless` first.
 */
export function formatAQValue(value: number): string {
  return formatAQ(aqNotation(value));
}

/**
 * Tolerance of the unit-fraction test (`usesPlural`). A value like 1/3 is
 * stored as 0.3333333333333333, so its reciprocal misses 3 by a few ulps; the
 * slack is far below the distance between any two distinct AQ values.
 */
const UNIT_FRACTION_EPSILON = 1e-9;

/**
 * Whether a count takes the plural display form
 * (docs/additional_quantity_specifications.md §3.2, decided with the user):
 * singular only for exactly one and for a **unit fraction** — a proper fraction
 * whose numerator is 1 (1/2, 1/3, 1/4, 1/8). Every other count is plural,
 * including `0` („0 Packungen“) and mixed numbers („1 ½ Packungen“); a proper
 * fraction with a larger numerator is plural too („¾ Packungen“).
 *
 * Both the unit forms (`auDisplayName`) and the ingredient forms
 * (`ingredientDisplayName`) share the rule, so it has a single home. The test is
 * numeric rather than textual because callers also pass whole stock counts that
 * are not AQ table values: a count in (0, 1) is a unit fraction exactly when its
 * reciprocal is a whole number.
 */
function usesPlural(count: number): boolean {
  if (count === 1) {
    return false;
  }
  if (count > 0 && count < 1) {
    const denominator = 1 / count;
    return Math.abs(denominator - Math.round(denominator)) > UNIT_FRACTION_EPSILON;
  }
  return true;
}

/**
 * The unit text to show for a count (docs/additional_quantity_specifications.md
 * §3.2): the unit's **plural** form when the count takes one („2 Packungen
 * Mehl“), otherwise its **singular** form — or the canonical name when the pair
 * is empty (an invariant unit). §3.2 of the spec defines which counts are
 * singular: one and the unit fractions (½, ¼, ⅛).
 */
export function auDisplayName(au: AdditionalUnit, count: number): string {
  if (usesPlural(count) && au.plural !== undefined) {
    return au.plural;
  }
  return au.singular ?? au.name;
}

/**
 * The Singular/Plural display form of an ingredient entry for a count, or
 * undefined when the entry is unknown or the name is invariant. The pair is
 * atomic (the parser rejects a half-filled one), so one presence check suffices.
 */
function ingredientForm(
  entry: Pick<IngredientEntry, 'singular' | 'plural'> | undefined,
  count: number,
): string | undefined {
  if (entry?.singular === undefined || entry.plural === undefined) {
    return undefined;
  }
  return usesPlural(count) ? entry.plural : entry.singular;
}

/**
 * The ingredient name to show for a count (docs/storage_format.md §9): the
 * ingredient's Singular/Plural display form („1 Karotte“ / „2 Karotten“), or the
 * canonical name when the entry is unknown or the name is invariant (Zucker,
 * Milch). The arrangement renderer uses it for `<INF>`, so one placeholder
 * covers both forms and the count decides which one appears — exactly like the
 * unit's own `<AU>` form (`auDisplayName`). The canonical name keeps its own
 * placeholder, `<IN>`.
 */
export function ingredientDisplayName(ingredient: string, count: number): string {
  return ingredientForm(mappingsFor(ingredient), count) ?? ingredient;
}

/**
 * Every text form a unit can appear as in the app's own lines: the canonical
 * name plus the singular and plural display forms, deduplicated. The shopping
 * list's line vocabulary is derived from this (shoppingSort.ts), so a line the
 * app wrote in any form is undone again — never a hand-kept copy.
 */
export function auDisplayForms(au: AdditionalUnit): readonly string[] {
  const forms = [au.name];
  if (au.singular !== undefined) {
    forms.push(au.singular);
  }
  if (au.plural !== undefined) {
    forms.push(au.plural);
  }
  return [...new Set(forms)];
}

/** The values an arrangement template substitutes (§4). */
export interface ArrangementValues {
  /** Additional quantity, already in its display typography. */
  readonly aq: string;
  /** Additional unit, already in its singular/plural display form. */
  readonly au: string;
  /** Canonical ingredient name (`<IN>`). */
  readonly ingredient: string;
  /**
   * Ingredient name in its singular/plural display form for the count
   * (`<INF>`, `ingredientDisplayName`); the canonical name for an invariant one.
   */
  readonly ingredientForm: string;
  /** Base quantity to show (for an exact unit derived from the rounded AQ, §6.3). */
  readonly bq: number;
  /** Base unit family (g / ml) the base quantity is expressed in. */
  readonly bu: string;
}

/**
 * Substitutes an arrangement template's placeholders (§4): `<AQ>`, `<AU>`,
 * `<IN>` (canonical ingredient name), `<INF>` (its singular/plural display form
 * for the count), `<BQ>`, `<BU>` and `<NNBSP>` (U+202F). Everything else — any
 * **free text**, punctuation or spacing — passes through unchanged. `<BQ>` and
 * `<BU>` may stand apart, separated by free text or a plain space, as well as in
 * the usual `<BQ><NNBSP><BU>` run; `<BQ>` renders the number and `<BU>` the
 * displayed unit (kg / l from 1000 up, `formatBU`).
 */
export function renderArrangementTemplate(arrangement: string, values: ArrangementValues): string {
  return (
    arrangement
      .replaceAll('<AQ>', values.aq)
      .replaceAll('<AU>', values.au)
      // <INF> before <IN>: the two tokens are disjoint, but the longer one reads
      // as the specific case and stays first for clarity.
      .replaceAll('<INF>', values.ingredientForm)
      .replaceAll('<IN>', values.ingredient)
      .replaceAll('<BQ>', formatBQNumber(values.bq, values.bu))
      .replaceAll('<BU>', formatBU(values.bq, values.bu))
      .replaceAll('<NNBSP>', NNBSP)
  );
}

/** One raw run of an arrangement template, split at its parentheses (§4). */
export interface ArrangementTemplatePart {
  /** A text run, or the inner template of a parenthesized note. */
  readonly kind: 'text' | 'note';
  /** The run's template, with the note's parentheses removed. */
  readonly template: string;
}

/**
 * Splits an arrangement template at its parenthesized notes (§4). The note
 * parts hold what stands *inside* the brackets, so a display can drop the
 * brackets and style that text on its own. Nested brackets are not part of the
 * arrangement grammar; the first `)` closes the note. An unclosed `(` is left
 * in the text (nothing can be lifted out), and parentheses that do not appear in
 * the template never split a rendered line — an ingredient name may itself
 * contain brackets without being mistaken for a note.
 */
export function splitArrangementNotes(arrangement: string): readonly ArrangementTemplatePart[] {
  const parts: ArrangementTemplatePart[] = [];
  let text = '';
  let note: string | null = null;
  for (const char of arrangement) {
    if (note === null) {
      if (char === '(') {
        if (text !== '') {
          parts.push({ kind: 'text', template: text });
          text = '';
        }
        note = '';
      } else {
        text += char;
      }
    } else if (char === ')') {
      parts.push({ kind: 'note', template: note });
      note = null;
    } else {
      note += char;
    }
  }
  // An unclosed bracket stays literal text: there is no complete note to lift
  // out, and silently dropping the rest of the arrangement would lose content.
  if (note !== null) {
    text += `(${note}`;
  }
  if (text !== '') {
    parts.push({ kind: 'text', template: text });
  }
  return parts;
}

/** One rendered run of an arrangement line (§4). */
export type ArrangementDisplayPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'note'; readonly value: string };

/** A rendered arrangement line with its notes split out for styled display (§4). */
export interface ArrangementDisplay {
  /**
   * The line exactly as written, notes in parentheses. This is the wording the
   * written shopping list keeps; the app and the cooking view render `parts`.
   */
  readonly text: string;
  /**
   * The line's runs, in order. A note holds the trimmed text inside its
   * parentheses — the caller supplies the separator (an en space, or a regular
   * space and brackets in step prose).
   */
  readonly parts: readonly ArrangementDisplayPart[];
}

/**
 * Renders an arrangement as styled display runs (§4): every parenthesized note
 * is lifted out of its brackets, so the caller can show it muted and italic
 * after an en space. `text` keeps the written form with brackets, so the
 * shopping list and every other plain-text consumer are unchanged.
 */
export function renderArrangementDisplay(
  arrangement: string,
  values: ArrangementValues,
): ArrangementDisplay {
  const templateParts = splitArrangementNotes(arrangement);
  const parts: ArrangementDisplayPart[] = [];
  templateParts.forEach((part, index) => {
    const rendered = renderArrangementTemplate(part.template, values);
    if (part.kind === 'note') {
      const note = rendered.trim();
      if (note !== '') {
        parts.push({ kind: 'note', value: note });
      }
      return;
    }
    // The space that used to separate the line from its bracket gives way to
    // the caller's separator; the note already carries the only free space.
    const next = templateParts[index + 1];
    const value = next?.kind === 'note' ? rendered.replace(/\s+$/, '') : rendered;
    if (value !== '') {
      parts.push({ kind: 'text', value });
    }
  });
  return {
    text: renderArrangementTemplate(arrangement, values),
    // A line that renders to nothing still needs one run a caller can render.
    parts: parts.length === 0 ? [{ kind: 'text', value: '' }] : parts,
  };
}

/** The plain base form as a display line (no arrangement, no note). */
function baseFormDisplay(ingredient: string, bq: number, bu: string): ArrangementDisplay {
  const text = `${formatBQ(bq, bu)} ${ingredient}`;
  return { text, parts: [{ kind: 'text', value: text }] };
}

/**
 * Collapses the double spaces left by an empty `<IN>` in a draft arrangement
 * ("1 Becher  (160 g)"), in the written text and in every display run alike.
 */
function collapseDisplaySpaces(display: ArrangementDisplay): ArrangementDisplay {
  const collapse = (value: string): string => value.replaceAll('  ', ' ');
  return {
    text: collapse(display.text),
    parts: display.parts.map((part) =>
      part.kind === 'note'
        ? { kind: 'note', value: collapse(part.value) }
        : { kind: 'text', value: collapse(part.value) },
    ),
  };
}

/**
 * Renders the selected unit's arrangement with the placeholders substituted
 * (§4). Shared by renderAQS (a registered ingredient) and the draft-entry
 * renderers. `ingredient` may be empty in the draft case, which drops the
 * arrangement's space before the name.
 *
 * `entry` is the ingredient entry the `<INF>` display forms are read from;
 * callers that already hold one (a draft entry, renderQuantityText) pass it,
 * and the registry is consulted otherwise. A caller that hides the
 * name (an empty `ingredient`) can still pass the entry so `<INF>` keeps its
 * singular/plural form — the name-less shopping lines rely on it.
 *
 * `nameOmitted` handles the `<INF>` templates that use the count form *as the
 * count marker* ("3 Auberginen (1 kg)"): without the name that token is the
 * only noun, so the unit's own display form stands in ("3 Stück (1 kg)") — the
 * same rule `renderOptimizedAQ` applies to a recipe chip. A template that
 * already carries an `<IN>` keeps the ingredient count form inside its bracket
 * ("180 ml (1 Dose Kichererbsen)"): the token names the item there, not the
 * unit.
 */
function renderSelectedAQ(
  ingredient: string,
  selected: AdditionalQuantity,
  bu: string,
  shownBq: number,
  formatAq: (aq: string) => string,
  entry?: AuSelectableEntry,
  nameOmitted = false,
): ArrangementDisplay {
  // The count that drives the display forms of both the unit and the ingredient.
  const count = aqToNumber(selected.aq);
  // <INF> is the ingredient in its count form („1 Karotte“ / „2 Karotten“),
  // falling back to the canonical name for an invariant or unknown name. The
  // lookup is registry-backed unless the caller passed a (draft) entry. With
  // the name omitted and no <IN> in the template, the unit stands in instead.
  const ingredientFormText =
    nameOmitted && !selected.au.arrangement.includes('<IN>')
      ? auDisplayName(selected.au, count)
      : (ingredientForm(entry ?? mappingsFor(ingredient), count) ?? ingredient);
  const display = renderArrangementDisplay(selected.au.arrangement, {
    aq: formatAq(selected.aq),
    // <AU> renders the singular or plural display form of the count (§3).
    au: auDisplayName(selected.au, count),
    ingredient,
    ingredientForm: ingredientFormText,
    bq: shownBq,
    bu,
  });
  // The create form can preview an entry before a name is typed; the
  // arrangement would then leave a dangling space ("1 Becher  (160 g)").
  return ingredient === '' ? collapseDisplaySpaces(display) : display;
}

/**
 * Renders an optimizer result with the selected unit's arrangement. Shared by
 * `renderAQS` and the reorder-point preview. The shown BQ is
 * the optimizer's BQ: for an exact unit that is `q·c`, for a non-exact or
 * metric-only candidate a value from the BQ table, and for a fallback `V0`.
 *
 * `nameOmitted` renders the arrangement without the ingredient name (a chip
 * label). `<IN>` is empty then, and `<INF>` — the count form that the Stück
 * arrangements use in place of `<AU>` — would be empty too. So the count form
 * is replaced by the unit's own display form: the chip has no name that could
 * carry the count, and a naked number ("1 ½ (100 g)") would hide the unit.
 */
function renderOptimizedAQ(
  ingredient: string,
  result: OptimizedQuantity,
  bu: string,
  formatAq: (aq: string) => string,
  entry?: AuSelectableEntry,
  nameOmitted = false,
): ArrangementDisplay {
  const selected = result.aq!;
  const count = selected.value;
  // <INF> is the ingredient in its count form („1 Karotte“ / „2 Karotten“),
  // falling back to the canonical name for an invariant or unknown name. With
  // the name omitted (<IN> is empty) the unit's form stands in instead.
  const ingredientFormText = nameOmitted
    ? auDisplayName(selected.au, count)
    : (ingredientForm(entry ?? mappingsFor(ingredient), count) ?? ingredient);
  const display = renderArrangementDisplay(selected.au.arrangement, {
    aq: formatAq(selected.notation),
    au: auDisplayName(selected.au, count),
    ingredient,
    ingredientForm: ingredientFormText,
    bq: result.bq,
    bu,
  });
  // The create form can preview an entry before a name is typed; the
  // arrangement would then leave a dangling space ("1 Becher  (160 g)").
  return ingredient === '' ? collapseDisplaySpaces(display) : display;
}

/**
 * Renders the full display line for an ingredient (§4): the selected unit's
 * arrangement template with <AQ> <AU> <IN> <INF> <BQ> <BU> and <NNBSP> (U+202F)
 * substituted, or the base form "<BQ> <BU> <IN>" when no AQS applies. The AQ
 * itself is rendered in the §8 glyph typography (`formatAQ`).
 *
 * The shown base quantity is the stored value (`formatBQ`) — except for an
 * **exact** unit (§6.3): its factor defines the base amount (a 200 g Block),
 * so rounding the AQ to the nearest fraction of that unit would contradict the
 * shown count ("8 Blöcke (1,5 kg)"). For exact units the shown base quantity is
 * therefore derived from the rounded AQ instead (AQ × factor), even when the
 * result is not a table value. Approximate units (a carrot varies in weight)
 * keep the stored/scaled value, which is the preferred reading there: the
 * rounding stays visible in the count only. Storage and scaling are untouched
 * either way.
 */
export function renderAQS(
  ingredient: string,
  bq: number,
  bu: string,
  context: PrecisionContext = {},
): string {
  return renderAQSDisplay(ingredient, bq, bu, context).text;
}

/**
 * The display runs for `renderAQS` (§4), used by the web app and the HTML
 * export: the same line, with every parenthesized arrangement note split out so
 * it can be rendered muted and italic after an en space. The written shopping
 * list keeps `renderAQS`'s bracketed `text`.
 */
export function renderAQSDisplay(
  ingredient: string,
  bq: number,
  bu: string,
  context: PrecisionContext = {},
): ArrangementDisplay {
  return renderAQSWith(ingredient, bq, bu, formatAQ, context);
}

/**
 * Renders the **label of a quantity suggestion chip** for one target: the
 * arrangement the optimizer selects, with the ingredient name omitted —
 * "1 Becher (500 g)" instead of "1 Becher Joghurt (500 g)". A Stück unit names
 * itself rather than the ingredient's count form, so the chip keeps a unit:
 * "1 ½ Stück (100 g)", "100 ml (3 Stück)".
 *
 * `result` is the optimizer's answer for the same target (`v0`), so a caller
 * that already enumerated and scored its anchors (quantitySuggestions.ts) does
 * not score each of them twice. The name is omitted deliberately: the field
 * already sits under the ingredient's caption, and repeating the name in every
 * chip would crowd the single chip line (decided with the user). The
 * arrangement's note keeps its brackets in `text`; `ArrangementLine` splits the
 * note out of them for the muted, italic chip run, exactly like a pantry chip.
 */
export function renderOptimizedChipDisplay(
  entry: AuSelectableEntry | undefined,
  result: OptimizedQuantity,
  bu: string,
): ArrangementDisplay {
  if (result.aq === undefined) {
    // Metric-only winner or fallback: the base amount alone, no name.
    const text = formatBQ(result.bq, bu);
    return { text, parts: [{ kind: 'text', value: text }] };
  }
  // An empty <IN> leaves a double space before the note ("1 Becher  (500 g)").
  // Collapse it, exactly like the create form's name-less preview. The last
  // argument makes <INF> render the unit form (see renderOptimizedAQ).
  return collapseDisplaySpaces(renderOptimizedAQ('', result, bu, formatAQ, entry, true));
}

/**
 * The master-list counterpart of `renderAQSDisplay`: renders one derived master
 * row from the step uses it was merged from, with the constrained master
 * optimizer (quantityOptimizer.optimizeMasterQuantity). A single use renders
 * exactly like the step row; several uses keep the master BQ equal to the sum
 * of the step BQs and the AQ consistent with the step counts.
 *
 * The uses must already be scaled to the displayed size. `masterUsesFor`
 * (recipe/masterQuantity.ts) gathers them from the recipe's steps.
 */
export function renderMasterAQSDisplay(
  ingredient: string,
  uses: readonly MasterQuantityUse[],
  bu: string,
): ArrangementDisplay {
  return renderMasterAQSWith(ingredient, uses, bu, formatAQ);
}

/**
 * Renders an **aggregate need** — the shopping list's required quantity per
 * ingredient — from the master lines of the selected dishes (decided with the
 * user). The optimizer (`optimizeAggregateQuantity`) keeps the summed base
 * quantity fixed and may add one additional unit, so the need always names the
 * exact amount the dishes call for and never a different whole-package total.
 *
 * The line is the ingredient's master-row counterpart one level up: a total of
 * two dish master lines that both read "1 Becher" renders as "2 Becher (1 kg)",
 * and a total that no count restates stays in the base form ("1,02 kg Mehl").
 * The arrangement's note keeps its brackets here: the shopping sheet shows the
 * need as plain text and the Keep write never receives this line (the purchase
 * side has its own reading).
 *
 * @param ingredient the canonical ingredient name (`<IN>` / `<INF>`)
 * @param totalBq the aggregate need in the family base unit (the fixed BQ)
 * @param bu the base unit family (g / ml)
 * @param contributions the dishes' master lines, in the order they are summed
 */
export function renderAggregateNeed(
  ingredient: string,
  totalBq: number,
  bu: string,
  contributions: readonly AggregateQuantityUse[],
): string {
  const result = optimizeAggregateQuantity(totalBq, contributions, mappingsFor(ingredient), bu);
  if (result.aq === undefined) {
    const base = formatBQ(result.bq, bu);
    // The base form carries the name after the amount; without one it is the
    // amount alone (the sheet shows the name elsewhere on its row).
    return ingredient === '' ? base : `${base} ${ingredient}`;
  }
  return renderSelectedAQ(
    ingredient,
    { aq: result.aq.notation, au: result.aq.au, factor: result.aq.factor },
    bu,
    result.bq,
    formatAQ,
    mappingsFor(ingredient),
  ).text;
}

/**
 * The count the aggregate need line names (`renderAggregateNeed`), as a number,
 * or null when the aggregate uses no additional unit or a unit other than the
 * ingredient's **shopping unit**.
 *
 * The pantry sheet uses it for the amount the dishes need together: the chip
 * that completes the need, and the need line itself, must name the same count.
 * Re-reading the summed grams would disagree whenever the master lines' counts
 * do not match the gram total — three dishes that each read "1 Aubergine
 * (333 g)" need "3 Auberginen (1 kg)", while a nearest-quarter reading of the
 * 1 kg would say "2¾". A malformed contribution set answers null instead of
 * throwing (the caller falls back to the plain reading, like `needText`).
 */
export function aggregateNeedCount(
  ingredient: string,
  totalBq: number,
  bu: string,
  contributions: readonly AggregateQuantityUse[],
): number | null {
  if (contributions.length === 0) {
    return null;
  }
  const target = shoppingUnitFor(mappingsFor(ingredient), bu);
  if (target === null) {
    return null;
  }
  try {
    const result = optimizeAggregateQuantity(totalBq, contributions, mappingsFor(ingredient), bu);
    if (result.aq === undefined || result.aq.au.name !== target.au.name) {
      return null;
    }
    return aqToNumber(result.aq.notation);
  } catch {
    return null;
  }
}

/**
 * The shared core of the master renderer: optimizes the master quantity from
 * its step uses and renders the selected unit's arrangement.
 */
function renderMasterAQSWith(
  ingredient: string,
  uses: readonly MasterQuantityUse[],
  bu: string,
  formatAq: (aq: string) => string,
): ArrangementDisplay {
  const result = optimizeMasterQuantity(uses, mappingsFor(ingredient), bu);
  if (result.aq === undefined) {
    return baseFormDisplay(ingredient, result.bq, bu);
  }
  return renderOptimizedAQ(ingredient, result, bu, formatAq);
}

/**
 * The shared core of the AQS display renderer: selects the additional quantity,
 * then renders the arrangement with the §8 fraction formatter.
 */
function renderAQSWith(
  ingredient: string,
  bq: number,
  bu: string,
  formatAq: (aq: string) => string,
  context: PrecisionContext,
): ArrangementDisplay {
  const result = optimizeQuantity(bq, mappingsFor(ingredient), bu, context);
  if (result.aq === undefined) {
    // Metric-only winner or fallback: the plain base form, no AQ.
    return baseFormDisplay(ingredient, result.bq, bu);
  }
  return renderOptimizedAQ(ingredient, result, bu, formatAq);
}

/**
 * The epsilon of the exact-unit check below: 1/3 · 300 g is 99.999… in binary
 * floating point, which is the same amount as 100 g.
 */
const AMOUNT_EPSILON = 1e-6;

/**
 * Renders a quantity that is **not a stored recipe quantity** in the
 * ingredient's familiar arrangement: what a set of dishes needs together (a sum,
 * see ../shoppingList) or a stock on the shelf — the whole line, including the
 * ingredient name ("2 Becher Joghurt (600 g)", "1,15 kg Mehl", "60 g
 * Trockenhefe").
 *
 * Two precision rules separate it from renderAQS, and both follow from what the line
 * is for — *naming an amount that exists*, not displaying a stored recipe value:
 *
 * - the quantity need not be a standard number (a need is a sum over dishes; a
 *   stock comes from the reorder point or from a keyboard), so nothing throws
 *   and the additional quantity is only ever *displayed* as the nearest AQ
 *   fraction;
 * - an **exact** unit applies only when its count really brings that amount home.
 *   For a recipe row it is the point of an exact unit that the count restates the
 *   amount (§6.3: 350 g of yoghurt shows as "1 Becher Joghurt (400 g)"), but a
 *   line that names a requirement must not be restated as something else: 350 g
 *   needed is not 400 g needed, so the mapping is skipped and the search
 *   continues — down to the base form ("350 g Joghurt"). An approximate unit
 *   always applies: it keeps the queried amount as the authoritative reading
 *   ("6 Karotten (500 g)").
 *
 * An empty name (the create form's preview before a name is typed) has no
 * mappings to look up, so the base amount stands alone ("600 g").
 *
 * @param ingredient the ingredient name for the arrangement's <IN>
 * @param bq the quantity to name, in `bu` (need not be a table value)
 * @param bu the base unit family (g / ml) — or any other unit of a stored file
 */
export function renderQuantityText(ingredient: string, bq: number, bu: string): string {
  const amount = formatBQ(bq, bu);
  // The base form carries the name after the amount; without one it is the amount
  // alone (an empty arrangement name would leave a dangling space).
  const base = ingredient === '' ? amount : `${amount} ${ingredient}`;
  const entry = mappingsFor(ingredient);
  // Unknown ingredient, foreign family unit or a quantity without an AQ floor
  // (0 g, a negative): the base form is the whole answer.
  if (entry === undefined || entry.bu !== bu || !(bq > 0) || !Number.isFinite(bq)) {
    return base;
  }
  for (const mapping of entry.entries) {
    const au = AU_BY_NAME.get(mapping.au);
    const value = roundToAQValue(bq / mapping.factor);
    // Unreachable unit (generator-validated data) or a raw value outside the AQ
    // range: this mapping cannot be displayed.
    if (au === undefined || value === null) {
      continue;
    }
    const aq = aqNotation(value);
    const allowed = NUMBER_SCHEMES[au.numberScheme] ?? EMPTY_SCHEME;
    if (!allowed.includes(aq)) {
      continue;
    }
    if (au.exact && Math.abs(value * mapping.factor - bq) > AMOUNT_EPSILON) {
      continue;
    }
    return renderSelectedAQ(ingredient, { aq, au, factor: mapping.factor }, bu, bq, formatAQ, entry)
      .text;
  }
  return base;
}

/**
 * The additional unit an ingredient is **bought** in, or null when it has none
 * (docs/additional_quantity_specifications.md §3.1) — the unit the shopping
 * list names its amount in.
 *
 * The flag belongs to the *mapping*, not to the unit: „Stück (ZE zuerst)“ is the
 * purchase unit of a carrot but a recipe measure for a clove of garlic. The
 * entry's mappings are searched in their file order and the one flagged
 * `shoppingUnit` wins; a unit that is only a recipe measure for this ingredient
 * (TL, EL, a clove) is skipped. At most one mapping may carry the flag (the
 * master-data parser and generator enforce it), so the search order is
 * immaterial in valid data. `bu` is the family unit the quantity is expressed
 * in: a mapping's factor is expressed in the ingredient's fixed base unit, so a
 * quantity of another family (g for an ml ingredient) has no applicable
 * shopping unit and the caller falls back to the base form (§4).
 *
 * @param entry the ingredient's master-data entry, or undefined when the name
 *   is not registered (no shopping unit then — the base form)
 * @param bu the family unit of the quantity that is being shopped for
 */
export function shoppingUnitFor(
  entry: AuSelectableEntry | undefined,
  bu: string,
): { au: AdditionalUnit; factor: number } | null {
  if (entry === undefined || entry.bu !== bu) {
    return null;
  }
  for (const mapping of entry.entries) {
    const au = AU_BY_NAME.get(mapping.au);
    // Unreachable with generator-validated data (see selectAQForEntry).
    if (au !== undefined && mapping.shoppingUnit) {
      return { au, factor: mapping.factor };
    }
  }
  return null;
}

/**
 * Renders a **whole-number** count of one additional unit for the shopping list
 * ("3 Blöcke Tofu (600 g)"): the unit's arrangement with an integer count in
 * place of the optimizer-selected AQ. The count is never rounded here — the
 * shopping list rounds it *up* to whole packages, which is the caller's rule
 * (`shoppingRow` in ../shoppingList).
 *
 * `amount` is the required base quantity the count is being bought for. Like an
 * exact unit in a recipe line (§6.3), an exact shopping unit shows what the
 * count actually brings home (count × factor, even when that is more than the
 * recipe needs); an approximate one keeps the required amount, which stays the
 * authoritative reading there ("3 Packungen Joghurt (1150 g)").
 *
 * @param ingredient the ingredient name for the arrangement's <IN>
 * @param count the whole number of units to buy
 * @param au the selected shopping unit
 * @param factor the mapping's conversion factor (base unit per one unit)
 * @param bu the family unit the amount is expressed in
 * @param amount the required base quantity (see above)
 * @param entry the ingredient entry that supplies `<INF>` when `ingredient` is
 *   empty (the name-less shopping amount)
 */
export function renderUnitCount(
  ingredient: string,
  count: number,
  au: AdditionalUnit,
  factor: number,
  bu: string,
  amount: number,
  entry?: AuSelectableEntry,
): string {
  const shownBq = au.exact ? count * factor : amount;
  return renderSelectedAQ(
    ingredient,
    { aq: String(count), au, factor },
    bu,
    shownBq,
    formatAQ,
    entry,
  ).text;
}

/**
 * How a pantry reading may deviate from the plain re-reading of its amount
 * (see `pantryReading`):
 *
 * - `aq` — a count the caller already knows for exactly this amount: the
 *   aggregate need's count (`aggregateNeedCount`). It wins when the unit's
 *   scheme allows it (and an exact unit still restates the amount), so the chip
 *   that completes the need reads like the need line.
 * - `roundUp` — a **purchase**: the count is rounded up to the next whole piece,
 *   never down (the shopping list's "whole shopping units" rule,
 *   `shoppingRow` in ../shoppingList). Exact units are already bought in whole
 *   packs; a typed amount that is no pack count keeps the base form.
 */
export interface PantryReadOptions {
  readonly aq?: number;
  readonly roundUp?: boolean;
}

/**
 * The count a pantry reading shows for one amount (components/PantrySelect —
 * the "auf Vorrat" and "kaufen" readings), or null when the amount has to be
 * read in the plain base unit ("700 g").
 *
 * The pantry sheet is no exception to the display rules (§4, §6.1): a count is
 * only shown when the unit's **number scheme** allows it, and an **exact** unit
 * must restate the amount it names (`count × factor = amount`). A 700 g stock
 * of a 1000 g `Packung (unteilbar)` therefore reads "700 g", never
 * "¾ Packung (700 g)", and a 500 g stock of that pack reads "500 g" instead of
 * the scheme-forbidden "½ Packung" — half of an unteilbar pack is not a
 * countable pack. The old nearest-AQ reading produced exactly such lines
 * ("⅚ Becher (400 g)" for a 500 g Becher: forbidden by the halves scheme *and*
 * ⅚ × 500 g ≠ 400 g).
 *
 * - **Exact unit**: the nearest AQ value, but only when the scheme allows it
 *   and the count restates the amount. The count is a whole or scheme-allowed
 *   number of packs, because that is what a shelf or an order really holds.
 * - **Approximate unit**: the count is only a *reading* of the amount (a carrot
 *   has no fixed weight), so the amount in the bracket stays authoritative. The
 *   count is the nearest count the scheme allows, ties toward the larger like
 *   the display formatters, and only inside the optimizer's factor-2 band — a
 *   count the amount cannot plausibly carry is no reading of it, and the base
 *   form stands.
 * - **Above the scheme's range** a plain whole count is still real ("40
 *   Stück") and stays allowed, exactly like the stock count field reads it
 *   (`stockCountText` in ../shoppingList): the scheme bounds what a *recipe*
 *   line may say, not how many packs a shop sells.
 *
 * `options` (see `PantryReadOptions`) lets the caller supply the count it
 * already knows — the aggregate need's reading — or ask for a **purchase**
 * count, which is rounded up to whole pieces and never down.
 */
function pantryCount(
  au: AdditionalUnit,
  factor: number,
  bq: number,
  options: PantryReadOptions = {},
): number | null {
  const raw = bq / factor;
  if (!(raw > 0) || !Number.isFinite(raw)) {
    return null;
  }
  const counts = (NUMBER_SCHEMES[au.numberScheme] ?? EMPTY_SCHEME).map((notation) =>
    aqToNumber(notation),
  );
  if (counts.length === 0) {
    return null;
  }
  const largest = counts[counts.length - 1]!;
  // A count is honest when the scheme names it, or when it is a whole count
  // above the scheme's range (a shelf or an order really holds 12 packs).
  const allowed = (count: number): boolean =>
    counts.includes(count) || (Number.isInteger(count) && count > largest);
  if (options.aq !== undefined && options.aq > 0) {
    // The caller's own count (the aggregate need's reading) wins when it is
    // honest for this unit and amount.
    if (
      allowed(options.aq) &&
      (!au.exact || Math.abs(options.aq * factor - bq) <= AMOUNT_EPSILON)
    ) {
      return options.aq;
    }
  }
  if (options.roundUp && !au.exact) {
    // A purchase: every whole piece that covers the amount, like the shopping
    // list's own rounding (`shoppingRow` in ../shoppingList).
    const whole = Math.ceil(raw);
    return allowed(whole) ? whole : null;
  }
  if (au.exact) {
    const value = raw > AQ_MAX ? Math.round(raw) : roundToAQValue(raw);
    if (value === null) {
      return null;
    }
    // The bracket shows the amount itself (see `pantryReading`), so the count
    // must restate it — no "¾ Packung (700 g)".
    if (Math.abs(value * factor - bq) > AMOUNT_EPSILON) {
      return null;
    }
    return allowed(value) ? value : null;
  }
  // Approximate unit: nearest scheme-allowed count, ties toward the larger.
  if (raw >= largest) {
    const whole = Math.round(raw);
    return Math.abs(whole * factor - bq) <= bq ? whole : null;
  }
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const count of counts) {
    // Factor-2 band, like the optimizer's approximate BQ/AQ pair (§6): a count
    // the amount cannot plausibly carry is not a reading of it.
    if (Math.abs(count * factor - bq) > bq) {
      continue;
    }
    const distance = Math.abs(count - raw);
    if (distance < bestDistance || (distance === bestDistance && (best === null || count > best))) {
      best = count;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * One amount of the pantry sheet (see `pantryReading`): a base quantity in the
 * ingredient's shopping unit while that unit can honestly name it, with its two
 * linked numeric readings — the additional quantity (the count) and the base
 * quantity (the grams / millilitres) — or in the plain base form (`au` and `aq`
 * null). Used for both the "auf Vorrat" (stock) and "kaufen" (buy) amounts,
 * which share the same scheme-aware reading.
 */
export interface PantryReading {
  /** The shopping unit the amount is counted in, or null (the base form). */
  readonly au: AdditionalUnit | null;
  /** Conversion factor (family base unit per one AU); 1 without an AU. */
  readonly factor: number;
  /** The count for display (`pantryCount`), or null when the amount has to be read in the base unit. */
  readonly aq: number | null;
  /** The base quantity in the family unit (g / ml) — the editable value. */
  readonly bq: number;
}

/**
 * The pantry sheet's reading of one base quantity (the "auf Vorrat" stock or
 * the "kaufen" amount, components/PantrySelect): the amount in the ingredient's
 * **shopping unit** while that unit can honestly name it, and the plain base
 * form otherwise ("700 g").
 *
 * The count goes through the same display rules as every recipe line (§4,
 * §6.1) — the scheme must allow it and an exact unit must restate the amount
 * (see `pantryCount`). Unlike a recipe line (§6.3), the shown base quantity is
 * the amount itself: the two tappable readings are linked by the factor, and
 * the grams/millilitres are what the sheet edits, so an exact unit must not
 * overrule a typed amount. `au` is null exactly when no honest count exists;
 * the caller then renders the base form.
 *
 * `options` carries what the sheet knows beyond the amount (see
 * `PantryReadOptions`): the aggregate need's count for the chip that completes
 * the need, and the "purchase" rounding for the amount to buy.
 */
export function pantryReading(
  ingredient: string,
  bq: number,
  bu: string,
  options: PantryReadOptions = {},
): PantryReading {
  const target = shoppingUnitFor(mappingsFor(ingredient), bu);
  if (target === null) {
    return { au: null, factor: 1, aq: null, bq };
  }
  const aq = pantryCount(target.au, target.factor, bq, options);
  if (aq === null) {
    return { au: null, factor: 1, aq: null, bq };
  }
  return {
    au: target.au,
    factor: target.factor,
    aq,
    bq,
  };
}

/**
 * Formats the count of a pantry reading (`PantryReading.aq`): an AQ value in
 * the §8 glyph typography ("1 ¼"), 0 and whole counts beyond the table as
 * plain decimal numbers ("0", "2000").
 */
export function formatPantryAq(aq: number): string {
  return isAQValue(aq) ? formatAQ(aqNotation(aq)) : formatDecimal(aq);
}

/** Canonical notation of a pantry count (AQ form, or plain for 0 / whole). */
function pantryAqNotation(aq: number): string {
  return isAQValue(aq) ? aqNotation(aq) : String(aq);
}

/**
 * Renders a pantry reading as text, with or without the ingredient name. The
 * name-less form is what the sheet shows (it carries the name elsewhere); the
 * named form is the Keep write's line.
 */
function renderPantryText(
  ingredient: string,
  reading: PantryReading,
  bu: string,
  entry?: AuSelectableEntry,
): string {
  return renderPantryDisplay(ingredient, reading, bu, entry).text;
}

/**
 * The display runs of a pantry reading (§4): the same line `renderPantryText`
 * writes, with the arrangement's note split out. The pantry sheet styles the
 * note like every other arrangement; the Keep write keeps the bracketed text.
 * A name-less reading (the sheet's chips and amount lines) shows the unit's own
 * form where the arrangement uses the count form as its count marker — the
 * Stück arrangement reads "3 Stück (1 kg)", not "3 Auberginen (1 kg)"; the
 * named Keep line keeps the ingredient form.
 */
function renderPantryDisplay(
  ingredient: string,
  reading: PantryReading,
  bu: string,
  entry?: AuSelectableEntry,
): ArrangementDisplay {
  if (reading.au === null || reading.aq === null) {
    const base = formatBQ(reading.bq, bu);
    const text = ingredient === '' ? base : `${base} ${ingredient}`;
    return { text, parts: [{ kind: 'text', value: text }] };
  }
  return renderSelectedAQ(
    ingredient,
    { aq: pantryAqNotation(reading.aq), au: reading.au, factor: reading.factor },
    bu,
    reading.bq,
    formatAQ,
    entry,
    ingredient === '',
  );
}

/**
 * Renders a pantry reading without the ingredient name ("1 ¼ Becher (600 g)"),
 * or the base form ("600 g") when no shopping unit can name the amount. The
 * sheet's tappable form builds the same arrangement from `pantryReading`'s
 * pieces; this string is the plain-text reading of it.
 */
export function renderPantryAmount(
  ingredient: string,
  bq: number,
  bu: string,
  options: PantryReadOptions = {},
): string {
  return renderPantryText(
    '',
    pantryReading(ingredient, bq, bu, options),
    bu,
    mappingsFor(ingredient),
  );
}

/**
 * The label of a pantry stock chip (decided with the user): the reading's
 * arrangement **with both units** — the additional unit and the base unit — so
 * a chip names the amount it stands for on its own ("1 Becher (400 g)",
 * "½ Becher (250 g)", "700 g"). A count the number scheme forbids and an exact
 * count that would contradict its bracket are never shown; the base form names
 * the amount then. It is the same reading as `renderPantryAmount`, except that
 * an empty stock reads just "0" — never "0 Becher (0 g)". The options pass
 * through to `pantryReading` (the aggregate need's count for the chip that
 * completes the need).
 */
export function renderPantryChip(
  ingredient: string,
  bq: number,
  bu: string,
  options: PantryReadOptions = {},
): string {
  if (!(bq > 0)) {
    return '0';
  }
  return renderPantryAmount(ingredient, bq, bu, options);
}

/**
 * The pantry chip's display runs (§4): `renderPantryChip`'s line with the
 * arrangement note split out, so the stock chips show the same styled note as
 * the sheet's amount lines. An empty stock stays the plain "0".
 */
export function renderPantryChipDisplay(
  ingredient: string,
  bq: number,
  bu: string,
  options: PantryReadOptions = {},
): ArrangementDisplay {
  if (!(bq > 0)) {
    return { text: '0', parts: [{ kind: 'text', value: '0' }] };
  }
  return renderPantryDisplay(
    '',
    pantryReading(ingredient, bq, bu, options),
    bu,
    mappingsFor(ingredient),
  );
}

/**
 * Renders a pantry reading with the ingredient name ("1 ¼ Becher Mehl (500 g)"),
 * or the base form ("500 g Mehl") — the line the Keep write carries. It names
 * the same amount the sheet shows; only the count-form position differs: the
 * sheet prints the unit ("3 Stück (1 kg)") because its row already names the
 * ingredient, while the list names it here ("3 Auberginen (1 kg)").
 *
 * The amount is always the **purchase**, so an approximate unit's count is
 * rounded **up** to whole pieces (`PantryReadOptions.roundUp`): buying "2¾
 * Auberginen" for a need of "3 Auberginen" would under-offer the count, while
 * three pieces cover the summed grams. The bracket keeps the amount the sheet
 * computed (the sum's or the typed one), as an approximate unit's amount stays
 * authoritative.
 */
export function renderPantryLine(ingredient: string, bq: number, bu: string): string {
  return renderPantryText(ingredient, pantryReading(ingredient, bq, bu, { roundUp: true }), bu);
}
