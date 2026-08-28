/**
 * Tests for the standard time values (recipe editor stepper).
 *
 * The stepper values were agreed with the user: 1 / 3 / 5 / 10 / 15 / 20 /
 * 30 / 45 min, then 1 / 1.5 / 2 / 3 / 6 / 12 / 24 / 48 h.
 */

import { describe, expect, it } from 'vitest';

import { STANDARD_TIME_VALUES, formatTimeValue, parseTimeValue } from './timeValues.js';

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

  it('returns null for anything that is not a duration', () => {
    expect(parseTimeValue('')).toBeNull();
    expect(parseTimeValue('so lange wie nötig')).toBeNull();
    expect(parseTimeValue('-5 min')).toBeNull();
    expect(parseTimeValue('0 h')).toBeNull();
    expect(parseTimeValue('2.5')).toBeNull();
  });
});
