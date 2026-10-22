/**
 * AUTO-GENERATED from docs/AQs.csv, docs/additional_units.csv,
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

/** One ingredient–additional-unit mapping (conversion factor only). */
export interface IngredientMapping {
  /** Referenced additional unit name (see ADDITIONAL_UNITS). */
  readonly au: string;
  /** Amount of base unit per one additional unit. */
  readonly factor: number;
}

/** One ingredient in the master data: base unit, reorder point and AU mappings. */
export interface IngredientEntry {
  /** Fixed base unit family of the ingredient ("g" or "ml"); the conversion factors are expressed in this unit. */
  readonly bu: string;
  /** Base-unit quantity definitely on stock directly after a shopping trip, independent of the meal plan (0 = only ever bought for a recipe; Infinity = always in stock, e.g. water). Not necessarily a ladder value. */
  readonly reorderPoint: number;
  /** Ingredient-level tolerance in [0, 1], or absent to inherit the recipe / global default (docs/recipe_scaling_algorithm.md §4.1). */
  readonly tolerance?: number;
  /** Singular display form of the name (count 1), e.g. "Karotte"; absent = the name is invariant and serves for every count (Zucker, Milch). Present exactly when `plural` is. */
  readonly singular?: string;
  /** Plural display form of the name (count ≠ 1), e.g. "Karotten"; absent = invariant (see `singular`). */
  readonly plural?: string;
  /** The ingredient's additional-unit mappings; empty = bare ingredient without additional units. */
  readonly entries: readonly IngredientMapping[];
}

/** All additional units, in table order. */
export const ADDITIONAL_UNITS: readonly AdditionalUnit[] = [
  {
    name: 'Dose',
    singular: 'Dose',
    plural: 'Dosen',
    arrangement: '<AQ><NNBSP><AU> <IN> (<BQ><NNBSP><BU>)',
    numberScheme: 'halves_and_integers_up_to_30',
    exact: true,
    shoppingUnit: true,
  },
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
    '4+1/2',
    '5',
    '5+1/2',
    '6',
    '6+1/2',
    '7',
    '7+1/2',
    '8',
    '8+1/2',
    '9',
    '9+1/2',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '22',
    '25',
    '28',
    '30',
  ],
  all_fractions_and_integers_up_to_30: [
    '1/8',
    '1/6',
    '1/4',
    '1/3',
    '3/8',
    '1/2',
    '5/8',
    '2/3',
    '3/4',
    '5/6',
    '7/8',
    '1',
    '1+1/8',
    '1+1/6',
    '1+1/4',
    '1+1/3',
    '1+1/2',
    '1+3/4',
    '2',
    '2+1/4',
    '2+1/2',
    '2+3/4',
    '3',
    '3+1/4',
    '3+1/2',
    '3+3/4',
    '4',
    '4+1/4',
    '4+1/2',
    '4+3/4',
    '5',
    '5+1/2',
    '6',
    '6+1/2',
    '7',
    '7+1/2',
    '8',
    '8+1/2',
    '9',
    '9+1/2',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
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
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
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
    '3+1/4',
    '3+1/2',
    '3+3/4',
    '4',
    '4+1/4',
    '4+1/2',
    '4+3/4',
    '5',
    '5+1/2',
    '6',
    '6+1/2',
    '7',
    '7+1/2',
    '8',
    '8+1/2',
    '9',
    '9+1/2',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '22',
    '25',
    '28',
    '30',
  ],
};

