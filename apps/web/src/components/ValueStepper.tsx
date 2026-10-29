/**
 * A −/+ stepper over a finite, ordered list of allowed values.
 *
 * Used where the value must be one of a baked set (the meal plan's ingredient
 * recipe yields) rather than a free target. The +/− buttons move exactly one
 * list entry per press, and the list itself is the single source of truth, so a
 * value the export cannot show is never offered. Holding a button repeats the
 * walk at the same cadence as tapping it quickly (StepperButton).
 *
 * The chip row uses the ingredient sheet's adaptive logic — core's
 * `suggestQuantities` wrapped in `SuggestionChips` — instead of fixed powers of
 * ten: arrangements around the current value, with the ingredient recipe's
 * master data (its additional-unit links) when that row exists, and metric
 * arrangements when it does not. The caller's `values` are the export's
 * pre-baked yield views and act as a hard lower/upper cap: a suggestion whose
 * tap value is not one of them is dropped, because the Keep link can only open
 * a baked size. The stepper still shows the current value when no chip happens
 * to offer it (the adaptive row never reserves the active chip).
 *
 * The value slot is right-aligned and sized to the widest BQ reading below the
 * kg/l switch (QuantityValue's BQ probe), not to the free-input "999,99 ml":
 * the stepper never shows decimals, so the editable field's extra width would
 * only be whitespace. The caller still supplies the unit in `format`.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useMemo, useRef } from 'react';

import { formatBQ, mappingsFor, previousAllowedBQ, suggestQuantities } from '@cookbook/core';

import ArrangementLine from './ArrangementLine';
import type { QuantityFamily } from './QuantityInput';
import QuantityValue from './QuantityValue';
import StepperButton from './StepperButton';
import SuggestionChips from './SuggestionChips';

interface ValueStepperProps {
  /** The current value; must be one of `values`. */
  value: number;
  /** The allowed values, ascending (the export's pre-baked yield views). */
  values: readonly number[];
  /** Reports the newly selected value. */
  onChange: (value: number) => void;
  /** Display form of a value (unit and German formatting are the caller's). */
  format: (value: number) => string;
  /** Accessible name of the group (e.g. "Menge"). */
  ariaLabel: string;
  /**
   * The ingredient recipe whose master data feeds the chips (its additional
   * units). Absent when the title has no master row: the chips stay metric.
   */
  ingredient?: string;
  /** The target's family unit; the optimizer only considers family-compatible AUs. */
  family: QuantityFamily;
}

/**
 * The widest BQ reading below the kg/l switch ("950 g" / "950 ml"): 950 is the
 * largest allowed BQ value under 1000. Above 1000 the display steps to kg / l
 * and stays within this width for every realistic yield. Derived from the BQ
 * table, not hand-tuned, so the slot follows the generated master data.
 */
const BQ_WIDTH_PROBE = previousAllowedBQ(1000) ?? 950;

function ValueStepper({
  value,
  values,
  onChange,
  format,
  ariaLabel,
  ingredient,
  family,
}: ValueStepperProps) {
  const index = values.indexOf(value);

  /**
   * The adaptive chips, derived from the current value on every change so the
   * row follows a step or a tap (same rule as the ingredient sheet). The
   * master-data entry supplies the additional-unit links when the ingredient
   * recipe has one; `values` is the hard cap — a chip whose stored BQ is not a
   * baked yield is dropped, so every tap keeps the export link answerable.
   */
  const chips = useMemo(() => {
    const entry = ingredient === undefined ? undefined : mappingsFor(ingredient);
    return suggestQuantities(value, entry, family, { allowedValues: values }).map((suggestion) => ({
      value: suggestion.value,
      label: <ArrangementLine display={suggestion.display} />,
    }));
  }, [value, ingredient, family, values]);

  /**
   * Mirror of the latest value so a hold's repeat ticks move from the entry
   * the previous tick produced, even before the parent re-renders and passes
   * the new prop back.
   */
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });

  /** One list entry in `direction`; false when the end of the list blocks it. */
  const step = (direction: 1 | -1): boolean => {
    const current = valueRef.current;
    const currentIndex = values.indexOf(current);
    if (currentIndex < 0) return false;
    const next = values[currentIndex + direction];
    if (next === undefined) return false;
    valueRef.current = next;
    onChange(next);
    return true;
  };

  return (
    <div className="quantity-picker">
      <SuggestionChips
        chips={chips}
        value={value}
        onChange={onChange}
        ariaLabel={`${ariaLabel}: Vorschläge`}
      />
      <div className="quantity-row">
        <StepperButton
          direction={-1}
          disabled={index <= 0}
          ariaLabel={`${ariaLabel} verringern`}
          onStep={step}
        />
        <QuantityValue probe={formatBQ(BQ_WIDTH_PROBE, family)}>
          <span className="quantity-value quantity-display">{format(value)}</span>
        </QuantityValue>
        <StepperButton
          direction={1}
          disabled={index < 0 || index >= values.length - 1}
          ariaLabel={`${ariaLabel} erhöhen`}
          onStep={step}
        />
      </div>
    </div>
  );
}

export default ValueStepper;
