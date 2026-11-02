#!/usr/bin/env node
/**
 * Builds the web app's self-hosted Noto faces into `src/fonts/`
 * (docs/DESIGN.md §4.2, §4.8).
 *
 * Two groups of files come out of here:
 *
 *   1. The stock latin faces, copied from the `@fontsource-variable` packages:
 *      Noto Sans (upright + italic), Noto Serif (upright + italic) and Noto
 *      Serif Display (upright only). Copying the files instead of importing the
 *      packages' `index.css` keeps the bundle to these files — the packages ship
 *      one CSS file per group that also declares every Cyrillic, Devanagari …
 *      subset, which a German cooking app never loads but would still deploy.
 *      The copies are committed: the build must not fetch fonts.
 *
 *      The italics are real drawn faces, not a browser-synthesized oblique:
 *      DESIGN §4.2 renders arrangement notes, the `optional` marker and the
 *      passive right-hand annotations in italic, and a slant computed from the
 *      upright face distorts curves, weight and spacing. Noto Serif Display
 *      ships no italic here because it is a heading face only (§4.8) and no
 *      heading is italic.
 *
 *   2. The fraction companions (`*-fractions*.woff2`), which no stock subset
 *      provides. They carry the Number Forms fraction glyphs (U+2150–215E,
 *      ⅐ … ⅞), the Latin-1 fraction glyphs (already in the latin subset,
 *      repeated for safety) and the narrow no-break space (U+202F) that every
 *      number/unit pair uses. The latin subsets stop at Latin-1, so `formatAQ`'s
 *      precomposed fraction glyphs (⅓, ⅒, ⅛ …) and every number/unit separator
 *      would otherwise be drawn by the operating system's fallback font, in a
 *      different weight and size. One companion exists per face and style, so
 *      an italic run with a quantity keeps both the italic design and the
 *      fraction design. In the web app each companion is a second face of the
 *      same family and style with a narrow `unicode-range` (styles/fonts.css),
 *      so the browser composes the family per character. Only the `wght` axis
 *      is kept; `wdth` and `CTGR` are pinned.
 *
 * Sources:
 *   - the latin faces: the installed `@fontsource-variable` packages.
 *   - the fraction companions: the full variable Noto fonts, because the
 *     subset packages do not contain the Number Forms block. Place them in the
 *     git-ignored `.fonts/` (like the other design fonts):
 *       .fonts/NotoSans-VF.ttf      .fonts/NotoSans-Italic-VF.ttf
 *       .fonts/NotoSerif-VF.ttf     .fonts/NotoSerif-Italic-VF.ttf
 *     from https://github.com/notofonts/noto-fonts/tree/main/unhinted/variable-ttf
 *
 * Re-run after a font change, then regenerate the export's embedded copies so
 * the cooking view ships the same bytes:
 *   npm run generate:noto-faces   (from apps/web)
 *   npm run generate:fonts        (from packages/core)
 *
 * License: the Noto faces are released under the SIL Open Font License 1.1;
 * the license text sits beside them (`src/fonts/OFL.txt`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import subsetFont from 'subset-font';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUT_DIR = resolve(HERE, '../src/fonts');
const FONTSOURCE = resolve(ROOT, 'node_modules/@fontsource-variable');

/**
 * The stock faces: package → the package's latin WOFF2 → the committed file.
 * Every entry is a variable `wght` file, so one file serves the weights 400 and
 * 600 of DESIGN §4.2. The upright and italic files of a family are declared
 * together in `styles/fonts.css`, which is what makes the italic real.
 */
const LATIN_FACES = [
  ['noto-sans', 'noto-sans-latin-wght-normal.woff2', 'noto-sans-latin.woff2'],
  ['noto-sans', 'noto-sans-latin-wght-italic.woff2', 'noto-sans-latin-italic.woff2'],
  ['noto-serif', 'noto-serif-latin-wght-normal.woff2', 'noto-serif-latin.woff2'],
  ['noto-serif', 'noto-serif-latin-wght-italic.woff2', 'noto-serif-latin-italic.woff2'],
  [
    'noto-serif-display',
    'noto-serif-display-latin-wght-normal.woff2',
    'noto-serif-display-latin.woff2',
  ],
];

/** The full variable Noto fonts, the only sources that still have the Number Forms. */
const FRACTION_SOURCES = {
  'Noto Sans': resolve(ROOT, '.fonts/NotoSans-VF.ttf'),
  'Noto Sans Italic': resolve(ROOT, '.fonts/NotoSans-Italic-VF.ttf'),
  'Noto Serif': resolve(ROOT, '.fonts/NotoSerif-VF.ttf'),
  'Noto Serif Italic': resolve(ROOT, '.fonts/NotoSerif-Italic-VF.ttf'),
};

/**
 * The characters of every fraction companion: the whole Number Forms block the
 * app's AQ table can use, the Latin-1 fraction glyphs (already in the latin
 * subset, repeated for safety) and the narrow no-break space every quantity
 * uses.
 */
const FRACTION_CHARS =
  '\u202F' +
  '\u2150\u2151\u2152\u2153\u2154\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E\u2189' +
  '\u00BC\u00BD\u00BE';

/**
 * The fraction companions, one per face and style: the theme family → its full
 * variable source, committed file and pinned axes. Noto Serif Display is absent
 * because it only ever renders page headings, which carry no quantities.
 */
const FRACTION_FACES = [
  {
    family: 'Noto Sans',
    source: FRACTION_SOURCES['Noto Sans'],
    target: 'noto-sans-fractions.woff2',
    axes: { wdth: 100, CTGR: 0 },
  },
  {
    family: 'Noto Sans',
    source: FRACTION_SOURCES['Noto Sans Italic'],
    target: 'noto-sans-fractions-italic.woff2',
    axes: { wdth: 100, CTGR: 0 },
  },
  {
    family: 'Noto Serif',
    source: FRACTION_SOURCES['Noto Serif'],
    target: 'noto-serif-fractions.woff2',
    axes: { wdth: 100, CTGR: 0 },
  },
  {
    family: 'Noto Serif',
    // The serif italic carries no CTGR axis of its own, so only wdth is pinned.
    source: FRACTION_SOURCES['Noto Serif Italic'],
    target: 'noto-serif-fractions-italic.woff2',
    axes: { wdth: 100 },
  },
];

/** Reads a font file, failing with an actionable message when it is missing. */
function readFont(path, hint) {
  if (!existsSync(path)) {
    throw new Error(`missing font source ${path} — ${hint}`);
  }
  return readFileSync(path);
}

/** Writes one face and reports its size. */
function writeFace(name, buffer) {
  writeFileSync(resolve(OUT_DIR, name), buffer);
  console.log(`Wrote ${name} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

mkdirSync(OUT_DIR, { recursive: true });

// The stock latin faces: copy the package's latin WOFF2 unchanged.
for (const [pkg, source, target] of LATIN_FACES) {
  writeFace(target, readFont(resolve(FONTSOURCE, pkg, 'files', source), 'run npm install first'));
}

// The fraction companions: only the twenty characters above, with the width and
// contrast axes pinned so each file stays a few kilobytes. The weight axis
// stays live to match the theme face's 400–600 range.
for (const { family, source, target, axes } of FRACTION_FACES) {
  writeFace(
    target,
    await subsetFont(
      readFont(source, 'download it from https://github.com/notofonts/noto-fonts'),
      FRACTION_CHARS,
      { targetFormat: 'woff2', variationAxes: axes },
    ),
  );
  console.log(`  ${family} fraction companion`);
}
