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
  'Ingredient;Singular;Plural;Base Unit;Tolerance;Reorder Point',
  'Joghurt;;;g;;0',
  'Zucker;;;g;0.25;1000',
  'Milch;;;ml;;0',
  'Cashews;Cashew;Cashews;g;;inf',
].join('\n');

const LIST: IngredientList = {
  Joghurt: { bu: 'g', reorderPoint: 0 },
  Zucker: { bu: 'g', reorderPoint: 1000, tolerance: 0.25 },
  Milch: { bu: 'ml', reorderPoint: 0 },
  Cashews: { bu: 'g', reorderPoint: Infinity, singular: 'Cashew', plural: 'Cashews' },
};

/** The canonical AU mappings (docs format, dot decimals) as a fixture. */
const MAPPINGS_TEXT = [
  'Ingredient;Additional Unit;Conversion Factor',
  'Joghurt;Becher;500',
  'Joghurt;Esslöffel;23.71373706',
  'Zucker;Esslöffel;13.33521432',
  'Zucker;Teelöffel;4.216965034',
].join('\n');

const MAPPINGS: IngredientMappingsByIngredient = {
  Joghurt: [
    { au: 'Becher', factor: 500 },
    { au: 'Esslöffel', factor: 23.71373706 },
  ],
  Zucker: [
    { au: 'Esslöffel', factor: 13.33521432 },
    { au: 'Teelöffel', factor: 4.216965034 },
  ],
};

/** The merged registry shape: base unit + reorder point from the list, entries from the mappings. */
const MERGED: IngredientMappings = {
  Joghurt: {
    bu: 'g',
    reorderPoint: 0,
    entries: [
      { au: 'Becher', factor: 500 },
      { au: 'Esslöffel', factor: 23.71373706 },
    ],
  },
  Zucker: {
    bu: 'g',
    reorderPoint: 1000,
    tolerance: 0.25,
    entries: [
      { au: 'Esslöffel', factor: 13.33521432 },
      { au: 'Teelöffel', factor: 4.216965034 },
    ],
  },
  Milch: { bu: 'ml', reorderPoint: 0, entries: [] },
  Cashews: { bu: 'g', reorderPoint: Infinity, singular: 'Cashew', plural: 'Cashews', entries: [] },
};

describe('parseIngredientListCsv', () => {
  it('parses the canonical format including the optional tolerance', () => {
    expect(parseIngredientListCsv(LIST_TEXT)).toEqual(LIST);
  });

  it('tolerates CRLF, blank lines, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${LIST_TEXT.replaceAll('\n', ';\r\n')}`;
    expect(parseIngredientListCsv(sloppy)).toEqual(LIST);
  });

  it('parses the display forms of a name with a count form; invariant names carry none', () => {
    expect(parseIngredientListCsv(LIST_TEXT).Cashews).toEqual({
      bu: 'g',
      reorderPoint: Infinity,
      singular: 'Cashew',
      plural: 'Cashews',
    });
    expect(parseIngredientListCsv(LIST_TEXT).Zucker).not.toHaveProperty('singular');
    expect(parseIngredientListCsv(LIST_TEXT).Zucker).not.toHaveProperty('plural');
  });

  it('rejects a half-filled Singular/Plural pair', () => {
    expect(() =>
      parseIngredientListCsv(
        LIST_TEXT.replace('Cashews;Cashew;Cashews;g;;inf', 'Cashews;Cashew;;g;;inf'),
      ),
    ).toThrow(/unvollständiges Singular\/Plural-Paar/);
    expect(() =>
      parseIngredientListCsv(
        LIST_TEXT.replace('Cashews;Cashew;Cashews;g;;inf', 'Cashews;;Cashews;g;;inf'),
      ),
    ).toThrow(/unvollständiges Singular\/Plural-Paar/);
  });

  it('parses the pre-tolerance five-column header with no tolerance', () => {
    const legacy = [
      'Ingredient;Singular;Plural;Base Unit;Reorder Point',
      'Joghurt;;;g;0',
      'Zucker;;;g;1000',
    ].join('\n');
    expect(parseIngredientListCsv(legacy)).toEqual({
      Joghurt: { bu: 'g', reorderPoint: 0 },
      Zucker: { bu: 'g', reorderPoint: 1000 },
    });
  });

  it('parses the legacy three-column header with invariant names', () => {
    const legacy = ['Ingredient;Base Unit;Reorder Point', 'Joghurt;g;0', 'Zucker;g;1000'].join(
      '\n',
    );
    expect(parseIngredientListCsv(legacy)).toEqual({
      Joghurt: { bu: 'g', reorderPoint: 0 },
      Zucker: { bu: 'g', reorderPoint: 1000 },
    });
  });

  it('parses the legacy two-column header with the neutral reorder point 0', () => {
    const legacy = ['Ingredient;Base Unit', 'Joghurt;g', 'Zucker;g'].join('\n');
    expect(parseIngredientListCsv(legacy)).toEqual({
      Joghurt: { bu: 'g', reorderPoint: 0 },
      Zucker: { bu: 'g', reorderPoint: 0 },
    });
  });

  it('parses the infinity token case-insensitively', () => {
    expect(
      parseIngredientListCsv(
        LIST_TEXT.replace('Cashews;Cashew;Cashews;g;;inf', 'Cashews;Cashew;Cashews;g;;INF'),
      ),
    ).toEqual(LIST);
  });

  it('rejects an empty or invalid tolerance', () => {
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Zucker;;;g;0.25;1000', 'Zucker;;;g;1.5;1000')),
    ).toThrow(/ungültige Toleranz/);
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Zucker;;;g;0.25;1000', 'Zucker;;;g;viel;1000')),
    ).toThrow(/ungültige Toleranz/);
  });

  it('rejects an empty reorder point (the field is mandatory)', () => {
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Joghurt;;;g;;0', 'Joghurt;;;g;;')),
    ).toThrow(/leerer Meldebestand/);
  });

  it('rejects a negative or non-numeric reorder point', () => {
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Joghurt;;;g;;0', 'Joghurt;;;g;;-5')),
    ).toThrow(/ungültiger Meldebestand/);
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Joghurt;;;g;;0', 'Joghurt;;;g;;viel')),
    ).toThrow(/ungültiger Meldebestand/);
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseIngredientListCsv(`${LIST_TEXT}\nCashews;;;g;;0;extra`)).toThrow(
      /unerwartete Spaltenzahl/,
    );
  });

  it('throws on an empty file or an unexpected header', () => {
    expect(() => parseIngredientListCsv('')).toThrow(/leer/);
    expect(() => parseIngredientListCsv('A;B\n1;2')).toThrow(/Kopfzeile/);
  });

  it('throws on an unknown base unit or a duplicate ingredient', () => {
    expect(() => parseIngredientListCsv(LIST_TEXT.replace(';g;;inf', ';kg;;inf'))).toThrow(
      /unbekannte Basis-Einheit "kg"/,
    );
    expect(() => parseIngredientListCsv(`${LIST_TEXT}\nJoghurt;;;ml;;0`)).toThrow(/doppelte Zutat/);
  });
});

