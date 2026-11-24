/**
 * Shared ingredient display helpers.
 *
 * The editor's ingredient lists, the reference readout and the ingredient
 * previews render the same kind of ingredient line, so the display wording must
 * come from one place — a second copy could drift into a different arrangement
 * or unit form.
 */

import {
  NNBSP,
  artifactDisplay,
  masterUsesFor,
  referenceUses,
  renderAQSDisplay,
  renderMasterAQSDisplay,
  type ArrangementDisplay,
  type MasterQuantityUse,
  type PrecisionContext,
  type Recipe,
  type TextArtifact,
  type Unit,
} from '@cookbook/core';

/**
 * `renderAQSDisplay` with a defensive fallback: an ingredient whose display
 * form cannot be derived (e.g. the master data is not loaded) falls back to one
 * plain text run instead of breaking the view. The fallback joins number and
 * unit with the narrow no-break space (docs/CODING_CONVENTIONS.md) and is
 * deliberately built here rather than through `formatBQ`, because it must never
 * throw again.
 *
 * Used by the ingredient lists, the amount previews and the reference readout,
 * which render the arrangement's note as a muted, italic aside
 * (`ArrangementLine`).
 */
export function safeRenderAQSDisplay(
  name: string,
  quantity: number,
  unit: Unit,
  context: PrecisionContext = {},
): ArrangementDisplay {
  try {
    return renderAQSDisplay(name, quantity, unit, context);
  } catch {
    const text = `${quantity}${NNBSP}${unit} ${name}`;
    return { text, parts: [{ kind: 'text', value: text }] };
  }
}

/**
 * The master-list counterpart of `safeRenderAQSDisplay`: renders one derived
 * master row from the step uses it was merged from (`masterUsesFor`) through
 * the constrained master optimizer. The fallback is the summed step BQ in its
 * plain base form, so a broken master-data state can never break the list.
 */
export function safeRenderMasterAQSDisplay(
  name: string,
  uses: readonly MasterQuantityUse[],
  unit: Unit,
): ArrangementDisplay {
  try {
    return renderMasterAQSDisplay(name, uses, unit);
  } catch {
    const quantity = uses.reduce((sum, use) => sum + use.quantity, 0);
    const text = `${quantity}${NNBSP}${unit} ${name}`;
    return { text, parts: [{ kind: 'text', value: text }] };
  }
}

/**
 * `artifactDisplay` with the same kind of defensive fallback: a flagged
 * artifact whose display cannot be derived (e.g. the master data is not
 * loaded) falls back to its scaled plain amount instead of breaking the
 * reference readout. A size marker keeps its written text, which never
 * consults the registry. The readout surface drops a count of 1.
 */
export function safeArtifactDisplay(artifact: TextArtifact, factor: number): ArrangementDisplay {
  try {
    return artifactDisplay(artifact, factor, 'readout');
  } catch {
    const text =
      artifact.kind === 'size'
        ? `${artifact.count === 1 ? '' : `${artifact.count} `}${artifact.size} ${artifact.unit} ${artifact.marker}`
        : artifact.unit === undefined
          ? String(artifact.quantity * factor)
          : `${artifact.quantity * factor}${NNBSP}${artifact.unit}`;
    return { text, parts: [{ kind: 'text', value: text }] };
  }
}

/**
 * The reference readout of a recipe at one factor: reference ingredients
 * (scaled through the master list) followed by flagged inline artifacts
 * (scaled through the artifact display). `referenceUses` owns the order; the
 * two overlays and the export therefore show the same lines in the same
 * sequence.
 */
export function referenceReadoutItems(recipe: Recipe, factor: number): ArrangementDisplay[] {
  return referenceUses(recipe).map((use) =>
    use.kind === 'ingredient'
      ? safeRenderMasterAQSDisplay(
          use.ingredient.name,
          masterUsesFor(recipe.steps, use.ingredient, factor),
          use.ingredient.unit,
        )
      : safeArtifactDisplay(use.artifact, factor),
  );
}
