/**
 * Tests for the ingredient merging and the master-list derivation
 * (storage_format.md §4: the step rows are the source of truth; an ingredient
 * used in several places appears once, with the total amount).
 */

import { describe, expect, it } from 'vitest';

import { deriveIngredients, mergeIngredientUses } from './ingredientList.js';
import { masterUsesFor } from './masterQuantity.js';
import type { Step } from './types.js';

describe('mergeIngredientUses', () => {
  it('merges repeated entries of the same name with the summed quantity', () => {
    const result = mergeIngredientUses([
      { name: 'Joghurt', quantity: 200, unit: 'g' },
      { name: 'Joghurt', quantity: 200, unit: 'g' },
    ]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 400, unit: 'g' }]);
  });

  it('keeps a non-standard sum exact (400 + 750 = 1150)', () => {
    const result = mergeIngredientUses([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Joghurt', quantity: 750, unit: 'g' },
    ]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 1150, unit: 'g' }]);
  });

  it('keeps same-name entries with different units separate', () => {
    const result = mergeIngredientUses([
      { name: 'Mehl', quantity: 200, unit: 'g' },
      { name: 'Mehl', quantity: 300, unit: 'ml' },
    ]);
    expect(result).toEqual([
      { name: 'Mehl', quantity: 200, unit: 'g' },
      { name: 'Mehl', quantity: 300, unit: 'ml' },
    ]);
  });

  it('merges same-unit uses even when the name also appears in another unit', () => {
    // The g rows are comparable and merge; the ml row stays separate. This
    // keeps one master row backed by exactly one unit's uses.
    const result = mergeIngredientUses([
      { name: 'Mehl', quantity: 200, unit: 'g' },
      { name: 'Mehl', quantity: 300, unit: 'ml' },
      { name: 'Mehl', quantity: 100, unit: 'g' },
    ]);
    expect(result).toEqual([
      { name: 'Mehl', quantity: 300, unit: 'g' },
      { name: 'Mehl', quantity: 300, unit: 'ml' },
    ]);
  });

  it('keeps the order of first appearance', () => {
    const result = mergeIngredientUses([
      { name: 'Reis', quantity: 300, unit: 'g' },
      { name: 'Joghurt', quantity: 200, unit: 'g' },
      { name: 'Reis', quantity: 100, unit: 'g' },
    ]);
    expect(result).toEqual([
      { name: 'Reis', quantity: 400, unit: 'g' },
      { name: 'Joghurt', quantity: 200, unit: 'g' },
    ]);
  });

  it('trims names', () => {
    const result = mergeIngredientUses([{ name: '  Joghurt ', quantity: 400, unit: 'g' }]);
    expect(result).toEqual([{ name: 'Joghurt', quantity: 400, unit: 'g' }]);
  });
});

