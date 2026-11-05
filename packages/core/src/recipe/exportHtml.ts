/**
 * HTML export generator — the cooking view (docs/ARCHITECTURE.md, "HTML share export",
 * docs/DESIGN.md §5.11).
 *
 * Produces a self-contained HTML file for a recipe with *pre-computed* display
 * values: for every allowed size the complete cooking view is baked into the
 * file — the scaled reference readout, the scaled master ingredient list, the
 * scaled per-step ingredient lists and the step prose with its scaled inline
 * artifacts. No master data and no scaling/display logic run at runtime; the
 * embedded script only toggles visibility (the size picker, the three screens
 * Intro → Zutaten → Zubereitung and the step-by-step navigation).
 *
 * The cooking view is one page with three screen states (§5.11): the Intro
 * (the photo, title, description, meta, size picker, reference readout, the
 * „Erstellt mit Cookbook" brand), the Zutaten check list and the Zubereitung
 * steps shown one
 * at a time. A fixed bottom bar carries the „Zurück" / „Weiter" buttons and the
 * flow dots; a swipe, Escape and the browser Back/Forward keys move through the
 * flow. The recipe's theme skins the whole view (§4.8): its typeface and
 * palette, plus the derived `muted` and `on-accent` colours computed here.
 *
 * The allowed sizes depend on the recipe type:
 *
 * - a **finished dish** has the allowed serving counts (servingSizes.ts, 18
 *   options), exactly what the meal plan accepts;
 * - an **ingredient recipe** has the allowed BQ yields within ±1 decade of its
 *   written yield (`recipe/yieldViews.ts`), which is the same range the meal
 *   plan accepts — so the link in a Keep line can always open the exact amount.
 *   Its yield picker uses the app's adaptive chip logic (`suggestQuantities`,
 *   including the recipe's master-data AU links) with the baked views as a hard
 *   cap; one pre-rendered row per view keeps the chips recentred while the
 *   script only fits and toggles them.
 *
 * The page opens on the recipe's written size, or on the size the URL asks for
 * (`?portionen=6` on the export host, `#portionen=6` on a bare Drive link — the
 * parameter names live in `planLink.ts`, where the meal-plan writer and reader
 * use them too). Keep has no hyperlink-with-text, so a meal-plan entry carries
 * the raw export URL; the export host additionally injects the size as
 * `window.__COOKBOOK_PLAN_SIZE__` and preselects the view with a `<style>`
 * element, because its sandbox iframe hides the outer URL from the page.
 *
 * The app stores the export as `<title>.html` next to the recipe file and
 * regenerates it in place on every save, so shared links never break
 * (docs/ARCHITECTURE.md, HTML share export).
 *
 * Sub-recipe links: when the caller passes a `links` map (ingredient-recipe
 * title → URL, e.g. the Drive link of the sub-recipe's own `<title>.html`),
 * every ingredient use whose name is present in the map — a master row, a step
 * row or an inline text artifact — makes that name the link that opens the
 * export in a new tab (recipe_structure.md "The link means"; links are
 * implicit by name == recipe title, storage_format.md §4). Without a URL for a
 * title the display line stays plain text.
 *
 * The link also promises the *amount* the use needs at the view it is shown
 * in: the URL carries it as the meal-plan size parameter (`&menge=500ml` on the
 * export host, `#menge=500ml` on a Drive link, planLink.ts), so the sub-recipe
 * opens scaled to what the parent cooks instead of its written yield. The
 * amount is snapped to an allowed BQ value, because only BQ values are baked
 * views of an ingredient recipe (yieldViews.ts); a use outside the target's
 * ±1 decade band still falls back to its written yield.
 *
 * The recipe's photo (§5.8) is embedded the same self-contained way: the caller
 * passes its base64-encoded bytes and the export inlines them as a `data:` URI
 * at the top of the Intro, so the file needs no sibling image and no network.
 * A recipe without a photo omits the media area entirely — the Intro starts
 * with the title.
 *
 * All recipe content is HTML-escaped: recipe data is user/AI-authored text and
 * must never be able to inject markup into the exported file.
 */

import {
  EN_SPACE,
  formatAQValue,
  formatBQ,
  formatDecimal,
  renderAQSDisplay,
  renderMasterAQSDisplay,
  type ArrangementDisplay,
  type ArrangementDisplayPart,
} from '../additionalUnits.js';
import { mappingsFor } from '../ingredientRegistry.js';
import { optimizeUnitless } from '../quantityOptimizer.js';
import { suggestQuantities } from '../quantitySuggestions.js';
import { nearestAllowedBQ, previousAllowedBQ } from '../quantityValues.js';
import { SERVING_COUNTS } from '../servingSizes.js';
import { resolveSizeMarker, sizeMarkerFallbackText } from '../sizeMarkers.js';
import type { PrecisionContext } from '../precision.js';
import { escapeHtml, renderArtifacts } from './artifacts.js';
import type { QuantityArtifact, TextArtifact } from './artifacts.js';
import { masterUsesFor } from './masterQuantity.js';
import {
  PLAN_FRAGMENT_SERVINGS,
  PLAN_FRAGMENT_YIELD,
  PLAN_PRESELECT_ELEMENT_ID,
  convertYieldUnit,
  formatLinkQuantity,
  withPlanSize,
} from '../planLink.js';
import { resolveTheme, resolveThemeFonts } from './theme.js';
import type { ResolvedTheme } from './theme.js';
import { displayTimeText } from './timeValues.js';
import { defaultYieldView, yieldViewQuantities } from './yieldViews.js';
import type { Ingredient, MasterIngredient, Recipe, Step, Unit } from './types.js';
import { EMBEDDED_FONT_COMPANIONS, EMBEDDED_FONTS } from './embeddedFonts.js';

/**
 * The recipe photo, encoded for embedding in the export (DESIGN §5.8). The
 * caller — the web app's storage layer — downloads the photo sibling and
 * base64-encodes it; the export only inlines the bytes, it never fetches. The
 * `data:` URI is built here, so `mimeType` is restricted to the two the
 * storage format allows (storage_format.md §2: `.jpg` / `.png`).
 */
export interface RecipePhoto {
  /** MIME type of the encoded bytes. */
  mimeType: 'image/jpeg' | 'image/png';
  /** The bytes, base64-encoded, without the `data:` prefix. */
  base64: string;
}

/**
 * The theme's five stored tokens plus the derived colours, as CSS custom
 * properties on `:root`. The derived colours are computed here (solid hex, no
 * `color-mix`, no opacity) so the self-contained export renders them in every
 * browser (§4.8):
 *
 * - `muted` is `ink` blended 40 % toward `paper`;
 * - `on-accent` is `ink` when the accent is light, `paper` otherwise — the
 *   choice whose contrast against `accent` is the higher (WCAG AA);
 * - `press` is `ink` blended 12 % onto `paper`: the solid equivalent of the
 *   app's shared press wash for a control whose fill is the page colour;
 * - `surface` is `paper` lifted 45 % toward white: the raised sheet the
 *   ingredient rows sit on (§5.4). The cooking view is always light, so the
 *   lift stays a warm off-white for every theme palette.
 */

