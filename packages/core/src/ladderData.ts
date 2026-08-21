/**
 * AUTO-GENERATED from docs/standard_numbers.csv by scripts/generate-ladder.mjs.
 * Do not edit by hand — re-run 'npm run generate:ladder' (packages/core) after a CSV change.
 */

/** One rung of the quantity ladder (x = −16 … 48). */
export interface LadderRung {
  /** Step index; exact(x) = 10^(x/16). */
  readonly x: number;
  /** Geometric value 10^(x/16); defines the rung positions only. */
  readonly exact: number;
  /** Rounded decimal form, used for base quantities (g / kg / ml / l) and serving counts. */
  readonly bq: number;
  /** Rounded fraction form for additional-unit display, canonical notation (e.g. "1+1/4"). */
  readonly aq: string;
}

export const LADDER_RUNGS: readonly LadderRung[] = [
  { x: -16, exact: 0.1, bq: 0.1, aq: '1/10' },
  { x: -15, exact: 0.115, bq: 0.12, aq: '1/9' },
  { x: -14, exact: 0.133, bq: 0.15, aq: '1/8' },
  { x: -13, exact: 0.154, bq: 0.18, aq: '1/6' },
  { x: -12, exact: 0.178, bq: 0.2, aq: '1/6' },
  { x: -11, exact: 0.205, bq: 0.22, aq: '1/5' },
  { x: -10, exact: 0.237, bq: 0.25, aq: '1/4' },
  { x: -9, exact: 0.274, bq: 0.28, aq: '1/4' },
  { x: -8, exact: 0.316, bq: 0.3, aq: '1/3' },
  { x: -7, exact: 0.365, bq: 0.35, aq: '3/8' },
  { x: -6, exact: 0.422, bq: 0.4, aq: '2/5' },
  { x: -5, exact: 0.487, bq: 0.5, aq: '1/2' },
  { x: -4, exact: 0.562, bq: 0.6, aq: '3/5' },
  { x: -3, exact: 0.649, bq: 0.7, aq: '2/3' },
  { x: -2, exact: 0.75, bq: 0.8, aq: '3/4' },
  { x: -1, exact: 0.866, bq: 0.9, aq: '7/8' },
  { x: 0, exact: 1, bq: 1, aq: '1' },
  { x: 1, exact: 1.15, bq: 1.2, aq: '1+1/4' },
  { x: 2, exact: 1.33, bq: 1.5, aq: '1+1/2' },
  { x: 3, exact: 1.54, bq: 1.8, aq: '1+3/4' },
  { x: 4, exact: 1.78, bq: 2, aq: '2' },
  { x: 5, exact: 2.05, bq: 2.2, aq: '2+1/4' },
  { x: 6, exact: 2.37, bq: 2.5, aq: '2+1/2' },
  { x: 7, exact: 2.74, bq: 2.8, aq: '2+3/4' },
  { x: 8, exact: 3.16, bq: 3, aq: '3' },
  { x: 9, exact: 3.65, bq: 3.5, aq: '3+1/2' },
  { x: 10, exact: 4.22, bq: 4, aq: '4' },
  { x: 11, exact: 4.87, bq: 5, aq: '5' },
  { x: 12, exact: 5.62, bq: 6, aq: '6' },
  { x: 13, exact: 6.49, bq: 7, aq: '7' },
  { x: 14, exact: 7.5, bq: 8, aq: '8' },
  { x: 15, exact: 8.66, bq: 9, aq: '9' },
  { x: 16, exact: 10, bq: 10, aq: '10' },
  { x: 17, exact: 11.5, bq: 12, aq: '12' },
  { x: 18, exact: 13.3, bq: 15, aq: '15' },
  { x: 19, exact: 15.4, bq: 18, aq: '18' },
  { x: 20, exact: 17.8, bq: 20, aq: '20' },
  { x: 21, exact: 20.5, bq: 22, aq: '22' },
  { x: 22, exact: 23.7, bq: 25, aq: '25' },
  { x: 23, exact: 27.4, bq: 28, aq: '28' },
  { x: 24, exact: 31.6, bq: 30, aq: '30' },
  { x: 25, exact: 36.5, bq: 35, aq: '35' },
  { x: 26, exact: 42.2, bq: 40, aq: '40' },
  { x: 27, exact: 48.7, bq: 50, aq: '50' },
  { x: 28, exact: 56.2, bq: 60, aq: '60' },
  { x: 29, exact: 64.9, bq: 70, aq: '70' },
  { x: 30, exact: 75, bq: 80, aq: '80' },
  { x: 31, exact: 86.6, bq: 90, aq: '90' },
  { x: 32, exact: 100, bq: 100, aq: '100' },
  { x: 33, exact: 115, bq: 120, aq: '120' },
  { x: 34, exact: 133, bq: 150, aq: '150' },
  { x: 35, exact: 154, bq: 180, aq: '180' },
  { x: 36, exact: 178, bq: 200, aq: '200' },
  { x: 37, exact: 205, bq: 220, aq: '220' },
  { x: 38, exact: 237, bq: 250, aq: '250' },
  { x: 39, exact: 274, bq: 280, aq: '280' },
  { x: 40, exact: 316, bq: 300, aq: '300' },
  { x: 41, exact: 365, bq: 350, aq: '350' },
  { x: 42, exact: 422, bq: 400, aq: '400' },
  { x: 43, exact: 487, bq: 500, aq: '500' },
  { x: 44, exact: 562, bq: 600, aq: '600' },
  { x: 45, exact: 649, bq: 700, aq: '700' },
  { x: 46, exact: 750, bq: 800, aq: '800' },
  { x: 47, exact: 866, bq: 900, aq: '900' },
  { x: 48, exact: 1000, bq: 1000, aq: '1000' },
];
