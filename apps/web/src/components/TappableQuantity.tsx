/**
 * One tappable quantity of a pantry row (components/PantrySelect and
 * components/SubRecipeSelect): plain text when closed, an inline keyboard input
 * when tapped.
 *
 * The quantities of both pantry steps read as ordinary text that happens to be
 * editable — there is no box, no stepper and no slider (decided with the user).
 * Committing the unchanged value is a no-op, so a tap that merely opens the
 * keyboard can never alter the amount.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState } from 'react';

import { formatDecimal } from '@cookbook/core';

import { parseInput, roundThousandths } from './pantryInput';

interface TappableQuantityProps {
  /** The closed reading, written as plain text (the value it shows). */
  display: string;
  /** The number behind `display`: the prefill and the "unchanged" reference. */
  editValue: number;
  /** The unit the open input is typed in ("g" / "ml" / the shopping unit). */
  unitName: string;
  /**
   * Whether the open input shows its unit beside it. The count hides it: the
   * arrangement's <AU> already names that unit right after the input, so the
   * label would double it. Defaults to true — a base amount's "g"/"ml" is only
   * shown here.
   */
  showEditUnit?: boolean;
  /** Reports a committed number (already clamped to ≥ 0 by the caller). */
  onCommit: (typed: number) => void;
  /** Accessible name of the reading, e.g. "Kaufen für Mehl". */
  label: string;
}

function TappableQuantity({
  display,
  editValue,
  unitName,
  showEditUnit = true,
  onCommit,
  label,
}: TappableQuantityProps) {
  /** True while the keyboard is open; `draft` holds what is being typed. */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function beginEdit(): void {
    setEditing(true);
    setDraft(formatDecimal(roundThousandths(editValue)));
  }

  function commitTyped(): void {
    setEditing(false);
    const parsed = parseInput(draft);
    if (!Number.isFinite(parsed)) return;
    const rounded = roundThousandths(parsed);
    // Unchanged (within the sheet's thousandth precision): nothing to do.
    if (rounded === roundThousandths(editValue)) return;
    onCommit(rounded);
  }

  if (editing) {
    return (
      <span className="pantry-value-edit">
        <input
          className="pantry-value-input"
          // The phone's number keypad, not the full keyboard. The value may carry
          // a decimal comma, hence "decimal" rather than "numeric".
          inputMode="decimal"
          enterKeyHint="done"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commitTyped}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitTyped();
            if (event.key === 'Escape') setEditing(false);
          }}
          aria-label={`${label} in ${unitName}`}
        />
        {/* The field's unit while it is open: g / ml for a base amount, the
            shopping unit's name for a count. A count hides it — that unit is
            already the arrangement's <AU> right beside the input. The unit's
            leading margin is the space between the number and its unit. */}
        {showEditUnit && <span className="pantry-value-unit">{unitName}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="pantry-value"
      onClick={beginEdit}
      aria-label={`${label} eintippen (${unitName})`}
    >
      {display}
    </button>
  );
}

export default TappableQuantity;
