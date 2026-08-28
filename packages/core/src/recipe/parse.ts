/**
 * Parser and per-file validator for the canonical Markdown + YAML recipe
 * format (docs/storage_format.md).
 *
 * `parseRecipe()` performs the full read path: split YAML front matter from the
 * Markdown body, parse the YAML (via the `yaml` package), validate schema,
 * values and body (§7.1), and return the typed {@link Recipe}. All problems are
 * collected and thrown together as a {@link RecipeParseError} — errors are
 * shown to the user precisely, never silently ignored or auto-corrected.
 *
 * Cross-recipe validation (§7.2) lives in ./validate.ts.
 *
 * Known limitation: the front matter ends at the *first* line that is exactly
 * `---` after the opening delimiter. A `---` line inside a YAML block scalar
 * would therefore end the front matter early. The canonical serializer never
 * produces this, and hand-written files with such a line are rejected with a
 * precise YAML error — acceptable for the canonical format.
 */

import { parseDocument } from 'yaml';

import { pos } from '../ladder.js';
import { deriveIngredients, extractMarkers } from './markers.js';
import { RecipeParseError } from './types.js';
import type { Ingredient, Recipe, RecipeType, Unit, ValidationIssue } from './types.js';

/** The line that opens and closes the YAML front matter (§2). */
const FRONT_MATTER_DELIMITER = '---';
/** The single structural heading of the body (§5). */
const ZUBEREITUNG_HEADING = '## Zubereitung';
/** A numbered step line: "N. text" (leading indentation allowed). */
const ORDERED_LIST_ITEM = /^\s*(\d+)\.\s+(.+)$/;
/** Any Markdown heading — none may appear in the body except the one above. */
const HEADING_PATTERN = /^\s*#{1,6}\s/;
/** Characters that are invalid in file names on common filesystems (§2). */
const INVALID_TITLE_CHARS = /[/\\:*?"<>|]/;
/** Windows reserved device names; such titles break file sync to Windows. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const UNITS: readonly Unit[] = ['g', 'kg', 'ml', 'l'];

/** Top-level fields common to both recipe types (§3). */
const COMMON_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'type',
  'subtitle',
  'description',
  'prep_time',
  'total_time',
]);
/** Fields allowed only on finished_dish (§3). */
const FINISHED_DISH_ONLY: ReadonlySet<string> = new Set(['servings']);
/** Fields allowed only on ingredient_recipe (§3). */
const INGREDIENT_RECIPE_ONLY: ReadonlySet<string> = new Set(['yield', 'yield_unit']);
/** The union of all allowed top-level fields (unknown fields are rejected). */
const ALL_TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  ...COMMON_FIELDS,
  ...FINISHED_DISH_ONLY,
  ...INGREDIENT_RECIPE_ONLY,
]);

/** The marker grammar (see markers.ts) — strict form for malformed detection. */
const STRICT_MARKER_RE =
  /^\{\{ingredient\|[^|}]+\|[0-9]+(?:\.[0-9]+)?\|(?:g|kg|ml|l)(?:\|ref)?(?:\|recipe:[^|}]+)?\}\}$/;
/** Any `{{ … }}` block in a step — candidates for malformed markers. */
const CURLY_BLOCK_RE = /\{\{([^{}]*)\}\}/g;

/** Type guard for plain YAML mappings (objects). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the string value of `key` or records an issue; undefined on error. */
function readString(
  obj: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  path: string,
): string | undefined {
  const value = obj[key];
  if (value === undefined) {
    issues.push({ path, message: `Pflichtfeld "${key}" fehlt.` });
    return undefined;
  }
  if (typeof value !== 'string') {
    issues.push({ path, message: `"${key}" muss ein String sein.` });
    return undefined;
  }
  return value;
}

/** Returns the optional string value of `key`; undefined when absent or wrong. */
function readOptionalString(
  obj: Record<string, unknown>,
  key: string,
  issues: ValidationIssue[],
  path: string,
): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    issues.push({ path, message: `"${key}" muss ein String sein.` });
    return undefined;
  }
  return value;
}

/**
 * Records a value problem for `path`: positivity/finiteness, the integer
 * requirement for servings (§3), and the ladder membership (§7.1).
 */
function checkLadderValue(
  value: number,
  path: string,
  issues: ValidationIssue[],
  integerOnly: boolean,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    issues.push({ path, message: 'Der Wert muss eine positive Zahl sein.' });
    return;
  }
  if (integerOnly && !Number.isInteger(value)) {
    issues.push({ path, message: 'Der Wert muss eine ganze Zahl sein.' });
    return;
  }
  try {
    pos(value);
  } catch {
    issues.push({ path, message: `"${value}" ist kein Standardwert (Leiterwert).` });
  }
}

