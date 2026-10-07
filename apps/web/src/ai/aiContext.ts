/**
 * Runtime context serialization for AI-assisted recipe work.
 *
 * The AI rules document (docs/ai_recipe_rules.md, embedded via recipeRules.ts)
 * is static: role, format rules and the shared process (Ablauf). Everything
 * that varies is serialized here and appended to the system instruction:
 *
 * - {@link buildGuidelinesText}: the user's personal recipe guidelines
 *   (Drive file `rezept-richtlinien.md`) — ingredients, techniques, wording.
 * - {@link buildCollectionText}: the collection — ingredient master data, all
 *   recipe titles and the full content of the ingredient-recipes the AI may
 *   reference as sub-recipes.
 * - {@link buildSpecificationsText}: the per-request Vorgaben the user sets on
 *   the AI-create screen (Typ, Portionen/Ergiebigkeit, Merkmale, KI-Verhalten).
 * - {@link buildEditTaskText}: the AI-edit task framing plus the original
 *   recipe in full.
 *
 * All blocks live in the system instruction and never appear as a chat bubble.
 */

import { serializeRecipe } from '@cookbook/core';
import type { IngredientMappings, Recipe, RecipeType } from '@cookbook/core';

/**
 * Serializes the ingredient master data as `- Name (base unit)` lines. The AI
 * only needs the names (to reuse them) and the base unit family (g/ml, so it
 * writes the right unit); the additional-unit conversions are display data the
 * AI never writes.
 */
function serializeMasterData(mappings: IngredientMappings): string {
  const names = Object.keys(mappings).sort((a, b) => a.localeCompare(b, 'de'));
  if (names.length === 0) return '(keine Zutaten-Stammdaten geladen)';
  return names.map((name) => `- ${name} (${mappings[name]!.bu})`).join('\n');
}

/** A recipe of the collection as far as the AI context needs it. */
export interface ContextRecipe {
  /** The parsed recipe. */
  recipe: Recipe;
}

