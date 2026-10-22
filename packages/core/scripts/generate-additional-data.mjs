#!/usr/bin/env node
/**
 * Generates `src/additionalUnitsData.ts` from the additional-unit master data:
 *   - docs/AQs.csv                       (AQ values, penalties and the scheme columns)
 *   - docs/additional_units.csv          (units: name, arrangement, scheme, exactness, shopping flag)
 *   - docs/ingredients.csv               (ingredient list: name, base unit, tolerance, reorder point, display forms)
 *   - docs/ingredient_unit_mappings.csv  (ingredient → AU: factor; no priority)
 *
 * The `Singular` / `Plural` columns of docs/ingredients.csv (columns B and C,
 * directly after the name) are validated here and compiled into the optional
 * `singular` / `plural` fields of each ingredient: the display forms the app
 * uses when it names the ingredient with a count („1 Karotte“ / „2 Karotten“).
 * The canonical `Ingredient` cell stays the key — it is what recipes and the
 * mappings file use — and the two forms are display data only. Both cells are
 * empty for an invariant name (Zucker, Milch, Butter): the ingredient name then
 * serves for every count. A half-filled pair is an error (see
 * parseDisplayForms).
 *
 * The same two columns of docs/additional_units.csv (again directly after the
 * name) are validated and compiled into the optional `singular` / `plural`
 * fields of each unit: the forms the app shows in place of `<AU>` when the count
 * is one (singular) or above one (plural), so „2 Packungen Mehl (2 kg)“ reads
 * correctly. The canonical `Additional Unit` cell stays the key — it is what the
 * mappings file references and what the runtime registry keys units by — and
 * the two forms are display data only. Both cells are empty for an invariant
 * unit: the unit name then serves for every count. A half-filled pair is an
 * error (see parseDisplayForms).
 *
 * The `Tolerance` column of docs/ingredients.csv is optional and compiled into
 * the `tolerance` field of the ingredient: the ingredient-level fallback of the
 * tolerance cascade (docs/recipe_scaling_algorithm.md §4.1). Empty = inherit
 * the recipe or the global default; a value must be in [0, 1].
 *
 * The `Reorder Point` column of docs/ingredients.csv is validated here and
 * compiled into the `reorderPoint` field of each ingredient: the quantity of
 * the base unit that is definitely on stock directly after a shopping trip,
 * independent of the meal plan. It is a mandatory cell and states either a
 * non-negative number (0 = the ingredient is only ever bought for a recipe) or
 * the token `inf` for infinite stock (realistically only water). It need not be
 * a ladder value.
 *
 * The `Unit Exact` column of docs/additional_units.csv is validated here and
 * compiled into the `exact` flag of each unit: `yes` (the default for an empty
 * cell) means the unit fixes the base amount, so the displayed base quantity is
 * derived from the rounded additional quantity
 * (docs/additional_quantity_specifications.md §6.3).
 *
 * The `Shopping Unit` column of docs/additional_units.csv is validated here and
 * compiled into the `shoppingUnit` flag of each unit: `yes` when ingredients are
 * bought in this unit (a Becher of yogurt), `no` when the unit is only a recipe
 * measure (TL, EL). The cell is mandatory — every unit states the flag, so a new
 * unit can never silently default into or out of the shopping list. Because a
 * unit's identity is its name (mappings reference it by name), the rare unit
 * that is a shopping unit for some ingredients and not for others is modelled as
 * two units with **distinct names** (docs/additional_quantity_specifications.md
 * §3.1), never as two rows with the same name.
 *
 * The number-scheme columns live directly in docs/AQs.csv, the single source of
 * the AQ values and their memberships. A unit references a scheme by name; the
 * generator fails when a unit names an unknown scheme, when a scheme cell is not
 * 1/0/empty, or when a scheme allows a count above 30.
 *
 * A unit identity is its name, and the app allows **one shopping unit per
 * ingredient** (decided with the user). The mapping generator therefore fails
 * when an ingredient maps to two units both flagged `Shopping Unit = yes`.
 *
 * Usage:
 *   npm run generate:additional   (from packages/core)
 *
 * After every change to one of the CSVs, re-run this script and commit the
 * regenerated file. The generated TypeScript module is committed so that the
 * framework-free core package and its consumers never parse CSV at runtime
 * (same pattern as generate-ladder.mjs).
 *
 * CSV format (canonical): semicolon-separated, dot decimals (German comma
 * decimals tolerated), header row, CRLF tolerated, one optional trailing empty
 * cell per row (spreadsheet exports). Scheme cells: `1` = allowed, `0` or
 * empty = not allowed. The `Unit Exact` cell is `yes` or `no`, empty = `yes`.
 * The `Shopping Unit` cell is `yes` or `no` and must not be empty. The
 * ingredient `Tolerance` cell is empty or a number in [0, 1].
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const AQ_CSV = resolve(ROOT, 'docs/AQs.csv');
const UNITS_CSV = resolve(ROOT, 'docs/additional_units.csv');
const INGREDIENTS_CSV = resolve(ROOT, 'docs/ingredients.csv');
const MAPPINGS_CSV = resolve(ROOT, 'docs/ingredient_unit_mappings.csv');
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/additionalUnitsData.ts');

/**
 * Placeholders allowed in an arrangement template
 * (docs/additional_quantity_specifications.md §4). Everything else in the cell
 * is **free text** and is rendered unchanged — literal words, punctuation and
 * spacing all pass through — so this set only rejects a mistyped placeholder.
 */
