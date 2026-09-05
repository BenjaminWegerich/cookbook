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
 * Body grammar (§4/§5): each numbered step is a block — either a single prose
 * line, or its own ingredient rows followed by one prose line:
 *
 *   ## Zubereitung
 *   1. - 250 g Tortillas
 *      - 15 ml Zitronensaft
 *      Tortillas im Ofen erwärmen.
 *   2. Tofu marinieren.
 *
 * Rows are natural amount-first phrases with a required name (`- 250 g Reis`);
 * the prose is free text with optional {{…}} display-only artifacts
 * (./artifacts.ts). Hand-written quantities may use German comma decimals and
 * kg/l; everything is normalized to the canonical family form (g/ml, '.'
 * decimals) here, so the in-memory model and every serializer output are
 * canonical.
 *
 * Known limitation: the front matter ends at the *first* line that is exactly
 * `---` after the opening delimiter. A `---` line inside a YAML block scalar
 * would therefore end the front matter early. The canonical serializer never
 * produces this, and hand-written files with such a line are rejected with a
 * precise YAML error — acceptable for the canonical format.
 */

import { parseDocument } from 'yaml';

import { pos } from '../ladder.js';
import { parseIngredientPhrase, replaceArtifacts } from './artifacts.js';
import { deriveIngredients } from './ingredientList.js';
import { RecipeParseError } from './types.js';
import type { Ingredient, Recipe, RecipeType, Step, Unit, ValidationIssue } from './types.js';

/** The line that opens and closes the YAML front matter (§2). */
const FRONT_MATTER_DELIMITER = '---';
/** The single structural heading of the body (§5). */
const ZUBEREITUNG_HEADING = '## Zubereitung';
/** A numbered step line: "N. …" (leading indentation allowed). */
const ORDERED_LIST_ITEM = /^\s*(\d+)\.\s*(.*)$/;
/** Any Markdown heading — none may appear in the body except the one above. */
const HEADING_PATTERN = /^\s*#{1,6}\s/;
/** Characters that are invalid in file names on common filesystems (§2). */
const INVALID_TITLE_CHARS = /[/\\:*?"<>|]/;
/** Windows reserved device names; such titles break file sync to Windows. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Any `{{ … }}` block in a step — candidates for malformed artifacts. */
const CURLY_BLOCK_RE = /\{\{([^{}]*)\}\}/g;

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
const FINISHED_DISH_ONLY: ReadonlySet<string> = new Set(['servings', 'reference']);
/** Fields allowed only on ingredient_recipe (§3). */
const INGREDIENT_RECIPE_ONLY: ReadonlySet<string> = new Set(['yield', 'yield_unit']);
/** The union of all allowed top-level fields (unknown fields are rejected). */
const ALL_TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  ...COMMON_FIELDS,
  ...FINISHED_DISH_ONLY,
  ...INGREDIENT_RECIPE_ONLY,
]);

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
 * Validates and normalizes one amount-first phrase (a step row or an artifact
 * content) into the canonical Ingredient/artifact form.
 */