describe('parseIngredientMappingsCsv', () => {
  it('parses the canonical format (no priority column)', () => {
    expect(parseIngredientMappingsCsv(MAPPINGS_TEXT)).toEqual(MAPPINGS);
  });

  it('tolerates CRLF and one trailing empty cell per row', () => {
    const sloppy = MAPPINGS_TEXT.replaceAll(/([0-9])\n/g, '$1;\n').replaceAll('\n', '\r\n');
    expect(parseIngredientMappingsCsv(sloppy)).toEqual(MAPPINGS);
  });

  it('normalizes German comma decimals to dots', () => {
    const text = MAPPINGS_TEXT.replace('500\n', '500,0\n');
    expect(parseIngredientMappingsCsv(text).Joghurt?.[0]?.factor).toBe(500);
  });

  it('parses a legacy file with the obsolete Priority column and ignores it', () => {
    const legacy = [
      'Ingredient;Additional Unit;Conversion Factor;Priority',
      'Joghurt;Becher;500;1',
      'Zucker;Esslöffel;13.33521432;2',
    ].join('\n');
    expect(parseIngredientMappingsCsv(legacy)).toEqual({
      Joghurt: [{ au: 'Becher', factor: 500 }],
      Zucker: [{ au: 'Esslöffel', factor: 13.33521432 }],
    });
  });

  it('throws on a row with too many columns', () => {
    expect(() =>
      parseIngredientMappingsCsv(`${MAPPINGS_TEXT}\nZucker;Esslöffel;12;1`),
    ).toThrow(/unerwartete Spaltenzahl/);
  });

  it('throws on an empty file or an unexpected header', () => {
    expect(() => parseIngredientMappingsCsv('')).toThrow(/leer/);
    expect(() => parseIngredientMappingsCsv('A;B;C;D\n1;2;3;4')).toThrow(/Kopfzeile/);
  });

  it('throws on an unknown additional unit', () => {
    expect(() =>
      parseIngredientMappingsCsv(MAPPINGS_TEXT.replace('Joghurt;Esslöffel', 'Joghurt;Pfund')),
    ).toThrow(/unbekannte Zusatz-Einheit "Pfund"/);
  });

  it('throws on a non-positive factor', () => {
    expect(() =>
      parseIngredientMappingsCsv(MAPPINGS_TEXT.replace('Zucker;Teelöffel;4.216965034', 'Zucker;Teelöffel;0')),
    ).toThrow(/ungültiger Umrechnungsfaktor/);
  });

  it('throws on a duplicate unit per ingredient', () => {
    expect(() =>
      parseIngredientMappingsCsv(
        MAPPINGS_TEXT.replace('Zucker;Teelöffel;4.216965034', 'Zucker;Esslöffel;4.216965034'),
      ),
    ).toThrow(/doppelte Umrechnung/);
  });

  it('throws when an ingredient maps to two shopping units', () => {
    const text = [
      'Ingredient;Additional Unit;Conversion Factor',
      'Mehl;Packung (unteilbar);1000',
      'Mehl;Becher;500',
    ].join('\n');
    expect(() => parseIngredientMappingsCsv(text)).toThrow(/mehr als eine Einkaufs-Einheit/);
  });
});

