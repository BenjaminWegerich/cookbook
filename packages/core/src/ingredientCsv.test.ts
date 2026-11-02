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
  'Ingredient;Singular;Plural;Base Unit;Precision;Reorder Point',
  'Joghurt;;;g;medium;0',
  'Zucker;;;g;high;1000',
  'Milch;;;ml;very low;0',
  'Cashews;Cashew;Cashews;g;low;inf',
].join('\n');

const LIST: IngredientList = {
  Joghurt: { bu: 'g', precision: 'medium', reorderPoint: 0 },
  Zucker: { bu: 'g', precision: 'high', reorderPoint: 1000 },
  Milch: { bu: 'ml', precision: 'very low', reorderPoint: 0 },
  Cashews: {
    bu: 'g',
    precision: 'low',
    reorderPoint: Infinity,
    singular: 'Cashew',
    plural: 'Cashews',
  },
};

/** The canonical AU mappings (docs format, dot decimals) as a fixture. */
const MAPPINGS_TEXT = [
  'Ingredient;Additional Unit;Conversion Factor;Shopping Unit',
  'Joghurt;Becher;500;yes',
  'Joghurt;Esslöffel;23.71373706;no',
  'Zucker;Esslöffel;13.33521432;no',
  'Zucker;Teelöffel;4.216965034;no',
].join('\n');

const MAPPINGS: IngredientMappingsByIngredient = {
  Joghurt: [
    { au: 'Becher', factor: 500, shoppingUnit: true },
    { au: 'Esslöffel', factor: 23.71373706, shoppingUnit: false },
  ],
  Zucker: [
    { au: 'Esslöffel', factor: 13.33521432, shoppingUnit: false },
    { au: 'Teelöffel', factor: 4.216965034, shoppingUnit: false },
  ],
};

/** The merged registry shape: base unit + reorder point from the list, entries from the mappings. */
const MERGED: IngredientMappings = {
  Joghurt: {
    bu: 'g',
    precision: 'medium',
    reorderPoint: 0,
    entries: [
      { au: 'Becher', factor: 500, shoppingUnit: true },
      { au: 'Esslöffel', factor: 23.71373706, shoppingUnit: false },
    ],
  },
  Zucker: {
    bu: 'g',
    precision: 'high',
    reorderPoint: 1000,
    entries: [
      { au: 'Esslöffel', factor: 13.33521432, shoppingUnit: false },
      { au: 'Teelöffel', factor: 4.216965034, shoppingUnit: false },
    ],
  },
  Milch: { bu: 'ml', precision: 'very low', reorderPoint: 0, entries: [] },
  Cashews: {
    bu: 'g',
    precision: 'low',
    reorderPoint: Infinity,
    singular: 'Cashew',
    plural: 'Cashews',
    entries: [],
  },
};

