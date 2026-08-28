/**
 * Standard time values for the recipe editor (agreed with the user).
 *
 * `prep_time` and `total_time` are stored as free-text display values
 * (docs/storage_format.md §3, e.g. `25 min`, `1 h 30 min`), but the editor
 * offers them only as a stepper over these standard values — the same
 * "standard numbers only" idea as the quantity ladder
 * (docs/quantity_scaling.md §3), applied to durations.
 *
 * The minute values cover the cooking-relevant short range; the hour values
 * (including `1.5 h` for stews / overnight dishes) cover the long range.
 * A value outside this list can still exist in stored files (the format is
 * free text) — the editor shows it as a custom value and lets the user
 * replace it with a standard one.
 */

/** A standard duration: its length in minutes and the display label. */
export interface TimeValue {
  /** Total duration in minutes (e.g. 90 for "1 h 30 min"). */
  minutes: number;
  /** German display form, e.g. "45 min", "1 h 30 min", "2 h". */
  label: string;
}

/** Minute values below one hour: 1 / 3 / 5 / 10 / 15 / 20 / 30 / 45 min. */
const MINUTE_VALUES = [1, 3, 5, 10, 15, 20, 30, 45] as const;

/** Hour values: 1 / 1.5 / 2 / 3 / 6 / 12 / 24 / 48 h, as minutes. */
const HOUR_VALUES = [60, 90, 120, 180, 360, 720, 1440, 2880] as const;

/** The ordered standard durations (short to long). */
export const STANDARD_TIME_VALUES: readonly TimeValue[] = [
  ...MINUTE_VALUES.map((minutes) => ({ minutes, label: formatTimeValue(minutes) })),
  ...HOUR_VALUES.map((minutes) => ({ minutes, label: formatTimeValue(minutes) })),
];

/**
 * Formats a duration in minutes as the German display string used in the
 * storage format (§3): `45 min`, `1 h`, `1 h 30 min`, `2 h`.
 */
export function formatTimeValue(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Parses the German display forms the app itself writes (§3 examples:
 * `25 min`, `1 h 30 min`, plus `1.5 h`) into minutes, or returns null for
 * anything else (e.g. free text from a hand-written file).
 */
export function parseTimeValue(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') {
    return null;
  }
  // Compound "X h Y min" — the form the app writes for e.g. "1 h 30 min".
  const compound = /^(\d+)\s*h\s*(\d+)\s*min$/.exec(trimmed);
  if (compound !== null) {
    return Number(compound[1]) * 60 + Number(compound[2]);
  }
  // Integer minutes: "45 min".
  const minutes = /^(\d+)\s*min$/.exec(trimmed);
  if (minutes !== null) {
    return Number(minutes[1]);
  }
  // Hours, possibly fractional: "2 h", "1.5 h".
  const hours = /^(\d+(?:\.\d+)?)\s*h$/.exec(trimmed);
  if (hours !== null) {
    const total = Math.round(Number(hours[1]) * 60);
    return total > 0 ? total : null;
  }
  return null;
}
