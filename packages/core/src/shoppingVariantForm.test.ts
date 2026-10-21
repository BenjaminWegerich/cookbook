/**
 * Tests for the synonym form rule of the shopping master-data screen
 * (packages/core/src/shoppingVariantForm.ts): the identity rules the synonym
 * CSV enforces at load, answered for one candidate while the user types
 * (docs/storage_format.md §10, docs/shopping_item_identity.md §1/§5).
 */

import { describe, expect, it } from 'vitest';

import type { ShoppingItems, ShoppingSynonyms } from './shoppingRouteCsv.js';
import { validateShoppingVariant } from './shoppingVariantForm.js';

/** The item table fixture: a canonical ingredient and a non-ingredient. */
const ITEMS: ShoppingItems = {
  Karotten: { store: 'Lidl', section: 'Obst und Gemüse' },
  Klopapier: { store: 'dm', section: 'Drogerie' },
};

/** The synonym fixture: a variant of Karotten and one of Klopapier. */
const SYNONYMS: ShoppingSynonyms = {
  Möhren: 'Karotten',
  Zewa: 'Klopapier',
};

describe('validateShoppingVariant', () => {
  it('accepts a new spelling and returns it trimmed', () => {
    expect(validateShoppingVariant('  gelbe Rüben  ', 'Karotten', ITEMS, SYNONYMS)).toEqual({
      ok: true,
      variant: 'gelbe Rüben',
    });
  });

  it('rejects an empty or whitespace-only synonym', () => {
    expect(validateShoppingVariant('', 'Karotten', ITEMS, SYNONYMS)).toEqual({
      ok: false,
      message: 'Bitte ein Synonym eingeben.',
    });
    expect(validateShoppingVariant('   ', 'Karotten', ITEMS, SYNONYMS).ok).toBe(false);
  });

  it('rejects the CSV separators the format cannot store', () => {
    for (const candidate of ['Möhren;Karotten', 'Möhren\nKarotten', 'Möhren\rKarotten']) {
      expect(validateShoppingVariant(candidate, 'Karotten', ITEMS, SYNONYMS)).toEqual({
        ok: false,
        message: 'Ein Synonym darf kein Semikolon und keinen Zeilenumbruch enthalten.',
      });
    }
  });

  it('rejects the article name itself, case-folded', () => {
    expect(validateShoppingVariant('Karotten', 'Karotten', ITEMS, SYNONYMS)).toEqual({
      ok: false,
      message: 'Das Synonym muss sich vom Artikelnamen unterscheiden.',
    });
    // ß folds to ss, like the matching itself (§3).
    expect(validateShoppingVariant('WEISSE BOHNEN', 'Weiße Bohnen', ITEMS, SYNONYMS)).toEqual({
      ok: false,
      message: 'Das Synonym muss sich vom Artikelnamen unterscheiden.',
    });
  });

  it('rejects a synonym that would shadow another article name', () => {
    expect(validateShoppingVariant('klopapier', 'Karotten', ITEMS, SYNONYMS)).toEqual({
      ok: false,
      message: '„Klopapier“ ist bereits ein Artikel.',
    });
  });

  it('rejects a synonym already stored for the same article', () => {
    expect(validateShoppingVariant('möhren', 'Karotten', ITEMS, SYNONYMS)).toEqual({
      ok: false,
      message: '„Möhren“ ist für diesen Artikel schon hinterlegt.',
    });
  });

  it('rejects a synonym already stored for another article', () => {
    expect(validateShoppingVariant('Zewa', 'Karotten', ITEMS, SYNONYMS)).toEqual({
      ok: false,
      message: '„Zewa“ ist bereits ein Synonym für „Klopapier“.',
    });
  });

  it('checks the draft tables it is given, not the stored ones', () => {
    // The sheet removes „Möhren“ from its form and adds it again: against the
    // edited draft table (without that row) the candidate is valid.
    const draftSynonyms: ShoppingSynonyms = { Zewa: 'Klopapier' };
    expect(validateShoppingVariant('Möhren', 'Karotten', ITEMS, draftSynonyms)).toEqual({
      ok: true,
      variant: 'Möhren',
    });
  });
});
