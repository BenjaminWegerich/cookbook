import { describe, expect, it } from 'vitest';

import type { IngredientMappings } from './ingredientRegistry.js';
import {
  mergeIngredientMasterData,
  parseIngredientListCsv,
  parseIngredientMappingsCsv,
  serializeIngredientListCsv,
  serializeIngredientMappingsCsv,
  splitIngredientMasterData,
  type IngredientList,
  type IngredientMappingsByIngredient,
} from './ingredientCsv.js';

/** The canonical ingredient list (docs format) as a fixture. */
const LIST_TEXT = [
  'Ingredient;Base Unit;Reorder Point',
  'Joghurt;g;0',
  'Zucker;g;1000',
  'Milch;ml;0',
  'Cashews;g;inf',
].join('\n');

const LIST: IngredientList = {
  Joghurt: { bu: 'g', reorderPoint: 0 },
  Zucker: { bu: 'g', reorderPoint: 1000 },
  Milch: { bu: 'ml', reorderPoint: 0 },
  Cashews: { bu: 'g', reorderPoint: Infinity },
};

/** The canonical AU mappings (docs format, dot decimals) as a fixture. */
const MAPPINGS_TEXT = [
  'Ingredient;Additional Unit;Conversion Factor;Priority',
  'Joghurt;Becher;400;1',
  'Joghurt;EL;24;2',
  'Zucker;EL;12;1',
  'Zucker;TL;4;2',
].join('\n');

const MAPPINGS: IngredientMappingsByIngredient = {
  Joghurt: [
    { au: 'Becher', factor: 400, priority: 1 },
    { au: 'EL', factor: 24, priority: 2 },
  ],
  Zucker: [
    { au: 'EL', factor: 12, priority: 1 },
    { au: 'TL', factor: 4, priority: 2 },
  ],
};

/** The merged registry shape: base unit + reorder point from the list, entries from the mappings. */
const MERGED: IngredientMappings = {
  Joghurt: {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Becher', factor: 400, priority: 1 },
      { au: 'EL', factor: 24, priority: 2 },
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
  Milch: { bu: 'ml', reorderPoint: 0, entries: [] },
  Cashews: { bu: 'g', reorderPoint: Infinity, entries: [] },
};

describe('parseIngredientListCsv', () => {
  it('parses the canonical format', () => {
    expect(parseIngredientListCsv(LIST_TEXT)).toEqual(LIST);
  });

  it('tolerates CRLF, blank lines, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${LIST_TEXT.replaceAll('\n', ';\r\n')}`;
    expect(parseIngredientListCsv(sloppy)).toEqual(LIST);
  });

  it('parses the legacy two-column header with the neutral reorder point 0', () => {
    // Files written before the reorder-point column existed keep loading; the
    // next serialization upgrades them (see the round-trip test below).
    const legacy = ['Ingredient;Base Unit', 'Joghurt;g', 'Zucker;g'].join('\n');
    expect(parseIngredientListCsv(legacy)).toEqual({
      Joghurt: { bu: 'g', reorderPoint: 0 },
      Zucker: { bu: 'g', reorderPoint: 0 },
    });
  });

  it('parses the infinity token case-insensitively', () => {
    expect(
      parseIngredientListCsv(`${LIST_TEXT.replace('Cashews;g;inf', 'Cashews;g;INF')}`),
    ).toEqual(LIST);
  });

  it('rejects an empty reorder point (the field is mandatory)', () => {
    expect(() => parseIngredientListCsv(LIST_TEXT.replace('Joghurt;g;0', 'Joghurt;g;'))).toThrow(
      /leerer Meldebestand/,
    );
  });

  it('rejects a negative or non-numeric reorder point', () => {
    expect(() => parseIngredientListCsv(LIST_TEXT.replace('Joghurt;g;0', 'Joghurt;g;-5'))).toThrow(
      /ungültiger Meldebestand/,
    );
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Joghurt;g;0', 'Joghurt;g;viel')),
    ).toThrow(/ungültiger Meldebestand/);
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseIngredientListCsv(`${LIST_TEXT}\nCashews;g;0;extra`)).toThrow(
      /unerwartete Spaltenzahl/,
    );
  });

  it('throws on an empty file', () => {
    expect(() => parseIngredientListCsv('')).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseIngredientListCsv('A;B\n1;2')).toThrow(/Kopfzeile/);
  });

  it('throws on an unknown base unit', () => {
    expect(() => parseIngredientListCsv(LIST_TEXT.replace('Cashews;g', 'Cashews;kg'))).toThrow(
      /unbekannte Basis-Einheit "kg"/,
    );
  });

  it('throws on a duplicate ingredient name', () => {
    expect(() => parseIngredientListCsv(`${LIST_TEXT}\nJoghurt;ml;0`)).toThrow(/doppelte Zutat/);
  });
});