const ARRANGEMENT_TOKENS = new Set(['<AQ>', '<AU>', '<IN>', '<INF>', '<BQ>', '<BU>', '<NNBSP>']);

/** Exact header of the additional-units table (docs/additional_units.csv). */
const UNITS_HEADER =
  'Additional Unit;Singular;Plural;Arrangement;Number Scheme;Unit Exact;Shopping Unit';

/** Exact header of the ingredient list (docs/ingredients.csv). */
const INGREDIENTS_HEADER = 'Ingredient;Singular;Plural;Base Unit;Tolerance;Reorder Point';

/** Converts a CSV cell to a number, accepting both '.' and ',' decimals. */
function toNumber(cell) {
  return Number(cell.trim().replace(',', '.'));
}

/**
 * Parses the `Unit Exact` cell of the additional-units table: `yes` / `no`,
 * with an empty cell meaning the default `yes` (docs/additional_units.csv).
 * Anything else is a master-data error.
 */
function parseUnitExact(cell, unitName) {
  const value = (cell ?? '').trim().toLowerCase();
  if (value === '' || value === 'yes') {
    return true;
  }
  if (value === 'no') {
    return false;
  }
  throw new Error(
    `${UNITS_CSV}: invalid Unit Exact value '${cell}' for unit '${unitName}' (use yes or no)`,
  );
}

/**
 * Parses the `Shopping Unit` cell of the additional-units table: `yes` when
 * ingredients are bought in this unit (a Becher of yogurt), `no` when the unit
 * is only a recipe measure (TL, EL). The cell is mandatory — an empty cell is a
 * master-data error, so a new unit cannot silently default into or out of the
 * shopping list (docs/additional_quantity_specifications.md §3.1).
 */
function parseShoppingUnit(cell, unitName) {
  const value = (cell ?? '').trim().toLowerCase();
  if (value === 'yes') {
    return true;
  }
  if (value === 'no') {
    return false;
  }
  throw new Error(
    `${UNITS_CSV}: invalid Shopping Unit value '${cell}' for unit '${unitName}' ` +
      `(use yes or no; the cell is mandatory)`,
  );
}

/**
 * Parses the `Reorder Point` cell of the ingredient list: the base-unit
 * quantity that is definitely on stock directly after a shopping trip. The
 * cell is mandatory and holds either a non-negative number (0 = only ever
 * bought for a recipe) or the token `inf` for infinite stock (water-like
 * ingredients). Case-insensitive; the canonical written form is `inf`.
 */
function parseReorderPoint(cell, ingredient) {
  const value = (cell ?? '').trim().toLowerCase();
  if (value === '') {
    throw new Error(`${INGREDIENTS_CSV}: empty Reorder Point for '${ingredient}'`);
  }
  if (value === 'inf') {
    return Infinity;
  }
  const point = toNumber(cell);
  if (!Number.isFinite(point) || point < 0) {
    throw new Error(
      `${INGREDIENTS_CSV}: invalid Reorder Point '${cell}' for '${ingredient}' ` +
        `(use a number >= 0 or inf)`,
    );
  }
  return point;
}