describe('parseIngredientListCsv', () => {
  it('parses the canonical format including the mandatory precision', () => {
    expect(parseIngredientListCsv(LIST_TEXT)).toEqual(LIST);
  });

  it('tolerates CRLF, blank lines, a trailing empty cell and a leading BOM', () => {
    const sloppy = `\uFEFF${LIST_TEXT.replaceAll('\n', ';\r\n')}`;
    expect(parseIngredientListCsv(sloppy)).toEqual(LIST);
  });

  it('parses the display forms of a name with a count form; invariant names carry none', () => {
    expect(parseIngredientListCsv(LIST_TEXT).Cashews).toEqual({
      bu: 'g',
      precision: 'low',
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
        LIST_TEXT.replace('Cashews;Cashew;Cashews;g;low;inf', 'Cashews;Cashew;;g;low;inf'),
      ),
    ).toThrow(/unvollständiges Singular\/Plural-Paar/);
    expect(() =>
      parseIngredientListCsv(
        LIST_TEXT.replace('Cashews;Cashew;Cashews;g;low;inf', 'Cashews;;Cashews;g;low;inf'),
      ),
    ).toThrow(/unvollständiges Singular\/Plural-Paar/);
  });

  it('rejects older headers without the mandatory Precision column', () => {
    const legacy = ['Ingredient;Singular;Plural;Base Unit;Reorder Point', 'Joghurt;;;g;0'].join(
      '\n',
    );
    expect(() => parseIngredientListCsv(legacy)).toThrow(/Kopfzeile/);
  });

  it('parses the infinity token case-insensitively', () => {
    expect(
      parseIngredientListCsv(
        LIST_TEXT.replace('Cashews;Cashew;Cashews;g;low;inf', 'Cashews;Cashew;Cashews;g;low;INF'),
      ),
    ).toEqual(LIST);
  });

  it('rejects an empty or invalid precision', () => {
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Zucker;;;g;high;1000', 'Zucker;;;g;;1000')),
    ).toThrow(/leerer Precision-Wert/);
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Zucker;;;g;high;1000', 'Zucker;;;g;0.5;1000')),
    ).toThrow(/ungültiger Precision-Wert/);
  });

  it('rejects an empty reorder point (the field is mandatory)', () => {
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Joghurt;;;g;medium;0', 'Joghurt;;;g;medium;')),
    ).toThrow(/leerer Meldebestand/);
  });

  it('rejects a negative or non-numeric reorder point', () => {
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Joghurt;;;g;medium;0', 'Joghurt;;;g;medium;-5')),
    ).toThrow(/ungültiger Meldebestand/);
    expect(() =>
      parseIngredientListCsv(LIST_TEXT.replace('Joghurt;;;g;medium;0', 'Joghurt;;;g;medium;viel')),
    ).toThrow(/ungültiger Meldebestand/);
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseIngredientListCsv(`${LIST_TEXT}\nCashews;;;g;low;0;extra`)).toThrow(
      /unerwartete Spaltenzahl/,
    );
  });

  it('throws on an empty file or an unexpected header', () => {
    expect(() => parseIngredientListCsv('')).toThrow(/leer/);
    expect(() => parseIngredientListCsv('A;B\n1;2')).toThrow(/Kopfzeile/);
  });

  it('throws on an unknown base unit or a duplicate ingredient', () => {
    expect(() => parseIngredientListCsv(LIST_TEXT.replace(';g;low;inf', ';kg;low;inf'))).toThrow(
      /unbekannte Basis-Einheit "kg"/,
    );
    expect(() => parseIngredientListCsv(`${LIST_TEXT}\nJoghurt;;;ml;medium;0`)).toThrow(
      /doppelte Zutat/,
    );
  });
});

