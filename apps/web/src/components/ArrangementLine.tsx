/**
 * ArrangementLine — renders a core `ArrangementDisplay` with its notes styled.
 *
 * An ingredient arrangement may end in a parenthesized note ("1 Becher Joghurt
 * (500 g)"). The display drops the brackets and shows the note muted and italic
 * after one en space, so the amount line reads as one phrase with a quiet aside
 * (docs/DESIGN.md §5.4). Two exceptions keep the brackets: step prose keeps a
 * regular space and styles brackets and content alike, because the sentence's
 * punctuation must stay visible (§5.11), and the reference readout keeps the
 * brackets after one en space (§5.11).
 *
 * The written shopping list never uses this component — it keeps the bracketed
 * text from core's `renderAQS`/`renderPantryLine`.
 */

import { Fragment } from 'react';

import { EN_SPACE, type ArrangementDisplay } from '@cookbook/core';

interface ArrangementLineProps {
  /** The rendered line from core (`renderAQSDisplay`, `renderPantryChipDisplay`, …). */
  display: ArrangementDisplay;
  /**
   * How a note is attached: `bare` (the default) uses one en space before the
   * note, `parenthesised` keeps a regular space and the brackets for step prose,
   * `reference` keeps the brackets after one en space for the reference readout.
   */
  noteForm?: 'bare' | 'parenthesised' | 'reference';
}

/**
 * Renders the display runs in order. Notes are the only styled runs: the
 * `.arrangement-note` class supplies the muted, italic look (styles/editor.css),
 * and the separator around a note is part of this component so every surface
 * words it the same way.
 */
export default function ArrangementLine({ display, noteForm = 'bare' }: ArrangementLineProps) {
  return (
    // One wrapper keeps the runs a single inline phrase when the component is
    // dropped into a flex row (.ingredient-line, .chip): without it every text
    // node and the note would become separate flex items and pick up the gap.
    <span className="arrangement-line">
      {display.parts.map((part, index) => {
        if (part.kind === 'text') {
          return <Fragment key={index}>{part.value}</Fragment>;
        }
        const bracketed = noteForm !== 'bare';
        return (
          <Fragment key={index}>
            {noteForm === 'parenthesised' ? ' ' : EN_SPACE}
            <span className="arrangement-note">{bracketed ? `(${part.value})` : part.value}</span>
          </Fragment>
        );
      })}
    </span>
  );
}
