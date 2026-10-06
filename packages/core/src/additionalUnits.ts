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

import { AQ_MAX, AQ_MIN, aqNotation, aqToNumber, isAQValue, roundToAQValue } from './aqLadder.js';
import {
  ADDITIONAL_UNITS,
  NUMBER_SCHEMES,
  type AdditionalUnit,
  type IngredientEntry,
} from './additionalUnitsData.js';
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
 * The parts of an ingredient entry that drive AU selection: its fixed base unit
 * and its AU mappings. The reorder point takes no part in it, so a **draft**
 * entry — the create form's not-yet-saved mapping rows — can be selected from
 * directly (see selectAQForEntry and resolveReorderPoint).
 */
export type AuSelectableEntry = Pick<IngredientEntry, 'bu' | 'entries'>;

/**
 * Selects the additional quantity specification for an explicit entry (§6).
 *
 * Mappings are evaluated in ascending priority order (the caller passes them
 * pre-sorted); the first mapping whose rounded AQ passes its number scheme wins.
 * An entry whose base unit differs from `bu` has no applicable AQS (§7) — the
 * conversion factor is expressed in the ingredient's fixed base unit.
 *
 * This is the registry-independent core of selectAQ: the create form passes its
 * unsaved draft mappings here so the preview already reflects them.
 *
 * @param entry the ingredient's base unit + AU mappings, or undefined when the
 *   name is not registered
 * @param bq stored/entered base quantity — must be a standard ladder value (§3,
 *   else throws)
 * @param bu base unit the quantity is expressed in (g / kg / ml / l)
 * @returns the selected AQ + AU, or null when no AQS applies (base form)
 */