/** The collection facts the AI context block needs. */
export interface AiCollectionInput {
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
 * Builds the `# Rezept-Richtlinien` block from the user's personal guidelines
 * (Drive file `rezept-richtlinien.md`, edited outside the app). A missing or
 * empty file serializes as "(keine hinterlegt)".
 */
export function buildGuidelinesText(personalRules: string): string {
  const rules = personalRules.trim();
  return rules === ''
    ? '# Rezept-Richtlinien\n(keine hinterlegt)'
    : `# Rezept-Richtlinien\n${rules}`;
}

/**
 * Builds the `# Sammlung` block: ingredient master data, all recipe titles and
 * the full content of the ingredient-recipes (usable as sub-recipes). German
 * labels (the data language), English scaffolding.
 */
export function buildCollectionText(input: AiCollectionInput): string {
  const sections: string[] = [];

  sections.push(`## Zutaten-Stammdaten\n${serializeMasterData(input.masterData)}`);

  const titles = input.recipes
    .map(({ recipe }) => recipe.title)
    .sort((a, b) => a.localeCompare(b, 'de'));
  const ingredientRecipes = input.recipes
    .filter(({ recipe }) => recipe.type === 'ingredient_recipe')
    .sort((a, b) => a.recipe.title.localeCompare(b.recipe.title, 'de'));

  sections.push(
    `## Vorhandene Rezepte\n${
      titles.length === 0 ? '(keine)' : titles.map((title) => `- ${title}`).join('\n')
    }`,
  );

  if (ingredientRecipes.length > 0) {
    const bodies = ingredientRecipes.map(
      ({ recipe }) =>
        `### ${recipe.title}\n\`\`\`markdown\n${serializeRecipe(recipe).trimEnd()}\n\`\`\``,
    );
    sections.push(
      `## Zutaten-Rezepte (vollständiger Inhalt)\n` +
        `Diese Rezepte kannst du als Zutat verwenden (Name = Titel). Nutze ihre exakten Titel,\n` +
        `skaliere ihre Menge zur benötigten Portion und zähle sie in den Schritten wie eine Zutat.\n${bodies.join('\n\n')}`,
    );
  }

  return `# Sammlung\n\n${sections.join('\n\n')}`;
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
  /** „KI-Verhalten“: ask back when something is unclear, or always draft. */
  replyMode: 'clarify' | 'draft';
}

/**
 * German display labels of the Merkmale flags. The model knows what each means,
 * so only the bare keywords are sent — no definition lines.
 */
const MERKMAL_LABELS: Readonly<Record<'vegan' | 'fast' | 'cheap', string>> = {
  vegan: 'vegan',
  fast: 'schnell und einfach',
  cheap: 'günstig',
};

/**
 * Serializes the user's recipe specifications into the `# Vorgaben` block of
 * the system instruction. The numbers are stated as the literal front matter
 * values the AI has to write (`servings: 6`, `yield: 1000`); the Merkmale are
 * bare keywords; the Verhalten line is only emitted for the non-default
 * "Direkt entwerfen" mode (the Ablauf rules already describe asking first).
 * The last line gives the chat precedence over the standing values.
 */
export function buildSpecificationsText(spec: RecipeSpecifications): string {
  const lines: string[] = [];

  if (spec.type === 'finished_dish') {
    lines.push('- Typ: `finished_dish` (Gericht)');
    if (spec.servings !== null) {
      lines.push(
        `- Portionen: ${spec.servings} → setze \`servings: ${spec.servings}\`, skaliere alle ` +
          'Mengen darauf',
      );
    }
  } else {
    lines.push('- Typ: `ingredient_recipe` (Zutaten-Rezept)');
    if (spec.yieldQuantity !== null) {
      lines.push(
        `- Ergiebigkeit: ${spec.yieldQuantity} ${spec.yieldUnit} → setze \`yield: ${spec.yieldQuantity}\`, ` +
          `\`yield_unit: ${spec.yieldUnit}\``,
      );
    }
  }

  const flags = (['vegan', 'fast', 'cheap'] as const).filter((key) => spec[key]);
  lines.push(
    flags.length === 0
      ? '- Merkmale: keine'
      : `- Merkmale: ${flags.map((key) => MERKMAL_LABELS[key]).join(', ')}`,
  );

  if (spec.replyMode === 'draft') {
    lines.push('- Verhalten: Schreibe ohne Rückfragen direkt den Entwurf');
  }

  lines.push(
    '- Vorrang: Widerspricht eine spätere Nutzernachricht diesen Vorgaben, gilt die neuere ' +
      'Nutzernachricht.',
  );

  return `# Vorgaben\n\n${lines.join('\n')}`;
}

/**
 * Serializes the AI-edit task: the original recipe file in full, framed as the
 * binding starting version. It takes the place of the create task framing in
 * an edit session's system instruction, so the recipe is present on every turn
 * (including clarifying questions and repair rounds) and never appears as a
 * chat bubble. The user's own message then carries only the desired change.
 *
 * The file is embedded fenced so its front matter and headings cannot be read
 * as instructions of the context block around it.
 */
export function buildEditTaskText(originalText: string): string {
  return (
    '# Auftrag\n\n' +
    'Überarbeite das folgende Rezept — es ist die verbindliche Ausgangsfassung. Der Nutzer ' +
    'beschreibt nur die gewünschten Änderungen; alles, was er nicht nennt, bleibt unverändert.\n' +
    '- Übernimm unverändert: Titel, Typ, Wortlaut der Schritte, Zeiten, `description`, `reference`.\n' +
    '- Setze Änderungen vollständig um: Portionsänderung skaliert alle Mengen und `servings`; ' +
    'entfernte Zutat verschwindet aus Zeilen und Inline-Erwähnungen; Einheitenkorrektur hält ' +
    'die Mengenregeln ein.\n' +
    '- Titeländerung: neuen Titel in der Datei durchgehend verwenden.\n' +
    '- Liefere die vollständige, überarbeitete Datei zurück.\n\n' +
    `\`\`\`markdown\n${originalText.trimEnd()}\n\`\`\``
  );
}
