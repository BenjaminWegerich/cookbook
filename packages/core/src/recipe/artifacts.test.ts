/**
 * Tests for the inline text artifacts (docs/storage_format.md §4) and the
 * shared amount-first phrase grammar (rows and artifacts).
 */

import { describe, expect, it } from 'vitest';

import {
  artifactToText,
  escapeHtml,
  insertArtifact,
  isQuantityArtifact,
  isSizeArtifact,
  parseArtifactContent,
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

  it('parses fraction and mixed-number amounts (the unitless AQ notation)', () => {
    expect(parseIngredientPhrase('1/3')).toEqual({ quantity: 1 / 3 });
    expect(parseIngredientPhrase('1+1/4')).toEqual({ quantity: 1.25 });
    expect(parseIngredientPhrase('1 / 2')).toEqual({ quantity: 0.5 });
    expect(parseIngredientPhrase('1/2 g')).toEqual({ quantity: 0.5, unit: 'g' });
    expect(parseIngredientPhrase('1/2 g Mehl')).toEqual({
      name: 'Mehl',
      quantity: 0.5,
      unit: 'g',
    });
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
  const quantity = (value: number, unit?: 'g' | 'ml', name?: string) => ({
    kind: 'quantity' as const,
    quantity: value,
    ...(unit !== undefined ? { unit } : {}),
    ...(name !== undefined ? { name } : {}),
  });

  it('writes canonical artifact text', () => {
    expect(artifactToText(quantity(1500, 'ml', 'Wasser'))).toBe('{{1500 ml Wasser}}');
    expect(artifactToText(quantity(100, 'g'))).toBe('{{100 g}}');
    expect(artifactToText(quantity(300))).toBe('{{300}}');
  });

  it('writes a unitless count in the canonical AQ fraction notation', () => {
    expect(artifactToText(quantity(1 / 3))).toBe('{{1/3}}');
    expect(artifactToText(quantity(1.25))).toBe('{{1+1/4}}');
    expect(artifactToText(quantity(0.5))).toBe('{{1/2}}');
    expect(artifactToText(quantity(3))).toBe('{{3}}');
  });

  it('writes a size marker with its explicit count and |size suffix', () => {
    expect(
      artifactToText({ kind: 'size', marker: 'Backring', count: 1, size: 26, unit: 'cm' }),
    ).toBe('{{1 26 cm Backring|size}}');
    expect(
      artifactToText({ kind: 'size', marker: 'Backring', count: 2, size: 20, unit: 'cm' }),
    ).toBe('{{2 20 cm Backring|size}}');
  });

  it('splits a step text into prose segments and artifact spans', () => {
    const text = 'Nudeln in {{1500 ml Wasser}} kochen, dann {{100 g}} unterheben.';
    const { segments, spans } = splitArtifacts(text);
    expect(spans.map((span) => span.artifact)).toEqual([
      quantity(1500, 'ml', 'Wasser'),
      quantity(100, 'g'),
    ]);
    expect(spans[0]!.start).toBe(text.indexOf('{{1500'));
    expect(spans[0]!.end).toBe(spans[0]!.start + '{{1500 ml Wasser}}'.length);
    expect(spans[1]!.start).toBe(text.indexOf('{{100'));
    expect(spans[1]!.end).toBe(spans[1]!.start + '{{100 g}}'.length);
    expect(segments).toEqual([
      { type: 'text', value: 'Nudeln in ' },
      { type: 'artifact', artifact: quantity(1500, 'ml', 'Wasser') },
      { type: 'text', value: ' kochen, dann ' },
      { type: 'artifact', artifact: quantity(100, 'g') },
      { type: 'text', value: ' unterheben.' },
    ]);
  });

  it('classifies a size marker as a size artifact, not an ingredient mention', () => {
    const text = 'Für {{1 26 cm Backring|size}} ausrollen.';
    const { segments, spans } = splitArtifacts(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.artifact).toEqual({
      kind: 'size',
      marker: 'Backring',
      count: 1,
      size: 26,
      unit: 'cm',
    });
    expect(isSizeArtifact(spans[0]!.artifact)).toBe(true);
    expect(isQuantityArtifact(spans[0]!.artifact)).toBe(false);
    expect(segments).toEqual([
      { type: 'text', value: 'Für ' },
      {
        type: 'artifact',
        artifact: { kind: 'size', marker: 'Backring', count: 1, size: 26, unit: 'cm' },
      },
      { type: 'text', value: ' ausrollen.' },
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

  it('parses the size-marker grammar strictly', () => {
    expect(parseArtifactContent('1 26 cm Backring|size')).toEqual({
      kind: 'size',
      marker: 'Backring',
      count: 1,
      size: 26,
      unit: 'cm',
    });
    expect(parseArtifactContent('2 20,0 cm Backring|size')).toEqual({
      kind: 'size',
      marker: 'Backring',
      count: 2,
      size: 20,
      unit: 'cm',
    });
    // The count is mandatory, even for one mold.
    expect(parseArtifactContent('26 cm Backring|size')).toBeNull();
    // A size marker has no precision.
    expect(parseArtifactContent('1 26 cm Backring|precision: high|size')).toBeNull();
    expect(parseArtifactContent('1 26 cm Backring|size|precision: high')).toBeNull();
    expect(parseArtifactContent('0 26 cm Backring|size')).toBeNull();
    expect(parseArtifactContent('1 0 cm Backring|size')).toBeNull();
    // Syntax only: the registry check belongs to the recipe validator, so a
    // draft with an unknown marker can still be rendered/edited.
    expect(parseArtifactContent('1 26 cm Springform|size')).toEqual({
      kind: 'size',
      marker: 'Springform',
      count: 1,
      size: 26,
      unit: 'cm',
    });
  });

  it('normalizes artifacts inside text via replaceArtifacts', () => {
    const text = 'Mit {{1,5 l Wasser}} und {{0.2 kg Reis}} arbeiten.';
    expect(replaceArtifacts(text, (artifact) => artifact)).toBe(
      'Mit {{1500 ml Wasser}} und {{200 g Reis}} arbeiten.',
    );
    // Unitless counts normalize to their canonical AQ fraction.
    expect(replaceArtifacts('Mit {{0.5}} und {{1,25}} arbeiten.', (a) => a)).toBe(
      'Mit {{1/2}} und {{1+1/4}} arbeiten.',
    );
    expect(replaceArtifacts('Für {{1 26,0 cm Backring|size}} ausrollen.', (a) => a)).toBe(
      'Für {{1 26 cm Backring|size}} ausrollen.',
    );
  });

  it('inserts and deletes artifacts via replaceArtifacts', () => {
    expect(insertArtifact('Butter schmelzen.', 7, quantity(100, 'g'))).toBe(
      'Butter {{100 g}}schmelzen.',
    );
    expect(
      insertArtifact('Butter schmelzen.', 7, {
        kind: 'size',
        marker: 'Backring',
        count: 1,
        size: 26,
        unit: 'cm',
      }),
    ).toBe('Butter {{1 26 cm Backring|size}}schmelzen.');
    expect(replaceArtifacts('A {{100 g}} B', () => null)).toBe('A  B');
  });

  it('escapes HTML and renders artifacts safely', () => {
    expect(escapeHtml('<b>&"\'</b>')).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
    const rendered = renderArtifacts('Salz & Pfeffer, dann {{100 g}} Mehl', (artifact) => {
      if (!isQuantityArtifact(artifact)) return '';
      return `<code>${escapeHtml(String(artifact.quantity))}</code>`;
    });
    expect(rendered).toBe('Salz &amp; Pfeffer, dann <code>100</code> Mehl');
  });
});
