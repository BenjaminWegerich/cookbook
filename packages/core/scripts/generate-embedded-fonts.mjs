#!/usr/bin/env node
/**
 * Generates `src/recipe/embeddedFonts.ts` from the export theme faces' WOFF2
 * files (docs/DESIGN.md §4.8).
 *
 * The faces are the three selectable shortlist faces — Noto Sans and Noto Serif
 * each upright and italic, Noto Serif Display upright only — plus the fraction
 * companions that complete the two body families. The retired condensed and
 * mono faces are gone: they are no longer selectable and no longer embedded, so
 * a stored recipe that still names one exports in the fallback stack.
 *
 * The source of the bytes are the committed WOFF2 files the web app serves
 * (`apps/web/src/fonts`, built by apps/web/scripts/generate-noto-faces.mjs from
 * the `@fontsource-variable` packages and the generated fraction companions).
 * Each latin face covers Basic Latin + Latin-1 (the German letters ä ö ü ß Ä Ö
 * Ü included) plus the typographic punctuation the export renders („ " ' – — …)
 * — so the inlined font stays practical in size while covering everything the
 * cooking view draws. That coverage is a superset of DESIGN §4.8's requirement,
 * which is the point of "subset to the required coverage" there.
 *
 * The italics are the drawn faces of DESIGN §4.2/§5.4, not a synthesized
 * oblique: the export styles arrangement notes, the `optional` marker and the
 * passive right-hand annotations with `font-style: italic`, so the family must
 * carry a real italic face or the browser slants the upright one.
 *
 * The latin subsets omit the Number Forms fraction glyphs, so every export body
 * face also embeds its own fraction companion (U+2150–215E, U+2189) plus the
 * narrow no-break space (U+202F) — one per style, so a quantity inside an
 * italic run keeps the italic design. Noto Serif Display gets none: it only
 * renders page headings, which carry no quantities.
 *
 * All eight embedded faces are variable fonts covering the whole weight axis,
 * so each is embedded once and declared over the two weights the cooking view
 * uses (`400 600`, DESIGN §4.2). Their companions do the same.
 *
 * The generator is a drift guard like the other `generate-*` scripts: a missing,
 * empty or non-WOFF2 file fails the run with an explicit message. Keeping the
 * emitted key sets in step with `theme.ts`'s THEME_FONT_VALUES is a test's job
 * (theme.test.ts), because a `.mjs` script cannot import the TypeScript
 * shortlist.
 *
 * Usage:
 *   npm run generate:fonts   (from packages/core)
 *
 * After a font change (a shortlist face, a package upgrade) re-run this script
 * and commit the regenerated file. The generated module is committed so the
 * framework-free core package embeds the fonts without parsing anything at
 * runtime (same pattern as generate-ladder.mjs / generate-additional-data.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/recipe/embeddedFonts.ts');

/**
 * The export theme faces in DESIGN §4.8 order: family → its committed latin
 * WOFF2 (the same file the web app serves) → the CSS style it is declared in.
 * A family appears once per style. Noto Serif Display has no italic entry: it
 * is a heading face and no heading is italic.
 */
const FONTS = [
  { family: 'Noto Sans', style: 'normal', path: 'apps/web/src/fonts/noto-sans-latin.woff2' },
  { family: 'Noto Sans', style: 'italic', path: 'apps/web/src/fonts/noto-sans-latin-italic.woff2' },
  { family: 'Noto Serif', style: 'normal', path: 'apps/web/src/fonts/noto-serif-latin.woff2' },
  {
    family: 'Noto Serif',
    style: 'italic',
    path: 'apps/web/src/fonts/noto-serif-latin-italic.woff2',
  },
  {
    family: 'Noto Serif Display',
    style: 'normal',
    path: 'apps/web/src/fonts/noto-serif-display-latin.woff2',
  },
];

/**
 * The fraction companions of the export body faces (DESIGN §4.8, §7), keyed by
 * the theme family and style whose latin face they complete. Noto Serif Display
 * is absent: it renders page headings only and carries no quantities.
 */
const COMPANIONS = [
  { family: 'Noto Sans', style: 'normal', path: 'apps/web/src/fonts/noto-sans-fractions.woff2' },
  {
    family: 'Noto Sans',
    style: 'italic',
    path: 'apps/web/src/fonts/noto-sans-fractions-italic.woff2',
  },
  { family: 'Noto Serif', style: 'normal', path: 'apps/web/src/fonts/noto-serif-fractions.woff2' },
  {
    family: 'Noto Serif',
    style: 'italic',
    path: 'apps/web/src/fonts/noto-serif-fractions-italic.woff2',
  },
];

/** The `unicode-range` of every fraction companion; shared with styles/fonts.css. */
const COMPANION_UNICODE_RANGE = 'U+202F, U+2150-215E, U+2189';

/** First four bytes of a WOFF2 file (`wOF2`). */
const WOFF2_MAGIC = [0x77, 0x4f, 0x46, 0x32];

/**
 * Reads one WOFF2 file and returns its base64-encoded bytes. Fails loudly on a
 * missing, empty or non-WOFF2 file so a bad font never ships silently.
 */
function readWoff2(path) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    throw new Error(`missing font file ${path} — run npm install first`);
  }
  if (buffer.length === 0) {
    throw new Error(`empty font file ${path}`);
  }
  for (let i = 0; i < WOFF2_MAGIC.length; i++) {
    if (buffer[i] !== WOFF2_MAGIC[i]) {
      throw new Error(`${path} is not a WOFF2 file (bad magic bytes)`);
    }
  }
  return buffer.toString('base64');
}