describe('parseIngredientMappingsCsv', () => {
  it('parses the canonical format with the per-mapping shopping flag', () => {
    expect(parseIngredientMappingsCsv(MAPPINGS_TEXT)).toEqual(MAPPINGS);
  });

  it('tolerates CRLF and one trailing empty cell per row', () => {
    const sloppy = MAPPINGS_TEXT.replaceAll(/([a-z])\n/g, '$1;\n').replaceAll('\n', '\r\n');
    expect(parseIngredientMappingsCsv(sloppy)).toEqual(MAPPINGS);
  });

  it('normalizes German comma decimals to dots', () => {
    const text = MAPPINGS_TEXT.replace('500;', '500,0;');
    expect(parseIngredientMappingsCsv(text).Joghurt?.[0]?.factor).toBe(500);
  });

  it('keeps the same unit a purchase unit for one ingredient and a measure for another', () => {
    // The requirement behind the per-mapping flag: „Stück“ is how carrots are
    // bought, but a clove of garlic is only a recipe measure.
    const text = [
      'Ingredient;Additional Unit;Conversion Factor;Shopping Unit',
      'Karotten;Stück (ZE zuerst);62.1;yes',
      'frischer Knoblauch;Stück (ZE zuerst);4;no',
    ].join('\n');
    expect(parseIngredientMappingsCsv(text)).toEqual({
      Karotten: [{ au: 'Stück (ZE zuerst)', factor: 62.1, shoppingUnit: true }],
      'frischer Knoblauch': [{ au: 'Stück (ZE zuerst)', factor: 4, shoppingUnit: false }],
    });
  });

  it('throws on an empty or invalid shopping flag', () => {
    expect(() =>
      parseIngredientMappingsCsv(
        MAPPINGS_TEXT.replace('Joghurt;Becher;500;yes', 'Joghurt;Becher;500;'),
      ),
    ).toThrow(/ungültiger Einkaufs-Wert/);
    expect(() =>
      parseIngredientMappingsCsv(
        MAPPINGS_TEXT.replace('Joghurt;Becher;500;yes', 'Joghurt;Becher;500;vielleicht'),
      ),
    ).toThrow(/ungültiger Einkaufs-Wert/);
  });

  it('parses a legacy flagless file with the retired unit-level flag', () => {
    const legacy = [
      'Ingredient;Additional Unit;Conversion Factor',
      'Joghurt;Becher;500',
      'Zucker;Esslöffel;13.33521432',
    ].join('\n');
    expect(parseIngredientMappingsCsv(legacy)).toEqual({
      Joghurt: [{ au: 'Becher', factor: 500, shoppingUnit: true }],
      Zucker: [{ au: 'Esslöffel', factor: 13.33521432, shoppingUnit: false }],
    });
  });

  it('parses a legacy file with the obsolete Priority column and ignores it', () => {
    const legacy = [
      'Ingredient;Additional Unit;Conversion Factor;Priority',
      'Joghurt;Becher;500;1',
      'Zucker;Esslöffel;13.33521432;2',
    ].join('\n');
    expect(parseIngredientMappingsCsv(legacy)).toEqual({
      Joghurt: [{ au: 'Becher', factor: 500, shoppingUnit: true }],
      Zucker: [{ au: 'Esslöffel', factor: 13.33521432, shoppingUnit: false }],
    });
  });

  it('throws on a row with too many columns', () => {
    expect(() => parseIngredientMappingsCsv(`${MAPPINGS_TEXT}\nZucker;Esslöffel;12;no;1`)).toThrow(
      /unerwartete Spaltenzahl/,
    );
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
      parseIngredientMappingsCsv(
        MAPPINGS_TEXT.replace('Zucker;Teelöffel;4.216965034', 'Zucker;Teelöffel;0'),
      ),
    ).toThrow(/ungültiger Umrechnungsfaktor/);
  });

  it('throws on a duplicate unit per ingredient', () => {
    expect(() =>
      parseIngredientMappingsCsv(
        MAPPINGS_TEXT.replace('Zucker;Teelöffel;4.216965034', 'Zucker;Esslöffel;4.216965034'),
      ),
    ).toThrow(/doppelte Umrechnung/);
  });

  it('throws when an ingredient marks two shopping units', () => {
    const text = [
      'Ingredient;Additional Unit;Conversion Factor;Shopping Unit',
      'Mehl;Packung (unteilbar);1000;yes',
      'Mehl;Becher;500;yes',
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
      'Ingredient,Additional Unit,Conversion Factor,Shopping Unit',
      'Joghurt,Becher,"1,5",yes',
    ].join('\n');
    expect(parseIngredientMappingsCsv(comma)).toEqual({
      Joghurt: [{ au: 'Becher', factor: 1.5, shoppingUnit: true }],
    });
  });

  it('reads quoted header cells and a trailing empty cell like a spreadsheet writes them', () => {
    const comma = [
      '"Ingredient","Additional Unit","Conversion Factor","Shopping Unit",',
      'Joghurt,Becher,500,yes,',
    ].join('\n');
    expect(parseIngredientMappingsCsv(comma)).toEqual({
      Joghurt: [{ au: 'Becher', factor: 500, shoppingUnit: true }],
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
    expect(merged.Milch).toEqual({ bu: 'ml', precision: 'very low', reorderPoint: 0, entries: [] });
    expect(merged.Cashews).toEqual({
      bu: 'g',
      precision: 'low',
      reorderPoint: Infinity,
      singular: 'Cashew',
      plural: 'Cashews',
      entries: [],
    });
  });

  it('throws when a mapping references an ingredient that is not in the list', () => {
    const withOrphan = {
      ...MAPPINGS,
      Käse: [{ au: 'Esslöffel', factor: 12, shoppingUnit: false }],
    };
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
    expect(serializeIngredientListCsv(LIST)).toContain('Cashews;Cashew;Cashews;g;low;inf');
    expect(() =>
      parseIngredientListCsv(
        LIST_TEXT.replace(
          'Cashews;Cashew;Cashews;g;low;inf',
          'Cashews;Cashew;Cashews;g;low;Infinity',
        ),
      ),
    ).toThrow(/ungültiger Meldebestand/);
  });

  it('rejects a legacy file without precision instead of upgrading it', () => {
    const legacy = 'Ingredient;Base Unit;Reorder Point\nJoghurt;g;0\n';
    expect(() => parseIngredientListCsv(legacy)).toThrow(/Kopfzeile/);
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
