/**
 * Ingredient markers — the canonical way ingredients appear in the
 * preparation steps (storage_format.md §4, decided with the user).
 *
 * The step text is the source of truth for the ingredient list: an ingredient
 * is written inline into the step that uses it as a machine-readable marker:
 *
 *   {{ingredient|Joghurt|400|g}}
 *   {{ingredient|Joghurt|750|g|ref}}
 *   {{ingredient|Béchamelsauce|500|ml|recipe:Béchamelsauce}}
 *
 * The marker key is English (code language, like the front-matter field
 * names); the display form is derived at render time from the additional-unit
 * master data ("1 Becher Joghurt (400 g)").
 *
 * Quantities are stored in the ingredient's family unit (g or ml, decided
 * with the user); kg / l appear only in display (see additionalUnits.ts).
 *
 * The ingredient list of a recipe is *derived* from the markers
 * (`deriveIngredients`): order of first appearance, duplicates merged with the
 * total amount (rounded to the nearest ladder rung — the sum of two ladder
 * values is not necessarily a ladder value), reference flag and recipe link
 * carried over.
 */

import { mergeIngredientUses } from './ingredientList.js';
import type { Ingredient, Unit } from './types.js';

/** One parsed ingredient marker. */
export interface IngredientMarker {
  /** German ingredient name (master data key where possible). */
  name: string;
  /** Base quantity in the stored unit; a standard number (ladder value). */
  quantity: number;
  /** Stored base unit (authored as g or ml; kg/l read for legacy files). */
  unit: Unit;
  /** Portion anchor flag (§4: at most 2 per finished-dish recipe). */
  reference?: boolean;
  /** Title of a linked ingredient recipe (§4). */
  recipe?: string;
}

/**
 * The marker pattern. Name and recipe title may contain letters, digits,
 * spaces, umlauts etc. but never `|`, `{`, `}` (they are the delimiters).
 * The quantity is a positive decimal; the unit is one of g/kg/ml/l (read
 * accepts all four; the app authors g/ml only).
 */
const MARKER_RE =
  /\{\{ingredient\|([^|}]+)\|([0-9]+(?:\.[0-9]+)?)\|(g|kg|ml|l)(\|ref)?(\|recipe:([^|}]+))?\}\}/g;

/** Returns the canonical text of a marker (as written into a step). */
export function markerToText(marker: IngredientMarker): string {
  const flags = [
    marker.reference === true ? 'ref' : undefined,
    marker.recipe !== undefined ? `recipe:${marker.recipe}` : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  return `{{ingredient|${marker.name}|${marker.quantity}|${marker.unit}${flags.map((flag) => `|${flag}`).join('')}}}`;
}

/** Extracts all ingredient markers from one step, in order of appearance. */
export function extractMarkers(step: string): IngredientMarker[] {
  const markers: IngredientMarker[] = [];
  for (const match of step.matchAll(MARKER_RE)) {
    // The regex guarantees all groups; indexed access is safe (strict mode).
    markers.push({
      name: match[1]!.trim(),
      quantity: Number(match[2]),
      unit: match[3] as Unit,
      ...(match[4] !== undefined ? { reference: true } : {}),
      ...(match[6] !== undefined ? { recipe: match[6]!.trim() } : {}),
    });
  }
  return markers;
}

/**
 * Derives the ingredient list of a recipe from its steps (storage_format.md
 * §4): markers in order of first appearance, merged by exact name with the
 * total amount (sum rounded to the nearest ladder rung — non-standard numbers
 * do not exist in the app, docs/quantity_scaling.md §3).
 */
export function deriveIngredients(steps: readonly string[]): Ingredient[] {
  const entries: Ingredient[] = [];
  for (const step of steps) {
    for (const marker of extractMarkers(step)) {
      entries.push({
        name: marker.name,
        quantity: marker.quantity,
        unit: marker.unit,
        ...(marker.reference === true ? { reference: true } : {}),
        ...(marker.recipe !== undefined ? { recipe: marker.recipe } : {}),
      });
    }
  }
  return mergeIngredientUses(entries);
}

/**
 * Replaces every marker in a step via `update` (return null to delete the
 * marker). Non-marker text is passed through unchanged.
 */
export function replaceMarkers(
  step: string,
  update: (marker: IngredientMarker) => IngredientMarker | null,
): string {
  return step.replace(MARKER_RE, (_match, ...args) => {
    // Re-parse the match (the regex groups are positional in `args`).
    const [name, quantity, unit, ref, , recipe] = args as [
      string,
      string,
      string,
      string | undefined,
      string | undefined,
      string | undefined,
    ];
    const marker: IngredientMarker = {
      name: name.trim(),
      quantity: Number(quantity),
      unit: unit as Unit,
      ...(ref !== undefined ? { reference: true } : {}),
      ...(recipe !== undefined ? { recipe: recipe.trim() } : {}),
    };
    const result = update(marker);
    return result === null ? '' : markerToText(result);
  });
}

/**
 * HTML-escapes a text value for safe insertion into HTML content or
 * attributes (shared by the HTML export and the marker renderer).
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
 * Substitutes every marker in a step with the string produced by `render`
 * (used by the HTML export to embed the display arrangement). All non-marker
 * text is HTML-escaped here; `render` must therefore return already-escaped
 * HTML — this is what lets a marker be rendered as a link (e.g. a sub-recipe
 * reference) without the surrounding text being able to inject markup.
 */
export function renderMarkers(step: string, render: (marker: IngredientMarker) => string): string {
  let result = '';
  let lastIndex = 0;
  for (const match of step.matchAll(MARKER_RE)) {
    result += escapeHtml(step.slice(lastIndex, match.index));
    // match[0] is the full match; the groups follow (markers.ts MARKER_RE).
    const [, name, quantity, unit, ref, , recipe] = match as unknown as [
      string,
      string,
      string,
      string,
      string | undefined,
      string | undefined,
      string | undefined,
    ];
    result += render({
      name: name.trim(),
      quantity: Number(quantity),
      unit: unit as Unit,
      ...(ref !== undefined ? { reference: true } : {}),
      ...(recipe !== undefined ? { recipe: recipe.trim() } : {}),
    });
    lastIndex = match.index + match[0].length;
  }
  result += escapeHtml(step.slice(lastIndex));
  return result;
}

/**
 * Updates (or deletes, with null) every marker of the given name across the
 * steps — used by the editor when a list row is edited or removed.
 */
export function updateMarkersByName(
  steps: readonly string[],
  name: string,
  update: (marker: IngredientMarker) => IngredientMarker | null,
): string[] {
  return steps.map((step) =>
    replaceMarkers(step, (marker) => (marker.name === name ? update(marker) : marker)),
  );
}

/**
 * Inserts a marker's text into a step at the given character offset. Returns
 * the updated step.
 */
export function insertMarkerIntoStep(step: string, at: number, marker: IngredientMarker): string {
  const text = markerToText(marker);
  const offset = Math.max(0, Math.min(at, step.length));
  return `${step.slice(0, offset)}${text}${step.slice(offset)}`;
}