/**
 * Parses the optional `Tolerance` cell of the ingredient list: empty = inherit
 * the recipe / global default; otherwise a number in [0, 1]. The cell is the
 * ingredient-level step of the tolerance cascade
 * (docs/recipe_scaling_algorithm.md §4.1).
 */
function parseToleranceCell(cell, ingredient) {
  const value = (cell ?? '').trim();
  if (value === '') return undefined;
  const tolerance = toNumber(value);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
    throw new Error(
      `${INGREDIENTS_CSV}: invalid Tolerance '${cell}' for '${ingredient}' (use a number in [0, 1] or leave the cell empty)`,
    );
  }
  return tolerance;
}

/**
 * Parses a `Singular` / `Plural` pair: the display forms used when the subject
 * is named with a count („1 Karotte“ / „2 Karotten“, „2 Packungen“). Shared by
 * the ingredient list and the additional-units table, whose two cells sit
 * directly after the name they belong to. Both cells are empty for an invariant
 * name (Zucker, Milch) — the canonical name then serves for every
 * count — and both are filled for a name that has a count form. A half-filled
 * pair is an error: with only one form given, one side would silently fall back
 * to the canonical name, which is exactly the ambiguity these columns remove.
 * Returns the fields to spread into the entry (`{}` for an invariant name, so
 * the generated entry carries no empty strings).
 */
function parseDisplayForms(singularCell, pluralCell, subject, source) {
  const singular = (singularCell ?? '').trim();
  const plural = (pluralCell ?? '').trim();
  if (singular === '' && plural === '') {
    return {};
  }
  if (singular === '' || plural === '') {
    throw new Error(
      `${source}: incomplete Singular/Plural pair for '${subject}' ` +
        `(fill both display forms or leave both empty for an invariant name)`,
    );
  }
  return { singular, plural };
}

/** Parses a `;`-separated CSV into { header, rows } of trimmed cells. */
function parseCsv(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new Error(`${path}: file is empty`);
  }
  const header = lines[0].split(';').map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(';').map((cell) => cell.trim());
    // Drop exactly one trailing empty cell produced by spreadsheet exports
    // (e.g. a row ending in ';'); a meaningful empty cell inside the row stays.
    if (cells.length === header.length + 1 && cells[cells.length - 1] === '') {
      cells.pop();
    }
    if (cells.length !== header.length) {
      throw new Error(
        `${path}: expected ${header.length} columns, got ${cells.length} in line: ${line}`,
      );
    }
    return cells;
  });
  return { header, rows };
}

/**
 * Parses a canonical AQ notation (`1/2`, `1+1/4`, `3`) into its numeric value.
 * Kept local so the generator is a standalone Node script.
 */
function parseAqNumber(value) {
  const compact = value.replace(/\s+/g, '');
  const plus = compact.indexOf('+');
  if (plus !== -1) {
    const integer = toNumber(compact.slice(0, plus));
    const fraction = compact.slice(plus + 1);
    const slash = fraction.indexOf('/');
    return integer + toNumber(fraction.slice(0, slash)) / toNumber(fraction.slice(slash + 1));
  }
  const slash = compact.indexOf('/');
  if (slash !== -1) {
    return toNumber(compact.slice(0, slash)) / toNumber(compact.slice(slash + 1));
  }
  return toNumber(compact);
}

/**
 * Reads docs/AQs.csv: the AQ values, their penalties (validated in
 * generate-quantity-data.mjs) and the number-scheme columns. The scheme
 * membership is emitted as canonical AQ notation strings because the legacy
 * shopping/pantry helpers still compare notations; the new optimizer uses the
 * numeric `AQ_SCHEMES` from quantityData.ts.
 *
 * The scheme names must be the same names docs/additional_units.csv references.
 * Every scheme is a subset of the AQ rows; a scheme may not allow counts above
 * 30 (decided with the user).
 */
