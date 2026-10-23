/**
 * ArrangementLine — renders a core `ArrangementDisplay` with its notes styled.
 *
 * An ingredient arrangement may end in a parenthesized note ("1 Becher Joghurt
 * (500 g)"). The note is always the muted, italic `.arrangement-note` run; how
 * it is attached depends on the surface. `bracketed` keeps the brackets after
 * one en space (the editor's ingredient lists and the reference readout),
 * `parenthesised` keeps a regular space and styles brackets and content alike
 * for step prose, because the sentence's punctuation must stay visible
 * (docs/DESIGN.md §5.11). `bare` drops the brackets after one en space for the
 * pantry surfaces, where the amount still reads as one phrase (§5.4).
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
   * bracket-less note, `parenthesised` keeps a regular space and the brackets
   * for step prose, `bracketed` keeps the brackets after one en space (the
   * editor's ingredient lists and the reference readout).
   */
  noteForm?: 'bare' | 'parenthesised' | 'bracketed';
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
