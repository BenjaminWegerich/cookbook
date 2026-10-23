/**
 * ReferenceReadout — a recipe's reference ingredients below a size input.
 *
 * The reference ingredients are the sanity check of a chosen size: their
 * amounts move by the same exact factor as everything else
 * (docs/recipe_structure.md). The readout shows them small and muted, one
 * amount per line, with no caption and no comma between the lines — it is a
 * readout of amounts, not a form field and not a sentence (docs/DESIGN.md
 * §5.11).
 *
 * An arrangement note keeps its brackets here and follows one en space in the
 * muted, italic `.arrangement-note` run, like the editor's ingredient lists
 * (docs/DESIGN.md §5.11).
 *
 * Both overlays that show the readout — the meal-plan overlay („Einplanen" /
 * „Umplanen") and „Bestehendes Rezept auswählen" — render this component, so
 * their wording cannot drift apart.
 */

import type { ArrangementDisplay } from '@cookbook/core';

import ArrangementLine from './ArrangementLine';

interface ReferenceReadoutProps {
  /**
   * The reference ingredients' display runs, already scaled to the chosen
   * size. The caller builds them with `safeRenderAQSDisplay`.
   */
  readonly items: readonly ArrangementDisplay[];
}

/**
 * Renders one line per reference ingredient. An empty list renders nothing:
 * the readout is omitted when the recipe defines no reference ingredient.
 */
export default function ReferenceReadout({ items }: ReferenceReadoutProps) {
  if (items.length === 0) return null;
  return (
    <ul className="reference-readout">
      {items.map((display, index) => (
        // The list is static for the sheet's lifetime; its order follows the
        // recipe's ingredient list, so the position is a stable key.
        <li key={index}>
          <ArrangementLine display={display} noteForm="bracketed" />
        </li>
      ))}
    </ul>
  );
}
