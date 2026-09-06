/**
 * Tests for the standard time values (recipe editor stepper).
 *
 * The stepper values were agreed with the user: 1 / 3 / 5 / 10 / 15 / 20 /
 * 30 / 45 min, then 1 / 1.5 / 2 / 3 / 6 / 12 / 24 / 48 h.
 */

import { describe, expect, it } from 'vitest';

import {
  STANDARD_TIME_VALUES,
  displayTimeText,
  formatTimeDisplay,
  formatTimeValue,
  parseTimeValue,
} from './timeValues.js';

/** Narrow no-break space (U+202F) — the display-time typography (§ rule). */
const NNBSP = '\u202F';

describe('STANDARD_TIME_VALUES', () => {
  it('offers the agreed minute and hour values in ascending order', () => {
    expect(STANDARD_TIME_VALUES.map((v) => v.minutes)).toEqual([
      1, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 360, 720, 1440, 2880,
    ]);
  });

  it('labels the values in German display form', () => {
    expect(STANDARD_TIME_VALUES.map((v) => v.label)).toEqual([
      '1 min',
      '3 min',
      '5 min',
      '10 min',
      '15 min',
      '20 min',
      '30 min',
      '45 min',
      '1 h',
      '1 h 30 min',
      '2 h',
      '3 h',
      '6 h',
      '12 h',
      '24 h',
      '48 h',
    ]);
  });
});

describe('formatTimeValue', () => {
  it('formats minutes below one hour', () => {
    expect(formatTimeValue(1)).toBe('1 min');
    expect(formatTimeValue(45)).toBe('45 min');
  });

  it('formats full hours', () => {
    expect(formatTimeValue(60)).toBe('1 h');
    expect(formatTimeValue(120)).toBe('2 h');
    expect(formatTimeValue(2880)).toBe('48 h');
  });

  it('formats hours with minutes as "X h Y min"', () => {
    expect(formatTimeValue(90)).toBe('1 h 30 min');
    expect(formatTimeValue(135)).toBe('2 h 15 min');
  });
});

describe('parseTimeValue', () => {
  it('parses the forms the app itself writes', () => {
    expect(parseTimeValue('45 min')).toBe(45);
    expect(parseTimeValue('1 h')).toBe(60);
    expect(parseTimeValue('1 h 30 min')).toBe(90);
    expect(parseTimeValue('2 h')).toBe(120);
    expect(parseTimeValue('1.5 h')).toBe(90);
  });

  it('is case- and space-insensitive', () => {
    expect(parseTimeValue(' 25 MIN ')).toBe(25);
    expect(parseTimeValue('1H30Min')).toBe(90);
  });

  it('tolerates narrow no-break spaces pasted into a file', () => {
    expect(parseTimeValue(`25${NNBSP}min`)).toBe(25);
    expect(parseTimeValue(`1${NNBSP}h${NNBSP}30${NNBSP}min`)).toBe(90);
  });

  it('returns null for anything that is not a duration', () => {
    expect(parseTimeValue('')).toBeNull();
    expect(parseTimeValue('so lange wie nötig')).toBeNull();
    expect(parseTimeValue('-5 min')).toBeNull();
    expect(parseTimeValue('0 h')).toBeNull();
    expect(parseTimeValue('2.5')).toBeNull();
  });
});

describe('formatTimeDisplay', () => {
  it('separates every number/unit gap with a narrow no-break space', () => {
    expect(formatTimeDisplay(45)).toBe(`45${NNBSP}min`);
    expect(formatTimeDisplay(60)).toBe(`1${NNBSP}h`);
    // Compound durations are unbreakable: "1 h 30 min" binds h–30 too.
    expect(formatTimeDisplay(90)).toBe(`1${NNBSP}h${NNBSP}30${NNBSP}min`);
    expect(formatTimeDisplay(135)).toBe(`2${NNBSP}h${NNBSP}15${NNBSP}min`);
    expect(formatTimeDisplay(2880)).toBe(`48${NNBSP}h`);
  });

  it('is never stored — equals formatTimeValue up to the spacing', () => {
    // The storage string stays plain; only the display swaps the spaces.
    expect(formatTimeValue(90)).toBe('1 h 30 min');
    expect(formatTimeDisplay(90)).not.toBe(formatTimeValue(90));
  });
});

describe('displayTimeText', () => {
  it('re-formats canonical stored values for display', () => {
    expect(displayTimeText('25 min')).toBe(`25${NNBSP}min`);
    expect(displayTimeText('1 h 30 min')).toBe(`1${NNBSP}h${NNBSP}30${NNBSP}min`);
  });

  it('shows hand-written free text verbatim', () => {
    expect(displayTimeText('über Nacht')).toBe('über Nacht');
    expect(displayTimeText('ca. 2 h')).toBe('ca. 2 h');
    expect(displayTimeText('')).toBe('');
  });
});
