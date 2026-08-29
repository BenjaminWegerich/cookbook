import { afterEach, describe, expect, it } from 'vitest';

import { INGREDIENT_MAPPINGS } from './additionalUnitsData.js';
import { masterIngredientNames, renderAQS, selectAQ } from './additionalUnits.js';
import {
  allIngredientMappings,
  mappingsFor,
  resetIngredientMappings,
  setIngredientMappings,
} from './ingredientRegistry.js';

/** Narrow no-break space (U+202F), as substituted by the renderer. */
const NNBSP = '\u202F';

afterEach(() => {
  resetIngredientMappings();
});

describe('ingredient registry', () => {
  it('starts with the built-in seed', () => {
    expect(masterIngredientNames()).toEqual(Object.keys(INGREDIENT_MAPPINGS).sort());
    expect(mappingsFor('Joghurt')).toEqual(INGREDIENT_MAPPINGS.Joghurt);
    expect(mappingsFor('Unbekannt')).toBeUndefined();
  });

  it('replaces the whole set via setIngredientMappings (Drive file wins)', () => {
    setIngredientMappings({
      Käse: [
        { bu: 'g', au: 'Becher', factor: 200, priority: 1 },
        { bu: 'g', au: 'EL', factor: 12, priority: 2 },
      ],
    });
    expect(masterIngredientNames()).toEqual(['Käse']);
    expect(mappingsFor('Käse')?.[0]).toEqual({ bu: 'g', au: 'Becher', factor: 200, priority: 1 });
    // The built-in names are gone — the Drive file is authoritative.
    expect(mappingsFor('Joghurt')).toBeUndefined();
  });

  it('serves selectAQ/renderAQS for a registered ingredient', () => {
    setIngredientMappings({
      Käse: [{ bu: 'g', au: 'Becher', factor: 200, priority: 1 }],
    });
    const selected = selectAQ('Käse', 400, 'g');
    expect(selected).not.toBeNull();
    expect(selected!.aq).toBe('2');
    expect(selected!.au.name).toBe('Becher');
    expect(renderAQS('Käse', 400, 'g')).toBe(`2${NNBSP}Becher Käse (400${NNBSP}g)`);
  });

  it('renders the base form when no scheme passes for a registered ingredient', () => {
    setIngredientMappings({
      Pfeffer: [{ bu: 'g', au: 'TL', factor: 3, priority: 1 }],
    });
    // 500 g ÷ 3 g per TL ≈ 167 → rounds to a ladder value far above the
    // integers_up_to_10 scheme → no AQS passes, the base form is shown.
    expect(renderAQS('Pfeffer', 500, 'g')).toBe(`500${NNBSP}g Pfeffer`);
  });

  it('resetIngredientMappings restores the seed', () => {
    setIngredientMappings({ Käse: [{ bu: 'g', au: 'Becher', factor: 200, priority: 1 }] });
    resetIngredientMappings();
    expect(allIngredientMappings()).toEqual(INGREDIENT_MAPPINGS);
    expect(masterIngredientNames()).toContain('Joghurt');
  });
});
