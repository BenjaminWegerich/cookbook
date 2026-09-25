#!/usr/bin/env node
/**
 * Generates `src/additionalUnitsData.ts` from the additional-unit master data:
 *   - docs/number_schemes.csv            (AQ value × number scheme matrix)
 *   - docs/additional_units.csv          (units: name, arrangement, scheme, exactness, shopping flag)
 *   - docs/ingredients.csv               (ingredient list: name, base unit, reorder point)
 *   - docs/ingredient_unit_mappings.csv  (ingredient → AU: factor, priority)
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
 * The AQ values in number_schemes.csv must exactly match the AQ column of the
 * authoritative ladder table docs/standard_numbers.csv (see
 * docs/additional_quantity_specifications.md §3 and §5): the generator acts as
 * the drift guard — a mismatch fails the build with an explicit list, so
 * changing the standard numbers can never silently corrupt the schemes.
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
 * The `Shopping Unit` cell is `yes` or `no` and must not be empty.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LADDER_CSV = resolve(ROOT, 'docs/standard_numbers.csv');
const SCHEMES_CSV = resolve(ROOT, 'docs/number_schemes.csv');
const UNITS_CSV = resolve(ROOT, 'docs/additional_units.csv');
const INGREDIENTS_CSV = resolve(ROOT, 'docs/ingredients.csv');
const MAPPINGS_CSV = resolve(ROOT, 'docs/ingredient_unit_mappings.csv');
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/additionalUnitsData.ts');

/** Placeholders allowed in an arrangement template (docs/additional_quantity_specifications.md §4). */
const ARRANGEMENT_TOKENS = new Set(['<AQ>', '<AU>', '<IN>', '<BQ>', '<BU>', '<NNBSP>']);

/** Exact header of the additional-units table (docs/additional_units.csv). */
const UNITS_HEADER = 'Additional Unit;Arrangement;Number Scheme;Unit Exact;Shopping Unit';

/** Exact header of the ingredient list (docs/ingredients.csv). */
const INGREDIENTS_HEADER = 'Ingredient;Base Unit;Reorder Point';

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