/** Ingredient master data keyed by ingredient name. */
export const INGREDIENT_MAPPINGS: Readonly<Record<string, IngredientEntry>> = {
  Äpfel: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Apfel',
    plural: 'Äpfel',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 181.6 }],
  },
  Aquafaba: {
    bu: 'ml',
    reorderPoint: 0,
    singular: 'Dose Kichererbsen',
    plural: 'Dosen Kichererbsen',
    entries: [
      { au: 'Stück (BE zuerst, exakt)', factor: 180 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3 },
    ],
  },
  Auberginen: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Aubergine',
    plural: 'Auberginen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 339.5 }],
  },
  Avocados: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Avocado',
    plural: 'Avocados',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 249.8 }],
  },
  Backpulver: {
    bu: 'g',
    reorderPoint: 90,
    entries: [
      { au: 'Päckchen', factor: 15 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3 },
    ],
  },
  Birnen: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Birne',
    plural: 'Birnen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 206.5 }],
  },
  Blumenkohl: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Blumenkohl',
    plural: 'Blumenkohlköpfe',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 1172.7 }],
  },
  Brokkoli: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Brokkoli',
    plural: 'Brokkoli',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 347.1 }],
  },
  Butter: {
    bu: 'g',
    reorderPoint: 500,
    entries: [{ au: 'Packung (teilbar)', factor: 250 }],
  },
  Cashews: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Cashew',
    plural: 'Cashews',
    entries: [],
  },
  Chiliflocken: {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 7 },
      { au: 'Teelöffel', factor: 2 },
    ],
  },
  Chilis: {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
  Currypulver: {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 6 },
      { au: 'Teelöffel', factor: 2 },
    ],
  },
  Dill: {
    bu: 'g',
    reorderPoint: 100,
    entries: [],
  },
  Eisbergsalat: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Kopf Eisbergsalat',
    plural: 'Köpfe Eisbergsalat',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 721.1 }],
  },
  Fenchel: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Fenchelknolle',
    plural: 'Fenchelknollen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 286.3 }],
  },
  'frische Chilis': {
    bu: 'g',
    reorderPoint: 0,
    singular: 'frische Chili',
    plural: 'frische Chilis',
    entries: [],
  },
  'frische Hefe': {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
  'frische Petersilie': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 1 }],
  },
  'frischer Dill': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 1.8 }],
  },
  'frischer Ingwer': {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
  'frischer Kerbel': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 1 }],
  },
  'frischer Knoblauch': {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Knoblauchzehe',
    plural: 'Knoblauchzehen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 4 }],
  },
  'frischer Liebstöckel': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 1 }],
  },
  'frischer Majoran': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 3 }],
  },
  'frischer Oregano': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 3 }],
  },
  'frischer Rosmarin': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 2.5 }],
  },
  'frischer Salbei': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 3 }],
  },
  'frischer Schnittlauch': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 3 },
      { au: 'Teelöffel', factor: 1 },
    ],
  },
  'frischer Thymian': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 3 }],
  },
  'frisches Basilikum': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Zweig', factor: 4 },
      { au: 'Blatt', factor: 0.1 },
    ],
  },
  'frisches Koriandergrün': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Zweig', factor: 1 }],
  },
  Frühlingszwiebeln: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Frühlingszwiebel',
    plural: 'Frühlingszwiebeln',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 29.2 }],
  },
  'ganze Gewürznelken': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 5.623413252 },
      { au: 'Teelöffel', factor: 1.77827941 },
    ],
  },
  'gehackte Tomaten': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Dose (Gesamtgewicht)', factor: 400 }],
  },
  'gekochte Kichererbsen': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Dose (Abtropfgewicht)', factor: 240 }],
  },
  'gekochte Kichererbsen mit Aquafaba': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Dose (Gesamtgewicht)', factor: 400 }],
  },
  'gekochte Kidneybohnen': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Dose (Abtropfgewicht)', factor: 240 }],
  },
  'gekochte weiße Bohnen': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Dose (Abtropfgewicht)', factor: 250 }],
  },
  'gemahlene Gewürznelken': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  'gemahlene Koriandersamen': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 4.216965034 },
      { au: 'Teelöffel', factor: 1.333521432 },
    ],
  },
  'gemahlene Kurkuma': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  'gemahlene Muskatnuss': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  'gemahlener Ingwer': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  'gemahlener Kardamom': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  'gemahlener Kreuzkümmel': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 5.121908158 },
      { au: 'Teelöffel', factor: 1.619689575 },
    ],
  },
  'getrockneter Liebstöckel': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 4.216965034 },
      { au: 'Teelöffel', factor: 1.333521432 },
    ],
  },
  'gemahlener Pfeffer': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 17.7827941 },
      { au: 'Teelöffel', factor: 5.623413252 },
    ],
  },
  'Gemüsebrühe-Pulver': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  'geräuchertes Paprikapulver': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 5.496908158 },
      { au: 'Teelöffel', factor: 1.738274987 },
    ],
  },
  'gerebelter Kerbel': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 1.539926526 },
      { au: 'Teelöffel', factor: 0.486967525 },
    ],
  },
  'gerebelter Majoran': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 1.539926526 },
      { au: 'Teelöffel', factor: 0.486967525 },
    ],
  },
  'gerebelter Oregano': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 2.371373706 },
      { au: 'Teelöffel', factor: 0.749894209 },
    ],
  },
  'gerebelter Salbei': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 2.371373706 },
      { au: 'Teelöffel', factor: 0.749894209 },
    ],
  },
  'gerebelter Thymian': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 3.16227766 },
      { au: 'Teelöffel', factor: 1 },
    ],
  },
  'geriebener Käse': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (unteilbar)', factor: 150 }],
  },
  'getrocknete Chilis': {
    bu: 'g',
    reorderPoint: 0,
    singular: 'getrocknete Chili',
    plural: 'getrocknete Chilis',
    entries: [],
  },
  'getrockneter Dill': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 3.16227766 },
      { au: 'Teelöffel', factor: 1 },
    ],
  },
  'getrockneter Rosmarin': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 4.869675252 },
      { au: 'Teelöffel', factor: 1.539926526 },
    ],
  },
  Gluten: {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 8.7 },
      { au: 'Teelöffel', factor: 2.751181564 },
    ],
  },
  'granulierter Knoblauch': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Grapefruits: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Grapefruit',
    plural: 'Grapefruits',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 393.5 }],
  },
  Grapefruitsaft: {
    bu: 'ml',
    reorderPoint: 0,
    singular: 'Grapefruit',
    plural: 'Grapefruits',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 202.8463836 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Grapefruitschale: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Grapefruit',
    plural: 'Grapefruits',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 10.83 },
      { au: 'Esslöffel', factor: 5.623413252 },
      { au: 'Teelöffel', factor: 1.77827941 },
    ],
  },
  'grobkörniges Salz': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Hefeflocken: {
    bu: 'g',
    reorderPoint: 300,
    entries: [
      { au: 'Esslöffel', factor: 4.216965034 },
      { au: 'Teelöffel', factor: 1.333521432 },
    ],
  },
  Karotten: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Karotte',
    plural: 'Karotten',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 62.1 }],
  },
  Kartoffeln: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Kartoffel',
    plural: 'Kartoffeln',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 89.5 }],
  },
  Kirschtomaten: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Kirschtomate',
    plural: 'Kirschtomaten',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 11.3 }],
  },
  Knollensellerie: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Sellerieknolle',
    plural: 'Sellerieknollen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 876.8 }],
  },
  Kopfsalat: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Salatkopf',
    plural: 'Salatköpfe',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 348.3 }],
  },
  Limetten: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Limette',
    plural: 'Limetten',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 65 }],
  },
  Limettensaft: {
    bu: 'ml',
    reorderPoint: 0,
    singular: 'Limette',
    plural: 'Limetten',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 31.6227766 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Limettenschale: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Limette',
    plural: 'Limetten',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 1.333521432 },
      { au: 'Esslöffel', factor: 5.623413252 },
      { au: 'Teelöffel', factor: 1.77827941 },
    ],
  },
  Mehl: {
    bu: 'g',
    reorderPoint: 1000,
    entries: [{ au: 'Packung (unteilbar)', factor: 1000 }],
  },
  Mais: {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Dose (Abtropfgewicht)', factor: 285 }],
  },
  Milch: {
    bu: 'ml',
    reorderPoint: 3000,
    entries: [
      { au: 'Packung (unteilbar)', factor: 1000 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Naturtofu: {
    bu: 'g',
    reorderPoint: 400,
    entries: [{ au: 'Packung (teilbar)', factor: 200 }],
  },
  Öl: {
    bu: 'ml',
    reorderPoint: 500,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Orangen: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Orange',
    plural: 'Orangen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 225.5 }],
  },
  Orangensaft: {
    bu: 'ml',
    reorderPoint: 0,
    singular: 'Orange',
    plural: 'Orangen',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 86.59643234 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Orangenschale: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Orange',
    plural: 'Orangen',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 5.623413252 },
      { au: 'Esslöffel', factor: 5.623413252 },
      { au: 'Teelöffel', factor: 1.77827941 },
    ],
  },
  Paprikas: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Paprika',
    plural: 'Paprikas',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 206.5624698 }],
  },
  Pfirsiche: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Pfirsich',
    plural: 'Pfirsiche',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 136.1 }],
  },
  Räuchertofu: {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (teilbar)', factor: 200 }],
  },
  'rote Beete': {
    bu: 'g',
    reorderPoint: 0,
    singular: 'rote Beete',
    plural: 'rote Beeten',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 155.5 }],
  },
  Rotkohl: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Rotkohl',
    plural: 'Rotkohlköpfe',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 1842.5 }],
  },
  Kochsahne: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [{ au: 'Packung (unteilbar)', factor: 200 }],
  },
  Salz: {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 16.07094682 },
      { au: 'Teelöffel', factor: 5.08207961 },
    ],
  },
  Sauerkraut: {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
  Schalotten: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Schalotte',
    plural: 'Schalotten',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 32 }],
  },
  'scharfes Paprikapulver': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 5.496908158 },
      { au: 'Teelöffel', factor: 1.738274987 },
    ],
  },
  Schlagsahne: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [
      { au: 'Becher', factor: 200 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Senf: {
    bu: 'g',
    reorderPoint: 200,
    entries: [
      { au: 'Esslöffel', factor: 17.7827941 },
      { au: 'Teelöffel', factor: 5.623413252 },
    ],
  },
  Sojasauce: {
    bu: 'ml',
    reorderPoint: 250,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Speisestärke: {
    bu: 'g',
    reorderPoint: 400,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Spitzkohl: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Spitzkohl',
    plural: 'Spitzkohlköpfe',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 1000 }],
  },
  Stangensellerie: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Stange Sellerie',
    plural: 'Stangen Sellerie',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 56 }],
  },
  Strauchtomaten: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Strauchtomate',
    plural: 'Strauchtomaten',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 110 }],
  },
  'süßes Paprikapulver': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 5.496908158 },
      { au: 'Teelöffel', factor: 1.738274987 },
    ],
  },
  Tomatenmark: {
    bu: 'g',
    reorderPoint: 200,
    entries: [
      { au: 'Tube', factor: 200 },
      { au: 'Esslöffel', factor: 15.39926526 },
      { au: 'Teelöffel', factor: 4.869675252 },
    ],
  },
  Trockenbackhefe: {
    bu: 'g',
    reorderPoint: 42,
    entries: [
      { au: 'Esslöffel', factor: 7.498942093 },
      { au: 'Teelöffel', factor: 2.371373706 },
    ],
  },
  Vanilleextrakt: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Weißkohl: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Weißkohl',
    plural: 'Weißkohlköpfe',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 1906 }],
  },
  Wodka: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  'gemahlener Zimt': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  Zitronen: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Zitrone',
    plural: 'Zitronen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 115 }],
  },
  Zitronensaft: {
    bu: 'ml',
    reorderPoint: 0,
    singular: 'Zitrone',
    plural: 'Zitronen',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 36.51741273 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Zitronenschale: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Zitrone',
    plural: 'Zitronen',
    entries: [
      { au: 'Stück (BE zuerst)', factor: 3.16227766 },
      { au: 'Esslöffel', factor: 5.623413252 },
      { au: 'Teelöffel', factor: 1.77827941 },
    ],
  },
  Zucchini: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Zucchini',
    plural: 'Zucchini',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 209.6 }],
  },
  Zucker: {
    bu: 'g',
    reorderPoint: 1000,
    entries: [
      { au: 'Packung (unteilbar)', factor: 1000 },
      { au: 'Esslöffel', factor: 13.33521432 },
      { au: 'Teelöffel', factor: 4.216965034 },
    ],
  },
  Zwetschgen: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Zwetschge',
    plural: 'Zwetschgen',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 38.8 }],
  },
  Zwiebeln: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Zwiebel',
    plural: 'Zwiebeln',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 82.8 }],
  },
  Wasser: {
    bu: 'ml',
    reorderPoint: Infinity,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Kakaopulver: {
    bu: 'g',
    reorderPoint: 250,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Leinsamen: {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  'weißer Sesam': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  'schwarzer Sesam': {
    bu: 'g',
    reorderPoint: 100,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  Kürbiskerne: {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 6.493816316 },
      { au: 'Teelöffel', factor: 2.053525026 },
    ],
  },
  'getrocknete Soja-Steaks': {
    bu: 'g',
    reorderPoint: 0,
    singular: 'getrocknetes Soja-Steak',
    plural: 'getrocknete Soja-Steaks',
    entries: [{ au: 'Stück (ZE zuerst)', factor: 60 }],
  },
  'passierte Tomaten': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Flasche', factor: 700 }],
  },
  'Crème fraîche': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Becher', factor: 150 }],
  },
  'Penne rigate': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (teilbar)', factor: 500 }],
  },
  Joghurt: {
    bu: 'g',
    reorderPoint: 800,
    entries: [
      { au: 'Becher', factor: 500 },
      { au: 'Esslöffel', factor: 23.71373706 },
      { au: 'Teelöffel', factor: 7.498942093 },
    ],
  },
  Skyr: {
    bu: 'g',
    reorderPoint: 800,
    entries: [],
  },
  Mayonnaise: {
    bu: 'g',
    reorderPoint: 250,
    entries: [
      { au: 'Esslöffel', factor: 23.71373706 },
      { au: 'Teelöffel', factor: 7.498942093 },
    ],
  },
  Kokosmilch: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [{ au: 'Dose (Gesamtgewicht)', factor: 400 }],
  },
  'rote Linsen': {
    bu: 'g',
    reorderPoint: 0,
    singular: 'rote Linse',
    plural: 'rote Linsen',
    entries: [{ au: 'Packung (teilbar)', factor: 500 }],
  },
  Linsen: {
    bu: 'g',
    reorderPoint: 0,
    singular: 'Linse',
    plural: 'Linsen',
    entries: [{ au: 'Packung (teilbar)', factor: 500 }],
  },
  Olivenöl: {
    bu: 'ml',
    reorderPoint: 1000,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3.16227766 },
    ],
  },
  Apfelessig: {
    bu: 'ml',
    reorderPoint: 750,
    entries: [
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3 },
    ],
  },
  'Hokkaido-Kürbis': {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Stück (ZE zuerst)', factor: 1500 }],
  },
  Feta: {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (teilbar)', factor: 150 }],
  },
  Walnusskerne: {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (unteilbar)', factor: 200 }],
  },
  Ahornsirup: {
    bu: 'g',
    reorderPoint: 375,
    entries: [
      { au: 'Flasche', factor: 375 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3 },
    ],
  },
  Hackfleisch: {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
  'brauner Zucker': {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Esslöffel', factor: 13.33521432 },
      { au: 'Teelöffel', factor: 4.216965034 },
    ],
  },
  Gemüsebrühe: {
    bu: 'ml',
    reorderPoint: 0,
    entries: [
      { au: 'Glas', factor: 400 },
      { au: 'Esslöffel', factor: 10 },
      { au: 'Teelöffel', factor: 3 },
    ],
  },
  Reis: {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (halbierbar)', factor: 1000 }],
  },
  Rosinen: {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (halbierbar)', factor: 250 }],
  },
  Sojaschnetzel: {
    bu: 'g',
    reorderPoint: 0,
    entries: [{ au: 'Packung (halbierbar)', factor: 150 }],
  },
  Tahin: {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
  Süßkartoffeln: {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
  Tortillas: {
    bu: 'g',
    reorderPoint: 0,
    entries: [],
  },
};