export function selectAQForEntry(
  entry: AuSelectableEntry | undefined,
  bq: number,
  bu: string,
): AdditionalQuantity | null {
  // Rejects non-standard base quantities (§3): they do not exist in the app.
  pos(bq);
  // No entry (unregistered name) or a mismatched base unit — and bare
  // ingredients (empty entries) — have no AQS (§7): base form only.
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
 * Selects the additional quantity specification for a registered ingredient
 * (§6) — the registry-backed shorthand of selectAQForEntry.
 *
 * @param ingredient ingredient name (key into INGREDIENT_MAPPINGS)
 * @param bq stored base quantity — must be a standard ladder value (§3, else throws)
 * @param bu stored base unit (g / kg / ml / l)
 * @returns the selected AQ + AU, or null when no AQS applies (base form)
 */
export function selectAQ(ingredient: string, bq: number, bu: string): AdditionalQuantity | null {
  return selectAQForEntry(mappingsFor(ingredient), bq, bu);
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
 * Renders the selected unit's arrangement with the placeholders substituted
 * (§4). Shared by renderAQS (a registered ingredient) and resolveReorderPoint
 * (the create form's draft entry). `ingredient` may be empty in the draft case,
 * which drops the arrangement's space before the name.
 */
function renderSelectedAQ(
  ingredient: string,
  selected: AdditionalQuantity,
  bu: string,
  shownBq: number,
): string {
  // The arrangement binds <BQ> and <BU> together with a narrow no-break
  // space; substitute that pair with the formatted base quantity first (the
  // <NNBSP> placeholder is consumed here, before the general substitution).
  const line = selected.au.arrangement
    .replace('<BQ><NNBSP><BU>', formatBQ(shownBq, bu))
    .replaceAll('<AQ>', formatAQ(selected.aq))
    .replaceAll('<AU>', selected.au.name)
    .replaceAll('<IN>', ingredient)
    .replaceAll('<NNBSP>', NNBSP);
  // The create form can preview an entry before a name is typed; the
  // arrangement would then leave a dangling space ("1 Becher  (160 g)").
  return ingredient === '' ? line.replaceAll('  ', ' ') : line;
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
  return renderSelectedAQ(ingredient, selected, bu, shownBq);
}

/**
 * The tolerance of the exact-unit check below: 1/3 · 300 g is 99.999… in binary
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
 * Two tolerances separate it from renderAQS, and both follow from what the line
 * is for — *naming an amount that exists*, not displaying a stored recipe value:
 *
 * - the quantity need not be a standard number (a need is a sum over dishes; a
 *   stock comes from the reorder point or from a keyboard), so nothing throws
 *   and the additional quantity is only ever *displayed* as the nearest ladder
 *   fraction (§6.1);
 * - an **exact** unit applies only when its count really brings that amount home.
 *   For a recipe row it is the point of an exact unit that the count restates the
 *   amount (§6.3: 350 g of yoghurt shows as "1 Becher Joghurt (400 g)"), but a
 *   line that names a requirement must not be restated as something else: 350 g
 *   needed is not 400 g needed, so the mapping is skipped and the search
 *   continues — down to the base form ("350 g Joghurt"). An approximate unit
 *   always applies: it keeps the queried amount as the authoritative reading
 *   ("6 Stück Karotten (500 g)").
 *
 * An empty name (the create form's preview before a name is typed) has no
 * mappings to look up, so the base amount stands alone ("600 g").
 *
 * @param ingredient the ingredient name for the arrangement's <IN>
 * @param bq the quantity to name, in `bu` (need not be a ladder value)
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
    return renderSelectedAQ(ingredient, { aq, au, factor: mapping.factor }, bu, bq);
  }
  return base;
}

/**
 * The additional unit an ingredient is **bought** in, or null when it has none
 * (docs/additional_quantity_specifications.md §3.1) — the unit the shopping
 * list names its amount in.
 *
 * The flag lives on the *unit*, not on the mapping, so the entry's mappings are
 * searched in their priority order (1 = most preferred) and the first one whose
 * unit is a shopping unit wins; a unit that is only a recipe measure (TL, EL)
 * is skipped. `bu` is the family unit the quantity is expressed in: a mapping's
 * factor is expressed in the ingredient's fixed base unit, so a quantity of
 * another family (g for an ml ingredient) has no applicable shopping unit and
 * the caller falls back to the base form (§4).
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
    if (au !== undefined && au.shoppingUnit) {
      return { au, factor: mapping.factor };
    }
  }
  return null;
}

/**
 * Renders a **whole-number** count of one additional unit for the shopping list
 * ("3 Blöcke Tofu (600 g)"): the unit's arrangement with an integer count in
 * place of the ladder-rounded AQ of §6. The count is never rounded here — the
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
 */
export function renderUnitCount(
  ingredient: string,
  count: number,
  au: AdditionalUnit,
  factor: number,
  bu: string,
  amount: number,
): string {
  const shownBq = au.exact ? count * factor : amount;
  return renderSelectedAQ(ingredient, { aq: String(count), au, factor }, bu, shownBq);
}

/**
 * The count a pantry amount reads as (components/PantrySelect — the "auf
 * Vorrat" and "kaufen" readings): the nearest AQ ladder value, ignoring the
 * unit's number scheme, so the amount is always named in the ingredient's
 * shopping unit ("⅕ Packung" for 200 g of a 1000 g pack) rather than dropping
 * the unit. An empty amount reads 0; a count beyond the ladder's top (1000) is
 * rounded to a whole number, like a recipe count above its scheme. A raw count
 * between 0 and the ladder's floor reads 0 too — no fraction exists below ⅒,
 * and "no pack" is the honest reading of a sliver of a pack.
 */
function roundPantryCount(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw < AQ_MIN) return 0;
  if (raw > AQ_MAX) return Math.round(raw);
  return roundToAQValue(raw)!;
}

/**
 * One amount of the pantry sheet (see `pantryReading`): a base quantity in the
 * ingredient's shopping unit, with its two linked numeric readings — the
 * additional quantity (the count) and the base quantity (the grams /
 * millilitres). Used for both the "auf Vorrat" (stock) and "kaufen" (buy)
 * amounts, which share the same nearest-ladder reading.
 */
export interface PantryReading {
  /** The shopping unit the amount is counted in, or null (the base form). */
  readonly au: AdditionalUnit | null;
  /** Conversion factor (family base unit per one AU); 1 without an AU. */
  readonly factor: number;
  /** The count for display (`roundPantryCount`), or null without an AU. */
  readonly aq: number | null;
  /** The base quantity in the family unit (g / ml) — the editable value. */
  readonly bq: number;
}

/**
 * The pantry sheet's reading of one base quantity (the "auf Vorrat" stock or
 * the "kaufen" amount, components/PantrySelect): the amount in the ingredient's
 * **shopping unit**, with the additional quantity rounded to the nearest AQ
 * ladder value regardless of the unit's number scheme.
 *
 * Unlike a recipe line (§6.3), the shown base quantity is the amount itself:
 * the two tappable readings are linked by the factor, and the grams/millilitres
 * are what the sheet edits, so an exact unit must not overrule a typed amount.
 */
export function pantryReading(ingredient: string, bq: number, bu: string): PantryReading {
  const target = shoppingUnitFor(mappingsFor(ingredient), bu);
  if (target === null) {
    return { au: null, factor: 1, aq: null, bq };
  }
  return {
    au: target.au,
    factor: target.factor,
    aq: roundPantryCount(bq / target.factor),
    bq,
  };
}

/**
 * Formats the count of a pantry reading (`PantryReading.aq`): a ladder value in
 * the §8 glyph typography ("1 ¼"), 0 and whole counts beyond the ladder as
 * plain decimal numbers ("0", "2000").
 */
export function formatPantryAq(aq: number): string {
  return isAQValue(aq) ? formatAQ(aqNotation(aq)) : formatDecimal(aq);
}

/** Canonical notation of a pantry count (ladder form, or plain for 0 / whole). */
function pantryAqNotation(aq: number): string {
  return isAQValue(aq) ? aqNotation(aq) : String(aq);
}

/**
 * Renders a pantry reading as text, with or without the ingredient name. The
 * name-less form is what the sheet shows (it carries the name elsewhere); the
 * named form is the Keep write's line.
 */
function renderPantryText(ingredient: string, reading: PantryReading, bu: string): string {
  if (reading.au === null || reading.aq === null) {
    const base = formatBQ(reading.bq, bu);
    return ingredient === '' ? base : `${base} ${ingredient}`;
  }
  return renderSelectedAQ(
    ingredient,
    { aq: pantryAqNotation(reading.aq), au: reading.au, factor: reading.factor },
    bu,
    reading.bq,
  );
}

/**
 * Renders a pantry reading without the ingredient name ("1 ¼ Becher (500 g)"),
 * or the base form ("500 g") when the ingredient has no shopping unit. The
 * sheet's tappable form builds the same arrangement from `pantryReading`'s
 * pieces; this string is the plain-text reading of it.
 */
export function renderPantryAmount(ingredient: string, bq: number, bu: string): string {
  return renderPantryText('', pantryReading(ingredient, bq, bu), bu);
}

/**
 * Renders a pantry reading with the ingredient name ("1 ¼ Becher Mehl (500 g)"),
 * or the base form ("500 g Mehl") — the exact line the Keep write carries, so
 * the sheet can never show a different wording than the list gets.
 */
export function renderPantryLine(ingredient: string, bq: number, bu: string): string {
  return renderPantryText(ingredient, pantryReading(ingredient, bq, bu), bu);
}

/** The resolved create-form reorder point: its preview line and the value to store. */
export interface ReorderPointResolution {
  /** The display line for the chosen stock level ("1 Becher Creme Fraiche (160 g)"). */
  readonly preview: string;
  /** The base quantity to store in the master data (0, a ladder value, or Infinity). */
  readonly storedValue: number;
}

/**
 * Resolves a reorder point against an ingredient's (possibly not-yet-saved) AU
 * mappings — the create form's stock-level field.
 *
 * The reorder point is a base quantity, but it names a *stock state*: what is on
 * the shelf after a shopping trip, not what a recipe calls for. That difference
 * is why an **exact** unit does not merely change the preview here, as it does
 * for a recipe row (§6.3): the **stored** value snaps to the exact amount,
 * because stock comes in whole packages. 150 g entered for a 160 g Becher is
 * previewed and stored as 160 g — there is no such thing as 150 g of a 160 g
 * tub. Approximate units and the base form keep the entered value.
 *
 * The three stock levels of the master data (docs/storage_format.md §9):
 * - `0` — only ever bought for a recipe; the base form is shown ("0 g …");
 * - `Infinity` — infinite stock (water); the preview reads "unbegrenzt …";
 * - a positive ladder value — the entered base quantity, snapped as described
 *   above when an exact unit is selected.
 *
 * The mappings come from the caller rather than the registry so the create form
 * can preview its unsaved rows.
 *
 * @param ingredient the ingredient name for the preview ("" = not yet named)
 * @param entry the draft or registered entry (undefined = no mappings yet)
 * @param bq the entered reorder point: 0, a ladder value, or Infinity
 * @param bu the base unit family (g / ml)
 */
export function resolveReorderPoint(
  ingredient: string,
  entry: AuSelectableEntry | undefined,
  bq: number,
  bu: string,
): ReorderPointResolution {
  if (bq === Infinity) {
    return {
      preview: ingredient === '' ? 'unbegrenzt' : `unbegrenzt ${ingredient}`,
      storedValue: Infinity,
    };
  }
  // 0 is a valid reorder point but not a ladder value (§3): no AU applies.
  const selected = bq === 0 ? null : selectAQForEntry(entry, bq, bu);
  if (selected === null) {
    const base = formatBQ(bq, bu);
    return { preview: ingredient === '' ? base : `${base} ${ingredient}`, storedValue: bq };
  }
  const storedValue = selected.au.exact ? aqToNumber(selected.aq) * selected.factor : bq;
  return { preview: renderSelectedAQ(ingredient, selected, bu, storedValue), storedValue };
}
