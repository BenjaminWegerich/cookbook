/**
 * ArrangementLine — renders a core `ArrangementDisplay` with its notes styled.
 *
 * An ingredient arrangement may end in a parenthesized note ("1 Becher Joghurt
 * (500 g)"). The note is always the muted, italic `.arrangement-note` run. Every
 * list, chip and readout drops the brackets and follows the note after one en
 * space, where the amount still reads as one phrase (docs/DESIGN.md §5.4).
 *
 * Step prose is the exception and does not use this component: it keeps the
 * brackets and a regular space so the sentence's punctuation stays visible
 * (StepEditor.tsx, docs/DESIGN.md §5.11). The written shopping list also never
 * uses this component — it keeps the bracketed text from core's
 * `renderAQS`/`renderPantryLine`.
 */

import { Fragment } from 'react';

import { EN_SPACE, type ArrangementDisplay } from '@cookbook/core';

interface ArrangementLineProps {
  /** The rendered line from core (`renderAQSDisplay`, `renderPantryChipDisplay`, …). */
  display: ArrangementDisplay;
}

/**
 * Renders the display runs in order. Notes are the only styled runs: the
 * `.arrangement-note` class supplies the muted, italic look (styles/editor.css),
 * and the separator around a note is part of this component so every surface
 * words it the same way.
 */
export default function ArrangementLine({ display }: ArrangementLineProps) {
  return (
    // One wrapper keeps the runs a single inline phrase when the component is
    // dropped into a flex row (.ingredient-line, .chip): without it every text
    // node and the note would become separate flex items and pick up the gap.
    <span className="arrangement-line">
      {display.parts.map((part, index) => {
        if (part.kind === 'text') {
          return <Fragment key={index}>{part.value}</Fragment>;
        }
        return (
          <Fragment key={index}>
            {EN_SPACE}
            <span className="arrangement-note">{part.value}</span>
          </Fragment>
        );
      })}
    </span>
  );
}
