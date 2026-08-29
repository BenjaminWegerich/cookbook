import { describe, expect, it } from 'vitest';

import type { IngredientMappings } from './ingredientRegistry.js';
import { parseIngredientMappingsCsv, serializeIngredientMappingsCsv } from './ingredientCsv.js';

/** The canonical docs format (dot decimals) as a fixture. */
const CANONICAL_TEXT = [
  'Ingredient;Base Unit;Additional Unit;Conversion Factor;Priority',
  'Joghurt;g;Becher;400;1',
  'Joghurt;g;EL;24;2',
  'Joghurt;g;TL;7.5;3',
  'Zucker;g;EL;12;1',
  'Zucker;g;TL;4;2',
  'Milch;ml;Becher;250;1',
].join('\n');

const CANONICAL_MAPPINGS: IngredientMappings = {
  Joghurt: [
    { bu: 'g', au: 'Becher', factor: 400, priority: 1 },
    { bu: 'g', au: 'EL', factor: 24, priority: 2 },
    { bu: 'g', au: 'TL', factor: 7.5, priority: 3 },
  ],
  Zucker: [
    { bu: 'g', au: 'EL', factor: 12, priority: 1 },
    { bu: 'g', au: 'TL', factor: 4, priority: 2 },
  ],
  Milch: [{ bu: 'ml', au: 'Becher', factor: 250, priority: 1 }],
};

describe('parseIngredientMappingsCsv', () => {
  it('parses the canonical format (dot decimals, priorities per row)', () => {
    expect(parseIngredientMappingsCsv(CANONICAL_TEXT)).toEqual(CANONICAL_MAPPINGS);
  });

  it('tolerates CRLF, blank lines and one trailing empty cell per row', () => {
    const sloppy = CANONICAL_TEXT.replaceAll(/([0-9])\n/g, '$1;\n').replaceAll('\n', '\r\n');
    expect(parseIngredientMappingsCsv(sloppy)).toEqual(CANONICAL_MAPPINGS);
  });

  it('normalizes German comma decimals to dots', () => {
    const text = CANONICAL_TEXT.replace('7.5', '7,5');
    expect(parseIngredientMappingsCsv(text).Joghurt?.[2]?.factor).toBe(7.5);
  });

  it('strips a leading UTF-8 BOM (spreadsheet exports)', () => {
    expect(parseIngredientMappingsCsv(`\uFEFF${CANONICAL_TEXT}`)).toEqual(CANONICAL_MAPPINGS);
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseIngredientMappingsCsv(`${CANONICAL_TEXT}\nZucker;g;EL;12;1;extra`)).toThrow(
      /unerwartete Spaltenzahl/,
    );
  });

  it('throws on an empty file', () => {
    expect(() => parseIngredientMappingsCsv('')).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseIngredientMappingsCsv('A;B;C;D;E\n1;2;3;4;5')).toThrow(/Kopfzeile/);
  });

  it('throws on an unknown additional unit', () => {
    expect(() =>
      parseIngredientMappingsCsv(
        CANONICAL_TEXT.replace('Joghurt;g;EL;24;2', 'Joghurt;g;Pfund;24;2'),
      ),
    ).toThrow(/unbekannte Zusatz-Einheit "Pfund"/);
  });

  it('throws on an invalid base unit', () => {
    expect(() =>
      parseIngredientMappingsCsv(CANONICAL_TEXT.replace('Zucker;g;EL;12;1', 'Zucker;kg;EL;12;1')),
    ).toThrow(/unbekannte Basis-Einheit "kg"/);
  });

  it('throws on a non-positive factor', () => {
    expect(() =>
      parseIngredientMappingsCsv(CANONICAL_TEXT.replace('Zucker;g;TL;4;2', 'Zucker;g;TL;0;2')),
    ).toThrow(/ungültiger Umrechnungsfaktor/);
  });

  it('throws on a duplicate unit per ingredient', () => {
    expect(() =>
      parseIngredientMappingsCsv(CANONICAL_TEXT.replace('Zucker;g;TL;4;2', 'Zucker;g;EL;4;2')),
    ).toThrow(/doppelte Umrechnung/);
  });

  it('throws on a duplicate priority per ingredient', () => {
    expect(() =>
      parseIngredientMappingsCsv(CANONICAL_TEXT.replace('Zucker;g;TL;4;2', 'Zucker;g;TL;4;1')),
    ).toThrow(/doppelte Priorität/);
  });

  it('throws on a non-integer priority', () => {
    expect(() =>
      parseIngredientMappingsCsv(CANONICAL_TEXT.replace('Zucker;g;TL;4;2', 'Zucker;g;TL;4;1.5')),
    ).toThrow(/Priorität/);
  });
});

describe('serializeIngredientMappingsCsv', () => {
  it('writes the canonical format with dot decimals and a trailing newline', () => {
    const expected = `${CANONICAL_TEXT}\n`;
    expect(serializeIngredientMappingsCsv(CANONICAL_MAPPINGS)).toBe(expected);
    expect(serializeIngredientMappingsCsv(CANONICAL_MAPPINGS)).not.toContain(',');
  });

  it('round-trips through the parser', () => {
    const text = serializeIngredientMappingsCsv(CANONICAL_MAPPINGS);
    expect(parseIngredientMappingsCsv(text)).toEqual(CANONICAL_MAPPINGS);
  });

  it('round-trips a parsed file byte-stable', () => {
    const parsed = parseIngredientMappingsCsv(CANONICAL_TEXT);
    expect(serializeIngredientMappingsCsv(parsed)).toBe(`${CANONICAL_TEXT}\n`);
  });
});
