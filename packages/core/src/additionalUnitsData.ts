/**
 * AUTO-GENERATED from docs/number_schemes.csv, docs/additional_units.csv and
 * docs/ingredient_unit_mappings.csv by scripts/generate-additional-data.mjs.
 * Do not edit by hand — re-run 'npm run generate:additional' (packages/core) after a CSV change.
 */

/** One additional unit: display arrangement + number scheme reference. */
export interface AdditionalUnit {
  /** Unit name as shown in the display line. */
  readonly name: string;
  /** Display template; placeholders <AQ> <AU> <IN> <BQ> <BU> <NNBSP> (narrow no-break space). */
  readonly arrangement: string;
  /** Name of the number scheme gating this unit's additional quantities. */
  readonly numberScheme: string;
}

/** One ingredient–additional-unit mapping (conversion factor + priority). */
export interface IngredientMapping {
  /** Fixed base unit of the ingredient; the factor is expressed in this unit. */
  readonly bu: string;
  /** Referenced additional unit name (see ADDITIONAL_UNITS). */
  readonly au: string;
  /** Amount of base unit per one additional unit. */
  readonly factor: number;
  /** Positive integer, 1 = most preferred; unique per ingredient. */
  readonly priority: number;
}

/** All additional units, in table order. */
export const ADDITIONAL_UNITS: readonly AdditionalUnit[] = [
  {
    name: 'Becher',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
  },
  {
    name: 'EL',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_10',
  },
  {
    name: 'TL',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_10',
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

/** Ingredient mappings keyed by ingredient, each list sorted by ascending priority. */
export const INGREDIENT_MAPPINGS: Readonly<Record<string, readonly IngredientMapping[]>> = {
  Joghurt: [
    { bu: 'g', au: 'Becher', factor: 400, priority: 1 },
    { bu: 'g', au: 'EL', factor: 24, priority: 2 },
    { bu: 'g', au: 'TL', factor: 7.5, priority: 3 },
  ],
};
