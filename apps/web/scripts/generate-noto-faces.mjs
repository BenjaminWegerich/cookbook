#!/usr/bin/env node
/**
 * Builds the web app's six self-hosted Noto faces into `src/fonts/`
 * (docs/DESIGN.md §4.2, §4.8).
 *
 * Four of them are copies of the `@fontsource-variable` *latin* subset files:
 * Noto Sans, Noto Serif, Noto Serif Display and Noto Sans Mono. Copying them
 * instead of importing the packages' `index.css` keeps the bundle to these six
 * files — the packages ship one CSS file per group that also declares every
 * Cyrillic, Devanagari … subset, which a German cooking app never loads but
 * would still deploy. The copies are committed: the build must not fetch fonts.
 *
 * The other two faces exist only here, because neither is a stock Google family
 * file:
 *
 *   1. `noto-sans-condensed.woff2` — the theme face „Noto Sans Condensed", the
 *      width-axis instance (wdth = 75) of Noto Sans. Google Fonts exposes that
 *      width only as a variable axis, so the script pins it into a normal,
 *      single-face WOFF2 with the weight axis still live (100–900).
 *   2. `noto-sans-fractions.woff2` — the Number Forms block (U+2150–215E,
 *      ⅐ … ⅞) and the narrow no-break space (U+202F). The latin subset stops at
 *      Latin-1, so `formatAQ`'s precomposed fraction glyphs (⅓, ⅒, ⅛ …) and
 *      every number/unit separator would otherwise be drawn by the operating
 *      system's fallback font, in a different weight and size. The web app
 *      declares this file as a second face of the same family with a narrow
 *      `unicode-range` (styles/fonts.css), so the browser merges it per
 *      character. Only the `wght` axis is kept; `wdth` and `CTGR` are pinned.
 *
 * Sources:
 *   - the four latin faces: the installed `@fontsource-variable` packages.
 *   - the condensed face: the Noto Sans `latin` *width* file from the same
 *     package, pinned to wdth = 75.
 *   - the fractions face: the full variable Noto Sans, because the subset
 *     packages do not contain the Number Forms block. Place it at
 *     `.fonts/NotoSans-VF.ttf` (git-ignored, like the other design fonts):
 *     https://github.com/notofonts/noto-fonts/raw/main/unhinted/variable-ttf/NotoSans-VF.ttf
 *
 * Re-run after a font change, then regenerate the export's embedded copy so the
 * cooking view ships the same bytes:
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

/** The full variable Noto Sans, the only source that still has the Number Forms. */
const FULL_SOURCE = resolve(ROOT, '.fonts/NotoSans-VF.ttf');

/**
 * The characters of the fractions face: the whole Number Forms block the app's
 * AQ table can use, the Latin-1 fraction glyphs (already in the latin subset,
 * repeated for safety) and the narrow no-break space every quantity uses.
 */
const FRACTION_CHARS =
  '\u202F' +
  '\u2150\u2151\u2152\u2153\u2154\u2155\u2156\u2157\u2158\u2159\u215A\u215B\u215C\u215D\u215E\u2189' +
  '\u00BC\u00BD\u00BE';

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

// The fractions face: only the twenty characters above, with the width and
// contrast axes pinned so the file stays a few kilobytes.
writeFace(
  'noto-sans-fractions.woff2',
  await subsetFont(
    readFont(FULL_SOURCE, 'download it from https://github.com/notofonts/noto-fonts'),
    FRACTION_CHARS,
    {
      targetFormat: 'woff2',
      variationAxes: { wdth: 100, CTGR: 0 },
    },
  ),
);
