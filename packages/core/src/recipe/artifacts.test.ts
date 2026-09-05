/**
 * Tests for the inline text artifacts (docs/storage_format.md §4) and the
 * shared amount-first phrase grammar (rows and artifacts).
 */

import { describe, expect, it } from 'vitest';

import {
  artifactToText,
  escapeHtml,
  insertArtifact,
  parseIngredientPhrase,
  renderArtifacts,
  replaceArtifacts,
  splitArtifacts,
} from './artifacts.js';

describe('parseIngredientPhrase', () => {
  it('parses a canonical ingredient phrase', () => {
    expect(parseIngredientPhrase('250 g Tortillas')).toEqual({
      name: 'Tortillas',
      quantity: 250,
      unit: 'g',
    });
    expect(parseIngredientPhrase('15 ml Zitronensaft')).toEqual({
      name: 'Zitronensaft',
      quantity: 15,
      unit: 'ml',
    });
  });

  it('parses a quantity-only phrase when no name is present', () => {
    expect(parseIngredientPhrase('100 g')).toEqual({ quantity: 100, unit: 'g' });
    expect(parseIngredientPhrase('1500 ml')).toEqual({ quantity: 1500, unit: 'ml' });
    // A quantity-only artifact may omit the unit entirely ({{100}}).
    expect(parseIngredientPhrase('100')).toEqual({ quantity: 100 });
    expect(parseIngredientPhrase('3')).toEqual({ quantity: 3 });
  });

  it('requires a name for rows (requireName)', () => {
    expect(parseIngredientPhrase('100 g', true)).toBeNull();
    expect(parseIngredientPhrase('100', true)).toBeNull();
    expect(parseIngredientPhrase('100 g Mehl', true)).toEqual({
      name: 'Mehl',
      quantity: 100,
      unit: 'g',
    });
  });

  it('normalizes German comma decimals and kg/l display units', () => {
    expect(parseIngredientPhrase('1,5 l Wasser')).toEqual({
      name: 'Wasser',
      quantity: 1500,
      unit: 'ml',
    });
    expect(parseIngredientPhrase('0.2 kg Reis')).toEqual({
      name: 'Reis',
      quantity: 200,
      unit: 'g',
    });
    expect(parseIngredientPhrase('2,5 g')).toEqual({ quantity: 2.5, unit: 'g' });
  });

  it('rejects non-quantity phrases', () => {
    for (const bad of [
      '',
      'Mehl',
      '400 Stück Mehl',
      '- 250 g Reis',
      'a g Mehl',
      'g Mehl',
      '250 g {x}',
      '100 Teig', // a name without a unit would be ambiguous
    ]) {
      expect(parseIngredientPhrase(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('artifact text helpers', () => {
  it('writes canonical artifact text', () => {
    expect(artifactToText({ quantity: 1500, unit: 'ml', name: 'Wasser' })).toBe(
      '{{1500 ml Wasser}}',
    );
    expect(artifactToText({ quantity: 100, unit: 'g' })).toBe('{{100 g}}');
    expect(artifactToText({ quantity: 300 })).toBe('{{300}}');
  });

  it('splits a step text into prose segments and artifact spans', () => {
    const text = 'Nudeln in {{1500 ml Wasser}} kochen, dann {{100 g}} unterheben.';
    const { segments, spans } = splitArtifacts(text);
    expect(spans.map((span) => span.artifact)).toEqual([
      { name: 'Wasser', quantity: 1500, unit: 'ml' },
      { quantity: 100, unit: 'g' },
    ]);
    expect(spans[0]!.start).toBe(text.indexOf('{{1500'));
    expect(spans[0]!.end).toBe(spans[0]!.start + '{{1500 ml Wasser}}'.length);
    expect(spans[1]!.start).toBe(text.indexOf('{{100'));
    expect(spans[1]!.end).toBe(spans[1]!.start + '{{100 g}}'.length);
    expect(segments).toEqual([
      { type: 'text', value: 'Nudeln in ' },
      { type: 'artifact', artifact: { name: 'Wasser', quantity: 1500, unit: 'ml' } },
      { type: 'text', value: ' kochen, dann ' },
      { type: 'artifact', artifact: { quantity: 100, unit: 'g' } },
      { type: 'text', value: ' unterheben.' },
    ]);
  });

  it('keeps malformed blocks as prose text', () => {
    const { segments, spans } = splitArtifacts('Mit {{irgendwas}} mischen.');
    expect(spans).toEqual([]);
    expect(segments).toEqual([
      { type: 'text', value: 'Mit ' },
      { type: 'text', value: '{{irgendwas}}' },
      { type: 'text', value: ' mischen.' },
    ]);
  });

  it('normalizes artifacts inside text via replaceArtifacts', () => {
    const text = 'Mit {{1,5 l Wasser}} und {{0.2 kg Reis}} arbeiten.';
    expect(replaceArtifacts(text, (artifact) => artifact)).toBe(
      'Mit {{1500 ml Wasser}} und {{200 g Reis}} arbeiten.',
    );
  });

  it('inserts and deletes artifacts via replaceArtifacts', () => {
    expect(insertArtifact('Butter schmelzen.', 7, { quantity: 100, unit: 'g' })).toBe(
      'Butter {{100 g}}schmelzen.',
    );
    expect(replaceArtifacts('A {{100 g}} B', () => null)).toBe('A  B');
  });

  it('escapes HTML and renders artifacts safely', () => {
    expect(escapeHtml('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
    const rendered = renderArtifacts(
      'Salz & Pfeffer, dann {{100 g}} Mehl',
      (artifact) => `<code>${escapeHtml(String(artifact.quantity))}</code>`,
    );
    expect(rendered).toBe(
      'Salz &amp; Pfeffer, dann <code>100</code> Mehl',
    );
  });
});