/** The face of one shortlist family and style: weight range plus base64 bytes. */
function buildFace(font) {
  return {
    style: font.style,
    weight: '400 600',
    base64: readWoff2(resolve(ROOT, font.path)),
  };
}

/** The fraction companion of one body family and style: narrow range plus base64 bytes. */
function buildCompanion(companion) {
  return {
    style: companion.style,
    weight: '400 600',
    unicodeRange: COMPANION_UNICODE_RANGE,
    base64: readWoff2(resolve(ROOT, companion.path)),
  };
}

/**
 * Groups faces by family, preserving the FONTS/COMPANIONS order, so each family
 * emits one array holding its upright face first and its italic second — the
 * order a reader scans and the order the tests assert.
 */
function groupByFamily(entries, build) {
  /** @type {Map<string, object[]>} */
  const byFamily = new Map();
  for (const entry of entries) {
    const faces = byFamily.get(entry.family) ?? [];
    faces.push(build(entry));
    byFamily.set(entry.family, faces);
  }
  return byFamily;
}

/** Renders one `EmbeddedFontFace` object literal. */
function renderFace(face) {
  const fields = [`style: ${JSON.stringify(face.style)}`, `weight: ${JSON.stringify(face.weight)}`];
  if (face.unicodeRange !== undefined) {
    fields.push(`unicodeRange: ${JSON.stringify(face.unicodeRange)}`);
  }
  fields.push(`base64: '${face.base64}'`);
  return `    { ${fields.join(', ')} },`;
}

/** Renders a `Record<string, readonly EmbeddedFontFace[]>` literal. */
function renderRecord(name, byFamily) {
  const lines = [`export const ${name}: Readonly<Record<string, readonly EmbeddedFontFace[]>> = {`];
  for (const [family, faces] of byFamily) {
    lines.push(`  ${JSON.stringify(family)}: [`);
    for (const face of faces) lines.push(renderFace(face));
    lines.push('  ],');
  }
  lines.push('};');
  return lines.join('\n');
}

/** Renders the TypeScript module. */
function render(facesByFamily, companionsByFamily) {
  return [
    '/**',
    " * AUTO-GENERATED from the theme faces' WOFF2 files by",
    ' * scripts/generate-embedded-fonts.mjs (the @fontsource latin subsets, plus the',
    ' * generated fraction and narrow-space companion faces).',
    " * Do not edit by hand — re-run 'npm run generate:fonts' (packages/core) after a font change.",
    ' */',
    '',
    '/** One embedded font face: its CSS style and weight, and its subsetted WOFF2 bytes. */',
    'export interface EmbeddedFontFace {',
    '  /** CSS `font-style`: the drawn upright or italic face of the family, never a synthesis. */',
    "  readonly style: 'normal' | 'italic';",
    '  /** CSS `font-weight` value: `400` / `600` for a static face, `400 600` for a variable face. */',
    '  readonly weight: string;',
    '  /** The subsetted WOFF2 bytes, base64-encoded (without the `data:` prefix). */',
    '  readonly base64: string;',
    '  /** The CSS `unicode-range` when the face covers only a few characters. */',
    '  readonly unicodeRange?: string;',
    '}',
    '',
    '/**',
    ' * The export theme faces (DESIGN §4.8), keyed by the theme `font`',
    ' * name — the same names theme.ts exposes in THEME_FONT_VALUES. Each family',
    ' * lists its upright face and, where one exists, its drawn italic face: the',
    ' * export sets notes, the `optional` marker and the passive annotations in',
    ' * italic (§4.2, §5.4), and those must not be a synthesized oblique. Each face',
    ' * is the latin subset: Basic Latin + Latin-1 (German letters included) plus',
    ' * the typographic punctuation the cooking view renders, so the embedded font',
    ' * stays practical in size.',
    ' */',
    renderRecord('EMBEDDED_FONTS', facesByFamily),
    '',
    '/**',
    ' * The fraction companions of the export body faces (DESIGN §4.8, §7): the',
    ' * Number Forms fraction glyphs and the narrow no-break space (U+202F), which',
    ' * the latin subsets omit. Every body family embeds one per style, so a',
    ' * quantity inside an italic note keeps the italic design. Each face is',
    ' * declared with a `unicode-range` that excludes these characters, so the',
    ' * browser takes them from the matching companion and a quantity keeps both its',
    ' * fraction design and its number/unit gap ("300 g", "1 ½ Becher"). Noto Serif',
    ' * Display has no entry: it renders page headings only, and those carry no',
    ' * quantities.',
    ' */',
    renderRecord('EMBEDDED_FONT_COMPANIONS', companionsByFamily),
    '',
  ].join('\n');
}

let output = render(groupByFamily(FONTS, buildFace), groupByFamily(COMPANIONS, buildCompanion));
try {
  // Format with Prettier (root devDependency, used by `npm run format`) so the
  // committed generated module is prettier-clean and regeneration is idempotent
  // — `npm run format` would otherwise produce diff noise. The project config
  // (.prettierrc.json) is resolved explicitly because the generator's CWD may
  // differ from the repo root.
  const { format, resolveConfig } = await import('prettier');
  const config = await resolveConfig(OUT_PATH);
  output = await format(output, { ...config, parser: 'typescript' });
} catch {
  // Prettier not installed — the raw render is still valid TypeScript.
}
writeFileSync(OUT_PATH, output, 'utf8');
const faceCount = FONTS.length;
const companionCount = COMPANIONS.length;
console.log(
  `Wrote ${new Set(FONTS.map((f) => f.family)).size} families (${faceCount} faces, ${companionCount} companions) to ${OUT_PATH}`,
);
