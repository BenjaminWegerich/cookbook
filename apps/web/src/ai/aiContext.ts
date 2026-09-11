/**
 * Runtime context serialization for AI-assisted recipe work.
 *
 * The AI rules document (docs/ai_recipe_rules.md, embedded via recipeRules.ts)
 * is static. Everything that varies per user and per collection — the personal
 * rules, the loaded ingredient master data, and the recipes of the collection
 * (esp. the ingredient-recipes the AI may reference) — is serialized here into
 * one German-labeled context block appended to the system instruction on every
 * call of a create/edit session.
 *
 * The block that varies per *request* — the recipe specifications the user sets
 * on the AI-create screen (Typ, Portionen/Ergiebigkeit, Merkmale, „Die KI soll
 * …“) — is serialized by {@link buildSpecificationsText} and appended after the
 * context block, so both live in the system instruction and never appear as a
 * chat bubble.
 */

import { serializeRecipe } from '@cookbook/core';
import type { IngredientMappings, Recipe, RecipeType } from '@cookbook/core';

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

/**
 * The recipe specifications of one AI-create request: the values the user sets
 * on the create screen (editor parity). They constrain the draft for the whole
 * conversation — including revisions and repair rounds — instead of being sent
 * as a chat message.
 */
export interface RecipeSpecifications {
  /** „Typ“: the requested recipe type. */
  type: RecipeType;
  /** „Portionen“ (`finished_dish`): the requested serving count. */
  servings: number | null;
  /** „Ergiebigkeit“ (`ingredient_recipe`): the requested yield amount. */
  yieldQuantity: number | null;
  /** „Ergiebigkeit“: the yield's base unit (Gewicht vs. Volumen). */
  yieldUnit: 'g' | 'ml';
  /** Merkmal „vegan“: no animal products at all. */
  vegan: boolean;
  /** Merkmal „schnell und einfach“: low effort, few simple steps. */
  fast: boolean;
  /** Merkmal „günstig“: cheap, common ingredients. */
  cheap: boolean;
  /** „Die KI soll …“: ask back when something is unclear, or always draft. */
  replyMode: 'clarify' | 'draft';
}

/**
 * The Merkmale in display order, with the German constraint line each selected
 * flag adds to the prompt. The wording is instruction text for the AI (not UI),
 * so it stays a plain line of prose.
 */
const MERKMAL_LINES: ReadonlyArray<{
  key: 'vegan' | 'fast' | 'cheap';
  line: string;
}> = [
  {
    key: 'vegan',
    line: 'vegan: ausschließlich pflanzliche Zutaten, keine tierischen Produkte oder Derivate',
  },
  {
    key: 'fast',
    line: 'schnell und einfach: kurze Zubereitungszeit, wenige, unkomplizierte Schritte',
  },
  {
    key: 'cheap',
    line: 'günstig: preiswerte, gängige Zutaten, keine teuren Spezialprodukte',
  },
];

/**
 * Serializes the user's recipe specifications into the verbindliche Vorgaben
 * block of the system instruction. The numbers are stated as the literal front
 * matter values the AI has to write (`servings: 6`, `yield: 1000`), and the last
 * line gives the chat precedence over the standing values — otherwise a later
 * "mach es für 4 Portionen" would fight the Vorgaben block.
 */
export function buildSpecificationsText(spec: RecipeSpecifications): string {
  const lines: string[] = [];

  if (spec.type === 'finished_dish') {
    lines.push('- Rezept-Typ: `finished_dish` (Gericht) — liefere genau diesen Typ.');
    if (spec.servings !== null) {
      lines.push(
        `- Portionen: ${spec.servings} — setze \`servings: ${spec.servings}\` und skaliere alle ` +
          'Mengen darauf.',
      );
    }
  } else {
    lines.push(
      '- Rezept-Typ: `ingredient_recipe` (Zutaten-Rezept) — liefere genau diesen Typ, ohne ' +
        '`servings`.',
    );
    if (spec.yieldQuantity !== null) {
      lines.push(
        `- Ergiebigkeit: ${spec.yieldQuantity} ${spec.yieldUnit} — setze ` +
          `\`yield: ${spec.yieldQuantity}\` und \`yield_unit: ${spec.yieldUnit}\`.`,
      );
    }
  }

  const flags = MERKMAL_LINES.filter((merkmale) => spec[merkmale.key]);
  if (flags.length === 0) {
    lines.push('- Merkmale: (keine besonderen Vorgaben)');
  } else {
    lines.push(['- Merkmale:', ...flags.map((merkmale) => `  - ${merkmale.line}`)].join('\n'));
  }

  lines.push(
    spec.replyMode === 'draft'
      ? '- Verhalten: Schreibe ohne Rückfragen direkt den Entwurf; entscheide bei Unklarheiten ' +
          'selbst sinnvoll.'
      : '- Verhalten: Stelle bei Unklarheiten zuerst eine kurze Rückfrage (das Standardverhalten).',
  );
  lines.push(
    '- Vorrang: Widerspricht eine spätere Nutzernachricht diesen Vorgaben, gilt die neuere ' +
      'Nutzernachricht.',
  );

  return `## Vorgaben für dieses Rezept (verbindlich)\n\n${lines.join('\n')}`;
}
