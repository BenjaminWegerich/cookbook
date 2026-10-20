#!/usr/bin/env node
/**
 * Generates `src/recipe/embeddedFonts.ts` from the export font shortlist's
 * WOFF2 files (docs/DESIGN.md §4.8).
 *
 * The source of the bytes are the committed latin WOFF2 files the web app
 * serves (`apps/web/src/fonts`, built by apps/web/scripts/generate-noto-faces.mjs
 * from the `@fontsource-variable` packages and one generated instance). Each
 * face covers Basic Latin + Latin-1 (the German letters ä ö ü ß Ä Ö Ü included)
 * plus the typographic punctuation the export renders („ " ' – — …) — so the
 * inlined font stays practical in size while covering everything the cooking
 * view draws. That coverage is a superset of DESIGN §4.8's requirement, which
 * is the point of "subset to the required coverage" there.
 *
 * All five shortlist faces are variable fonts covering the whole weight axis,
 * so each is embedded once and declared over the two weights the cooking view
 * uses (`400 600`, DESIGN §4.2).
 *
 * The generator is a drift guard like the other `generate-*` scripts: a missing,
 * empty or non-WOFF2 file fails the run with an explicit message. Keeping the
 * emitted key set in step with `theme.ts`'s THEME_FONT_SHORTLIST is a test's
 * job (theme.test.ts), because a `.mjs` script cannot import the TypeScript
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
 * The export font shortlist in DESIGN §4.8 order, mapped to the committed
 * latin WOFF2 the web app also serves (apps/web/src/fonts). The export embeds
 * those exact files, so a themed cooking view and its editor preview render
 * identical bytes; the web app's fraction companion is not needed here, because
 * the cooking view renders fractions in the slash form (§7).
 */
const FONTS = [
  { family: 'Noto Sans', path: 'apps/web/src/fonts/noto-sans-latin.woff2' },
  { family: 'Noto Serif', path: 'apps/web/src/fonts/noto-serif-latin.woff2' },
  {
    family: 'Noto Serif Display',
    path: 'apps/web/src/fonts/noto-serif-display-latin.woff2',
  },
  { family: 'Noto Sans Mono', path: 'apps/web/src/fonts/noto-sans-mono-latin.woff2' },
  {
    family: 'Noto Sans Condensed',
    path: 'apps/web/src/fonts/noto-sans-condensed.woff2',
  },
];

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
  } catch (error) {
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

/** The face of one shortlist family: weight range plus base64 bytes. */
function buildFaces(font) {
  return [{ weight: '400 600', base64: readWoff2(resolve(ROOT, font.path)) }];
}

/**
 * The Noto Sans companion face the exports embed beside every theme face: the
 * Number Forms block and the narrow no-break space (U+202F). The latin subsets
 * have no glyph for the narrow space, so without this face a quantity would
 * lose the gap between number and unit ("300g"). The range is shared with the
 * web app's styles/fonts.css.
 */
const COMPANION = {
  weight: '400 600',
  unicodeRange: 'U+202F, U+2150-215E, U+2189',
  base64: readWoff2(resolve(ROOT, 'apps/web/src/fonts/noto-sans-fractions.woff2')),
};

/** Renders the TypeScript module. */
function render(byFamily) {
  const lines = [];
  lines.push('/**');
  lines.push(" * AUTO-GENERATED from the shortlist faces' WOFF2 files by");
  lines.push(' * scripts/generate-embedded-fonts.mjs (the @fontsource latin subsets, plus the');
  lines.push(" * web app's generated Noto Sans Condensed and fraction/space companion faces).");
  lines.push(
    " * Do not edit by hand — re-run 'npm run generate:fonts' (packages/core) after a font change.",
  );
  lines.push(' */');
  lines.push('');
  lines.push(
    '/** One embedded font face: the CSS weight it covers and its subsetted WOFF2 bytes. */',
  );
  lines.push('export interface EmbeddedFontFace {');
  lines.push(
    '  /** CSS `font-weight` value: `400` / `600` for a static face, `400 600` for a variable face. */',
  );
  lines.push('  readonly weight: string;');
  lines.push('  /** The subsetted WOFF2 bytes, base64-encoded (without the `data:` prefix). */');
  lines.push('  readonly base64: string;');
  lines.push('  /** The CSS `unicode-range` when the face covers only a few characters. */');
  lines.push('  readonly unicodeRange?: string;');
  lines.push('}');
  lines.push('');
  lines.push('/**');
  lines.push(" * The export font shortlist's faces (DESIGN §4.8), keyed by the theme `font`");
  lines.push(' * name — the same names theme.ts exposes in THEME_FONT_SHORTLIST. Each face is');
  lines.push(' * the latin subset: Basic Latin + Latin-1 (German letters included) plus the');
  lines.push(' * typographic punctuation the cooking view renders, so the embedded font stays');
  lines.push(' * practical in size.');
  lines.push(' */');
  lines.push(
    'export const EMBEDDED_FONTS: Readonly<Record<string, readonly EmbeddedFontFace[]>> = {',
  );
  for (const [family, faces] of byFamily) {
    lines.push(`  ${JSON.stringify(family)}: [`);
    for (const face of faces) {
      lines.push(`    { weight: ${JSON.stringify(face.weight)}, base64: '${face.base64}' },`);
    }
    lines.push('  ],');
  }
  lines.push('};');
  lines.push('');
  lines.push('/**');
  lines.push(' * The companion face every export embeds beside the theme face (DESIGN §4.8):');
  lines.push(' * the Number Forms fraction glyphs and the narrow no-break space (U+202F), which');
  lines.push(' * the latin subsets omit. The theme face itself is declared with a `unicode-range`');
  lines.push(' * that excludes these characters, so the browser takes them from this face and a');
  lines.push(' * quantity keeps its number/unit gap ("300 g").');
  lines.push(' */');
  lines.push('export const EMBEDDED_FONT_COMPANION: EmbeddedFontFace = {');
  lines.push(`  weight: ${JSON.stringify(COMPANION.weight)},`);
  lines.push(`  unicodeRange: ${JSON.stringify(COMPANION.unicodeRange)},`);
  lines.push(`  base64: '${COMPANION.base64}',`);
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const byFamily = FONTS.map((font) => [font.family, buildFaces(font)]);
let output = render(byFamily);
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
const faceCount = byFamily.reduce((sum, [, faces]) => sum + faces.length, 0);
console.log(`Wrote ${byFamily.length} families (${faceCount} faces) to ${OUT_PATH}`);