function parsePhrase(
  phrase: string,
  requireName: boolean,
  path: string,
  issues: ValidationIssue[],
): Ingredient | null {
  const parsed = parseIngredientPhrase(phrase, requireName);
  if (parsed === null) {
    issues.push({
      path,
      message: requireName
        ? `"${phrase}" ist keine gültige Zutaten-Zeile (erwartet z. B. "500 g Reis").`
        : `Ungültiger Mengen-Baustein "${phrase}" (erwartet z. B. "1500 ml Wasser" oder "100 g").`,
    });
    return null;
  }
  if (parsed.name !== undefined && parsed.name.includes('|')) {
    issues.push({ path, message: 'Der Zutatenname darf kein "|" enthalten.' });
    return null;
  }
  checkLadderValue(parsed.quantity, path, issues, false);
  return parsed as Ingredient;
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

  // Field-level schema: reject unknown fields, reject fields forbidden for the
  // declared type. With an invalid type the per-type checks are skipped (the
  // type problem above is the precise error; the union still rejects unknowns).
  for (const key of Object.keys(data)) {
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

  // Per-type required fields (§3) and their value rules (§7.1).
  let servings: number | undefined;
  let yieldValue: number | undefined;
  let yieldUnit: Unit | undefined;
  let reference: string[] | undefined;
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
    // Reference role (§4): 0–2 ingredient names anchored to the portion size,
    // resolved onto the derived master list at the end of parseRecipe.
    const referenceValue = data['reference'];
    if (referenceValue !== undefined) {
      const names =
        typeof referenceValue === 'string'
          ? [referenceValue]
          : Array.isArray(referenceValue)
            ? referenceValue.filter((entry): entry is string => typeof entry === 'string')
            : [];
      if (
        typeof referenceValue !== 'string' &&
        !(Array.isArray(referenceValue) && referenceValue.every((entry) => typeof entry === 'string'))
      ) {
        issues.push({
          path: 'reference',
          message: '"reference" muss eine Liste von Zutatennamen sein (z. B. ["Tortillas"]).',
        });
      } else {
        reference = [];
        const seen = new Set<string>();
        names.forEach((name, index) => {
          const path = `reference[${index}]`;
          const trimmed = name.trim();
          if (trimmed === '') {
            issues.push({ path, message: 'Ein Referenz-Name darf nicht leer sein.' });
            return;
          }
          if (seen.has(trimmed)) {
            issues.push({
              path,
              message: `"${trimmed}" ist mehrfach als Referenz-Zutat angegeben.`,
            });
            return;
          }
          seen.add(trimmed);
          reference!.push(trimmed);
        });
        if (reference.length > 2) {
          issues.push({
            path: 'reference',
            message: 'Höchstens 2 Zutaten dürfen als Referenz-Menge markiert sein.',
          });
        }
      }
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
      const rawUnit = yieldUnitValue as Unit;
      // kg/l are display units: normalize the yield to the family form (×1000).
      if (rawUnit === 'kg') {
        yieldUnit = 'g';
        if (yieldValue !== undefined) yieldValue *= 1000;
      } else if (rawUnit === 'l') {
        yieldUnit = 'ml';
        if (yieldValue !== undefined) yieldValue *= 1000;
      } else {
        yieldUnit = rawUnit;
      }
    }
  }

  if (title === undefined || type === undefined || prepTime === undefined) {
    // The problems are already recorded; the recipe cannot be built.
    return undefined;
  }

  const recipe: Recipe = {
    title,
    type,
    // Filled by the caller from the derived master list.
    ingredients: [],
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(description !== undefined ? { description } : {}),
    prep_time: prepTime,
    ...(totalTime !== undefined ? { total_time: totalTime } : {}),
    ...(reference !== undefined ? { reference } : {}),
    ...(servings !== undefined ? { servings } : {}),
    ...(yieldValue !== undefined ? { yield: yieldValue } : {}),
    ...(yieldUnit !== undefined ? { yield_unit: yieldUnit } : {}),
    steps: [],
  };
  return recipe;
}

/**
 * Parses one row line ("- 250 g Reis") into a canonical Ingredient. Records
 * issues on the given path.
 */
function parseRow(line: string, path: string, issues: ValidationIssue[]): Ingredient | null {
  const content = line.trim().replace(/^-\s+/, '');
  const parsed = parsePhrase(content, true, path, issues);
  if (parsed === null) return null;
  if (parsed.name === undefined) return null; // unreachable with requireName
  return parsed;
}

/**
 * Validates the artifacts of one step text and normalizes them to the
 * canonical family form (kg/l and German comma decimals → g/ml + '.').
 */
function validateAndNormalizeText(text: string, path: string, issues: ValidationIssue[]): string {
  for (const match of text.matchAll(CURLY_BLOCK_RE)) {
    const content = match[1] ?? '';
    if (parseIngredientPhrase(content) === null) {
      issues.push({
        path,
        message: `Ungültiger Mengen-Baustein ${JSON.stringify(match[0])} (erwartet z. B. {{1500 ml Wasser}}, {{100 g}} oder {{100}}).`,
      });
      continue;
    }
    // Validate the quantity without creating issues inside replaceArtifacts:
    // every artifact's content must be a standard number (§7.1).
    try {
      pos((parseIngredientPhrase(content) as { quantity: number }).quantity);
    } catch {
      issues.push({
        path,
        message: `Die Menge in ${JSON.stringify(match[0])} ist kein Standardwert (Leiterwert).`,
      });
    }
  }
  // Normalization: rewrite every valid artifact to the canonical text form.
  return replaceArtifacts(text, (artifact) => artifact);
}

/**
 * Validates the Markdown body (§4/§5) and returns the steps in order. Each
 * step block is one numbered item with optional rows followed by a prose line.
 */