describe('comma-separated spreadsheet exports', () => {
  it('parses a comma-separated mappings file', () => {
    expect(parseIngredientMappingsCsv(MAPPINGS_TEXT.replaceAll(';', ','))).toEqual(MAPPINGS);
  });

  it('parses a comma-separated ingredient-list file', () => {
    expect(parseIngredientListCsv(LIST_TEXT.replaceAll(';', ','))).toEqual(LIST);
  });

  it('keeps a quoted German decimal comma inside its cell', () => {
    const comma = [
      'Ingredient,Additional Unit,Conversion Factor',
      'Joghurt,Becher,"1,5"',
    ].join('\n');
    expect(parseIngredientMappingsCsv(comma)).toEqual({
      Joghurt: [{ au: 'Becher', factor: 1.5 }],
    });
  });

  it('reads quoted header cells and a trailing empty cell like a spreadsheet writes them', () => {
    const comma = [
      '"Ingredient","Additional Unit","Conversion Factor",',
      'Joghurt,Becher,500,',
    ].join('\n');
    expect(parseIngredientMappingsCsv(comma)).toEqual({
      Joghurt: [{ au: 'Becher', factor: 500 }],
    });
  });

  it('writes the canonical semicolon form again after reading a comma file', () => {
    expect(
      serializeIngredientMappingsCsv(
        parseIngredientMappingsCsv(MAPPINGS_TEXT.replaceAll(';', ',')),
      ),
    ).toBe(`${MAPPINGS_TEXT}\n`);
    expect(serializeIngredientListCsv(parseIngredientListCsv(LIST_TEXT.replaceAll(';', ',')))).toBe(
      `${LIST_TEXT}\n`,
    );
  });
});

describe('mergeIngredientMasterData', () => {
  it('combines list and mappings into the registry shape', () => {
    expect(mergeIngredientMasterData(LIST, MAPPINGS)).toEqual(MERGED);
  });

  it('keeps ingredients from the list without mappings as bare entries', () => {
    const merged = mergeIngredientMasterData(LIST, MAPPINGS);
    expect(merged.Milch).toEqual({ bu: 'ml', reorderPoint: 0, entries: [] });
    expect(merged.Cashews).toEqual({
      bu: 'g',
      reorderPoint: Infinity,
      singular: 'Cashew',
      plural: 'Cashews',
      entries: [],
    });
  });

  it('throws when a mapping references an ingredient that is not in the list', () => {
    const withOrphan = { ...MAPPINGS, Käse: [{ au: 'Esslöffel', factor: 12 }] };
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
    expect(serializeIngredientListCsv(LIST)).toContain('Cashews;Cashew;Cashews;g;;inf');
    expect(() =>
      parseIngredientListCsv(
        LIST_TEXT.replace('Cashews;Cashew;Cashews;g;;inf', 'Cashews;Cashew;Cashews;g;;Infinity'),
      ),
    ).toThrow(/ungültiger Meldebestand/);
  });

  it('upgrades a legacy three-column file to the current six-column format', () => {
    const legacy = 'Ingredient;Base Unit;Reorder Point\nJoghurt;g;0\n';
    expect(serializeIngredientListCsv(parseIngredientListCsv(legacy))).toBe(
      'Ingredient;Singular;Plural;Base Unit;Tolerance;Reorder Point\nJoghurt;;;g;;0\n',
    );
  });

  it('upgrades a legacy two-column file to the current six-column format', () => {
    const legacy = 'Ingredient;Base Unit\nJoghurt;g\n';
    expect(serializeIngredientListCsv(parseIngredientListCsv(legacy))).toBe(
      'Ingredient;Singular;Plural;Base Unit;Tolerance;Reorder Point\nJoghurt;;;g;;0\n',
    );
  });
});

describe('splitIngredientMasterData (inverse of merge)', () => {
  it('round-trips the registry through both files', () => {
    const { list, mappings } = splitIngredientMasterData(MERGED);
    expect(list).toEqual(LIST);
    expect(mappings).toEqual(MAPPINGS);
    const reparsed = mergeIngredientMasterData(
      parseIngredientListCsv(serializeIngredientListCsv(list)),
      parseIngredientMappingsCsv(serializeIngredientMappingsCsv(mappings)),
    );
    expect(reparsed).toEqual(MERGED);
  });
});
