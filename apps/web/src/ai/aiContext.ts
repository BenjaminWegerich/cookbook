/**
 * Runtime context serialization for AI-assisted recipe work.
 *
 * The AI rules document (docs/ai_recipe_rules.md, embedded via recipeRules.ts)
 * is static. Everything that varies per user and per collection — the personal
 * rules, the loaded ingredient master data, and the recipes of the collection
 * (esp. the ingredient-recipes the AI may reference) — is serialized here into
 * one German-labeled context block appended to the system instruction on every
 * call of a create/edit session.
 */

import { serializeRecipe } from '@cookbook/core';
import type { IngredientMappings, Recipe } from '@cookbook/core';

/**
 * Serializes one ingredient's master-data entry to a compact context line.
 *
 * Example line:
 *   - Joghurt — Basiseinheit: g — Zusatzeinheiten: Becher (1 Becher = 400 g), EL (1 EL = 24 g)
 */
function ingredientLine(name: string, entry: IngredientMappings[string]): string {
  const base = `Basiseinheit: ${entry.bu}`;
  if (entry.entries.length === 0) {
    return `- ${name} — ${base} — keine Zusatzeinheiten`;
  }
  const units = entry.entries
    .map((mapping) => `${mapping.au} (1 ${mapping.au} = ${mapping.factor} ${entry.bu})`)
    .join(', ');
  return `- ${name} — ${base} — Zusatzeinheiten: ${units}`;
}

/** Serializes the full ingredient master data (names + base units + AU mappings). */
function serializeMasterData(mappings: IngredientMappings): string {
  const names = Object.keys(mappings).sort((a, b) => a.localeCompare(b, 'de'));
  if (names.length === 0) return '(keine Zutaten-Stammdaten geladen)';
  return names.map((name) => ingredientLine(name, mappings[name]!)).join('\n');
}

/** A recipe of the collection as far as the AI context needs it. */
export interface ContextRecipe {
  /** The parsed recipe. */
  recipe: Recipe;
}

/** Everything the AI-create/edit prompt needs beyond the static rules. */
export interface AiContextInput {
  /** The user's personal rules text (docs file `zutaten-regeln.md`), raw. */
  personalRules: string;
  /** The loaded ingredient master data (runtime registry). */
  masterData: IngredientMappings;
  /**
   * All recipes of the collection. The AI gets the titles of every recipe
   * (unique-title rule + finished dishes are never link targets) and the full
   * canonical text of the ingredient-recipes it may reference as sub-recipes.
   */
  recipes: readonly ContextRecipe[];
}

/**
 * Builds the runtime context block for the system instruction. German labels
 * (the data language), English scaffolding; appended verbatim to the rules doc
 * text in every create/edit prompt.
 */
export function buildAiContextText(input: AiContextInput): string {
  const sections: string[] = [];

  // Personal rules (docs file `zutaten-regeln.md`, user-edited).
  const rules = input.personalRules.trim();
  sections.push(
    rules === ''
      ? '## Persönliche Regeln des Nutzers\n(keine hinterlegt)'
      : `## Persönliche Regeln des Nutzers\n${rules}`,
  );

  sections.push(`## Zutaten-Stammdaten\n${serializeMasterData(input.masterData)}`);

  const titles = input.recipes
    .map(({ recipe }) => recipe.title)
    .sort((a, b) => a.localeCompare(b, 'de'));
  const ingredientRecipes = input.recipes
    .filter(({ recipe }) => recipe.type === 'ingredient_recipe')
    .sort((a, b) => a.recipe.title.localeCompare(b.recipe.title, 'de'));

  sections.push(
    `## Vorhandene Rezepte (Titel)\n${
      titles.length === 0 ? '(keine)' : titles.map((title) => `- ${title}`).join('\n')
    }`,
  );

  if (ingredientRecipes.length > 0) {
    const bodies = ingredientRecipes.map(
      ({ recipe }) =>
        `### ${recipe.title}\n\`\`\`markdown\n${serializeRecipe(recipe).trimEnd()}\n\`\`\``,
    );
    sections.push(
      `## Vorhandene ingredient_recipes (Zutaten-Rezepte, vollständiger Inhalt)\n` +
        `Diese Rezepte kannst du als Zutat verwenden (Name = Titel). Nutze ihre exakten Titel,\n` +
        `skaliere ihre Menge zur benötigten Portion und zähle sie in den Schritten wie eine Zutat.\n${bodies.join('\n\n')}`,
    );
  }

  return sections.join('\n\n');
}