describe('parseIngredientMappingsCsv', () => {
  it('parses the canonical format (dot decimals, priorities per row)', () => {
    expect(parseIngredientMappingsCsv(MAPPINGS_TEXT)).toEqual(MAPPINGS);
  });

  it('tolerates CRLF and one trailing empty cell per row', () => {
    const sloppy = MAPPINGS_TEXT.replaceAll(/([0-9])\n/g, '$1;\n').replaceAll('\n', '\r\n');
    expect(parseIngredientMappingsCsv(sloppy)).toEqual(MAPPINGS);
  });

  it('normalizes German comma decimals to dots', () => {
    const text = MAPPINGS_TEXT.replace('400;1', '400,0;1');
    expect(parseIngredientMappingsCsv(text).Joghurt?.[0]?.factor).toBe(400);
  });

  it('does not expect an exactness column (that flag lives on the units)', () => {
    // The exactness of a unit is master data of the unit itself
    // (docs/additional_units.csv, `Unit Exact`), not of the mapping: the file
    // stays a pure overlay and the serializer never adds such a column.
    const text = MAPPINGS_TEXT.replaceAll('400;1', '400;1;yes');
    expect(() => parseIngredientMappingsCsv(text)).toThrow(/unerwartete Spaltenzahl/);
    expect(serializeIngredientMappingsCsv(MAPPINGS)).not.toContain('yes');
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseIngredientMappingsCsv(`${MAPPINGS_TEXT}\nZucker;EL;12;1;extra`)).toThrow(
      /unerwartete Spaltenzahl/,
    );
  });

  it('throws on an empty file', () => {
    expect(() => parseIngredientMappingsCsv('')).toThrow(/leer/);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseIngredientMappingsCsv('A;B;C;D\n1;2;3;4')).toThrow(/Kopfzeile/);
  });

  it('throws on an unknown additional unit', () => {
    expect(() =>
      parseIngredientMappingsCsv(MAPPINGS_TEXT.replace('Joghurt;EL;24;2', 'Joghurt;Pfund;24;2')),
    ).toThrow(/unbekannte Zusatz-Einheit "Pfund"/);
  });

  it('throws on a non-positive factor', () => {
    expect(() =>
      parseIngredientMappingsCsv(MAPPINGS_TEXT.replace('Zucker;TL;4;2', 'Zucker;TL;0;2')),
    ).toThrow(/ungültiger Umrechnungsfaktor/);
  });

  it('throws on a duplicate unit per ingredient', () => {
    expect(() =>
      parseIngredientMappingsCsv(MAPPINGS_TEXT.replace('Zucker;TL;4;2', 'Zucker;EL;4;2')),
    ).toThrow(/doppelte Umrechnung/);
  });

  it('throws on a duplicate priority per ingredient', () => {
    expect(() =>
      parseIngredientMappingsCsv(MAPPINGS_TEXT.replace('Zucker;TL;4;2', 'Zucker;TL;4;1')),
    ).toThrow(/doppelte Priorität/);
  });

  it('throws on a non-integer priority', () => {
    expect(() =>
      parseIngredientMappingsCsv(MAPPINGS_TEXT.replace('Zucker;TL;4;2', 'Zucker;TL;4;1.5')),
    ).toThrow(/Priorität/);
  });
});

describe('mergeIngredientMasterData', () => {
  it('combines list and mappings into the registry shape', () => {
    expect(mergeIngredientMasterData(LIST, MAPPINGS)).toEqual(MERGED);
  });

  it('keeps ingredients from the list without mappings as bare entries', () => {
    const merged = mergeIngredientMasterData(LIST, MAPPINGS);
    expect(merged.Milch).toEqual({ bu: 'ml', reorderPoint: 0, entries: [] });
    expect(merged.Cashews).toEqual({ bu: 'g', reorderPoint: Infinity, entries: [] });
  });

  it('throws when a mapping references an ingredient that is not in the list', () => {
    const withOrphan = { ...MAPPINGS, Käse: [{ au: 'EL', factor: 12, priority: 1 }] };
    expect(() => mergeIngredientMasterData(LIST, withOrphan)).toThrow(/nicht in der Zutaten-Liste/);
  });
});

describe('serializeIngredientListCsv and serializeIngredientMappingsCsv', () => {
  it('write the canonical formats with a trailing newline', () => {
    expect(serializeIngredientListCsv(LIST)).toBe(`${LIST_TEXT}\n`);
    expect(serializeIngredientMappingsCsv(MAPPINGS)).toBe(`${MAPPINGS_TEXT}\n`);
    expect(serializeIngredientMappingsCsv(MAPPINGS)).not.toContain(',');
  });

  it('round-trip a parsed file byte-stable', () => {
    expect(serializeIngredientListCsv(parseIngredientListCsv(LIST_TEXT))).toBe(`${LIST_TEXT}\n`);
    expect(serializeIngredientMappingsCsv(parseIngredientMappingsCsv(MAPPINGS_TEXT))).toBe(
      `${MAPPINGS_TEXT}\n`,
    );
  });

  it('writes the canonical inf token for an infinite reorder point', () => {
    expect(serializeIngredientListCsv(LIST)).toContain('Cashews;g;inf');
    // A user typing the JavaScript spelling is not the canonical form.
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Cashews;g;inf', 'Cashews;g;Infinity')),
    ).toThrow(/ungültiger Meldebestand/);
  });

  it('upgrades a legacy two-column file to the three-column format', () => {
    const legacy = 'Ingredient;Base Unit\nJoghurt;g\n';
    expect(serializeIngredientListCsv(parseIngredientListCsv(legacy))).toBe(
      'Ingredient;Base Unit;Reorder Point\nJoghurt;g;0\n',
    );
  });
});

describe('splitIngredientMasterData (inverse of merge)', () => {
  it('round-trips the registry through both files', () => {
    const { list, mappings } = splitIngredientMasterData(MERGED);
    expect(list).toEqual(LIST);
    expect(mappings).toEqual(MAPPINGS);
    // split → serialize → parse → merge reproduces the registry exactly.
    const reparsed = mergeIngredientMasterData(
      parseIngredientListCsv(serializeIngredientListCsv(list)),
      parseIngredientMappingsCsv(serializeIngredientMappingsCsv(mappings)),
    );
    expect(reparsed).toEqual(MERGED);
  });
});