/** Validates the title as a file name (§2: empty, whitespace, unsafe chars). */
function checkTitle(title: string, issues: ValidationIssue[]): void {
  if (title.trim() === '') {
    issues.push({ path: 'title', message: 'Der Titel darf nicht leer sein.' });
    return;
  }
  if (title !== title.trim()) {
    issues.push({
      path: 'title',
      message: 'Der Titel darf nicht mit Leerzeichen beginnen oder enden.',
    });
    return;
  }
  if (INVALID_TITLE_CHARS.test(title)) {
    issues.push({
      path: 'title',
      message: 'Der Titel darf keines dieser Zeichen enthalten: / \\ : * ? " < > |',
    });
    return;
  }
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    issues.push({ path: 'title', message: 'Der Titel darf keine Steuerzeichen enthalten.' });
    return;
  }
  if (WINDOWS_RESERVED.test(title)) {
    issues.push({
      path: 'title',
      message: `"${title}" ist ein reservierter Windows-Dateiname und nicht erlaubt.`,
    });
  }
}

/**
 * Validates the raw YAML front matter against the schema of §3/§4 and the
 * value rules of §7.1. Returns the typed recipe (steps filled by the caller)
 * or undefined when a required field could not be built — in that case the
 * problems are already recorded in `issues`.
 */
function validateRecipeData(data: unknown, issues: ValidationIssue[]): Recipe | undefined {
  if (!isPlainObject(data)) {
    issues.push({
      path: 'frontMatter',
      message: 'Der front matter muss eine YAML-Map sein (ein Objekt mit Feldern).',
    });
    return undefined;
  }

  // Determine the recipe type first: the allowed/forbidden field sets depend
  // on it (§3), and the type itself must be one of the two enum values.
  const typeValue = data['type'];
  const type: RecipeType | undefined =
    typeValue === 'finished_dish' || typeValue === 'ingredient_recipe' ? typeValue : undefined;
  if (typeValue === undefined) {
    issues.push({ path: 'type', message: 'Pflichtfeld "type" fehlt.' });
  } else if (type === undefined) {
    issues.push({
      path: 'type',
      message: `"type" muss "finished_dish" oder "ingredient_recipe" sein (gefunden: ${JSON.stringify(typeValue)}).`,
    });
  }

  // Field-level schema: reject unknown fields (incl. the removed `ingredients`
  // — it is derived from the body now, §4), reject fields forbidden for the
  // declared type. With an invalid type the per-type checks are skipped (the
  // type problem above is the precise error; the union still rejects unknowns).
  for (const key of Object.keys(data)) {
    if (key === 'ingredients') {
      issues.push({
        path: key,
        message:
          'Feld "ingredients" wird aus dem Zubereitungstext abgeleitet und darf nicht mehr im Front Matter stehen.',
      });
      continue;
    }
    if (!ALL_TOP_LEVEL_FIELDS.has(key)) {
      issues.push({ path: key, message: `Unbekanntes Feld "${key}".` });
      continue;
    }
    if (type === 'ingredient_recipe' && FINISHED_DISH_ONLY.has(key)) {
      issues.push({ path: key, message: `Feld "${key}" ist nur für finished_dish erlaubt.` });
    }
    if (type === 'finished_dish' && INGREDIENT_RECIPE_ONLY.has(key)) {
      issues.push({ path: key, message: `Feld "${key}" ist nur für ingredient_recipe erlaubt.` });
    }
  }

  const title = readString(data, 'title', issues, 'title');
  if (title !== undefined) checkTitle(title, issues);

  const subtitle = readOptionalString(data, 'subtitle', issues, 'subtitle');
  const description = readOptionalString(data, 'description', issues, 'description');
  const prepTime = readString(data, 'prep_time', issues, 'prep_time');
  const totalTime = readOptionalString(data, 'total_time', issues, 'total_time');

  // The ingredient list is derived from the body markers (§4); the typed
  // recipe returned here carries a placeholder that the caller replaces.
  const ingredients: Ingredient[] = [];

  // Per-type required fields (§3) and their value rules (§7.1).
  let servings: number | undefined;
  let yieldValue: number | undefined;
  let yieldUnit: Unit | undefined;
  if (type === 'finished_dish') {
    const servingsValue = data['servings'];
    if (servingsValue === undefined) {
      issues.push({ path: 'servings', message: 'Pflichtfeld "servings" fehlt (finished_dish).' });
    } else if (typeof servingsValue !== 'number') {
      issues.push({ path: 'servings', message: '"servings" muss eine Zahl sein.' });
    } else {
      checkLadderValue(servingsValue, 'servings', issues, true);
      servings = servingsValue;
    }
  } else if (type === 'ingredient_recipe') {
    const yieldRaw = data['yield'];
    if (yieldRaw === undefined) {
      issues.push({ path: 'yield', message: 'Pflichtfeld "yield" fehlt (ingredient_recipe).' });
    } else if (typeof yieldRaw !== 'number') {
      issues.push({ path: 'yield', message: '"yield" muss eine Zahl sein.' });
    } else {
      checkLadderValue(yieldRaw, 'yield', issues, false);
      yieldValue = yieldRaw;
    }
    const yieldUnitValue = data['yield_unit'];
    if (yieldUnitValue === undefined) {
      issues.push({
        path: 'yield_unit',
        message: 'Pflichtfeld "yield_unit" fehlt (ingredient_recipe).',
      });
    } else if (typeof yieldUnitValue !== 'string' || !UNITS.includes(yieldUnitValue as Unit)) {
      issues.push({
        path: 'yield_unit',
        message: `"yield_unit" muss eine der Einheiten g, kg, ml oder l sein (gefunden: ${JSON.stringify(yieldUnitValue)}).`,
      });
    } else {
      yieldUnit = yieldUnitValue as Unit;
    }
  }

  // Reference rules (§4): at most 2 per recipe and only for finished_dish.
  // Validated against the body markers (validateMarkers); the placeholder
  // list is empty here, so nothing to check at this stage.

  if (title === undefined || type === undefined || prepTime === undefined) {
    // The problems are already recorded; the recipe cannot be built.
    return undefined;
  }

  const recipe: Recipe = {
    title,
    type,
    ingredients,
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(description !== undefined ? { description } : {}),
    prep_time: prepTime,
    ...(totalTime !== undefined ? { total_time: totalTime } : {}),
    ...(servings !== undefined ? { servings } : {}),
    ...(yieldValue !== undefined ? { yield: yieldValue } : {}),
    ...(yieldUnit !== undefined ? { yield_unit: yieldUnit } : {}),
    steps: [],
  };
  return recipe;
}

