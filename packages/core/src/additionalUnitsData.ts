/**
 * AUTO-GENERATED from docs/number_schemes.csv, docs/additional_units.csv,
 * docs/ingredients.csv and docs/ingredient_unit_mappings.csv by
 * scripts/generate-additional-data.mjs.
 * Do not edit by hand — re-run 'npm run generate:additional' (packages/core) after a CSV change.
 */

/** One additional unit: display arrangement, number scheme and unit flags. */
export interface AdditionalUnit {
  /** Unit name as shown in the display line. */
  readonly name: string;
  /** Display template; placeholders <AQ> <AU> <IN> <BQ> <BU> <NNBSP> (narrow no-break space). */
  readonly arrangement: string;
  /** Name of the number scheme gating this unit's additional quantities. */
  readonly numberScheme: string;
  /** True when the unit fixes the base amount (a 400 g Becher, a 200 g Block): the shown base quantity is then derived from the rounded AQ (docs/additional_quantity_specifications.md §6.3). */
  readonly exact: boolean;
  /** True when ingredients are bought in this unit (a Becher of yogurt); false for a pure recipe measure (TL, EL). Drives the shopping list (docs/additional_quantity_specifications.md §3.1). */
  readonly shoppingUnit: boolean;
}

/** One ingredient–additional-unit mapping (conversion factor + priority). */
export interface IngredientMapping {
  /** Referenced additional unit name (see ADDITIONAL_UNITS). */
  readonly au: string;
  /** Amount of base unit per one additional unit. */
  readonly factor: number;
  /** Positive integer, 1 = most preferred; unique per ingredient. */
  readonly priority: number;
}

/** One ingredient in the master data: base unit, reorder point and AU mappings. */
export interface IngredientEntry {
  /** Fixed base unit family of the ingredient ("g" or "ml"); the conversion factors are expressed in this unit. */
  readonly bu: string;
  /** Base-unit quantity definitely on stock directly after a shopping trip, independent of the meal plan (0 = only ever bought for a recipe; Infinity = always in stock, e.g. water). Not necessarily a ladder value. */
  readonly reorderPoint: number;
  /** The ingredient's additional-unit mappings, ascending priority; empty = bare ingredient without additional units. */
  readonly entries: readonly IngredientMapping[];
}

/** All additional units, in table order. */
export const ADDITIONAL_UNITS: readonly AdditionalUnit[] = [
  {
    name: 'Becher',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'EL',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_10',
    exact: false,
    shoppingUnit: false,
  },
  {
    name: 'TL',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_10',
    exact: false,
    shoppingUnit: false,
  },
];

/** Number schemes: allowed AQ values per scheme, in ladder AQ order. */
export const NUMBER_SCHEMES: Readonly<Record<string, readonly string[]>> = {
  integers_up_to_10: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  halves_and_integers_up_to_30: [
    '1/2',
    '1',
    '1+1/2',
    '2',
    '2+1/2',
    '3',
    '3+1/2',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '12',
    '15',
    '18',
    '20',
    '22',
    '25',
    '28',
    '30',
  ],
};

/** Ingredient master data keyed by ingredient name (entries sorted by ascending priority). */
export const INGREDIENT_MAPPINGS: Readonly<Record<string, IngredientEntry>> = {
  Joghurt: {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Becher', factor: 400, priority: 1 },
      { au: 'EL', factor: 24, priority: 2 },
      { au: 'TL', factor: 7.5, priority: 3 },
    ],
  },
  Zucker: {
    bu: 'g',
    reorderPoint: 1000,
    entries: [
      { au: 'EL', factor: 12, priority: 1 },
      { au: 'TL', factor: 4, priority: 2 },
    ],
  },
  Mehl: {
    bu: 'g',
    reorderPoint: 1000,
    entries: [
      { au: 'Becher', factor: 150, priority: 1 },
      { au: 'EL', factor: 10, priority: 2 },
    ],
  },
  Butter: {
    bu: 'g',
    reorderPoint: 500,
    entries: [{ au: 'EL', factor: 10, priority: 1 }],
  },
  Milch: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [
      { au: 'Becher', factor: 250, priority: 1 },
      { au: 'EL', factor: 15, priority: 2 },
    ],
  },
  Sahne: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [{ au: 'Becher', factor: 200, priority: 1 }],
  },
  Olivenöl: {
    bu: 'ml',
    reorderPoint: 500,
    entries: [
      { au: 'EL', factor: 10, priority: 1 },
      { au: 'TL', factor: 3, priority: 2 },
    ],
  },
  Zitronensaft: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [{ au: 'EL', factor: 15, priority: 1 }],
  },
  Honig: {
    bu: 'g',
    reorderPoint: 500,
    entries: [{ au: 'EL', factor: 21, priority: 1 }],
  },
  Haferflocken: {
    bu: 'g',
    reorderPoint: 500,
    entries: [
      { au: 'Becher', factor: 100, priority: 1 },
      { au: 'EL', factor: 10, priority: 2 },
    ],
  },
  Cashews: {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
};