describe('deriveIngredients', () => {
  const steps: Step[] = [
    {
      ingredients: [{ name: 'Joghurt', quantity: 200, unit: 'g' }],
      text: 'Anrühren.',
    },
    {
      ingredients: [{ name: 'Zitronensaft', quantity: 15, unit: 'ml' }],
      text: 'Zugeben.',
    },
    {
      ingredients: [{ name: 'Joghurt', quantity: 200, unit: 'g' }],
      text: 'Unterheben.',
    },
  ];

  it('merges the rows of all steps in order of first use', () => {
    expect(deriveIngredients(steps)).toEqual([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Zitronensaft', quantity: 15, unit: 'ml' },
    ]);
  });

  it('sums the displayed BQs, not the exact targets', () => {
    // Each 450 g Joghurt row displays as 1 Becher (500 g); the master list is
    // 1000 g, not the exact 900 g.
    const roundedRows: Step[] = [
      { ingredients: [{ name: 'Joghurt', quantity: 450, unit: 'g' }], text: 'A.' },
      { ingredients: [{ name: 'Joghurt', quantity: 450, unit: 'g' }], text: 'B.' },
    ];
    expect(deriveIngredients(roundedRows)).toEqual([
      { name: 'Joghurt', quantity: 1000, unit: 'g' },
    ]);
  });

  it('uses the rounded exact-unit BQ when summing', () => {
    // 1/3 of a 200 g pack displays as 67 g; two rows make 134 g.
    const exactRows: Step[] = [
      { ingredients: [{ name: 'Naturtofu', quantity: 66.67, unit: 'g' }], text: 'A.' },
      { ingredients: [{ name: 'Naturtofu', quantity: 66.67, unit: 'g' }], text: 'B.' },
    ];
    expect(deriveIngredients(exactRows)).toEqual([{ name: 'Naturtofu', quantity: 134, unit: 'g' }]);
  });

  it('flags the merged entries whose name is in the reference list', () => {
    expect(deriveIngredients(steps, ['Zitronensaft'])).toEqual([
      { name: 'Joghurt', quantity: 400, unit: 'g' },
      { name: 'Zitronensaft', quantity: 15, unit: 'ml', reference: true },
    ]);
  });

  it('resolves reference by trimmed name', () => {
    const result = deriveIngredients(steps, ['  Zitronensaft ']);
    expect(result[1]).toEqual({ name: 'Zitronensaft', quantity: 15, unit: 'ml', reference: true });
  });

  it('never counts inline artifacts (they live in the prose, not the rows)', () => {
    const withArtifacts: Step[] = [
      { ingredients: [], text: 'Nudeln in {{1500 ml Wasser}} kochen.' },
      { ingredients: [{ name: 'Nudeln', quantity: 500, unit: 'g' }], text: 'Würzen.' },
    ];
    expect(deriveIngredients(withArtifacts)).toEqual([
      { name: 'Nudeln', quantity: 500, unit: 'g' },
    ]);
  });
});

describe('masterUsesFor', () => {
  it('recovers every use behind a master row, in recipe order', () => {
    const rows: Step[] = [
      { ingredients: [{ name: 'Joghurt', quantity: 450, unit: 'g' }], text: 'A.' },
      { ingredients: [{ name: 'Joghurt', quantity: 20, unit: 'g' }], text: 'B.' },
      { ingredients: [{ name: 'Joghurt', quantity: 450, unit: 'g' }], text: 'C.' },
    ];
    const master = deriveIngredients(rows);
    expect(masterUsesFor(rows, master[0]!)).toEqual([
      { quantity: 450 },
      { quantity: 20 },
      { quantity: 450 },
    ]);
  });

  it('scales every use and keeps the row precision', () => {
    const rows: Step[] = [
      {
        ingredients: [{ name: 'Joghurt', quantity: 250, unit: 'g', precision: 'high' }],
        text: 'A.',
      },
      { ingredients: [{ name: 'Joghurt', quantity: 250, unit: 'g' }], text: 'B.' },
    ];
    const master = deriveIngredients(rows);
    expect(masterUsesFor(rows, master[0]!, 2)).toEqual([
      { quantity: 500, precision: 'high' },
      { quantity: 500 },
    ]);
  });

  it('matches the trimmed name and the base unit, not a same-name other unit', () => {
    const rows: Step[] = [
      { ingredients: [{ name: ' Mehl ', quantity: 200, unit: 'g' }], text: 'A.' },
      { ingredients: [{ name: 'Mehl', quantity: 300, unit: 'ml' }], text: 'B.' },
      { ingredients: [{ name: 'Mehl', quantity: 100, unit: 'g' }], text: 'C.' },
    ];
    const master = deriveIngredients(rows);
    // Same-unit uses merged into one master row (300 g), the ml use is its own.
    expect(masterUsesFor(rows, master[0]!)).toEqual([{ quantity: 200 }, { quantity: 100 }]);
    expect(masterUsesFor(rows, master[1]!)).toEqual([{ quantity: 300 }]);
  });
});
