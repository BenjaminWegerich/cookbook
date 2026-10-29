/**
 * The fixed-width value slot of a quantity stepper.
 *
 * The hidden probe keeps the slot exactly as wide as the widest display the
 * caller will put in it; the probe uses the slot's own font, so the width
 * follows the bundled typeface instead of a hand-tuned pixel value. The
 * default is the free quantity input's widest value below the 10 kg / 10 l
 * bar: 999,99 ml, the largest value with two decimals just before `formatBQ`
 * switches to l. A read-only stepper that can only show BQs passes its own
 * narrower probe, so it does not reserve room for decimals it never shows. The
 * visible value is right-aligned inside that slot; a live preview below a
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
  /**
   * The widest text the slot must hold. The default is the free-input probe
   * ("999,99 ml"). A read-only stepper over BQ values passes its own BQ probe
   * instead, so it does not reserve room for decimals it can never show.
   */
  probe?: string;
}

function QuantityValue({ children, probe = QUANTITY_WIDTH_PROBE }: QuantityValueProps) {
  return (
    <span className="quantity-field">
      <span className="quantity-measure" aria-hidden="true">
        {probe}
      </span>
      {children}
    </span>
  );
}

export default QuantityValue;
