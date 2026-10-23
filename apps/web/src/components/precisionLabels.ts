/**
 * German labels of the five precision levels (docs/CODING_CONVENTIONS.md: UI in
 * German).
 *
 * One source for both the precision chips and every read-only display of a
 * level (the quantity sheet's „Zutat-Standard“), so the wording cannot drift.
 * The labels follow the canonical order of PRECISION_LEVELS.
 */

import { type PrecisionLevel } from '@cookbook/core';

/** German label of each level. */
const LABELS: Record<PrecisionLevel, string> = {
  'very low': 'Sehr niedrig',
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  'very high': 'Sehr hoch',
};

/** The German label of one level, for chips and read-only displays. */
export function precisionLabel(level: PrecisionLevel): string {
  return LABELS[level];
}