/** Validates the Markdown body (§5) and returns the steps in order. */
function parseSteps(body: string, issues: ValidationIssue[]): string[] | undefined {
  const lines = body.split(/\r?\n/);

  // Trim leading and trailing blank lines so the structural checks are stable.
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === '') first++;
  let last = lines.length - 1;
  while (last >= first && lines[last]!.trim() === '') last--;

  if (first > last) {
    issues.push({
      path: 'body',
      message: `Der Rezepttext fehlt (eine "${ZUBEREITUNG_HEADING}"-Überschrift mit Schritten ist erforderlich).`,
    });
    return undefined;
  }
  if (lines[first]!.trim() !== ZUBEREITUNG_HEADING) {
    issues.push({
      path: 'body',
      message: `Die erste Überschrift muss genau "${ZUBEREITUNG_HEADING}" sein.`,
    });
    return undefined;
  }

  const steps: string[] = [];
  let expected = 1;
  let numberingReported = false;
  for (let i = first + 1; i <= last; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') continue; // blank lines between steps are allowed
    if (HEADING_PATTERN.test(line)) {
      issues.push({
        path: 'body',
        message: `Unerwartete Überschrift "${trimmed}" — der Rezepttext enthält nur die eine "${ZUBEREITUNG_HEADING}"-Überschrift.`,
      });
      continue;
    }
    const match = ORDERED_LIST_ITEM.exec(line);
    if (match === null) {
      issues.push({
        path: 'body',
        message: `"${trimmed}" ist kein nummerierter Schritt (erwartet: "N. Text").`,
      });
      continue;
    }
    const num = Number(match[1]);
    if (num !== expected && !numberingReported) {
      issues.push({
        path: 'body',
        message: `Die Schritte müssen mit 1 beginnen und fortlaufend nummeriert sein (erwartet ${expected}, gefunden ${num}).`,
      });
      numberingReported = true;
    }
    expected = num + 1;
    steps.push(match[2]!.trim());
  }

  if (steps.length === 0) {
    issues.push({
      path: 'body',
      message: 'Die Zubereitung muss mindestens einen Schritt enthalten.',
    });
    return undefined;
  }
  return steps;
}

