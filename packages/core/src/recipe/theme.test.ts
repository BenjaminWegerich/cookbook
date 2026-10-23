/**
 * Tests for the recipe theme (docs/DESIGN.md §4.8): the font shortlist, the
 * default theme, the hex-colour check, and the resolution of a recipe's partial
 * theme over the defaults.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME,
  THEME_FONT_SHORTLIST,
  isHexColor,
  resolveTheme,
  resolveThemeFonts,
} from './theme.js';
import { EMBEDDED_FONT_COMPANIONS, EMBEDDED_FONTS } from './embeddedFonts.js';

describe('THEME_FONT_SHORTLIST', () => {
  it('holds the five Noto faces of DESIGN §4.8, no duplicates', () => {
    expect(THEME_FONT_SHORTLIST).toHaveLength(5);
    expect(new Set(THEME_FONT_SHORTLIST).size).toBe(5);
    expect(THEME_FONT_SHORTLIST[0]).toBe('Noto Sans');
  });
});

describe('DEFAULT_THEME', () => {
  it('is the web app palette and typeface of DESIGN §4.8', () => {
    expect(DEFAULT_THEME).toEqual({
      font: 'Noto Sans',
      accent: '#ad5632',
      paper: '#faf5ec',
      ink: '#2b241d',
      line: '#e6dbc8',
    });
  });
});

describe('isHexColor', () => {
  it('accepts canonical 6-digit hex, case-insensitively', () => {
    expect(isHexColor('#ad5632')).toBe(true);
    expect(isHexColor('#B85C38')).toBe(true);
    expect(isHexColor('#123abc')).toBe(true);
  });

  it('rejects non-hex and other lengths', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('#1234567')).toBe(false);
    expect(isHexColor('b85c38')).toBe(false);
  });
});

describe('EMBEDDED_FONTS', () => {
  it('embeds every shortlist typeface, and only those, each with non-empty WOFF2', () => {
    // Drift guard between theme.ts and the generated embeddedFonts.ts: a new
    // shortlist face without an embedded WOFF2 (or a stale embedded face) fails
    // here instead of silently exporting a system font.
    expect(Object.keys(EMBEDDED_FONTS).sort()).toEqual([...THEME_FONT_SHORTLIST].sort());
    for (const [family, faces] of Object.entries(EMBEDDED_FONTS)) {
      expect(faces.length, family).toBeGreaterThan(0);
      for (const face of faces) {
        expect(face.base64.length, family).toBeGreaterThan(0);
      }
    }
  });

  it('declares every face over the two required weights as one variable rule', () => {
    for (const family of THEME_FONT_SHORTLIST) {
      expect(EMBEDDED_FONTS[family]!.map((face) => face.weight)).toEqual(['400 600']);
    }
  });

  it('embeds a fraction/space companion for every export body face', () => {
    // Every shortlist face renders body text except the display serif, which is
    // a heading face only (resolveThemeFonts pairs it with Noto Serif).
    const bodyFaces = THEME_FONT_SHORTLIST.filter((name) => name !== 'Noto Serif Display');
    expect(Object.keys(EMBEDDED_FONT_COMPANIONS).sort()).toEqual([...bodyFaces].sort());
    for (const family of bodyFaces) {
      const companion = EMBEDDED_FONT_COMPANIONS[family];
      expect(companion?.base64.length, family).toBeGreaterThan(0);
      expect(companion?.weight, family).toBe('400 600');
      expect(companion?.unicodeRange, family).toContain('U+202F');
      expect(companion?.unicodeRange, family).toContain('U+2150-215E');
    }
    expect(EMBEDDED_FONT_COMPANIONS['Noto Serif Display']).toBeUndefined();
  });
});

describe('resolveThemeFonts', () => {
  it('keeps the selected face in both roles for every face but the display serif', () => {
    for (const font of THEME_FONT_SHORTLIST.filter((name) => name !== 'Noto Serif Display')) {
      expect(resolveThemeFonts(font)).toEqual({ heading: font, body: font });
    }
  });

  it('pairs the display serif as the heading face with Noto Serif for the body', () => {
    expect(resolveThemeFonts('Noto Serif Display')).toEqual({
      heading: 'Noto Serif Display',
      body: 'Noto Serif',
    });
  });
});

describe('resolveTheme', () => {
  it('returns the default theme for undefined or an empty theme', () => {
    expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(resolveTheme({})).toEqual(DEFAULT_THEME);
  });

  it('overrides each token independently and leaves the rest at their default', () => {
    expect(resolveTheme({ accent: '#123456' })).toEqual({
      ...DEFAULT_THEME,
      accent: '#123456',
    });
    expect(resolveTheme({ font: 'Noto Serif', line: '#000000' })).toEqual({
      ...DEFAULT_THEME,
      font: 'Noto Serif',
      line: '#000000',
    });
  });
});
