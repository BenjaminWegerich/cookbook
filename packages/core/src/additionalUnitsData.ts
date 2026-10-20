/**
 * AUTO-GENERATED from docs/number_schemes.csv, docs/additional_units.csv,
 * docs/ingredients.csv and docs/ingredient_unit_mappings.csv by
 * scripts/generate-additional-data.mjs.
 * Do not edit by hand — re-run 'npm run generate:additional' (packages/core) after a CSV change.
 */

/** One additional unit: display arrangement, number scheme and unit flags. */
export interface AdditionalUnit {
  /** Canonical unit name: the identity the mappings reference and the runtime registry keys units by; without `singular`/`plural` it is also the form the display line shows. */
  readonly name: string;
  /** Singular display form of the unit (count 1), e.g. "Packung"; absent = the name is invariant and serves for every count. Present exactly when `plural` is. */
  readonly singular?: string;
  /** Plural display form of the unit (count above one), e.g. "Packungen"; absent = invariant (see `singular`). */
  readonly plural?: string;
  /** Display template; placeholders <AQ> <AU> <IN> (canonical ingredient name) <INF> (its singular/plural form) <BQ> <BU> <NNBSP> (narrow no-break space). */
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
  /** Singular display form of the name (count 1), e.g. "Karotte"; absent = the name is invariant and serves for every count (Zucker, Milch). Present exactly when `plural` is. */
  readonly singular?: string;
  /** Plural display form of the name (count ≠ 1), e.g. "Karotten"; absent = invariant (see `singular`). */
  readonly plural?: string;
  /** The ingredient's additional-unit mappings, ascending priority; empty = bare ingredient without additional units. */
  readonly entries: readonly IngredientMapping[];
}

