#!/usr/bin/env node
/**
 * Builds the web app's self-hosted Noto faces into `src/fonts/`
 * (docs/DESIGN.md §4.2, §4.8).
 *
 * Four of them are copies of the `@fontsource-variable` *latin* subset files:
 * Noto Sans, Noto Serif, Noto Serif Display and Noto Sans Mono. Copying them
 * instead of importing the packages' `index.css` keeps the bundle to these
 * files — the packages ship one CSS file per group that also declares every
 * Cyrillic, Devanagari … subset, which a German cooking app never loads but
 * would still deploy. The copies are committed: the build must not fetch fonts.
 *
 * The remaining faces are generated here, because no stock Google family file
 * provides them:
 *
 *   1. `noto-sans-condensed.woff2` — the theme face „Noto Sans Condensed", the
 *      width-axis instance (wdth = 75) of Noto Sans. Google Fonts exposes that
 *      width only as a variable axis, so the script pins it into a normal,
 *      single-face WOFF2 with the weight axis still live (100–900).
 *   2. The four fraction companions (`*-fractions.woff2`) — the Number Forms
 *      block (U+2150–215E, ⅐ … ⅞), the Latin-1 fraction glyphs (already in the
 *      latin subset, repeated for safety) and the narrow no-break space
 *      (U+202F). The latin subsets stop at Latin-1, so `formatAQ`'s precomposed
 *      fraction glyphs (⅓, ⅒, ⅛ …) and every number/unit separator would
 *      otherwise be drawn by the operating system's fallback font, in a
 *      different weight and size. Each export body face gets a companion built
 *      from its own full variable source, so a themed cooking view keeps the
 *      theme face's fraction design (`Noto Serif Display` is a heading face and
 *      gets none). The web app uses the Noto Sans companion as a second face of
 *      the same family with a narrow `unicode-range` (styles/fonts.css), so the
 *      browser merges it per character. Only the `wght` axis is kept; `wdth`
 *      and `CTGR` are pinned.
 *
 * Sources:
 *   - the four latin faces: the installed `@fontsource-variable` packages.
 *   - the condensed face: the Noto Sans `latin` *width* file from the same
 *     package, pinned to wdth = 75.
 *   - the fraction companions: the full variable Noto fonts, because the
 *     subset packages do not contain the Number Forms block. Place them in the
 *     git-ignored `.fonts/` (like the other design fonts):
 *       .fonts/NotoSans-VF.ttf
 *       .fonts/NotoSerif-VF.ttf
 *       .fonts/NotoSansMono-VF.ttf
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

/** The width instance of Noto Sans that the theme face „Noto Sans Condensed" uses. */
const CONDENSED_WIDTH = 75;

/** The four stock faces: package name → source file → committed file. */
const LATIN_FACES = [
  ['noto-sans', 'noto-sans-latin-wght-normal.woff2', 'noto-sans-latin.woff2'],
  ['noto-serif', 'noto-serif-latin-wght-normal.woff2', 'noto-serif-latin.woff2'],
  [
    'noto-serif-display',
    'noto-serif-display-latin-wght-normal.woff2',
    'noto-serif-display-latin.woff2',
  ],
  ['noto-sans-mono', 'noto-sans-mono-latin-wght-normal.woff2', 'noto-sans-mono-latin.woff2'],
];

/** The installed Noto Sans latin file that also carries the width axis. */
const CONDENSED_SOURCE = resolve(FONTSOURCE, 'noto-sans/files/noto-sans-latin-wdth-normal.woff2');

/** The full variable Noto fonts, the only sources that still have the Number Forms. */
const FRACTION_SOURCES = {
  'Noto Sans': resolve(ROOT, '.fonts/NotoSans-VF.ttf'),
  'Noto Serif': resolve(ROOT, '.fonts/NotoSerif-VF.ttf'),
  'Noto Sans Mono': resolve(ROOT, '.fonts/NotoSansMono-VF.ttf'),
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
 * The fraction companions of the export body faces (DESIGN §4.8, §7): the
 * theme family → its full variable source, committed file and pinned axes.
 * Noto Serif Display is absent because it only ever renders page headings,
 * which carry no quantities.
 */
const FRACTION_FACES = [
  {
    family: 'Noto Sans',
    source: FRACTION_SOURCES['Noto Sans'],
    target: 'noto-sans-fractions.woff2',
    axes: { wdth: 100, CTGR: 0 },
  },
  {
    family: 'Noto Serif',
    source: FRACTION_SOURCES['Noto Serif'],
    target: 'noto-serif-fractions.woff2',
    axes: { wdth: 100, CTGR: 0 },
  },
  {
    family: 'Noto Sans Mono',
    source: FRACTION_SOURCES['Noto Sans Mono'],
    target: 'noto-sans-mono-fractions.woff2',
    axes: { wdth: 100 },
  },
  {
    // The condensed body face is Noto Sans pinned to the same width, so its
    // fractions come from the same source with the same pinned axis.
    family: 'Noto Sans Condensed',
    source: FRACTION_SOURCES['Noto Sans'],
    target: 'noto-sans-condensed-fractions.woff2',
    axes: { wdth: CONDENSED_WIDTH, CTGR: 0 },
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

// The four stock latin faces: copy the package's latin WOFF2 unchanged.
for (const [pkg, source, target] of LATIN_FACES) {
  writeFace(target, readFont(resolve(FONTSOURCE, pkg, 'files', source), 'run npm install first'));
}

// The condensed theme face: the latin width file, pinned to wdth 75 while the
// weight axis stays live, so one file serves weights 400 and 600.
writeFace(
  'noto-sans-condensed.woff2',
  await subsetFont(readFont(CONDENSED_SOURCE, 'run npm install first'), '', {
    targetFormat: 'woff2',
    keepAllGlyphs: true,
    variationAxes: { wdth: CONDENSED_WIDTH },
  }),
);

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
