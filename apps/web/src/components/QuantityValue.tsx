/**
 * The fixed-width value slot of a quantity stepper.
 *
 * The hidden probe keeps the slot exactly as wide as the widest quantity the
 * app can show below the 10 kg / 10 l bar: 999,99 ml, the largest value with
 * two decimals just before `formatBQ` switches to l (a g value is a little
 * narrower; kg / l values are shorter). The probe uses the slot's own font, so
 * the width follows the bundled typeface instead of a hand-tuned pixel value.
 * The visible value is right-aligned inside that slot; a live preview below a
 * field stays left-aligned.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import type { ReactNode } from 'react';

import { formatBQ } from '@cookbook/core';

/** The widest quantity display up to the 10 kg / 10 l bar (see file header). */
const QUANTITY_WIDTH_PROBE = formatBQ(1000 - 0.01, 'ml');

interface QuantityValueProps {
  /** The input or display element that fills the fixed-width slot. */
  children: ReactNode;
}

function QuantityValue({ children }: QuantityValueProps) {
  return (
    <span className="quantity-field">
      <span className="quantity-measure" aria-hidden="true">
        {QUANTITY_WIDTH_PROBE}
      </span>
      {children}
    </span>
  );
}

export default QuantityValue;
