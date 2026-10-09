/**
 * Tests for the recipe theme (docs/DESIGN.md §4.8): the font shortlist, the
 * default theme, the hex-colour check, and the resolution of a recipe's partial
 * theme over the defaults.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, THEME_FONT_SHORTLIST, isHexColor, resolveTheme } from './theme.js';
import { EMBEDDED_FONTS } from './embeddedFonts.js';

describe('THEME_FONT_SHORTLIST', () => {
  it('holds the eleven typefaces of DESIGN §4.8, no duplicates', () => {
    expect(THEME_FONT_SHORTLIST).toHaveLength(11);
    expect(new Set(THEME_FONT_SHORTLIST).size).toBe(11);
    expect(THEME_FONT_SHORTLIST[0]).toBe('Source Sans 3');
  });
});

describe('DEFAULT_THEME', () => {
  it('is the web app palette and typeface of DESIGN §4.8', () => {
    expect(DEFAULT_THEME).toEqual({
      font: 'Source Sans 3',
      accent: '#b85c38',
      paper: '#faf5ec',
      ink: '#2b241d',
      line: '#e6dbc8',
    });
  });
});

describe('isHexColor', () => {
  it('accepts canonical 6-digit hex, case-insensitively', () => {
    expect(isHexColor('#b85c38')).toBe(true);
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

  it('gives the static IBM Plex faces one weight each and the rest a variable range', () => {
    // The keys are guaranteed by the test above, but noUncheckedIndexedAccess
    // still requires the non-null assertion at the call site.
    for (const family of ['IBM Plex Mono', 'IBM Plex Sans Condensed']) {
      expect(EMBEDDED_FONTS[family]!.map((face) => face.weight).sort()).toEqual(['400', '600']);
    }
    for (const family of THEME_FONT_SHORTLIST) {
      if (family === 'IBM Plex Mono' || family === 'IBM Plex Sans Condensed') continue;
      expect(EMBEDDED_FONTS[family]!.map((face) => face.weight)).toEqual(['400 600']);
    }
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
    expect(resolveTheme({ font: 'Fraunces', line: '#000000' })).toEqual({
      ...DEFAULT_THEME,
      font: 'Fraunces',
      line: '#000000',
    });
  });
});