/** Parses a 6-digit hex colour into its RGB channels (0–255). */
function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace(/^#/, '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** Linearizes one sRGB channel for WCAG relative luminance. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a 6-digit hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two 6-digit hex colours (1–21). */
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** Blends two 6-digit hex colours with `weight` of the first (0–1), as hex. */
function blend(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const channel = (x: number, y: number): number => Math.round(x * weight + y * (1 - weight));
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(channel(ar, br))}${toHex(channel(ag, bg))}${toHex(channel(ab, bb))}`;
}

/** The resolved theme plus its derived colours, as a `:root` rule. */
function themeCss(theme: ResolvedTheme): string {
  const muted = blend(theme.ink, theme.paper, 0.6);
  const onAccent =
    contrastRatio(theme.ink, theme.accent) >= contrastRatio(theme.paper, theme.accent)
      ? theme.ink
      : theme.paper;
  // The app paints its press feedback as a 12 % ink layer over the control's
  // own fill; in the export a control's fill is the page's paper, so the same
  // look is one solid colour computed once here.
  const press = blend(theme.ink, theme.paper, 0.12);
  // The ingredient lists are one raised sheet on the paper page. A light mix
  // toward white reads as a card in every light theme and keeps the hairline
  // borders visible on a paper that is already close to white.
  const surface = blend(theme.paper, '#ffffff', 0.55);
  const fonts = resolveThemeFonts(theme.font);
  const headingFallback = fonts.heading === fonts.body ? '' : `'${fonts.body}', `;
  return (
    `:root {\n` +
    `  --theme-font: '${theme.font}';\n` +
    `  --theme-accent: ${theme.accent};\n` +
    `  --theme-paper: ${theme.paper};\n` +
    `  --theme-ink: ${theme.ink};\n` +
    `  --theme-line: ${theme.line};\n` +
    // The applied font tokens. Body text uses the theme's body face; only the
    // page headings use the heading face — for Noto Serif Display that is the
    // book serif for the body (see resolveThemeFonts). Both faces are embedded
    // as self-hosted WOFF2 `@font-face` rules (see fontFaceCss below); the
    // system-ui stack remains the fallback for a face without an embedded font
    // (§4.8). A heading face that differs from the body face falls back to the
    // body face first, so a character the heading face lacks (a fraction or
    // U+202F in a page title) keeps the theme's design and uses the body face's
    // companion instead of the operating system's font.
    `  --font: '${fonts.body}', system-ui, sans-serif;\n` +
    `  --font-heading: '${fonts.heading}', ${headingFallback}system-ui, sans-serif;\n` +
    `  --paper: var(--theme-paper);\n` +
    `  --ink: var(--theme-ink);\n` +
    `  --accent: var(--theme-accent);\n` +
    `  --line: var(--theme-line);\n` +
    `  --muted: ${muted};\n` +
    `  --on-accent: ${onAccent};\n` +
    `  --press: ${press};\n` +
    `  --surface: ${surface};\n` +
    `}`
  );
}

/**
 * The latin coverage of the theme faces (DESIGN §4.8), minus U+202F and the
 * Number Forms block: those characters belong to the companion face, so the
 * browser never selects the theme face first for the narrow no-break space.
 */
const THEME_FACE_UNICODE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
  'U+0304, U+0308, U+0329, U+2000-202E, U+2030-206F, U+20AC, U+2122, U+2191, ' +
  'U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/**
 * The `@font-face` rules of one family, or '' when the family has no embedded
 * face (§4.8). The faces are the latin subset of the theme typeface
 * (embeddedFonts.ts), inlined as a `data:` URI so the export stays
 * self-contained: no runtime font fetch and no sibling file. Every embedded
 * face is a variable font, declared once over the two weights the cooking view
 * uses (`400 600`, §4.2).
 *
 * A body family carries two styles: the upright face and the drawn italic face.
 * The export sets arrangement notes, the `optional` marker and the passive
 * annotations in italic (§4.2, §5.4); without the real face the browser would
 * synthesize an oblique from the upright file, which distorts curves, weight and
 * spacing.
 *
 * A matching companion face follows every export body family and style under
 * the same name. It supplies the narrow no-break space (U+202F) every quantity
 * uses and the Number Forms fraction glyphs of §7; the family's `unicode-range`
 * excludes both, so the browser takes them from the companion. Without it the
 * number and its unit lose their gap ("300g") in browsers that fall back
 * without a space glyph, and the fractions would come from a foreign fallback
 * font. Noto Serif Display has no companion: it renders page headings only and
 * carries no quantities.
 */
function familyFaceCss(family: string): string {
  const faces = EMBEDDED_FONTS[family];
  if (faces === undefined) return '';
  const themeFaces = faces
    .map(
      (face) =>
        `@font-face {\n` +
        `  font-family: '${family}';\n` +
        `  font-style: ${face.style};\n` +
        `  font-display: swap;\n` +
        `  font-weight: ${face.weight};\n` +
        `  unicode-range: ${THEME_FACE_UNICODE_RANGE};\n` +
        `  src: url(data:font/woff2;base64,${face.base64}) format('woff2');\n` +
        `}`,
    )
    .join('\n');
  const companions = EMBEDDED_FONT_COMPANIONS[family];
  if (companions === undefined) return themeFaces;
  const companionCss = companions
    .map(
      (companion) =>
        `@font-face {\n` +
        `  font-family: '${family}';\n` +
        `  font-style: ${companion.style};\n` +
        `  font-display: swap;\n` +
        `  font-weight: ${companion.weight};\n` +
        `  unicode-range: ${companion.unicodeRange};\n` +
        `  src: url(data:font/woff2;base64,${companion.base64}) format('woff2');\n` +
        `}`,
    )
    .join('\n');
  return `${themeFaces}\n${companionCss}`;
}

/**
 * The `@font-face` rules of the theme's heading and body faces. They are the
 * same family for every theme but Noto Serif Display, whose body is the book
 * serif (see resolveThemeFonts) — that theme embeds both faces, so the export
 * stays self-contained.
 */
function fontFaceCss(theme: ResolvedTheme): string {
  const fonts = resolveThemeFonts(theme.font);
  const families = fonts.heading === fonts.body ? [fonts.heading] : [fonts.heading, fonts.body];
  return families.map(familyFaceCss).join('\n');
}

/**
 * Inline SVG symbols (DESIGN §4.5, Material Symbols Rounded, weight 400), drawn
 * on the family's native `0 0 960 960` grid with `fill="currentColor"`. Each is
 * decorative (`aria-hidden`) beside a visible label or link text.
 */

/** The Cookbook brand mark (menu book 2) beside „Erstellt mit Cookbook". */
const BRAND_SVG =
  '<svg viewBox="0 0 960 960" width="20" height="20" aria-hidden="true" focusable="false">' +
  '<g transform="translate(0 960)"><path d="M240-80q-33 0-56.5-23.5T160-160v-80q-17 0-28.5-11.5T120-280q0-17 11.5-28.5T160-320v-120q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520v-120q-17 0-28.5-11.5T120-680q0-17 11.5-28.5T160-720v-80q0-33 23.5-56.5T240-880h480q33 0 56.5 23.5T800-800v640q0 33-23.5 56.5T720-80H240Zm0-80h480v-640H240v80q17 0 28.5 11.5T280-680q0 17-11.5 28.5T240-640v120q17 0 28.5 11.5T280-480q0 17-11.5 28.5T240-440v120q17 0 28.5 11.5T280-280q0 17-11.5 28.5T240-240v80Zm140-280v130q0 13 8.5 21.5T410-280q13 0 21.5-8.5T440-310v-130q26-7 43-28.5t17-48.5v-143q0-8-6-14t-14-6q-8 0-14 6t-6 14v131h-30v-131q0-8-6-14t-14-6q-8 0-14 6t-6 14v131h-30v-131q0-8-6-14t-14-6q-8 0-14 6t-6 14v143q0 27 17 48.5t43 28.5Zm220 0v130q0 13 8.5 21.5T630-280q13 0 21.5-8.5T660-310v-347q0-11-7.5-17t-19.5-6q-13 0-28.5 7T575-652q-17 17-26 38.5t-9 46.5v87q0 17 11.5 28.5T580-440h20ZM240-160v-640 640Z" fill="currentColor"/></g></svg>';

/** Left arrow of the „Zurück" button. */
const BACK_ARROW_SVG =
  '<svg viewBox="0 0 960 960" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path d="M313,520L509,716Q521,728 520.5,744Q520,760 508,772Q496,783 480,783.5Q464,784 452,772L188,508Q182,502 179.5,495Q177,488 177,480Q177,472 179.5,465Q182,458 188,452L452,188Q463,177 479.5,177Q496,177 508,188Q520,200 520,216.5Q520,233 508,245L313,440L760,440Q777,440 788.5,451.5Q800,463 800,480Q800,497 788.5,508.5Q777,520 760,520L313,520Z" fill="currentColor"/></svg>';

/** Right arrow of the „Weiter" button. */
const FORWARD_ARROW_SVG =
  '<svg viewBox="0 0 960 960" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path d="M647,520L200,520Q183,520 171.5,508.5Q160,497 160,480Q160,463 171.5,451.5Q183,440 200,440L647,440L451,244Q439,232 439.5,216Q440,200 452,188Q464,177 480,176.5Q496,176 508,188L772,452Q778,458 780.5,465Q783,472 783,480Q783,488 780.5,495Q778,502 772,508L508,772Q497,783 480.5,783Q464,783 452,772Q440,760 440,743.5Q440,727 452,715L647,520Z" fill="currentColor"/></svg>';

/** Minus of the yield stepper's „Menge verringern" button (Material `remove`). */
const STEP_DOWN_SVG =
  '<svg viewBox="0 0 960 960" aria-hidden="true" focusable="false">' +
  '<path d="M240,520Q223,520 211.5,508.5Q200,497 200,480Q200,463 211.5,451.5Q223,440 240,440L720,440Q737,440 748.5,451.5Q760,463 760,480Q760,497 748.5,508.5Q737,520 720,520L240,520Z" fill="currentColor"/></svg>';

/** Plus of the yield stepper's „Menge erhöhen" button (Material `add`). */
const STEP_UP_SVG =
  '<svg viewBox="0 0 960 960" aria-hidden="true" focusable="false">' +
  '<path d="M440,520L240,520Q223,520 211.5,508.5Q200,497 200,480Q200,463 211.5,451.5Q223,440 240,440L440,440L440,240Q440,223 451.5,211.5Q463,200 480,200Q497,200 508.5,211.5Q520,223 520,240L520,440L720,440Q737,440 748.5,451.5Q760,463 760,480Q760,497 748.5,508.5Q737,520 720,520L520,520L520,720Q520,737 508.5,748.5Q497,760 480,760Q463,760 451.5,748.5Q440,737 440,720L440,520Z" fill="currentColor"/></svg>';

/**
 * The invisible width probe of the yield stepper's value slot. Every baked view
 * is an allowed BQ, so the app's free-input probe ("999,99 ml") would reserve
 * decimals this picker can never show. 950 is the largest BQ under 1000 (the
 * decade block is 10…95 × 10ⁿ); above 1000 the display steps to kg / l and stays
 * within the same width for every realistic yield. Derived from the BQ table,
 * not hand-tuned.
 */
const YIELD_VALUE_PROBE_BQ = previousAllowedBQ(1000) ?? 950;

/** The precision context of an ingredient use in a recipe. */
function ingredientContext(ingredient: Ingredient): PrecisionContext {
  return {
    ...(ingredient.precision !== undefined ? { quantity: ingredient.precision } : {}),
  };
}

/** The precision context of an inline artifact in a recipe. */
function artifactContext(artifact: QuantityArtifact): PrecisionContext {
  return {
    ...(artifact.precision !== undefined ? { quantity: artifact.precision } : {}),
  };
}

/**
 * Renders a unitless inline count. It has no ingredient and no base unit, so
 * only the “BQ only” branch applies: the count is chosen from the AQ table with
 * the accuracy/roundness weights. If no AQ value fits, the unrounded target is
 * shown as a decimal.
 */
function unitlessText(value: number, context: PrecisionContext): string {
  const result = optimizeUnitless(value, context);
  return result.notation === undefined ? formatDecimal(result.value) : formatAQValue(result.value);
}

/** A whole-word boundary test for ingredient names: letters and digits count. */
function isNameChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/**
 * Finds `word` as a whole word in `text`, or -1. The name must not be matched
 * inside a longer word: "Zwiebel" is not a match inside "Zwiebeln".
 */
function wholeWordIndex(text: string, word: string): number {
  let from = 0;
  for (;;) {
    const index = text.indexOf(word, from);
    if (index < 0) return -1;
    const before = index === 0 ? undefined : text[index - 1];
    const after = index + word.length >= text.length ? undefined : text[index + word.length];
    if (!isNameChar(before) && !isNameChar(after)) return index;
    from = index + 1;
  }
}

/**
 * Every name form an arrangement may show for an ingredient: the canonical name
 * plus the master-data singular/plural forms (`<INF>` uses the latter). Longest
 * first, so "Zwiebeln" wins over the "Zwiebel" prefix of the same text.
 */
function ingredientNameForms(name: string): readonly string[] {
  const entry = mappingsFor(name);
  const forms = [entry?.singular, entry?.plural, name].filter(
    (form): form is string => form !== undefined && form !== '',
  );
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
}

/** The visible ingredient name as the sub-recipe link (§5.7). */
function nameLink(text: string, name: string, href: string): string {
  return (
    `<a class="name-link" href="${escapeHtml(href)}" target="_blank" rel="noopener" ` +
    `title="Zutaten-Rezept „${escapeHtml(name)}“ öffnen">${escapeHtml(text)}</a>`
  );
}

/**
 * Escapes one text run and, with a URL, wraps the ingredient's displayed name
 * in the sub-recipe link. `emphasizeName` additionally wraps that name in the
 * bold `.ingredient-name` run — the cooking view's ingredient rows do this, so
 * the name leads the row and the amounts stay quiet. Without a URL (or when the
 * name is not found as a whole word) the run stays plain, but an emphasized
 * name is still bold.
 */
function textRunHtml(
  text: string,
  name: string | undefined,
  href: string | undefined,
  emphasizeName: boolean,
): string {
  if (name === undefined) return escapeHtml(text);
  for (const form of ingredientNameForms(name)) {
    const index = wholeWordIndex(text, form);
    if (index < 0) continue;
    const shown = href === undefined ? escapeHtml(form) : nameLink(form, name, href);
    // The emphasis wraps the whole shown name, so a sub-recipe link stays one
    // bold link instead of splitting its target across a nested tag.
    const nameHtml = emphasizeName ? `<strong class="ingredient-name">${shown}</strong>` : shown;
    return (
      escapeHtml(text.slice(0, index)) + nameHtml + escapeHtml(text.slice(index + form.length))
    );
  }
  return escapeHtml(text);
}

/**
 * Renders an arrangement's parts. A note is lifted out of its brackets and
 * styled as the muted, italic `.arrangement-note` run: bare after an en space
 * (`bare`, every list and readout) or with its brackets and a regular space
 * (`parenthesised`, step prose) — DESIGN §5.4 / §5.11. A text run whose
 * ingredient name is found becomes the sub-recipe link when `name`/`href` are
 * given; `emphasizeName` makes that name the row's bold run.
 */
function partsHtml(
  parts: readonly ArrangementDisplayPart[],
  name: string | undefined,
  href: string | undefined,
  noteForm: 'bare' | 'parenthesised',
  emphasizeName: boolean,
): string {
  return parts
    .map((part) => {
      if (part.kind === 'note') {
        const note = escapeHtml(part.value);
        if (noteForm === 'bare') {
          return `${EN_SPACE}<span class="arrangement-note">${note}</span>`;
        }
        return ` <span class="arrangement-note">(${note})</span>`;
      }
      return textRunHtml(part.value, name, href, emphasizeName);
    })
    .join('');
}

/** Renders one arrangement display, notes lifted out (§5.4). */
function arrangementHtml(display: ArrangementDisplay, noteForm: 'bare' | 'parenthesised'): string {
  return partsHtml(display.parts, undefined, undefined, noteForm, false);
}

/**
 * Splits the arrangement at its final note. That note is the "last part" the
 * cooking view puts at the row's right edge; a display without a trailing note
 * (the base form) has no tail.
 */
function splitTail(display: ArrangementDisplay): {
  body: readonly ArrangementDisplayPart[];
  tail: string | undefined;
} {
  const last = display.parts[display.parts.length - 1];
  if (last?.kind !== 'note') {
    return { body: display.parts, tail: undefined };
  }
  return { body: display.parts.slice(0, -1), tail: last.value };
}

/**
 * A quantity-only prose artifact (`{{250 g}}`) has no name and no arrangement;
 * an ingredient mention renders through its arrangement. Step prose keeps the
 * note's brackets and a regular space (§5.11); the name is the sub-recipe link,
 * exactly as in the rows.
 */
function artifactHtml(
  name: string | undefined,
  value: number,
  bu: Unit | undefined,
  context: PrecisionContext,
  href: string | undefined,
): string {
  if (name === undefined) {
    return escapeHtml(bu === undefined ? unitlessText(value, context) : formatBQ(value, bu));
  }
  return partsHtml(
    renderAQSDisplay(name, value, bu ?? 'g', context).parts,
    name,
    href,
    'parenthesised',
    false,
  );
}

/**
 * The amount one sub-recipe use needs, in the shape the export's size
 * parameter takes: the exact scaled quantity snapped to an allowed BQ value
 * and converted to the family base unit (`kg` / `l` → `g` / `ml`).
 *
 * The snap is not cosmetic. An ingredient recipe bakes one view per allowed BQ
 * in a ±1 decade band around its written yield (`yieldViews.ts`), so an exact
 * scaled target such as 583.33 ml has no view of its own; the nearest BQ (600
 * ml here) is the amount the sub-recipe can actually open on. The band still
 * decides whether the target has that view at all — a use far outside it opens
 * on the written yield, like any other size the export does not hold.
 */
function subRecipeAmount(quantity: number, unit: Unit): { quantity: number; baseUnit: Unit } {
  // The stored unit may be a display form (`kg` / `l`) in a hand-built recipe;
  // the parser normalizes it, but the export must not depend on that caller.
  const conversion = convertYieldUnit(unit) ?? { baseUnit: unit, factor: 1 };
  return {
    quantity: nearestAllowedBQ(quantity * conversion.factor),
    baseUnit: conversion.baseUnit,
  };
}

/**
 * The URL a sub-recipe use opens: the export URL plus the amount this use needs
 * at the current baked view. The amount is snapped to an allowed BQ value
 * (`subRecipeAmount`), because only BQ values are baked views of an ingredient
 * recipe. `undefined` when the title has no link.
 */
function subRecipeHref(
  url: string | undefined,
  quantity?: number,
  unit?: Unit,
): string | undefined {
  if (url === undefined) return undefined;
  if (quantity === undefined || unit === undefined) return url;
  return withPlanSize(url, { kind: 'yield', ...subRecipeAmount(quantity, unit) });
}

/**
 * The Intro's media area (§5.8): the recipe photo as a 4:3 landscape image, or
 * '' when the recipe has none (the intro then starts with the title). The photo
 * is decorative (`alt=""`); the title beside it carries the name. The base64
 * alphabet has no HTML-special characters, so the `src` needs no escaping; an
 * empty payload is treated as "no photo" so a broken image is never emitted.
 */
function renderPhoto(photo: RecipePhoto | undefined): string {
  if (photo === undefined || photo.base64 === '') return '';
  return `  <img class="media" src="data:${photo.mimeType};base64,${photo.base64}" alt="">\n`;
}

/**
 * Renders one master row from the step uses it was merged from, through the
 * constrained master optimizer. The uses are scaled to the view, so the
 * master's BQ is the sum of the *scaled* step BQs at every baked size. A
 * hand-built recipe whose master entry has no backing row (normally impossible)
 * falls back to the plain base form instead of breaking the export.
 */
function masterDisplay(
  recipe: Recipe,
  ingredient: MasterIngredient,
  factor: number,
): ArrangementDisplay {
  const uses = masterUsesFor(recipe.steps, ingredient, factor);
  if (uses.length === 0) {
    const text = `${formatBQ(ingredient.quantity * factor, ingredient.unit)} ${ingredient.name}`;
    return { text, parts: [{ kind: 'text', value: text }] };
  }
  return renderMasterAQSDisplay(ingredient.name, uses, ingredient.unit);
}

/**
 * The reference ingredients of one view, scaled by the view's factor, as HTML
 * lines. Like every other readout, the note drops its brackets and follows one
 * en space in the muted, italic run (DESIGN §5.4/§5.11).
 */
function referenceLines(recipe: Recipe, factor: number): string[] {
  return recipe.ingredients
    .filter((ingredient) => ingredient.reference)
    .map((ingredient) => arrangementHtml(masterDisplay(recipe, ingredient, factor), 'bare'));
}

/**
 * The intro's small muted reference readout, or '' when there is none. One
 * quantity per line: the amounts are not a sentence, so they are stacked and
 * carry no comma between them (DESIGN §5.11).
 */
function renderReferenceReadout(
  recipe: Recipe,
  factor: number,
  sizeKey: string,
  sizeValue: string,
): string {
  const lines = referenceLines(recipe, factor);
  if (lines.length === 0) return '';
  const items = lines.map((line) => `    <li>${line}</li>\n`).join('');
  return `  <ul class="reference size-scoped" ${sizeKey}="${sizeValue}">\n` + `${items}  </ul>\n`;
}

/**
 * One ingredient row, shared by the master check list and every step list
 * (DESIGN §5.4). The left text starts at the row's left edge; its final note is
 * a right float at the end of that text, so it settles on the last text line
 * when it fits there and otherwise drops to its own right-aligned line.
 *
 * The master list's checkbox is the only difference between the two surfaces.
 * It is the row's leading control; its accessible name comes from the text span
 * (no `<label>`, so the sub-recipe link inside stays a link and does not toggle
 * the box). The caller owns the surrounding `<ul>`.
 */
function renderIngredientRow(
  display: ArrangementDisplay,
  name: string,
  href: string | undefined,
  checkboxId?: string,
): string {
  const { body, tail } = splitTail(display);
  const tailHtml = tail === undefined ? '' : `<span class="tail">${escapeHtml(tail)}</span>`;
  const text = `${partsHtml(body, name, href, 'bare', true)}${tailHtml}`;
  if (checkboxId === undefined) {
    return `  <li class="ingredient-row"><span class="ingredient-text">${text}</span></li>`;
  }
  return (
    `  <li class="ingredient-row check-row">` +
    `<input type="checkbox" id="${checkboxId}" aria-labelledby="t-${checkboxId}">` +
    `<span class="ingredient-text" id="t-${checkboxId}">${text}</span></li>`
  );
}

/** One checkable master-ingredient row (checkbox, quantity, optional sub-recipe link). */
function renderCheckRow(
  recipe: Recipe,
  ingredient: MasterIngredient,
  factor: number,
  links: Readonly<Record<string, string>>,
  id: string,
): string {
  return renderIngredientRow(
    masterDisplay(recipe, ingredient, factor),
    ingredient.name,
    subRecipeHref(links[ingredient.name], ingredient.quantity * factor, ingredient.unit),
    id,
  );
}

/**
 * One pre-computed Zutaten check list for a size. `sizeToken` disambiguates the
 * checkbox ids across sizes; `label` (yield recipes) carries the size's display
 * form for the stepper readout, and `isWritten` marks the fallback view.
 */
function renderCheckList(
  recipe: Recipe,
  factor: number,
  links: Readonly<Record<string, string>>,
  sizeKey: string,
  sizeValue: string,
  sizeToken: string,
  isWritten: boolean,
  label?: string,
): string {
  const rows = recipe.ingredients
    .map((ingredient, i) =>
      renderCheckRow(recipe, ingredient, factor, links, `c-${sizeToken}-${i}`),
    )
    .join('\n');
  const written = isWritten ? ' is-written' : '';
  const labelAttr = label !== undefined ? ` data-yield-label="${escapeHtml(label)}"` : '';
  return (
    `<ul class="ingredient-list check-list size-scoped${written}" ${sizeKey}="${sizeValue}"${labelAttr}` +
    ` role="group" aria-label="Zutaten">\n${rows}\n</ul>`
  );
}

/** One step block: its ingredient rows followed by the prose. */
function renderStep(
  step: Step,
  factor: number,
  links: Readonly<Record<string, string>>,
  n: number,
): string {
  const rows =
    step.ingredients.length === 0
      ? ''
      : `<ul class="ingredient-list step-rows">\n` +
        step.ingredients
          .map((ingredient) => {
            // The step list uses the exact same row as the master list; it only
            // omits the checkbox, because a step row is not checkable (§5.4).
            return renderIngredientRow(
              renderAQSDisplay(
                ingredient.name,
                ingredient.quantity * factor,
                ingredient.unit,
                ingredientContext(ingredient),
              ),
              ingredient.name,
              subRecipeHref(links[ingredient.name], ingredient.quantity * factor, ingredient.unit),
            );
          })
          .join('\n') +
        `\n</ul>\n`;
  // The prose artifacts are substituted with their scaled display form; the
  // surrounding text is HTML-escaped (renderArtifacts). An artifact that names
  // an ingredient recipe makes its name the sub-recipe link, exactly as in the
  // rows; the note keeps its brackets and regular space as prose (§5.11).
  const text = renderArtifacts(step.text, (artifact: TextArtifact) => {
    if (artifact.kind === 'size') {
      // The marker's own written arrangement is the fallback for a draft whose
      // master data is missing; a parsed canonical recipe always resolves.
      const resolved = resolveSizeMarker(artifact, factor);
      return escapeHtml(resolved === undefined ? sizeMarkerFallbackText(artifact) : resolved.text);
    }
    return artifactHtml(
      artifact.name,
      artifact.quantity * factor,
      artifact.unit,
      artifactContext(artifact),
      artifact.name !== undefined
        ? subRecipeHref(links[artifact.name], artifact.quantity * factor, artifact.unit)
        : undefined,
    );
  });
  return (
    `  <div class="step" data-step="${n}">\n` +
    `${rows}` +
    `    <p class="step-text">${text}</p>\n` +
    `  </div>`
  );
}

/** The steps of one size, wrapped for the script's size toggling. */
function renderStepWrap(
  recipe: Recipe,
  factor: number,
  links: Readonly<Record<string, string>>,
  sizeKey: string,
  sizeValue: string,
): string {
  const steps = recipe.steps.map((step, i) => renderStep(step, factor, links, i + 1)).join('\n');
  return `<div class="step-wrap size-scoped" ${sizeKey}="${sizeValue}">\n${steps}\n</div>`;
}

/** The serving picker for finished dishes (DESIGN §5.2). */
function renderServingPicker(recipe: Recipe): string {
  const buttons = SERVING_COUNTS.map((servings) => {
    const active = servings === recipe.servings;
    // A chip is one value of an exclusive set, so it is a radio: the checked
    // chip is the only tab stop and arrow keys move the choice (§5.2, §8).
    return `<button type="button" role="radio" aria-checked="${active}" tabindex="${active ? '0' : '-1'}" class="chip serving-chip${active ? ' active' : ''}" data-servings="${servings}">${servings}</button>`;
  }).join('\n    ');
  return (
    `  <p class="picker-caption">Portionen</p>\n` +
    `  <div class="chips" role="radiogroup" aria-label="Portionen wählen">\n    ${buttons}\n  </div>\n`
  );
}

/** True when two yield values are the same view (floating-point safe). */
function sameYieldValue(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

/**
 * One baked view's adaptive chip row — the ingredient sheet's logic applied to
 * the export: core's `suggestQuantities` around this view, with the recipe's
 * master-data AU links when its row exists, and the baked-view list as the hard
 * cap. The view itself is always a chip, so the row's radiogroup has a checked
 * option even when an additional unit normalizes the target to another BQ.
 *
 * The chips are rendered ascending, so the row, the arrow-key walk and the
 * screen reader all read left to right. Each chip carries its ranking as
 * `data-rank`; the one-line fit walks that ranking (highest priority first)
 * and hides the chips that do not fit, exactly like the app's
 * `SuggestionChips` (rank decides which survive, not the display order).
 */
function renderYieldChipRow(
  recipe: Recipe,
  quantities: readonly number[],
  view: number,
  unit: string,
  hidden: boolean,
): string {
  const suggestions = suggestQuantities(view, mappingsFor(recipe.title), unit, {
    allowedValues: quantities,
  });
  const chips = suggestions.map((suggestion) => ({
    value: suggestion.value,
    label: arrangementHtml(suggestion.display, 'bare'),
  }));
  // The current view's chip is promoted to rank 0, so the one-line fit can
  // never hide it: this row is a radiogroup and must keep a checked option.
  // `suggestQuantities` normally offers the view, but an additional unit may
  // normalize the target to another BQ; then the plain base form is the chip.
  let activeChip = chips.find((chip) => sameYieldValue(chip.value, view));
  if (activeChip === undefined) {
    activeChip = { value: view, label: escapeHtml(formatBQ(view, unit)) };
    chips.push(activeChip);
  }
  const ranked = [activeChip, ...chips.filter((chip) => chip !== activeChip)];
  // The ranking survives in `data-rank`; the markup itself reads ascending.
  const rankByValue = new Map(ranked.map((chip, index) => [chip.value, index]));
  const buttons = [...ranked]
    .sort((a, b) => a.value - b.value)
    .map((chip) => {
      const active = sameYieldValue(chip.value, view);
      // Radio semantics, as in the serving picker above (§5.2, §8).
      return (
        `<button type="button" role="radio" aria-checked="${active}" tabindex="${active ? '0' : '-1'}" class="chip yield-chip${active ? ' active' : ''}" data-yield="${formatLinkQuantity(chip.value)}" data-rank="${rankByValue.get(chip.value)}">` +
        `${chip.label}</button>`
      );
    })
    .join('\n    ');
  return (
    `  <div class="chips yield-chips size-scoped" data-yield="${formatLinkQuantity(view)}" role="radiogroup" aria-label="Menge wählen"${hidden ? ' hidden' : ''}>\n` +
    `    ${buttons}\n` +
    `  </div>\n`
  );
}

/**
 * The yield picker of an ingredient recipe: one adaptive chip row per baked
 * view (only the current view's row is visible), plus the −/+ stepper that
 * moves one baked view per press. Generating a row per view is what keeps the
 * chips recentred on the current amount — the app's ingredient sheet does the
 * same on every keystroke — while every value still belongs to a baked view, so
 * a tap only toggles visibility and no scaling runs at runtime. The default
 * view is the written yield when it is a BQ value, otherwise the nearest
 * allowed BQ.
 */
function renderYieldPicker(
  recipe: Recipe,
  quantities: readonly number[],
  activeValue: number,
): string {
  const unit = recipe.yield_unit!;
  const rows = quantities
    .map((value) => renderYieldChipRow(recipe, quantities, value, unit, value !== activeValue))
    .join('');
  return (
    `  <p class="picker-caption">Menge</p>\n` +
    rows +
    `  <div class="yield-row">\n` +
    `    <button type="button" class="yield-step-button yield-step-down" aria-label="Menge um eine Stufe verringern">${STEP_DOWN_SVG}</button>\n` +
    `    <span class="yield-value-slot"><span class="yield-value-measure" aria-hidden="true">${escapeHtml(formatBQ(YIELD_VALUE_PROBE_BQ, unit))}</span><span class="yield-value">${escapeHtml(formatBQ(activeValue, unit))}</span></span>\n` +
    `    <button type="button" class="yield-step-button yield-step-up" aria-label="Menge um eine Stufe erhöhen">${STEP_UP_SVG}</button>\n` +
    `  </div>\n`
  );
}

/** The per-size content of one recipe, split across the three screens. */
function sizeViews(
  recipe: Recipe,
  links: Readonly<Record<string, string>>,
): { picker: string; references: string; checkLists: string; stepWraps: string } {
  if (recipe.type === 'finished_dish') {
    const picker = renderServingPicker(recipe);
    let references = '';
    let checkLists = '';
    let stepWraps = '';
    SERVING_COUNTS.forEach((value, index) => {
      const factor = value / recipe.servings!;
      const sizeValue = String(value);
      references += renderReferenceReadout(recipe, factor, 'data-servings', sizeValue);
      checkLists +=
        renderCheckList(
          recipe,
          factor,
          links,
          'data-servings',
          sizeValue,
          `s${index}`,
          value === recipe.servings,
        ) + '\n';
      stepWraps += renderStepWrap(recipe, factor, links, 'data-servings', sizeValue) + '\n';
    });
    return { picker, references, checkLists, stepWraps };
  }

  // An ingredient recipe without a yield or family unit still exports a usable
  // single view (the storage format does not allow it; validation catches it).
  if (recipe.yield === undefined || recipe.yield_unit === undefined) {
    return {
      picker: '',
      references: '',
      checkLists: renderCheckList(recipe, 1, links, 'data-yield', '', 'y0', true),
      stepWraps: renderStepWrap(recipe, 1, links, 'data-yield', ''),
    };
  }

  const quantities = yieldViewQuantities(recipe.yield);
  const defaultView = defaultYieldView(recipe.yield);
  const picker = renderYieldPicker(recipe, quantities, defaultView);
  let references = '';
  let checkLists = '';
  let stepWraps = '';
  quantities.forEach((value, index) => {
    const factor = value / recipe.yield!;
    const sizeValue = formatLinkQuantity(value);
    references += renderReferenceReadout(recipe, factor, 'data-yield', sizeValue);
    checkLists +=
      renderCheckList(
        recipe,
        factor,
        links,
        'data-yield',
        sizeValue,
        `y${index}`,
        value === defaultView,
        formatBQ(value, recipe.yield_unit!),
      ) + '\n';
    stepWraps += renderStepWrap(recipe, factor, links, 'data-yield', sizeValue) + '\n';
  });
  return { picker, references, checkLists, stepWraps };
}

/** The intro's meta line: „Arbeitszeit" / „Gesamtzeit" caption/value pairs. */
function metaLine(recipe: Recipe): string {
  const items = [
    `<span class="meta-item"><span class="caption">Arbeitszeit</span><span class="meta-value">${escapeHtml(displayTimeText(recipe.prep_time))}</span></span>`,
  ];
  if (recipe.total_time !== undefined) {
    items.push(
      `<span class="meta-item"><span class="caption">Gesamtzeit</span><span class="meta-value">${escapeHtml(displayTimeText(recipe.total_time))}</span></span>`,
    );
  }
  return `<div class="meta-line">\n    ${items.join('\n    ')}\n  </div>`;
}

/**
 * The embedded navigation script: only DOM toggling, no scaling logic. It also
 * reads the size the URL's fragment asks for — the meal-plan link's promise —
 * and falls back to the recipe's written size when there is none (or when the
 * requested size has no baked view). Screen/step navigation mirrors the node
 * list into browser history, and every trigger — the bar's Zurück/Weiter,
 * Escape, a swipe, the browser's Back/Forward and the device's Back — moves
 * through the same history entries, so they cannot disagree about the node on
 * screen (§5.11, §6.6).
 */
const NAVIGATION_SCRIPT = `
(function () {
  'use strict';

  // The size the meal-plan line promised. Three sources, in order of authority:
  // a host may inject it (the Apps Script export host does, because its sandbox
  // iframe hides the outer URL), and otherwise it arrives in this page's own
  // query string or fragment - a Drive link can pass neither through.
  var raw = '';
  if (typeof window.__COOKBOOK_PLAN_SIZE__ === 'string') { raw += window.__COOKBOOK_PLAN_SIZE__; }
  raw += '&' + window.location.search.replace(/^\\?/, '');
  raw += '&' + window.location.hash.replace(/^#/, '');
  var params = {};
  raw.split('&').forEach(function (part) {
    var eq = part.indexOf('=');
    if (eq > 0) { params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1)); }
  });

  // The host preselects the promised size with a <style> element, so the page is
  // right even before (or without) this script. From here the real selection
  // takes over, so that helper goes.
  var preselect = document.getElementById('${PLAN_PRESELECT_ELEMENT_ID}');
  if (preselect && preselect.parentNode) { preselect.parentNode.removeChild(preselect); }

  var screens = {
    intro: document.querySelector('[data-screen="intro"]'),
    zutaten: document.querySelector('[data-screen="zutaten"]'),
    zubereitung: document.querySelector('[data-screen="zubereitung"]'),
  };
  var btnBack = document.getElementById('btn-back');
  var btnNext = document.getElementById('btn-next');
  var counter = document.getElementById('counter');
  var stepTitle = document.getElementById('step-title');

  // ---- Size selection (one of the two pickers exists per recipe) ----
  var servingChips = document.querySelectorAll('.serving-chip');
  var yieldChips = document.querySelectorAll('.yield-chip');
  var isServing = servingChips.length > 0;
  var sizeKey = isServing ? 'data-servings' : 'data-yield';
  var sizeEls = Array.prototype.slice.call(document.querySelectorAll('.size-scoped'));
  var currentSize = null;

  function toggleSize(value) {
    // A tap on the chosen size is not a change; only a real change is one.
    var changed = currentSize !== null && currentSize !== value;
    currentSize = value;
    // Checks are purely local and belong to the size they were made for, so a
    // size change discards them (§5.11, §6.6).
    if (changed) {
      document.querySelectorAll('.check-list input[type="checkbox"]').forEach(function (box) {
        box.checked = false;
      });
    }
    sizeEls.forEach(function (el) { el.hidden = el.getAttribute(sizeKey) !== value; });
  }
  function setActiveChip(value) {
    (isServing ? servingChips : yieldChips).forEach(function (btn) {
      var isActive = btn.getAttribute(sizeKey) === value;
      btn.classList.toggle('active', isActive);
      // Radio state: checked + a single tab stop, so the group is announced (§8).
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
  }
  // Arrow keys move the choice inside a size radiogroup (WAI-ARIA radio pattern).
  function onChipKeydown(e) {
    var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) { return; }
    // Only the visible row is a radio group: the other yield rows are hidden,
    // and the one-line fit hides whole chips that do not fit.
    var chips = Array.prototype.slice
      .call(e.currentTarget.parentNode.querySelectorAll('.chip'))
      .filter(function (chip) { return !chip.hidden; });
    var index = Array.prototype.indexOf.call(chips, e.currentTarget);
    var next = chips[index + step];
    if (next === undefined) { return; }
    e.preventDefault();
    next.focus();
    next.click();
  }
  (isServing ? servingChips : yieldChips).forEach(function (btn) {
    btn.addEventListener('keydown', onChipKeydown);
  });
  function activeChipValue() {
    var active = isServing
      ? document.querySelector('.chip.active')
      : document.querySelector('.yield-chips:not([hidden]) .chip.active');
    return active === null ? null : active.getAttribute(sizeKey);
  }

  // Yield state (empty for a finished dish).
  var yieldValues = [];
  var yieldLabels = {};
  var yieldValue = null;
  var stepDown = null;
  var stepUp = null;
  var yieldIndex = 0;

  /**
   * The visible yield row keeps one line, like the app's SuggestionChips: a
   * chip that fits is kept, one that does not is hidden and the next one is
   * tried. The walk follows data-rank (the ranking), not the ascending DOM
   * order. Re-run after a size change, a resize and the font load, and only
   * while the row is actually on screen.
   */
  function fitYieldChips() {
    var row = document.querySelector('.yield-chips:not([hidden])');
    if (!row) { return; }
    var available = row.getBoundingClientRect().width;
    if (available <= 0) { return; }
    var chips = Array.prototype.slice.call(row.querySelectorAll('.chip'));
    chips.sort(function (a, b) {
      return Number(a.getAttribute('data-rank')) - Number(b.getAttribute('data-rank'));
    });
    var gap = parseFloat(getComputedStyle(row).columnGap) || 10;
    var used = 0;
    var kept = 0;
    for (var i = 0; i < chips.length; i += 1) {
      var chip = chips[i];
      // Reset first: a chip hidden by the previous fit has no width to measure.
      chip.hidden = false;
      var width = chip.getBoundingClientRect().width;
      var next = used + (kept > 0 ? gap : 0) + width;
      if (next <= available) {
        used = next;
        kept += 1;
      } else {
        chip.hidden = true;
      }
    }
  }
  if (!isServing) {
    window.addEventListener('resize', fitYieldChips);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(fitYieldChips).catch(function () {});
    }
  }

  function selectServing(n) {
    var found = false;
    sizeEls.forEach(function (el) { if (el.getAttribute('data-servings') === n) { found = true; } });
    if (!found) { return false; }
    toggleSize(n);
    setActiveChip(n);
    return true;
  }

  function selectYieldAt(index) {
    if (index < 0 || index >= yieldValues.length) { return; }
    yieldIndex = index;
    var value = yieldValues[index];
    toggleSize(value);
    fitYieldChips();
    setActiveChip(value);
    if (yieldValue) { yieldValue.textContent = yieldLabels[value]; }
    if (stepDown) { stepDown.disabled = index === 0; }
    if (stepUp) { stepUp.disabled = index === yieldValues.length - 1; }
  }
  function selectYield(value) {
    var index = yieldValues.indexOf(value);
    if (index < 0) { return false; }
    selectYieldAt(index);
    return true;
  }

  servingChips.forEach(function (btn) {
    btn.addEventListener('click', function () { selectServing(btn.getAttribute('data-servings')); });
  });

  if (!isServing) {
    document.querySelectorAll('.check-list[data-yield]').forEach(function (el) {
      var value = el.getAttribute('data-yield');
      yieldValues.push(value);
      yieldLabels[value] = el.getAttribute('data-yield-label');
    });
    yieldValue = document.querySelector('.yield-value');
    stepDown = document.querySelector('.yield-step-down');
    stepUp = document.querySelector('.yield-step-up');
    yieldChips.forEach(function (btn) {
      btn.addEventListener('click', function () { selectYield(btn.getAttribute('data-yield')); });
    });
    // Press-and-hold on the yield stepper (§5.2): a tap steps once, a hold
    // repeats the step at the app's cadence — the first repeat after 450 ms,
    // then every 100 ms — until the baked-view list ends or the finger lifts.
    // A click and a keyboard activation both arrive as a click, so the click
    // performs the single step; the pointerdown only arms the hold. The
    // closing click of a hold is swallowed so the release adds no extra step.
    var HOLD_FIRST_REPEAT_MS = 450;
    var HOLD_REPEAT_INTERVAL_MS = 100;
    function bindStepper(button, direction) {
      if (button === null) { return; }
      var holdTimer = null;
      var repeatTimer = null;
      var repeated = false;

      function stopHold() {
        if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
        if (repeatTimer !== null) { clearInterval(repeatTimer); repeatTimer = null; }
      }
      function canStep() {
        return direction < 0 ? yieldIndex > 0 : yieldIndex < yieldValues.length - 1;
      }
      function step() { selectYieldAt(yieldIndex + direction); }

      button.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) { return; }
        stopHold();
        repeated = false;
        holdTimer = setTimeout(function () {
          holdTimer = null;
          if (!canStep()) { return; }
          step();
          repeated = true;
          repeatTimer = setInterval(function () {
            if (!canStep()) { stopHold(); return; }
            step();
          }, HOLD_REPEAT_INTERVAL_MS);
        }, HOLD_FIRST_REPEAT_MS);
      });
      button.addEventListener('pointerup', stopHold);
      button.addEventListener('pointerleave', stopHold);
      button.addEventListener('pointercancel', stopHold);
      button.addEventListener('click', function () {
        if (repeated) { repeated = false; return; }
        if (canStep()) { step(); }
      });
    }
    bindStepper(stepDown, -1);
    bindStepper(stepUp, 1);
  }

  // A fragment yield is normalized to the family base unit, so a hand-written
  // kg/l link finds the same view as the g/ml one the app writes.
  function normalizeYield(text) {
    var match = /^(\\d+(?:[.,]\\d+)?)(kg|l|g|ml)$/.exec(text);
    if (!match) { return null; }
    var amount = Number(match[1].replace(',', '.'));
    var unit = match[2];
    if (unit === 'kg' || unit === 'l') { amount = amount * 1000; }
    return String(amount);
  }

  // The initial size: the fragment's size when it has one, otherwise the
  // recipe's written size (the active chip / the is-written yield view).
  if (isServing) {
    if (!selectServing(params['${PLAN_FRAGMENT_SERVINGS}']) && !selectServing(activeChipValue())) {
      var first = document.querySelector('.serving-chip');
      selectServing(first === null ? '' : first.getAttribute('data-servings'));
    }
  } else {
    var wanted = params['${PLAN_FRAGMENT_YIELD}'] ? normalizeYield(params['${PLAN_FRAGMENT_YIELD}']) : null;
    if (wanted === null || !selectYield(wanted)) {
      var writtenView = document.querySelector('.check-list.is-written[data-yield]');
      if (!writtenView || !selectYield(writtenView.getAttribute('data-yield'))) { selectYieldAt(0); }
    }
  }

  // ---- Node model: intro → zutaten → step 1 … step N (DESIGN §6.6) ----
  var firstWrap = document.querySelector('.step-wrap');
  var stepCount = firstWrap === null ? 0 : firstWrap.querySelectorAll('.step').length;
  var nodes = ['intro', 'zutaten'];
  for (var i = 1; i <= stepCount; i++) { nodes.push('step-' + i); }
  var current = 0;

  function stepNumber(node) { return Number(node.slice('step-'.length)); }
  function isStep(node) { return node.indexOf('step-') === 0; }

  function showStep(el, direction) {
    el.classList.remove('slide-fwd', 'slide-back');
    void el.offsetWidth; // re-trigger the animation by forcing a reflow
    el.classList.add(direction === 'forward' ? 'slide-fwd' : 'slide-back');
  }

  // The dots span the whole flow — intro, Zutaten and each step — with the
  // current one lit (§5.11). They sit in the free slot between the two bar
  // buttons. When the flow is longer than that slot can show, the outermost
  // dots are omitted: the slot always shows a full window centred on the
  // current node, so no dot comes near a button and the cluster never leaves
  // empty space on one side while cutting dots on the other.
  var DOT_SIZE = 8;
  var DOT_GAP = 6;

  function dotCapacity() {
    var width = 0;
    if (typeof counter.getBoundingClientRect === 'function') {
      var rect = counter.getBoundingClientRect();
      if (rect && rect.width > 0) { width = rect.width; }
    }
    // A test stub (or a hidden document) has no measurable slot; nine dots is
    // the phone-width default, so the window logic stays exercised.
    if (width === 0) { return 9; }
    return Math.max(1, Math.floor((width + DOT_GAP) / (DOT_SIZE + DOT_GAP)));
  }

  function renderFlowPosition(index) {
    var capacity = dotCapacity();
    var first = 0;
    var last = nodes.length;
    if (nodes.length > capacity) {
      // Centre the window on the current node; clamp at the flow's ends. The
      // window always has capacity dots, so both sides stay equally close to
      // their button and no side gets extra blank space.
      first = Math.min(
        Math.max(0, index - Math.floor(capacity / 2)),
        nodes.length - capacity,
      );
      last = first + capacity;
    }
    var html =
      '<div class="dots" role="img" aria-label="Fortschritt: ' +
      (index + 1) + ' von ' + nodes.length + '">';
    for (var i = first; i < last; i++) {
      html +=
        '<span class="dot' + (i === index ? ' on' : '') + '" data-node="' + (i + 1) + '"></span>';
    }
    counter.innerHTML = html + '</div>';
  }

  function activeStepWrap() {
    var wraps = document.querySelectorAll('.step-wrap');
    for (var i = 0; i < wraps.length; i++) { if (!wraps[i].hidden) { return wraps[i]; } }
    return wraps[0] || null;
  }

  function render(direction) {
    var node = nodes[current];
    var onSteps = isStep(node);

    screens.intro.classList.toggle('active', node === 'intro');
    screens.zutaten.classList.toggle('active', node === 'zutaten');
    screens.zubereitung.classList.toggle('active', onSteps);
    if (node === 'intro') { fitYieldChips(); }

    // The swipe animation plays for the intro and Zutaten screens too, not only
    // the steps: the newly shown screen slides in with the motion direction.
    if (direction) {
      if (node === 'intro') { showStep(screens.intro, direction); }
      else if (node === 'zutaten') { showStep(screens.zutaten, direction); }
    }

    // Left button hidden on the intro (nothing precedes it); right button
    // removed on the last node (nothing follows it).
    btnBack.hidden = current === 0;
    btnNext.hidden = current === nodes.length - 1;

    renderFlowPosition(current);

    if (onSteps) {
      stepTitle.textContent = 'Schritt ' + stepNumber(node) + ' von ' + stepCount;
      var wrap = activeStepWrap();
      var stepEls = wrap === null ? [] : wrap.querySelectorAll('.step');
      stepEls.forEach(function (el, i) {
        var active = (i + 1) === stepNumber(node);
        el.classList.toggle('active', active);
        if (active && direction) { showStep(el, direction); }
      });
    }
  }

  // The free interval depends on the viewport and on the theme face's button
  // widths, so re-decide dots vs. count after a resize and once the embedded
  // faces have loaded (a fallback face can be wider).
  window.addEventListener('resize', function () { renderFlowPosition(current); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { renderFlowPosition(current); }).catch(function () {});
  }

  // One flow, one history: every node this session has visited owns exactly one
  // history entry, and every move shows the node of the entry the browser is on.
  // Zurück/Weiter, Escape, a swipe and the browser's or the device's Back button
  // therefore all end in the same render — the bar buttons only ask for the
  // neighbouring node, the browser performs the move (§6.6). No second path can
  // disagree with the history, which is what made a device Back land on the
  // wrong node after the bar had been used.
  //
  // deepest is the highest node this session holds an entry for. Going back
  // leaves the entries above the current one alive, so their node can be
  // reached again by traversing forward; a node pushed on top drops those
  // entries, so the mark comes back down to it.
  var deepest = 0;

  // A file:// document cannot hold history entries (pushState throws), and a
  // real history.back() there leaves the document instead of moving in it. The
  // flow still works — it renders in place — but it must not touch the browser
  // history then.
  var historyLive = true;

  // The state of the entry that shows index. The marker keeps an entry of
  // another document (the session history outlives this page) from being read
  // as a node of this flow.
  function entryState(index) { return { cookbook: 1, node: nodes[index] }; }
  function entryIndex(state) {
    if (!state || state.cookbook !== 1) { return -1; }
    return nodes.indexOf(state.node);
  }

  // Shows index and moves the flow's pointer. The flow is linear, so the
  // direction is only the slide's direction of travel: down the list is a back
  // move, up the list a forward one, whatever trigger asked for it.
  function show(index, direction) {
    current = index;
    if (index > deepest) { deepest = index; }
    render(direction);
  }

  // Writes the entry for a node the flow has not reached in this session yet.
  // The entry is written before the render, so a render that throws cannot
  // leave the flow and the browser's history disagreeing.
  function pushEntry(index) {
    var direction = index > current ? 'forward' : 'back';
    if (historyLive) {
      try {
        history.pushState(entryState(index), '');
        deepest = index;
      } catch (e) {
        historyLive = false;
        deepest = current;
      }
    }
    show(index, direction);
  }

  function go(index) {
    if (index === current || index < 0 || index >= nodes.length) { return; }
    var direction = index > current ? 'forward' : 'back';
    // Both directions are traversals whenever the browser still holds the
    // entry: a move to a node this session already reached reuses its entry
    // instead of pushing a second one for the same visit. deepest says how far
    // the session got, and a push (below) truncates the forward entries, which
    // is why the mark comes down with them.
    if (historyLive) {
      try {
        if (direction === 'back') { history.back(); return; }
        if (index <= deepest) { history.forward(); return; }
      } catch (e) {
        historyLive = false;
      }
    }
    pushEntry(index);
  }

  function forward() { go(current + 1); }
  function back() { go(current - 1); }

  btnBack.addEventListener('click', back);
  btnNext.addEventListener('click', forward);

  // Escape = one node back (§6.6).
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') { back(); } });

  // Browser Back/Forward, the device-back gesture and the swipe-back gesture
  // arrive here. The flow shows the node of the entry the browser reached and
  // slides in the direction of travel, so a device Back looks and lands exactly
  // like the bar's Zurück (§6.6).
  window.addEventListener('popstate', function (e) {
    var index = entryIndex(e.state);
    // An entry the flow did not write (the page-load entry, another document's
    // state) names no node of this flow; the only sensible landing is the intro.
    if (index < 0) { index = 0; }
    // A traversal the flow has already rendered — the bar's own Zurück/Weiter —
    // must neither animate nor render a second time.
    if (index === current) { return; }
    show(index, index > current ? 'forward' : 'back');
  });

  // Swipe on every screen (not only the steps): a deliberately horizontal drag
  // left = forward, right = back. A finger that scrolls the page also drifts
  // sideways, so the horizontal distance alone cannot decide: the drag must
  // dominate the vertical one, or a scroll would navigate by accident. The
  // start is also dropped for a multi-finger gesture (a pinch is never a page
  // swipe) and on touchcancel (the browser took the touch over, e.g. for a
  // scroll).
  var touchStart = null;
  document.addEventListener('touchstart', function (e) {
    touchStart = e.touches.length === 1
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : null;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (touchStart === null) { return; }
    var touch = e.changedTouches[0];
    var dx = touch.clientX - touchStart.x;
    var dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) <= 48 || Math.abs(dx) <= Math.abs(dy)) { return; }
    (dx < 0 ? forward : back)();
  }, { passive: true });
  document.addEventListener('touchcancel', function () { touchStart = null; }, { passive: true });

  // A check-list row is tappable as a whole to toggle the check; the sub-recipe
  // name link is the one exception (it opens the ingredient recipe, it never
  // toggles). The checkbox toggles natively.
  document.querySelectorAll('.check-row').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.closest('a') || e.target.closest('input')) { return; }
      var box = row.querySelector('input[type="checkbox"]');
      if (box) { box.checked = !box.checked; }
    });
  });

  // Initial state: the entry the page loaded on shows the node the flow resumes
  // on. A reload keeps the state of its entry, so the flow comes back on the
  // step it was left on and the first Back still lands on the node before it
  // (rendering the intro over a stack that still points at step 3 would make
  // Back walk forward on the next press). A fresh load has no state and starts
  // at the intro. replaceState rather than push, so Back does not reload.
  var start = 0;
  try {
    var resumed = entryIndex(history.state);
    if (resumed >= 0) { start = resumed; }
    history.replaceState(entryState(start), '');
  } catch (e) {
    historyLive = false;
  }
  current = start;
  deepest = start;
  render();
})();
`;

/** Inline styles: the cooking view's ladder tokens and components (DESIGN §4, §5). */
const STYLES = `
  /* The cooking view is always light; it does not follow the OS dark preference
     (§4.1). */
  :root { color-scheme: light; }

  /* Italic text uses the italic faces embedded above, never a slant the browser
     computes from the upright file (§4.2): a synthesized oblique distorts
     curves, weight and sidebearings. Turning synthesis off makes that a hard
     guarantee — a face without an italic renders upright instead of faking
     one. */
  html { font-synthesis: none; }

  /* Ladder tokens (DESIGN §4.2–4.3). */
  :root {
    --text-xl: 32px; --leading-xl: 36px;
    --text-lg: 24px; --leading-lg: 28px;
    --text-md: 18px; --leading-md: 24px;
    --text-sm: 14px; --leading-sm: 18px;
    --space-1: 4px; --space-2: 6px; --space-3: 8px; --space-4: 10px; --space-5: 14px;
    --space-6: 18px; --space-7: 24px; --space-8: 32px; --space-9: 42px; --space-10: 56px;
    --radius-sm: 6px; --radius-md: 10px; --radius-lg: 18px;
    --app-padding: 18px;
    --icon-size: 24px;
    --motion-base: 180ms;
    --bar-h: 74px; /* fixed bottom bar height (ladder value) */
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; overflow-x: hidden; }
  body {
    font-family: var(--font);
    font-size: var(--text-md);
    line-height: var(--leading-md);
    color: var(--ink);
    background: var(--paper);
    max-width: 32rem;
    margin: 0 auto;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- Screens: one page, three states (§5.11) ---- */
  .screen { display: none; min-height: 100vh; min-height: 100dvh;
            padding: var(--app-padding);
            padding-bottom: calc(var(--bar-h) + var(--space-9) + env(safe-area-inset-bottom)); }
  .screen.active { display: flex; flex-direction: column; }

  /* ---- Intro ---- */
  /* The photo (§5.8): a 4:3 landscape media area at the top of the intro,
     cropped to cover and rounded at the theme's medium radius. The title's own
     top margin (--space-5, 14px) is the gap between the photo and the title;
     without a photo the intro carries .no-photo and the title sits on the
     screen's 18px padding. */
  .media { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover;
           border-radius: var(--radius-md); }
  /* The theme's display face, when it has one, is reserved for the main heading
     of each page: the intro title, the Zutaten heading and the step title. All
     other text — the captions included — stays in the theme's body face
     (§4.8). */
  h1, .screen-title, .step-title { font-family: var(--font-heading); }
  h1 { font-size: var(--text-xl); line-height: var(--leading-xl); font-weight: 600; margin: var(--space-5) 0 var(--space-2);
       overflow-wrap: anywhere; }
  .screen.intro.no-photo h1 { margin-top: 0; }
  .description { margin: var(--space-3) 0 0; overflow-wrap: anywhere; }
  /* Times and the Cookbook brand share the recipe overview's caption/value look:
     an all-caps muted caption before a bold value (§5.11). */
  .meta-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-7); margin: var(--space-3) 0 var(--space-6); }
  .meta-item { display: inline-flex; align-items: baseline; gap: var(--space-2); }
  .caption { color: var(--muted); font-size: var(--text-sm); line-height: var(--leading-sm); font-weight: 600; text-transform: uppercase; }
  .meta-value { font-weight: 600; font-size: var(--text-md); line-height: var(--leading-md); }
  .brand { display: flex; align-items: center; gap: var(--space-2); color: var(--muted);
           font-size: var(--text-sm); line-height: var(--leading-sm); margin-top: auto; padding-top: var(--space-6); }
  .brand svg { width: 20px; height: 20px; }
  /* The intro's brand footer sits right above the bottom bar (§5.11), so the
     intro gets less bottom padding than the scrollable list screens. */
  .screen.intro { padding-bottom: calc(var(--bar-h) + var(--space-4) + env(safe-area-inset-bottom)); }
  .picker-caption { font-size: var(--text-sm); line-height: var(--leading-sm); color: var(--muted);
                    font-weight: 600; text-transform: uppercase; margin: 0 0 var(--space-2);
                    overflow-wrap: anywhere; }
  /* The chip row's gap is the app's --space-4 (10px): a chip's 32px pill reaches
     the 42px hit area through a 5px ring, so the gap must be at least twice the
     ring or two neighbouring hit areas would overlap (§5.2). */
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-bottom: 0; }
  .chip { position: relative; font: inherit; font-size: var(--text-sm); line-height: var(--leading-sm); padding: var(--space-2) var(--space-5);
          border-radius: 100px; border: 1px solid var(--line); background: var(--paper); color: var(--ink); cursor: pointer; }
  /* The visible pill stays compact (32px); the ring beyond it brings the hit area
     to the 42px floor, as in the app (§5.2). */
  .chip::before { content: ''; position: absolute; inset: -5px; }
  .chip.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  /* The yield rows are one measured line, like the app's SuggestionChips: the
     row clips, never wraps, and the fit hides whole chips that do not fit. */
  .yield-chips { flex-wrap: nowrap; overflow: hidden; }
  .yield-chips .chip { flex: none; }
  /* A note inside a filled chip keeps the chip's on-accent ink: --muted on
     --accent is 1.17:1, and no lightened tint reaches the AA 4.5:1 bar on that
     clay. The italic run alone carries the quiet cue (as in the app, editor.css). */
  .chip.active .arrangement-note { color: inherit; }
  /* The quiet aside of an ingredient arrangement (§5.4): the note left its
     brackets and follows one en space, muted and italic — in the rows, the
     reference readout and the pantry surfaces alike. Step prose keeps its
     brackets and a regular space (the span then wraps both, §5.11); the written
     shopping list keeps its bracketed wording. */
  .arrangement-note { color: var(--muted); font-style: italic; }
  /* Reference-ingredient readout under the size picker (amounts only, muted):
     one amount per line, no bullet and no comma between them (§5.11). */
  .reference { margin: var(--space-3) 0 0; padding: 0; list-style: none; color: var(--muted);
               font-size: var(--text-sm); line-height: var(--leading-sm); overflow-wrap: anywhere; }

  /* Ingredient-recipe stepper (§5.2 "exactly as today"). Each button is the
     app's 42 px circle with the 24 px Material „remove" / „add" drawing centred
     by the grid, not by a line box — the SVG would otherwise sit on the text
     baseline and read high in the circle. The circle is structural, like the
     app's .step-button, so it is not clamped to the radius ladder. The
     press-and-hold guards (no selection, callout or double-tap zoom) let a
     long press read purely as a hold, and the :active fill is the solid
     equivalent of the app's shared press wash. The row copies the app's
     .quantity-row gap; the value slot copies QuantityValue with the BQ probe
     ("950 g" / "950 ml"), so the width is fixed and the digits right-aligned
     while the stepper walks the views without reserving free-input decimals. */
  .yield-row { display: flex; align-items: center; gap: var(--space-6); margin: var(--space-3) 0 0; }
  .yield-step-button { width: var(--space-9); height: var(--space-9); padding: 0;
                       display: inline-grid; place-items: center; border-radius: 50%;
                       border: 1px solid var(--line); background: var(--paper); color: var(--ink); cursor: pointer;
                       -webkit-user-select: none; user-select: none;
                       -webkit-touch-callout: none; touch-action: manipulation; }
  .yield-step-button svg { display: block; width: var(--icon-size); height: var(--icon-size); fill: currentColor; }
  .yield-step-button:active:not(:disabled) { background: var(--press); }
  .yield-step-button:disabled { opacity: 0.5; cursor: default; }
  .yield-value-slot { position: relative; display: inline-block; flex: none; }
  .yield-value-measure { display: block; padding: var(--space-3) var(--space-4);
                         border: 1px solid transparent; font-size: var(--text-md);
                         line-height: var(--leading-md); font-weight: 600;
                         white-space: nowrap; visibility: hidden; }
  .yield-value { position: absolute; inset: 0; display: flex; align-items: center;
                 justify-content: flex-end; padding: var(--space-3) var(--space-4);
                 border: 1px solid transparent; font-size: var(--text-md);
                 line-height: var(--leading-md); font-weight: 600;
                 white-space: nowrap; text-align: right; }

  /* ---- Zutaten ---- */
  .screen-caption { font-size: var(--text-sm); line-height: var(--leading-sm); font-weight: 600;
                    text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 var(--space-2);
                    overflow-wrap: anywhere; }
  .screen-title { font-size: var(--text-lg); line-height: var(--leading-lg); font-weight: 600; margin: 0 0 var(--space-2); }
  /* The theme's decorative divider below „Zutaten" and the step title (§5.5). */
  .divider { margin: 0 0 var(--space-5); height: 0; border-bottom: 2px solid var(--accent); width: 42px; }
  /* The check list is centred in the space below the header, exactly like a
     step's rows and prose: auto margins take the free space when the list fits
     and collapse to 0 when it is taller, so the top of a long list stays
     reachable (§5.11). */
  .screen.zutaten .ingredient-list { margin-top: auto; margin-bottom: auto; }

  /* ---- Ingredient lists: one shared row design (§5.4) ----
     The Zutaten check list and every step's ingredient list are the same
     surface: one raised sheet of hairlined rows, the same text size and the same
     right-hand note edge. The master row adds the checkbox as its leading
     control; that checkbox is the only difference between the two lists. The
     raised surface is a light lift off the page (§4.8), so the sheet reads as
     one block without a shadow. */
  .ingredient-list { list-style: none; margin: 0; padding: 0 var(--space-5);
                     background: var(--surface); border: 1px solid var(--line);
                     border-radius: var(--radius-lg); }
  .ingredient-row { display: flex; align-items: center; gap: var(--space-4);
                    padding: var(--space-5) 0; border-top: 1px solid var(--line);
                    font-size: var(--text-md); line-height: var(--leading-md); }
  .ingredient-row:first-child { border-top: none; }
  /* The left text is the whole row; the note (if any) floats at its end. A
     flow-root contains the float, so the row height includes the dropped line. */
  .ingredient-text { flex: 1; min-width: 0; display: flow-root; overflow-wrap: anywhere; }
  /* The ingredient name is the row's one bold run, so the eye can scan the
     names while the amounts, units and notes keep the row's regular weight. */
  .ingredient-name { font-weight: 600; }
  .check-row .ingredient-text { cursor: pointer; }
  .ingredient-row input[type="checkbox"] { width: 24px; height: 24px; accent-color: var(--accent);
                                           cursor: pointer; flex: none; }
  /* A checked row goes muted; its text is NOT crossed out (decided with the user). */
  .ingredient-row input:checked + .ingredient-text { color: var(--muted); }
  /* The last part of the arrangement: a quiet right-hung note. It follows the
     text in the source, so it sits on the last line while that line has room
     and drops to a right-aligned line of its own once it does not (§5.4). The
     en space is the minimum gap to the text. */
  .tail { float: right; margin-inline-start: 0.5em; max-width: 100%;
          text-align: right; color: var(--muted); font-style: italic;
          overflow-wrap: break-word; }
  /* A sub-recipe's name is the link itself: accent underline, no symbol. The
     text stays in the row's ink and only the hover turns it into the accent. */
  .name-link { position: relative; color: inherit; text-decoration-line: underline;
               text-decoration-color: var(--accent); text-decoration-thickness: 1px;
               text-underline-offset: 3px; }
  .name-link:hover { color: var(--accent); }
  .name-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* The old badge promised a 42 px target. The name's line box is only 24 px
     high, so the pseudo-element restores the height without moving the text. */
  .name-link::after { content: ''; position: absolute; inset: -9px -4px; }

  /* ---- Zubereitung (steps) ---- */
  .step-title { font-size: var(--text-lg); line-height: var(--leading-lg); font-weight: 600; margin: 0 0 var(--space-2); }
  /* The wrap fills the space below the header and centres the step's rows and
     prose together (§5.11). overflow:hidden clips only the slide's horizontal
     travel; the wrap grows with its content, so a tall step still scrolls. */
  .step-wrap { overflow: hidden; flex: 1 1 auto; display: flex; flex-direction: column;
               justify-content: center; }
  .step { display: none; }
  .step.active { display: block; }
  .step.slide-fwd, .screen.slide-fwd { animation: stepFwd var(--motion-base) ease-out; }
  .step.slide-back, .screen.slide-back { animation: stepBack var(--motion-base) ease-out; }
  @keyframes stepFwd { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes stepBack { from { transform: translateX(-24px); opacity: 0; } to { transform: none; opacity: 1; } }
  /* The step's ingredient sheet takes the same card as Zutaten; one gap
     separates it from the prose, which keeps the arm's-length size (§5.11). */
  .step-rows { margin: 0 0 var(--space-6); }
  /* The prose reads at arm's length: 24 px on a 1.5 ratio (36 px leading),
     one step looser than the heading leading, so a longer instruction keeps
     clear line separation on a phone. */
  .step-text { margin: 0; font-size: var(--text-lg); line-height: 1.5; overflow-wrap: anywhere; }

  /* ---- Bottom bar (fixed): back · dots · forward on every screen (§5.11) ---- */
  .step-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 0; width: 100%; max-width: 32rem;
              min-height: var(--bar-h); display: flex; align-items: center; gap: var(--space-4);
              padding: var(--space-3) var(--app-padding) calc(var(--space-3) + env(safe-area-inset-bottom));
              background: var(--paper); border-top: 1px solid var(--line); }
  .step-bar .btn { display: inline-flex; align-items: center; gap: var(--space-2); font: inherit; font-weight: 600;
                   font-size: var(--text-md); min-height: 56px;
                   padding: var(--space-3) var(--space-5); border-radius: var(--radius-md);
                   border: 1px solid var(--line); background: var(--paper); color: var(--ink); cursor: pointer; }
  .step-bar .btn svg { width: 18px; height: 18px; fill: currentColor; flex: none; }
  .step-bar .btn.next { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .step-bar .btn:disabled { opacity: 0.5; cursor: default; }
  /* Both button slots keep their boxes when a button is absent, so the dot slot
     between them keeps the same width on the intro, in the steps and on the
     last node. visibility:hidden still removes the absent button from the a11y
     tree and from hit-testing. */
  .step-bar .btn[hidden] { display: inline-flex !important; visibility: hidden; }
  /* The flow position is the middle flex item, so it uses exactly the free
     interval between the two buttons. A long flow shows a full window of dots
     centred on the current node; the script omits the outermost nodes rather
     than letting any dot approach a button (§5.11). */
  .counter { flex: 1 1 0; min-width: 0; display: flex; align-items: center;
             justify-content: center; overflow: hidden; pointer-events: none; }
  .counter .dots { display: flex; align-items: center; justify-content: center;
                   gap: var(--space-2); }
  .counter .dot { flex: none; width: var(--space-3); height: var(--space-3);
                  border-radius: 100%; background: var(--line); }
  .counter .dot.on { background: var(--accent); }

  [hidden] { display: none !important; }

  @media (prefers-reduced-motion: reduce) {
    .step.slide-fwd, .step.slide-back, .screen.slide-fwd, .screen.slide-back { animation: none; }
  }
`;

/**
 * Generates the self-contained HTML export of a recipe (decision 7).
 *
 * @param recipe a parsed recipe (validated by the caller)
 * @param links optional map of ingredient-recipe title → URL (e.g. the Drive
 *   link of the recipe's own `<title>.html` export). Whenever an ingredient
 *   use — master row, step row or text artifact — names a title present in
 *   this map, that name becomes the link that opens the export
 *   (recipe_structure.md "The link means", storage_format.md §4).
 * @param photo optional base64-encoded recipe photo, inlined as a `data:` URI
 *   at the top of the Intro (§5.8). Omit it — or pass an empty payload — and
 *   the Intro starts with the title instead of a media area.
 * @returns the complete HTML document as a string
 */
export function generateRecipeHtml(
  recipe: Recipe,
  links: Readonly<Record<string, string>> = {},
  photo?: RecipePhoto,
): string {
  const theme = resolveTheme(recipe.theme);
  const fontFaces = fontFaceCss(theme);
  const views = sizeViews(recipe, links);
  const photoHtml = renderPhoto(photo);

  const intro =
    `<section class="screen intro active${photoHtml === '' ? ' no-photo' : ''}" data-screen="intro">\n` +
    photoHtml +
    `  <h1>${escapeHtml(recipe.title)}</h1>\n` +
    (recipe.description !== undefined
      ? `  <p class="description">${escapeHtml(recipe.description)}</p>\n`
      : '') +
    `  ${metaLine(recipe)}\n` +
    views.picker +
    views.references +
    `  <footer class="brand">${BRAND_SVG}<span>Erstellt mit Cookbook</span></footer>\n` +
    `</section>`;

  const zutaten =
    `<section class="screen zutaten" data-screen="zutaten">\n` +
    `  <p class="screen-caption">${escapeHtml(recipe.title)}</p>\n` +
    `  <h2 class="screen-title">Zutaten</h2>\n` +
    `  <div class="divider"></div>\n` +
    views.checkLists +
    `</section>`;

  const zubereitung =
    `<section class="screen zubereitung" data-screen="zubereitung">\n` +
    `  <p class="screen-caption">${escapeHtml(recipe.title)}</p>\n` +
    `  <h2 class="step-title" id="step-title" aria-live="polite"></h2>\n` +
    `  <div class="divider"></div>\n` +
    views.stepWraps +
    `</section>`;

  const bar =
    `<div class="step-bar">\n` +
    `  <button class="btn prev" type="button" id="btn-back">${BACK_ARROW_SVG}<span>Zurück</span></button>\n` +
    `  <div class="counter" id="counter"></div>\n` +
    `  <button class="btn next" type="button" id="btn-next">${FORWARD_ARROW_SVG}<span>Weiter</span></button>\n` +
    `</div>`;

  return (
    `<!doctype html>\n` +
    `<html lang="de">\n` +
    `<head>\n` +
    `  <meta charset="utf-8">\n` +
    `  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n` +
    `  <title>${escapeHtml(recipe.title)}</title>\n` +
    `  <style>\n${fontFaces}${themeCss(theme)}\n${STYLES}\n  </style>\n` +
    `</head>\n` +
    `<body>\n` +
    `${intro}\n${zutaten}\n${zubereitung}\n${bar}\n` +
    `  <script>${NAVIGATION_SCRIPT}\n  </script>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
