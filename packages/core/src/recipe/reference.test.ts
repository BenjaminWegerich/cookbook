/**
 * Tests for the reference role as one readout (docs/recipe_structure.md):
 * reference ingredients from the front-matter name list, then flagged inline
 * artifacts in step order.
 */

import { describe, expect, it } from 'vitest';

import { parseRecipe } from './parse.js';
import { referenceUses } from './reference.js';
import { NNBSP } from '../additionalUnits.js';
import { artifactDisplay } from './artifactDisplay.js';

describe('referenceUses', () => {
  it('puts the reference ingredients first, then flagged artifacts in step order', () => {
    const recipe = parseRecipe(`---
title: Käsekuchen
type: finished_dish
servings: 8
reference:
  - Quark
prep_time: 20 min
---
## Zubereitung
1. - 1000 g Quark
   Den Teig in {{1 26 cm Backring|size|reference}} backen und mit {{1/2|reference}} Zitrone mischen.
2. - 200 g Butter
   Butter in {{2 20 cm Backring|size}} schmelzen.
`);

    expect(referenceUses(recipe)).toEqual([
      {
        kind: 'ingredient',
        ingredient: { name: 'Quark', quantity: 1000, unit: 'g', reference: true },
      },
      {
        kind: 'artifact',
        artifact: {
          kind: 'size',
          marker: 'Backring',
          count: 1,
          size: 26,
          unit: 'cm',
          reference: true,
        },
      },
      { kind: 'artifact', artifact: { kind: 'quantity', quantity: 0.5, reference: true } },
    ]);
  });

  it('is empty for a recipe without reference amounts', () => {
    const recipe = parseRecipe(`---
title: Nichts
type: finished_dish
servings: 2
prep_time: 5 min
---
## Zubereitung
1. Nur Prosa mit {{100 g}} Mehl.
`);
    expect(referenceUses(recipe)).toEqual([]);
  });
});

describe('artifactDisplay', () => {
  it('scales a quantity artifact by the exact factor', () => {
    const written = artifactDisplay(
      { kind: 'quantity', quantity: 1500, unit: 'ml', name: 'Wasser' },
      1,
    );
    expect(written.text).toContain('Wasser');
    expect(written.text).toContain(`1,5${NNBSP}l`);
    const scaled = artifactDisplay({ kind: 'quantity', quantity: 100, unit: 'g' }, 1.5);
    expect(scaled.text).toBe(`150${NNBSP}g`);
  });

  it('applies the size marker scaling law instead of the linear factor', () => {
    // The written arrangement at factor 1 keeps its identity.
    expect(
      artifactDisplay({ kind: 'size', marker: 'Backring', count: 1, size: 26, unit: 'cm' }, 1).text,
    ).toBe('1 26er Backring');
    // 8 → 12 servings (factor 1.5) splits into two 22 cm molds, not 1.5 × 26.
    expect(
      artifactDisplay({ kind: 'size', marker: 'Backring', count: 1, size: 26, unit: 'cm' }, 1.5)
        .text,
    ).toBe('2 22er Backringe');
  });

  it('keeps a unitless count a count', () => {
    expect(artifactDisplay({ kind: 'quantity', quantity: 0.5 }, 2).text).toBe('1');
  });
});