/** Distinct AQ ladder values from standard_numbers.csv, in table order. */
function ladderAqValues() {
  const { header, rows } = parseCsv(LADDER_CSV);
  if (
    header[0] !== 'Exact Number' ||
    header[1] !== 'Rounded Number for BQ' ||
    header[2] !== 'Rounded Number for AQ'
  ) {
    throw new Error(`${LADDER_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const seen = new Set();
  const values = [];
  for (const row of rows) {
    const aq = row[2];
    if (aq === undefined || aq === '') {
      throw new Error(`${LADDER_CSV}: empty AQ cell in line: ${row.join(';')}`);
    }
    if (!seen.has(aq)) {
      seen.add(aq);
      values.push(aq);
    }
  }
  return values;
}

/**
 * Parses the scheme matrix and validates its AQ rows against the ladder — the
 * drift guard. The emitted membership sets follow the ladder's AQ order, so
 * reordering rows in the CSV does not change the output.
 */
function buildSchemes(ladderAq) {
  const { header, rows } = parseCsv(SCHEMES_CSV);
  if (header[0] !== 'AQ Value') {
    throw new Error(`${SCHEMES_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const schemeNames = header.slice(1);
  if (schemeNames.length === 0) {
    throw new Error(`${SCHEMES_CSV}: no number scheme columns defined`);
  }
  if (new Set(schemeNames).size !== schemeNames.length) {
    throw new Error(`${SCHEMES_CSV}: duplicate scheme column names`);
  }
  for (const name of schemeNames) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(
        `${SCHEMES_CSV}: invalid scheme name '${name}' (use letters, digits, underscores; start with a letter)`,
      );
    }
  }

  const rowAq = rows.map((row) => row[0]);
  if (new Set(rowAq).size !== rowAq.length) {
    throw new Error(`${SCHEMES_CSV}: duplicate AQ row`);
  }
  const missing = ladderAq.filter((aq) => !rowAq.includes(aq));
  const extra = rowAq.filter((aq) => !ladderAq.includes(aq));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${SCHEMES_CSV}: AQ rows drift from ${LADDER_CSV} — ` +
        `missing: ${missing.join(', ') || '—'}; extra/unknown: ${extra.join(', ') || '—'}. ` +
        `Keep the scheme table's AQ values in sync with the ladder's AQ column.`,
    );
  }

  const byAq = new Map(rows.map((row) => [row[0], row]));
  const schemes = schemeNames.map((name) => ({ name, values: [] }));
  for (const aq of ladderAq) {
    const row = byAq.get(aq);
    for (let col = 1; col < header.length; col++) {
      const cell = row[col] ?? '';
      if (cell === '') {
        continue;
      }
      if (cell !== '1' && cell !== '0') {
        throw new Error(
          `${SCHEMES_CSV}: invalid scheme cell '${cell}' for AQ '${aq}' (use 1, 0 or empty)`,
        );
      }
      if (cell === '1') {
        schemes[col - 1].values.push(aq);
      }
    }
  }
  return schemes;
}

/** Parses the additional units table; validates arrangements, scheme refs and the exactness flag. */
function buildUnits(schemeNames) {
  const { header, rows } = parseCsv(UNITS_CSV);
  if (header.join(';') !== UNITS_HEADER) {
    throw new Error(`${UNITS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const units = rows.map((row, index) => {
    const [name, arrangement, numberScheme, exactCell, shoppingCell] = row;
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

/** Parses the ingredient list; validates base units, reorder points and unique names. */
function buildIngredientList() {
  const { header, rows } = parseCsv(INGREDIENTS_CSV);
  if (header.join(';') !== INGREDIENTS_HEADER) {
    throw new Error(`${INGREDIENTS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const byName = new Map();
  for (const row of rows) {
    const [ingredient, bu, reorderCell] = row;
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
    byName.set(ingredient, { bu, reorderPoint: parseReorderPoint(reorderCell, ingredient) });
  }
  if (byName.size === 0) {
    throw new Error(`${INGREDIENTS_CSV}: no ingredients defined`);
  }
  return byName;
}

/**
 * Parses the ingredient–AU mappings; validates references, factors and
 * priorities. The base unit is not part of this file — it comes from the
 * ingredient list, which is also the authoritative set of ingredient names: a
 * mapping for an unknown ingredient is an error, and an ingredient without
 * mappings (e.g. Cashews) is simply absent here.
 */
function buildMappings(unitNames, ingredientNames) {
  const { header, rows } = parseCsv(MAPPINGS_CSV);
  if (header.join(';') !== 'Ingredient;Additional Unit;Conversion Factor;Priority') {
    throw new Error(`${MAPPINGS_CSV}: unexpected header ${JSON.stringify(header)}`);
  }
  const byIngredient = new Map();
  for (const row of rows) {
    const [ingredient, au, factorCell, priorityCell] = row;
    if (ingredient === '') {
      throw new Error(`${MAPPINGS_CSV}: empty ingredient in line: ${row.join(';')}`);
    }
    if (!ingredientNames.has(ingredient)) {
      throw new Error(
        `${MAPPINGS_CSV}: mapping for '${ingredient}' is not in the ingredient list (${INGREDIENTS_CSV})`,
      );
    }
    if (!unitNames.includes(au)) {
      throw new Error(
        `${MAPPINGS_CSV}: mapping for '${ingredient}' references unknown additional unit '${au}' ` +
          `(known: ${unitNames.join(', ')})`,
      );
    }
    const factor = toNumber(factorCell);
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `${MAPPINGS_CSV}: invalid conversion factor '${factorCell}' for '${ingredient}' → '${au}'`,
      );
    }
    const priority = toNumber(priorityCell);
    if (!Number.isInteger(priority) || priority <= 0) {
      throw new Error(
        `${MAPPINGS_CSV}: priority must be a positive integer, got '${priorityCell}' for '${ingredient}' → '${au}'`,
      );
    }
    const list = byIngredient.get(ingredient) ?? [];
    if (list.some((mapping) => mapping.au === au)) {
      throw new Error(`${MAPPINGS_CSV}: duplicate mapping for '${ingredient}' → '${au}'`);
    }
    if (list.some((mapping) => mapping.priority === priority)) {
      throw new Error(
        `${MAPPINGS_CSV}: duplicate priority ${priority} for '${ingredient}' (each mapping needs a unique priority)`,
      );
    }
    list.push({ au, factor, priority });
    byIngredient.set(ingredient, list);
  }
  // Evaluation order is ascending priority (1 = most preferred, §7); sorting
  // here keeps the runtime selection loop a plain first-hit-wins scan.
  for (const list of byIngredient.values()) {
    list.sort((a, b) => a.priority - b.priority);
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
  lines.push(' * AUTO-GENERATED from docs/number_schemes.csv, docs/additional_units.csv,');
  lines.push(' * docs/ingredients.csv and docs/ingredient_unit_mappings.csv by');
  lines.push(' * scripts/generate-additional-data.mjs.');
  lines.push(
    " * Do not edit by hand — re-run 'npm run generate:additional' (packages/core) after a CSV change.",
  );
  lines.push(' */');
  lines.push('');
  lines.push('/** One additional unit: display arrangement, number scheme and unit flags. */');
  lines.push('export interface AdditionalUnit {');
  lines.push('  /** Unit name as shown in the display line. */');
  lines.push('  readonly name: string;');
  lines.push(
    '  /** Display template; placeholders <AQ> <AU> <IN> <BQ> <BU> <NNBSP> (narrow no-break space). */',
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
  lines.push('/** One ingredient–additional-unit mapping (conversion factor + priority). */');
  lines.push('export interface IngredientMapping {');
  lines.push('  /** Referenced additional unit name (see ADDITIONAL_UNITS). */');
  lines.push('  readonly au: string;');
  lines.push('  /** Amount of base unit per one additional unit. */');
  lines.push('  readonly factor: number;');
  lines.push('  /** Positive integer, 1 = most preferred; unique per ingredient. */');
  lines.push('  readonly priority: number;');
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
    "  /** The ingredient's additional-unit mappings, ascending priority; empty = bare ingredient without additional units. */",
  );
  lines.push('  readonly entries: readonly IngredientMapping[];');
  lines.push('}');
  lines.push('');
  lines.push('/** All additional units, in table order. */');
  lines.push('export const ADDITIONAL_UNITS: readonly AdditionalUnit[] = [');
  for (const unit of units) {
    lines.push(
      `  { name: ${JSON.stringify(unit.name)}, arrangement: ${JSON.stringify(unit.arrangement)}, ` +
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
  lines.push(
    '/** Ingredient master data keyed by ingredient name (entries sorted by ascending priority). */',
  );
  lines.push('export const INGREDIENT_MAPPINGS: Readonly<Record<string, IngredientEntry>> = {');
  for (const [ingredient, entry] of ingredientList) {
    const entries = mappings.get(ingredient) ?? [];
    lines.push(`  ${JSON.stringify(ingredient)}: {`);
    lines.push(`    bu: ${JSON.stringify(entry.bu)},`);
    lines.push(`    reorderPoint: ${formatReorderPoint(entry.reorderPoint)},`);
    lines.push('    entries: [');
    for (const mapping of entries) {
      lines.push(
        `      { au: ${JSON.stringify(mapping.au)}, factor: ${mapping.factor}, ` +
          `priority: ${mapping.priority} },`,
      );
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const ladderAq = ladderAqValues();
const schemes = buildSchemes(ladderAq);
const units = buildUnits(schemes.map((scheme) => scheme.name));
const ingredientList = buildIngredientList();
const mappings = buildMappings(
  units.map((unit) => unit.name),
  ingredientList,
);
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
  `Wrote ${units.length} units, ${schemes.length} schemes (${memberships} memberships), ` +
    `${ingredientList.size} ingredient(s) to ${OUT_PATH}`,
);