function parseSteps(body: string, issues: ValidationIssue[]): Step[] | undefined {
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

  const steps: Step[] = [];
  let expected = 1;
  let numberingReported = false;
  let i = first + 1;
  while (i <= last) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === '') {
      i++; // blank lines between steps are allowed
      continue;
    }
    if (HEADING_PATTERN.test(line)) {
      issues.push({
        path: 'body',
        message: `Unerwartete Überschrift "${trimmed}" — der Rezepttext enthält nur die eine "${ZUBEREITUNG_HEADING}"-Überschrift.`,
      });
      i++;
      continue;
    }
    const match = ORDERED_LIST_ITEM.exec(line);
    if (match === null) {
      issues.push({
        path: 'body',
        message: `"${trimmed}" ist kein nummerierter Schritt (erwartet: "N. Text" oder "N. - 250 g Reis").`,
      });
      i++;
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

    const stepIndex = steps.length;
    const stepPath = `steps[${stepIndex}]`;
    const ingredients: Ingredient[] = [];
    const firstContent = match[2]!;
    let prose: string | undefined;
    const blockStart = i;

    // A step either starts with its rows ("- 250 g Reis") — then the rows run
    // until the first line that is not a row, which must be the prose — or it
    // is a single prose line.
    if (!firstContent.startsWith('- ')) {
      prose = firstContent.trim();
      i = blockStart + 1;
    } else {
      // Rows: the first row sits on the number line, further rows follow.
      const rowLine = parseRow(firstContent, `${stepPath}.ingredients[0]`, issues);
      if (rowLine !== null) ingredients.push(rowLine);
      i = blockStart + 1;
      while (prose === undefined && i <= last) {
        const next = lines[i]!.trim();
        if (next === '' || ORDERED_LIST_ITEM.test(lines[i]!) || HEADING_PATTERN.test(lines[i]!)) {
          // The step ended without a prose line (blank, or the next step).
          break;
        }
        if (next.startsWith('- ')) {
          const row = parseRow(lines[i]!, `${stepPath}.ingredients[${ingredients.length}]`, issues);
          if (row !== null) ingredients.push(row);
          i++;
          continue;
        }
        prose = next;
        i++;
      }
    }

    if (prose === undefined || prose === '') {
      issues.push({
        path: stepPath,
        message: 'Jeder Schritt braucht nach seinen Zutaten einen Text.',
      });
      continue;
    }
    if (prose.startsWith('- ')) {
      issues.push({
        path: `${stepPath}.text`,
        message: 'Der Schritt-Text darf nicht mit "- " beginnen (das ist Zutaten-Zeilen vorbehalten).',
      });
    }
    const text = validateAndNormalizeText(prose, `${stepPath}.text`, issues);
    steps.push({ ingredients, text });
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
 * Parses and validates one recipe file (§7.1).
 *
 * @param text the raw file content (UTF-8, Markdown + YAML front matter)
 * @returns the typed recipe (master list derived from the step rows, §4)
 * @throws {RecipeParseError} with every problem found (paths + German messages)
 */
export function parseRecipe(text: string): Recipe {
  const issues: ValidationIssue[] = [];

  const { frontMatter, body } = splitFrontMatter(text, issues);
  const data = frontMatter === undefined ? undefined : parseYaml(frontMatter, issues);
  const recipe = data === undefined ? undefined : validateRecipeData(data, issues);
  const steps = body === undefined ? undefined : parseSteps(body, issues);

  if (issues.length > 0) {
    throw new RecipeParseError(issues);
  }
  if (recipe === undefined || steps === undefined) {
    // Unreachable: both are only undefined when an issue was recorded above.
    throw new RecipeParseError(issues);
  }

  const ingredients = deriveIngredients(steps, recipe.reference ?? []);
  // §4: every reference name must match a merged ingredient of the recipe.
  if (recipe.reference !== undefined) {
    const mergedNames = new Set(ingredients.map((ingredient) => ingredient.name));
    recipe.reference.forEach((name, index) => {
      if (!mergedNames.has(name)) {
        issues.push({
          path: `reference[${index}]`,
          message: `Die Referenz-Zutat "${name}" kommt im Rezept nicht vor.`,
        });
      }
    });
  }
  if (issues.length > 0) {
    throw new RecipeParseError(issues);
  }
  return { ...recipe, steps, ingredients };
}