/** Splits the file text into YAML front matter and Markdown body (§2). */
function splitFrontMatter(
  text: string,
  issues: ValidationIssue[],
): { frontMatter?: string; body?: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] !== FRONT_MATTER_DELIMITER) {
    issues.push({
      path: 'frontMatter',
      message: `Die Datei muss mit einer "${FRONT_MATTER_DELIMITER}"-Zeile beginnen (YAML front matter).`,
    });
    return {};
  }
  const endIndex = lines.indexOf(FRONT_MATTER_DELIMITER, 1);
  if (endIndex === -1) {
    issues.push({
      path: 'frontMatter',
      message: `Die abschließende "${FRONT_MATTER_DELIMITER}"-Zeile des front matter fehlt.`,
    });
    return {};
  }
  return {
    frontMatter: lines.slice(1, endIndex).join('\n'),
    body: lines.slice(endIndex + 1).join('\n'),
  };
}

/** Parses the YAML front matter; returns the raw JS value or undefined. */
function parseYaml(frontMatter: string, issues: ValidationIssue[]): unknown {
  const doc = parseDocument(frontMatter);
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      issues.push({ path: 'frontMatter', message: `Ungültiges YAML: ${error.message}` });
    }
    return undefined;
  }
  try {
    return doc.toJS();
  } catch (error) {
    issues.push({
      path: 'frontMatter',
      message: `Ungültiges YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

/**
 * Validates the ingredient markers of the steps (§4, decided with the user:
 * the step text is the source of truth for the ingredient list).
 *
 * Reports malformed markers and invalid marker values with the step index as
 * the issue path. The reference rules depend on the recipe type and are only
 * enforced when the type is known (an invalid type is reported separately).
 */
function validateMarkers(
  steps: readonly string[],
  type: RecipeType | undefined,
  issues: ValidationIssue[],
): void {
  let referenceCount = 0;
  steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    // Any `{{ … }}` block that does not match the marker grammar is a
    // malformed marker — never silently treated as prose.
    for (const match of step.matchAll(CURLY_BLOCK_RE)) {
      if (!STRICT_MARKER_RE.test(match[0])) {
        issues.push({
          path,
          message: `Ungültiger Zutaten-Marker: ${JSON.stringify(match[0])} (erwartet z. B. {{ingredient|Joghurt|400|g}}).`,
        });
      }
    }
    for (const marker of extractMarkers(step)) {
      if (marker.name.trim() === '') {
        issues.push({ path, message: 'Der Zutatenname in einem Marker darf nicht leer sein.' });
      }
      if (!Number.isFinite(marker.quantity) || marker.quantity <= 0) {
        issues.push({
          path,
          message: `Die Menge für "${marker.name}" muss eine positive Zahl sein.`,
        });
      } else {
        try {
          pos(marker.quantity);
        } catch {
          issues.push({
            path,
            message: `Die Menge ${marker.quantity} für "${marker.name}" ist kein Standardwert (Leiterwert).`,
          });
        }
      }
      if (marker.reference === true) referenceCount++;
    }
  });

  if (type === 'finished_dish' && referenceCount > 2) {
    issues.push({ path: 'body', message: 'Höchstens 2 Zutaten dürfen mit "ref" markiert sein.' });
  } else if (type === 'ingredient_recipe' && referenceCount > 0) {
    issues.push({ path: 'body', message: '"ref" ist nur für finished_dish erlaubt.' });
  }
}

/**
 * Parses and validates one recipe file (§7.1).
 *
 * @param text the raw file content (UTF-8, Markdown + YAML front matter)
 * @returns the typed recipe (ingredients derived from the body markers, §4)
 * @throws {RecipeParseError} with every problem found (paths + German messages)
 */
export function parseRecipe(text: string): Recipe {
  const issues: ValidationIssue[] = [];

  const { frontMatter, body } = splitFrontMatter(text, issues);
  const data = frontMatter === undefined ? undefined : parseYaml(frontMatter, issues);
  const recipe = data === undefined ? undefined : validateRecipeData(data, issues);
  const steps = body === undefined ? undefined : parseSteps(body, issues);
  if (steps !== undefined) {
    validateMarkers(steps, recipe?.type, issues);
  }

  if (issues.length > 0) {
    throw new RecipeParseError(issues);
  }
  if (recipe === undefined || steps === undefined) {
    // Unreachable: both are only undefined when an issue was recorded above.
    throw new RecipeParseError(issues);
  }
  return { ...recipe, steps, ingredients: deriveIngredients(steps) };
}
