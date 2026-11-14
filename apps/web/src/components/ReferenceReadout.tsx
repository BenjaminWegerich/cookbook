/**
 * ReferenceReadout — a recipe's reference amounts below a size input.
 *
 * A reference amount is the sanity check of a chosen size: it moves with
 * everything else and shows the result (docs/recipe_structure.md). Reference
 * ingredients come from the master list; flagged inline artifacts (e.g. a size
 * marker such as `1 22er Backring`) follow them. The readout shows the lines
 * small and muted, one amount per line, with no caption and no comma between
 * the lines — it is a readout of amounts, not a form field and not a sentence
 * (docs/DESIGN.md §5.11).
 *
 * An arrangement note drops its brackets here and follows one en space in the
 * muted, italic `.arrangement-note` run, like every other list and readout
 * (docs/DESIGN.md §5.4/§5.11).
 *
 * Both overlays that show the readout — the meal-plan overlay („Einplanen" /
 * „Umplanen") and „Bestehendes Rezept auswählen" — render this component, so
 * their wording cannot drift apart.
 */

import type { ArrangementDisplay } from '@cookbook/core';

import ArrangementLine from './ArrangementLine';

interface ReferenceReadoutProps {
  /**
   * The reference amounts' display runs, already scaled to the chosen size.
   * The caller builds them with `referenceReadoutItems` (ingredient references
   * first, then flagged inline artifacts).
   */
  readonly items: readonly ArrangementDisplay[];
}

/**
 * Renders one line per reference amount. An empty list renders nothing: the
 * readout is omitted when the recipe defines no reference amount.
 */
export default function ReferenceReadout({ items }: ReferenceReadoutProps) {
  if (items.length === 0) return null;
  return (
    <ul className="reference-readout">
      {items.map((display, index) => (
        // The list is static for the sheet's lifetime; its order follows the
        // recipe's ingredient list, so the position is a stable key.
        <li key={index}>
          <ArrangementLine display={display} />
        </li>
      ))}
    </ul>
  );
}