function buildAqSchemes() {
  const { header, rows } = parseCsv(AQ_CSV);
  if (header[0] !== 'Additional Quantity' || header[1] !== 'Clumsiness Penalty') {
    throw new Error(`${AQ_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const schemeNames = header.slice(2);
  if (schemeNames.length === 0) {
    throw new Error(`${AQ_CSV}: no number scheme columns defined`);
  }
  if (new Set(schemeNames).size !== schemeNames.length) {
    throw new Error(`${AQ_CSV}: duplicate scheme column names`);
  }
  for (const name of schemeNames) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(
        `${AQ_CSV}: invalid scheme name '${name}' (use letters, digits, underscores; start with a letter)`,
      );
    }
  }

  const seen = new Set();
  const aqValues = [];
  const schemes = schemeNames.map((name) => ({ name, values: [] }));
  for (const row of rows) {
    const aq = row[0];
    if (aq === undefined || aq === '') {
      throw new Error(`${AQ_CSV}: empty AQ cell in line: ${row.join(';')}`);
    }
    const numeric = parseAqNumber(aq);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`${AQ_CSV}: invalid AQ value '${aq}'`);
    }
    if (seen.has(numeric)) {
      throw new Error(`${AQ_CSV}: duplicate AQ value '${aq}'`);
    }
    if (numeric > 30) {
      throw new Error(`${AQ_CSV}: AQ value '${aq}' is above 30; no scheme may allow it`);
    }
    seen.add(numeric);
    aqValues.push(aq);
    for (let col = 2; col < header.length; col++) {
      const cell = row[col] ?? '';
      if (cell === '') continue;
      if (cell !== '1' && cell !== '0') {
        throw new Error(
          `${AQ_CSV}: invalid scheme cell '${cell}' for AQ '${aq}' (use 1, 0 or empty)`,
        );
      }
      if (cell === '1') {
        schemes[col - 2].values.push(aq);
      }
    }
  }
  return { aqValues, schemes };
}

/** Parses the additional units table; validates arrangements, scheme refs, exactness and display forms. */
function buildUnits(schemeNames) {
  const { header, rows } = parseCsv(UNITS_CSV);
  if (header.join(';') !== UNITS_HEADER) {
    throw new Error(`${UNITS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const units = rows.map((row, index) => {
    const [name, singularCell, pluralCell, arrangement, numberScheme, exactCell, shoppingCell] =
      row;
    if (name === '') {
      throw new Error(`${UNITS_CSV}: empty unit name in row ${index + 2}`);
    }
    if (!schemeNames.includes(numberScheme)) {
      throw new Error(
        `${UNITS_CSV}: unit '${name}' references unknown number scheme '${numberScheme}' ` +
          `(known: ${schemeNames.join(', ')})`,
      );
    }
    for (const token of arrangement.match(/<[A-Z]+>/g) ?? []) {
      if (!ARRANGEMENT_TOKENS.has(token)) {
        throw new Error(
          `${UNITS_CSV}: unit '${name}' uses unknown placeholder ${token} ` +
            `(allowed: ${[...ARRANGEMENT_TOKENS].join(', ')})`,
        );
      }
    }
    return {
      name,
      // "Singular" / "Plural": the display forms shown in place of <AU> for a
      // count of one / above one; both empty for an invariant unit, whose name
      // then serves for every count. Display data only — the canonical `name`
      // stays the key the mappings reference. A qualifier in the name
      // ("Packung (teilbar)") is a key too, so such a unit must state its pair.
      ...parseDisplayForms(singularCell, pluralCell, name, UNITS_CSV),
      // <NNBSP> stays a placeholder in the arrangement; the runtime renderer
      // substitutes it with the narrow no-break space (U+202F) like any other
      // placeholder, keeping the generated module pure ASCII.
      arrangement,
      numberScheme,
      // "Unit Exact" (docs/additional_quantity_specifications.md §6.3): an
      // empty cell means the default `yes` — an exact unit is one whose
      // definition fixes the base amount (a 400 g Becher, a 200 g Block).
      exact: parseUnitExact(exactCell, name),
      // "Shopping Unit" (§3.1): mandatory yes/no — `yes` when ingredients are
      // bought in this unit, `no` when it is only a recipe measure.
      shoppingUnit: parseShoppingUnit(shoppingCell, name),
    };
  });
  // Unit names stay unique on purpose: mappings and the runtime registry
  // reference a unit by name, so two rows with the same name would be
  // indistinguishable. A unit that must be both a shopping and a non-shopping
  // unit for different ingredients is therefore split into two units with
  // distinct names (docs/additional_quantity_specifications.md §3.1).
  if (new Set(units.map((unit) => unit.name)).size !== units.length) {
    throw new Error(
      `${UNITS_CSV}: duplicate unit name — a unit's identity is its name; ` +
        `give the variants distinct names (docs/additional_quantity_specifications.md §3.1)`,
    );
  }
  return units;
}

/** Parses the ingredient list; validates base units, reorder points, display forms and unique names. */
function buildIngredientList() {
  const { header, rows } = parseCsv(INGREDIENTS_CSV);
  if (header.join(';') !== INGREDIENTS_HEADER) {
    throw new Error(`${INGREDIENTS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const byName = new Map();
  for (const row of rows) {
    const [ingredient, singularCell, pluralCell, bu, toleranceCell, reorderCell] = row;
    if (ingredient === '' || bu === '') {
      throw new Error(
        `${INGREDIENTS_CSV}: empty ingredient or base unit in line: ${row.join(';')}`,
      );
    }
    if (bu !== 'g' && bu !== 'ml') {
      throw new Error(
        `${INGREDIENTS_CSV}: invalid base unit '${bu}' for '${ingredient}' (allowed: g, ml)`,
      );
    }
    if (byName.has(ingredient)) {
      throw new Error(`${INGREDIENTS_CSV}: duplicate ingredient '${ingredient}'`);
    }
    const tolerance = parseToleranceCell(toleranceCell, ingredient);
    byName.set(ingredient, {
      bu,
      reorderPoint: parseReorderPoint(reorderCell, ingredient),
      ...(tolerance !== undefined ? { tolerance } : {}),
      ...parseDisplayForms(singularCell, pluralCell, ingredient, INGREDIENTS_CSV),
    });
  }
  if (byName.size === 0) {
    throw new Error(`${INGREDIENTS_CSV}: no ingredients defined`);
  }
  return byName;
}

/**
 * Parses the ingredient–AU mappings; validates references, factors and the
 * one-shopping-unit rule. The base unit is not part of this file — it comes
 * from the ingredient list, which is also the authoritative set of ingredient
 * names: a mapping for an unknown ingredient is an error, and an ingredient
 * without mappings (e.g. Cashews) is simply absent here.
 *
 * There is no per-ingredient priority anymore: the optimizer scores every
 * compatible unit. The shopping list still needs exactly one unit to buy in, so
 * an ingredient may map to at most one unit flagged `Shopping Unit = yes`.
 */
function buildMappings(units, ingredientNames) {
  const unitByName = new Map(units.map((unit) => [unit.name, unit]));
  const { header, rows } = parseCsv(MAPPINGS_CSV);
  if (header.join(';') !== 'Ingredient;Additional Unit;Conversion Factor') {
    throw new Error(`${MAPPINGS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const byIngredient = new Map();
  for (const row of rows) {
    const [ingredient, au, factorCell] = row;
    if (ingredient === '') {
      throw new Error(`${MAPPINGS_CSV}: empty ingredient in line: ${row.join(';')}`);
    }
    if (!ingredientNames.has(ingredient)) {
      throw new Error(
        `${MAPPINGS_CSV}: mapping for '${ingredient}' is not in the ingredient list (${INGREDIENTS_CSV})`,
      );
    }
    const unit = unitByName.get(au);
    if (unit === undefined) {
      throw new Error(
        `${MAPPINGS_CSV}: mapping for '${ingredient}' references unknown additional unit '${au}' ` +
          `(known: ${[...unitByName.keys()].join(', ')})`,
      );
    }
    const factor = toNumber(factorCell);
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `${MAPPINGS_CSV}: invalid conversion factor '${factorCell}' for '${ingredient}' → '${au}'`,
      );
    }
    const list = byIngredient.get(ingredient) ?? [];
    if (list.some((mapping) => mapping.au === au)) {
      throw new Error(`${MAPPINGS_CSV}: duplicate mapping for '${ingredient}' → '${au}'`);
    }
    list.push({ au, factor });
    byIngredient.set(ingredient, list);
  }
  for (const [ingredient, list] of byIngredient) {
    const shoppingUnits = list.filter((mapping) => unitByName.get(mapping.au).shoppingUnit);
    if (shoppingUnits.length > 1) {
      throw new Error(
        `${MAPPINGS_CSV}: '${ingredient}' maps to more than one shopping unit ` +
          `(${shoppingUnits.map((mapping) => mapping.au).join(', ')}); the app allows exactly one`,
      );
    }
  }
  return byIngredient;
}

/**
 * Renders a reorder point as a TypeScript number literal. Infinity has no JSON
 * form, so it is written as the `Infinity` global.
 */
function formatReorderPoint(value) {
  return value === Infinity ? 'Infinity' : String(value);
}

function render(units, schemes, ingredientList, mappings) {
  const lines = [];
  lines.push('/**');
  lines.push(' * AUTO-GENERATED from docs/AQs.csv, docs/additional_units.csv,');
  lines.push(' * docs/ingredients.csv and docs/ingredient_unit_mappings.csv by');
  lines.push(' * scripts/generate-additional-data.mjs.');
  lines.push(
    " * Do not edit by hand — re-run 'npm run generate:additional' (packages/core) after a CSV change.",
  );
  lines.push(' */');
  lines.push('');
  lines.push('/** One additional unit: display arrangement, number scheme and unit flags. */');
  lines.push('export interface AdditionalUnit {');
  lines.push(
    '  /** Canonical unit name: the identity the mappings reference and the runtime registry keys units by; without `singular`/`plural` it is also the form the display line shows. */',
  );
  lines.push('  readonly name: string;');
  lines.push(
    '  /** Singular display form of the unit (count 1), e.g. "Packung"; absent = the name is invariant and serves for every count. Present exactly when `plural` is. */',
  );
  lines.push('  readonly singular?: string;');
  lines.push(
    '  /** Plural display form of the unit (count above one), e.g. "Packungen"; absent = invariant (see `singular`). */',
  );
  lines.push('  readonly plural?: string;');
  lines.push(
    '  /** Display template; placeholders <AQ> <AU> <IN> (canonical ingredient name) <INF> (its singular/plural form) <BQ> <BU> <NNBSP> (narrow no-break space). */',
  );
  lines.push('  readonly arrangement: string;');
  lines.push("  /** Name of the number scheme gating this unit's additional quantities. */");
  lines.push('  readonly numberScheme: string;');
  lines.push(
    '  /** True when the unit fixes the base amount (a 400 g Becher, a 200 g Block): the shown base quantity is then derived from the rounded AQ (docs/additional_quantity_specifications.md §6.3). */',
  );
  lines.push('  readonly exact: boolean;');
  lines.push(
    '  /** True when ingredients are bought in this unit (a Becher of yogurt); false for a pure recipe measure (TL, EL). Drives the shopping list (docs/additional_quantity_specifications.md §3.1). */',
  );
  lines.push('  readonly shoppingUnit: boolean;');
  lines.push('}');
  lines.push('');
  lines.push('/** One ingredient–additional-unit mapping (conversion factor only). */');
  lines.push('export interface IngredientMapping {');
  lines.push('  /** Referenced additional unit name (see ADDITIONAL_UNITS). */');
  lines.push('  readonly au: string;');
  lines.push('  /** Amount of base unit per one additional unit. */');
  lines.push('  readonly factor: number;');
  lines.push('}');
  lines.push('');
  lines.push('/** One ingredient in the master data: base unit, reorder point and AU mappings. */');
  lines.push('export interface IngredientEntry {');
  lines.push(
    '  /** Fixed base unit family of the ingredient ("g" or "ml"); the conversion factors are expressed in this unit. */',
  );
  lines.push('  readonly bu: string;');
  lines.push(
    '  /** Base-unit quantity definitely on stock directly after a shopping trip, independent of the meal plan (0 = only ever bought for a recipe; Infinity = always in stock, e.g. water). Not necessarily a ladder value. */',
  );
  lines.push('  readonly reorderPoint: number;');
  lines.push(
    '  /** Ingredient-level tolerance in [0, 1], or absent to inherit the recipe / global default (docs/recipe_scaling_algorithm.md §4.1). */',
  );
  lines.push('  readonly tolerance?: number;');
  lines.push(
    '  /** Singular display form of the name (count 1), e.g. "Karotte"; absent = the name is invariant and serves for every count (Zucker, Milch). Present exactly when `plural` is. */',
  );
  lines.push('  readonly singular?: string;');
  lines.push(
    '  /** Plural display form of the name (count ≠ 1), e.g. "Karotten"; absent = invariant (see `singular`). */',
  );
  lines.push('  readonly plural?: string;');
  lines.push(
    "  /** The ingredient's additional-unit mappings; empty = bare ingredient without additional units. */",
  );
  lines.push('  readonly entries: readonly IngredientMapping[];');
  lines.push('}');
  lines.push('');
  lines.push('/** All additional units, in table order. */');
  lines.push('export const ADDITIONAL_UNITS: readonly AdditionalUnit[] = [');
  for (const unit of units) {
    // The display forms are emitted only when the unit has them, so an invariant
    // unit keeps the lean entry shape (no empty strings).
    const forms =
      unit.singular !== undefined
        ? `singular: ${JSON.stringify(unit.singular)}, plural: ${JSON.stringify(unit.plural)}, `
        : '';
    lines.push(
      `  { name: ${JSON.stringify(unit.name)}, ${forms}arrangement: ${JSON.stringify(unit.arrangement)}, ` +
        `numberScheme: ${JSON.stringify(unit.numberScheme)}, exact: ${unit.exact}, ` +
        `shoppingUnit: ${unit.shoppingUnit} },`,
    );
  }
  lines.push('];');
  lines.push('');
  lines.push('/** Number schemes: allowed AQ values per scheme, in ladder AQ order. */');
  lines.push('export const NUMBER_SCHEMES: Readonly<Record<string, readonly string[]>> = {');
  for (const scheme of schemes) {
    const values = scheme.values.map((value) => JSON.stringify(value)).join(', ');
    lines.push(`  ${JSON.stringify(scheme.name)}: [${values}],`);
  }
  lines.push('};');
  lines.push('');
  lines.push('/** Ingredient master data keyed by ingredient name. */');
  lines.push('export const INGREDIENT_MAPPINGS: Readonly<Record<string, IngredientEntry>> = {');
  for (const [ingredient, entry] of ingredientList) {
    const entries = mappings.get(ingredient) ?? [];
    lines.push(`  ${JSON.stringify(ingredient)}: {`);
    lines.push(`    bu: ${JSON.stringify(entry.bu)},`);
    lines.push(`    reorderPoint: ${formatReorderPoint(entry.reorderPoint)},`);
    if (entry.tolerance !== undefined) {
      lines.push(`    tolerance: ${entry.tolerance},`);
    }
    // The display forms are emitted only when the name has them, so an
    // invariant ingredient keeps the lean entry shape (no empty strings).
    if (entry.singular !== undefined) {
      lines.push(`    singular: ${JSON.stringify(entry.singular)},`);
      lines.push(`    plural: ${JSON.stringify(entry.plural)},`);
    }
    lines.push('    entries: [');
    for (const mapping of entries) {
      lines.push(
        `      { au: ${JSON.stringify(mapping.au)}, factor: ${mapping.factor} },`,
      );
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const { aqValues, schemes } = buildAqSchemes();
const units = buildUnits(schemes.map((scheme) => scheme.name));
const ingredientList = buildIngredientList();
const mappings = buildMappings(units, ingredientList);
let output = render(units, schemes, ingredientList, mappings);
try {
  // Format with Prettier (root devDependency, used by `npm run format`) so the
  // committed generated module is prettier-clean and regeneration is
  // idempotent — `npm run format` would otherwise produce diff noise.
  // The project config (.prettierrc.json) is resolved explicitly because the
  // generator's CWD may differ from the repo root.
  const { format, resolveConfig } = await import('prettier');
  const config = await resolveConfig(OUT_PATH);
  output = await format(output, { ...config, parser: 'typescript' });
} catch {
  // Prettier not installed — the raw render is still valid TypeScript.
}
writeFileSync(OUT_PATH, output, 'utf8');
const memberships = schemes.reduce((sum, scheme) => sum + scheme.values.length, 0);
console.log(
  `Wrote ${units.length} units, ${aqValues.length} AQ values, ` +
    `${schemes.length} schemes (${memberships} memberships), ` +
    `${ingredientList.size} ingredient(s) to ${OUT_PATH}`,
);