/** All additional units, in table order. */
export const ADDITIONAL_UNITS: readonly AdditionalUnit[] = [
  {
    name: 'Dose (Abtropfgewicht)',
    singular: 'Dose',
    plural: 'Dosen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU> Abtropfgewicht)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Dose (Gesamtgewicht)',
    singular: 'Dose',
    plural: 'Dosen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU> Gesamtgewicht)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Esslöffel',
    singular: 'EL',
    plural: 'EL',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_10',
    exact: false,
    shoppingUnit: false,
  },
  {
    name: 'Packung (teilbar)',
    singular: 'Packung',
    plural: 'Packungen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'all_fractions_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Packung (halbierbar)',
    singular: 'Packung',
    plural: 'Packungen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Packung (unteilbar)',
    singular: 'Packung',
    plural: 'Packungen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Stück (ZE zuerst)',
    singular: 'Stück',
    plural: 'Stück',
    arrangement: '<AQ><NNBSP><INF> (<BQ><NNBSP><BU>)',
    numberScheme: 'quarters_halves_and_integers_up_to_30',
    exact: false,
    shoppingUnit: true,
  },
  {
    name: 'Teelöffel',
    singular: 'TL',
    plural: 'TL',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_10',
    exact: false,
    shoppingUnit: false,
  },
  {
    name: 'Zweig',
    singular: 'Zweig',
    plural: 'Zweige',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'quarters_halves_and_integers_up_to_30',
    exact: false,
    shoppingUnit: false,
  },
  {
    name: 'Topf',
    singular: 'Topf',
    plural: 'Töpfe',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'quarters_halves_and_integers_up_to_30',
    exact: false,
    shoppingUnit: true,
  },
  {
    name: 'Stück (BE zuerst)',
    singular: 'Stück',
    plural: 'Stück',
    arrangement: '<BQ><NNBSP><BU> <IN> (<AQ><NNBSP><INF>)',
    numberScheme: 'quarters_halves_and_integers_up_to_30',
    exact: false,
    shoppingUnit: true,
  },
  {
    name: 'Stück (BE zuerst, exakt)',
    singular: 'Stück',
    plural: 'Stück',
    arrangement: '<BQ><NNBSP><BU> <IN> (<AQ><NNBSP><INF>)',
    numberScheme: 'quarters_halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Bund',
    singular: 'Bund',
    plural: 'Bünde',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'quarters_halves_and_integers_up_to_30',
    exact: false,
    shoppingUnit: true,
  },
  {
    name: 'Tube',
    singular: 'Tube',
    plural: 'Tuben',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Päckchen',
    singular: 'Päckchen',
    plural: 'Päckchen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Würfel',
    singular: 'Würfel',
    plural: 'Würfel',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Blatt',
    singular: 'Blatt',
    plural: 'Blätter',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'integers_up_to_10',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Flasche',
    singular: 'Flasche',
    plural: 'Flaschen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Becher',
    singular: 'Becher',
    plural: 'Becher',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
  {
    name: 'Glas',
    singular: 'Glas',
    plural: 'Gläser',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
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
  all_fractions_and_integers_up_to_30: [
    '1/10',
    '1/9',
    '1/8',
    '1/6',
    '1/5',
    '1/4',
    '1/3',
    '3/8',
    '2/5',
    '1/2',
    '3/5',
    '2/3',
    '3/4',
    '7/8',
    '1',
    '1+1/4',
    '1+1/2',
    '1+3/4',
    '2',
    '2+1/4',
    '2+1/2',
    '2+3/4',
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
  integers_up_to_30: [
    '1',
    '2',
    '3',
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
  quarters_halves_and_integers_up_to_30: [
    '1/4',
    '1/2',
    '3/4',
    '1',
    '1+1/4',
    '1+1/2',
    '1+3/4',
    '2',
    '2+1/4',
    '2+1/2',
    '2+3/4',
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
      { au: 'Esslöffel', factor: 24, priority: 2 },
      { au: 'Teelöffel', factor: 7.5, priority: 3 },
    ],
  },
  Zucker: {
    bu: 'g',
    reorderPoint: 1000,
    entries: [
      { au: 'Esslöffel', factor: 12, priority: 1 },
      { au: 'Teelöffel', factor: 4, priority: 2 },
    ],
  },
  Mehl: {
    bu: 'g',
    reorderPoint: 1000,
    entries: [
      { au: 'Packung (unteilbar)', factor: 1000, priority: 1 },
      { au: 'Becher', factor: 150, priority: 2 },
      { au: 'Esslöffel', factor: 10, priority: 3 },
    ],
  },
  Butter: {
    bu: 'g',
    reorderPoint: 500,
    entries: [{ au: 'Esslöffel', factor: 10, priority: 1 }],
  },
  Milch: {
    bu: 'ml',
    reorderPoint: 100,
    entries: [
      { au: 'Becher', factor: 250, priority: 1 },
      { au: 'Esslöffel', factor: 15, priority: 2 },
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
      { au: 'Esslöffel', factor: 10, priority: 1 },
      { au: 'Teelöffel', factor: 3, priority: 2 },
    ],
  },
  Zitronensaft: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [{ au: 'Esslöffel', factor: 15, priority: 1 }],
  },
  Honig: {
    bu: 'g',
    reorderPoint: 500,
    entries: [{ au: 'Esslöffel', factor: 21, priority: 1 }],
  },
  Haferflocken: {
    bu: 'g',
    reorderPoint: 500,
    singular: 'Haferflocke',
    plural: 'Haferflocken',
    entries: [
      { au: 'Becher', factor: 100, priority: 1 },
      { au: 'Esslöffel', factor: 10, priority: 2 },
    ],
  },
  Cashews: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Cashew',
    plural: 'Cashews',
    entries: [],
  },
  Karotten: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Karotte',
    plural: 'Karotten',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 80, priority: 1 }],
  },
  Aquafaba: {
    bu: 'ml',
    reorderPoint: 0,
    singular: 'Dose Kichererbsen',
    plural: 'Dosen Kichererbsen',
    entries: [{ au: 'Stück (BE zuerst, exakt)', factor: 180, priority: 1 }],
  },
};
