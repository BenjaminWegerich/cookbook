/**
 * HTML export generator — the cooking view (docs/user_stories.md, decision 7,
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
 * - a **finished dish** has the integer ladder serving counts 1–30 (18 options),
 *   exactly what the meal plan accepts;
 * - an **ingredient recipe** has the ladder yields within ±2 decades of its
 *   written yield (`recipe/yieldViews.ts`), which is the same range the meal
 *   plan accepts — so the link in a Keep line can always open the exact amount.
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
 * row or an inline text artifact — carries the „Rezept" badge that opens that
 * export in a new tab (recipe_structure.md "The link means"; links are
 * implicit by name == recipe title, storage_format.md §4). Without a URL for a
 * title the display line stays plain text.
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

import { formatAQValueSlash, formatBQ, renderAQSSlash } from '../additionalUnits.js';
import { scaleAQ } from '../aqLadder.js';
import { escapeHtml, renderArtifacts } from './artifacts.js';
import type { TextArtifact } from './artifacts.js';
import { difference, integerLadderValues, scale } from '../ladder.js';
import {
  PLAN_FRAGMENT_SERVINGS,
  PLAN_FRAGMENT_YIELD,
  PLAN_PRESELECT_ELEMENT_ID,
  formatLinkQuantity,
} from '../planLink.js';
import { resolveTheme } from './theme.js';
import type { ResolvedTheme } from './theme.js';
import { displayTimeText } from './timeValues.js';
import { yieldViewQuantities } from './yieldViews.js';
import type { Ingredient, Recipe, Step, Unit } from './types.js';
import { EMBEDDED_FONTS } from './embeddedFonts.js';

/** Allowed serving options of the export: integer ladder values 1–30 (§D2). */
const SERVING_MIN = 1;
const SERVING_MAX = 30;

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
 *   choice whose contrast against `accent` is the higher (WCAG AA).
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
  return (
    `:root {\n` +
    `  --theme-font: '${theme.font}';\n` +
    `  --theme-accent: ${theme.accent};\n` +
    `  --theme-paper: ${theme.paper};\n` +
    `  --theme-ink: ${theme.ink};\n` +
    `  --theme-line: ${theme.line};\n` +
    // The applied tokens. The theme font is embedded as self-hosted WOFF2
    // `@font-face` rules (see fontFaceCss below); the system-ui stack remains
    // the fallback for a typeface without an embedded face (§4.8).
    `  --font: var(--theme-font), system-ui, sans-serif;\n` +
    `  --paper: var(--theme-paper);\n` +
    `  --ink: var(--theme-ink);\n` +
    `  --accent: var(--theme-accent);\n` +
    `  --line: var(--theme-line);\n` +
    `  --muted: ${muted};\n` +
    `  --on-accent: ${onAccent};\n` +
    `}`
  );
}

/**
 * The theme typeface's `@font-face` rules, or '' when the typeface has no
 * embedded face (§4.8). Each face is the latin subset of the shortlist
 * typeface (embeddedFonts.ts), inlined as a `data:` URI so the export stays
 * self-contained: no runtime font fetch and no sibling file. Variable faces are
 * declared once over the two weights the cooking view uses (`400 600`, §4.2);
 * a static family (the two IBM Plex faces) declares one rule per weight.
 */
function fontFaceCss(theme: ResolvedTheme): string {
  const faces = EMBEDDED_FONTS[theme.font];
  if (faces === undefined) return '';
  return (
    faces
      .map(
        (face) =>
          `@font-face {\n` +
          `  font-family: '${theme.font}';\n` +
          `  font-style: normal;\n` +
          `  font-display: swap;\n` +
          `  font-weight: ${face.weight};\n` +
          `  src: url(data:font/woff2;base64,${face.base64}) format('woff2');\n` +
          `}`,
      )
      .join('\n') + '\n'
  );
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

/** Chain link of the sub-recipe „Rezept" badge. */
const LINK_ICON_SVG =
  '<svg viewBox="0 0 960 960" width="14" height="14" aria-hidden="true" focusable="false">' +
  '<path d="M280,680Q197,680 138.5,621.5Q80,563 80,480Q80,397 138.5,338.5Q197,280 280,280L400,280Q417,280 428.5,291.5Q440,303 440,320Q440,337 428.5,348.5Q417,360 400,360L280,360Q230,360 195,395Q160,430 160,480Q160,530 195,565Q230,600 280,600L400,600Q417,600 428.5,611.5Q440,623 440,640Q440,657 428.5,668.5Q417,680 400,680L280,680ZM360,520Q343,520 331.5,508.5Q320,497 320,480Q320,463 331.5,451.5Q343,440 360,440L600,440Q617,440 628.5,451.5Q640,463 640,480Q640,497 628.5,508.5Q617,520 600,520L360,520ZM560,680Q543,680 531.5,668.5Q520,657 520,640Q520,623 531.5,611.5Q543,600 560,600L680,600Q730,600 765,565Q800,530 800,480Q800,430 765,395Q730,360 680,360L560,360Q543,360 531.5,348.5Q520,337 520,320Q520,303 531.5,291.5Q543,280 560,280L680,280Q763,280 821.5,338.5Q880,397 880,480Q880,563 821.5,621.5Q763,680 680,680L560,680Z" fill="currentColor"/></svg>';

/**
 * Renders the display text of a quantity/ingredient line (HTML-escaped, no
 * link). A quantity-only artifact may be unitless (`{{1/2}}`) and then renders
 * as its AQ standard number in the slash form (DESIGN §7).
 */
function displayText(name: string | undefined, bq: number, bu: Unit | undefined): string {
  const line =
    name === undefined
      ? bu === undefined
        ? formatAQValueSlash(bq)
        : formatBQ(bq, bu)
      : renderAQSSlash(name, bq, bu ?? 'g');
  return escapeHtml(line);
}

/**
 * The sub-recipe „Rezept" badge (§5.7), or an empty string when there is no
 * link for the title. The link opens the sub-recipe's export in a new tab.
 */
function subRecipeBadge(url: string | undefined): string {
  if (url === undefined) return '';
  return (
    `<a class="badge" href="${escapeHtml(url)}" target="_blank" rel="noopener">` +
    `${LINK_ICON_SVG}Rezept</a>`
  );
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

/** The reference ingredients of one view, scaled by the view's Δx, as text. */
function referenceLines(recipe: Recipe, deltaX: number): string[] {
  return recipe.ingredients
    .filter((ingredient) => ingredient.reference)
    .map((ingredient) =>
      displayText(ingredient.name, scale(ingredient.quantity, deltaX), ingredient.unit),
    );
}

/** The intro's small muted reference readout, or '' when there is none. */
function renderReferenceReadout(
  recipe: Recipe,
  deltaX: number,
  sizeKey: string,
  sizeValue: string,
): string {
  const lines = referenceLines(recipe, deltaX);
  if (lines.length === 0) return '';
  return `  <p class="reference size-scoped" ${sizeKey}="${sizeValue}">${lines.join(', ')}</p>\n`;
}

/** One checkable master-ingredient row (checkbox, quantity, optional badge). */
function renderCheckRow(
  ingredient: Ingredient,
  bq: number,
  links: Readonly<Record<string, string>>,
  id: string,
): string {
  const text = displayText(ingredient.name, bq, ingredient.unit);
  const badge = subRecipeBadge(links[ingredient.name]);
  return (
    `  <li class="check-row">` +
    `<input type="checkbox" id="${id}"><label class="qty" for="${id}">${text}</label>${badge}</li>`
  );
}

/**
 * One pre-computed Zutaten check list for a size. `sizeToken` disambiguates the
 * checkbox ids across sizes; `label` (yield recipes) carries the size's display
 * form for the stepper readout, and `isWritten` marks the fallback view.
 */
function renderCheckList(
  recipe: Recipe,
  deltaX: number,
  links: Readonly<Record<string, string>>,
  sizeKey: string,
  sizeValue: string,
  sizeToken: string,
  isWritten: boolean,
  label?: string,
): string {
  const rows = recipe.ingredients
    .map((ingredient, i) =>
      renderCheckRow(ingredient, scale(ingredient.quantity, deltaX), links, `c-${sizeToken}-${i}`),
    )
    .join('\n');
  const written = isWritten ? ' is-written' : '';
  const labelAttr = label !== undefined ? ` data-yield-label="${escapeHtml(label)}"` : '';
  return (
    `<ul class="check-list size-scoped${written}" ${sizeKey}="${sizeValue}"${labelAttr}` +
    ` role="group" aria-label="Zutaten">\n${rows}\n</ul>`
  );
}

/** One step block: its bulleted ingredient rows followed by the prose. */
function renderStep(
  step: Step,
  deltaX: number,
  links: Readonly<Record<string, string>>,
  n: number,
): string {
  const rows =
    step.ingredients.length === 0
      ? ''
      : `<ul class="step-rows">\n` +
        step.ingredients
          .map((ingredient) => {
            const text = displayText(
              ingredient.name,
              scale(ingredient.quantity, deltaX),
              ingredient.unit,
            );
            const badge = subRecipeBadge(links[ingredient.name]);
            return `  <li><span class="step-ingredient">${text}</span>${badge}</li>`;
          })
          .join('\n') +
        `\n</ul>\n`;
  // The prose artifacts are substituted with their scaled display form; the
  // surrounding text is HTML-escaped (renderArtifacts). An artifact that names
  // an ingredient recipe carries the „Rezept" badge after its display form.
  const text = renderArtifacts(step.text, (artifact: TextArtifact) => {
    const bq =
      artifact.unit === undefined
        ? scaleAQ(artifact.quantity, deltaX)
        : scale(artifact.quantity, deltaX);
    const badge = artifact.name !== undefined ? subRecipeBadge(links[artifact.name]) : '';
    return `${displayText(artifact.name, bq, artifact.unit)}${badge}`;
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
  deltaX: number,
  links: Readonly<Record<string, string>>,
  sizeKey: string,
  sizeValue: string,
): string {
  const steps = recipe.steps.map((step, i) => renderStep(step, deltaX, links, i + 1)).join('\n');
  return `<div class="step-wrap size-scoped" ${sizeKey}="${sizeValue}">\n${steps}\n</div>`;
}

/** The serving picker for finished dishes (DESIGN §5.2). */
function renderServingPicker(recipe: Recipe): string {
  const buttons = integerLadderValues(SERVING_MIN, SERVING_MAX)
    .map((servings) => {
      const active = servings === recipe.servings ? ' active' : '';
      return `<button type="button" class="chip serving-chip${active}" data-servings="${servings}">${servings}</button>`;
    })
    .join('\n    ');
  return (
    `  <p class="picker-caption">Portionen</p>\n` +
    `  <div class="chips" role="group" aria-label="Portionen wählen">\n    ${buttons}\n  </div>\n`
  );
}

/** True for a power of ten (`0.1`, `1`, `10`, `100`, …) — the yield chip row. */
function isPowerOfTen(value: number): boolean {
  if (!(value > 0)) return false;
  const exponent = Math.log10(value);
  return Math.abs(exponent - Math.round(exponent)) < 1e-9;
}

/**
 * The yield picker of an ingredient recipe: the editor's own control language —
 * a row of suggested chips (powers of ten plus the written size) and a −/+
 * stepper that moves exactly one ladder rung per press. Every value belongs to
 * a baked view, so a tap only toggles visibility; no scaling runs at runtime.
 */
function renderYieldPicker(recipe: Recipe, quantities: readonly number[]): string {
  const unit = recipe.yield_unit!;
  const written = recipe.yield!;
  const chipValues = quantities.filter((quantity) => isPowerOfTen(quantity));
  if (!chipValues.includes(written)) chipValues.push(written);
  chipValues.sort((a, b) => a - b);
  const chips = chipValues
    .map((quantity) => {
      const active = quantity === written ? ' active' : '';
      return (
        `<button type="button" class="chip yield-chip${active}" data-yield="${formatLinkQuantity(quantity)}">` +
        `${escapeHtml(formatBQ(quantity, unit))}</button>`
      );
    })
    .join('\n    ');
  return (
    `  <p class="picker-caption">Menge</p>\n` +
    `  <div class="chips" role="group" aria-label="Menge wählen">\n    ${chips}\n  </div>\n` +
    `  <div class="yield-row">\n` +
    `    <button type="button" class="yield-step-button yield-step-down" aria-label="Menge um eine Stufe verringern">−</button>\n` +
    `    <span class="yield-value">${escapeHtml(formatBQ(written, unit))}</span>\n` +
    `    <button type="button" class="yield-step-button yield-step-up" aria-label="Menge um eine Stufe erhöhen">+</button>\n` +
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
    const servings = integerLadderValues(SERVING_MIN, SERVING_MAX);
    let references = '';
    let checkLists = '';
    let stepWraps = '';
    servings.forEach((value, index) => {
      const deltaX = difference(recipe.servings!, value);
      const sizeValue = String(value);
      references += renderReferenceReadout(recipe, deltaX, 'data-servings', sizeValue);
      checkLists +=
        renderCheckList(
          recipe,
          deltaX,
          links,
          'data-servings',
          sizeValue,
          `s${index}`,
          value === recipe.servings,
        ) + '\n';
      stepWraps += renderStepWrap(recipe, deltaX, links, 'data-servings', sizeValue) + '\n';
    });
    return { picker, references, checkLists, stepWraps };
  }

  // An ingredient recipe without a yield or family unit still exports a usable
  // single view (the storage format does not allow it; validation catches it).
  if (recipe.yield === undefined || recipe.yield_unit === undefined) {
    return {
      picker: '',
      references: '',
      checkLists: renderCheckList(recipe, 0, links, 'data-yield', '', 'y0', true),
      stepWraps: renderStepWrap(recipe, 0, links, 'data-yield', ''),
    };
  }

  const quantities = yieldViewQuantities(recipe.yield);
  const picker = renderYieldPicker(recipe, quantities);
  let references = '';
  let checkLists = '';
  let stepWraps = '';
  quantities.forEach((value, index) => {
    const deltaX = difference(recipe.yield!, value);
    const sizeValue = formatLinkQuantity(value);
    references += renderReferenceReadout(recipe, deltaX, 'data-yield', sizeValue);
    checkLists +=
      renderCheckList(
        recipe,
        deltaX,
        links,
        'data-yield',
        sizeValue,
        `y${index}`,
        value === recipe.yield,
        formatBQ(value, recipe.yield_unit!),
      ) + '\n';
    stepWraps += renderStepWrap(recipe, deltaX, links, 'data-yield', sizeValue) + '\n';
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
 * list into browser history, and a swipe, Escape and Back/Forward move through
 * the flow (§5.11, §6.6).
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

  function toggleSize(value) {
    sizeEls.forEach(function (el) { el.hidden = el.getAttribute(sizeKey) !== value; });
  }
  function setActiveChip(value) {
    (isServing ? servingChips : yieldChips).forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute(sizeKey) === value);
    });
  }
  function activeChipValue() {
    var active = document.querySelector('.chip.active');
    return active === null ? null : active.getAttribute(sizeKey);
  }

  // Yield state (empty for a finished dish).
  var yieldValues = [];
  var yieldLabels = {};
  var yieldValue = null;
  var stepDown = null;
  var stepUp = null;
  var yieldIndex = 0;

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
    if (stepDown) { stepDown.addEventListener('click', function () { selectYieldAt(yieldIndex - 1); }); }
    if (stepUp) { stepUp.addEventListener('click', function () { selectYieldAt(yieldIndex + 1); }); }
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
  // current one lit (§5.11).
  function renderDots(index) {
    var html = '<div class="dots">';
    for (var i = 0; i < nodes.length; i++) {
      html += '<span class="dot' + (i === index ? ' on' : '') + '"></span>';
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

    // Left button hidden on the intro (nothing precedes it); right button
    // removed on the last node (nothing follows it).
    btnBack.hidden = current === 0;
    btnNext.hidden = current === nodes.length - 1;

    renderDots(current);

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

  function forward() { if (current < nodes.length - 1) { go(current + 1, 'forward', true); } }
  function back() { if (current > 0) { go(current - 1, 'back', true); } }
  function go(index, direction, push) {
    current = index;
    render(direction);
    if (push) { history.pushState({ node: nodes[index] }, ''); }
  }

  btnBack.addEventListener('click', back);
  btnNext.addEventListener('click', forward);

  // Escape = one node back (§6.6).
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') { back(); } });

  // Browser Back/Forward (history is mirrored into the node list).
  window.addEventListener('popstate', function (e) {
    var node = e.state && e.state.node;
    var i = node ? nodes.indexOf(node) : 0;
    current = i < 0 ? 0 : i;
    render();
  });

  // Swipe on every screen (not only the steps): left = forward, right = back.
  var touchX = null;
  document.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (touchX === null) { return; }
    var dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 48) { (dx < 0 ? forward : back)(); }
    touchX = null;
  }, { passive: true });

  // A check-list row is tappable as a whole to toggle the check; the badge is
  // the one exception (it opens the sub-recipe, it never toggles).
  document.querySelectorAll('.check-row').forEach(function (row) {
    row.addEventListener('click', function (e) {
      if (e.target.closest('.badge')) { return; }
      if (e.target.closest('label') || e.target.closest('input')) { return; }
      var box = row.querySelector('input[type="checkbox"]');
      if (box) { box.checked = !box.checked; }
    });
  });

  // Initial state (no history entry yet; replace so Back does not reload).
  history.replaceState({ node: nodes[0] }, '');
  render();
})();
`;

/** Inline styles: the cooking view's ladder tokens and components (DESIGN §4, §5). */
const STYLES = `
  /* The cooking view is always light; it does not follow the OS dark preference
     (§4.1). */
  :root { color-scheme: light; }

  /* Ladder tokens (DESIGN §4.2–4.3). */
  :root {
    --text-xl: 32px; --text-xl-lh: 42px;
    --text-lg: 24px; --text-lg-lh: 32px;
    --text-md: 18px; --text-md-lh: 24px;
    --text-sm: 14px; --text-sm-lh: 18px;
    --space-1: 4px; --space-2: 6px; --space-3: 8px; --space-4: 10px; --space-5: 14px;
    --space-6: 18px; --space-7: 24px; --space-8: 32px; --space-9: 42px; --space-10: 56px;
    --radius-sm: 6px; --radius-md: 10px; --radius-lg: 18px;
    --app-padding: 18px;
    --motion-base: 180ms;
    --bar-h: 74px; /* fixed bottom bar height (ladder value) */
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    font-size: var(--text-md);
    line-height: var(--text-md-lh);
    color: var(--ink);
    background: var(--paper);
    max-width: 32rem;
    margin: 0 auto;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- Screens: one page, three states (§5.11) ---- */
  .screen { display: none; min-height: 100vh; min-height: 100dvh;
            padding: var(--app-padding); padding-bottom: calc(var(--bar-h) + var(--space-9)); }
  .screen.active { display: flex; flex-direction: column; }

  /* ---- Intro ---- */
  /* The photo (§5.8): a 4:3 landscape media area at the top of the intro,
     cropped to cover and rounded at the theme's medium radius. The title's own
     top margin (--space-6) is the gap between the photo and the title. */
  .media { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover;
           border-radius: var(--radius-md); }
  h1 { font-size: var(--text-xl); line-height: var(--text-xl-lh); margin: var(--space-6) 0 var(--space-2); }
  .description { margin: 0 0 var(--space-6); }
  /* Times and the Cookbook brand share the recipe overview's caption/value look:
     an all-caps muted caption before a bold value (§5.11). */
  .meta-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2) var(--space-7); margin: 0 0 var(--space-6); }
  .meta-item { display: inline-flex; align-items: baseline; gap: var(--space-2); }
  .caption { color: var(--muted); font-size: var(--text-sm); line-height: var(--text-sm-lh); font-weight: 600; text-transform: uppercase; }
  .meta-value { font-weight: 600; font-size: var(--text-sm); line-height: var(--text-sm-lh); }
  .brand { display: flex; align-items: center; gap: var(--space-2); color: var(--muted);
           font-size: var(--text-sm); line-height: var(--text-sm-lh); margin-top: auto; padding-top: var(--space-6); }
  .brand svg { width: 20px; height: 20px; }
  .picker-caption { font-size: var(--text-sm); line-height: var(--text-sm-lh); color: var(--muted);
                    font-weight: 600; text-transform: uppercase; margin: 0 0 var(--space-2); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-4); }
  .chip { font: inherit; font-size: var(--text-sm); line-height: 1; padding: var(--space-3) var(--space-5);
          border-radius: 100px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
  .chip.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  /* Reference-ingredient readout under the size picker (amounts only, muted). */
  .reference { margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: var(--text-sm-lh); }

  /* Ingredient-recipe stepper (§5.2 "exactly as today"). */
  .yield-row { display: flex; align-items: center; gap: var(--space-3); }
  .yield-step-button { font: inherit; font-size: var(--text-md); line-height: 1; min-width: var(--space-9);
                       min-height: 42px; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md);
                       border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
  .yield-step-button:disabled { opacity: 0.5; cursor: default; }
  .yield-value { font-weight: 600; min-width: var(--space-10); text-align: center; }

  /* ---- Zutaten ---- */
  .screen-caption { font-size: var(--text-sm); line-height: var(--text-sm-lh); font-weight: 600;
                    text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 var(--space-6); }
  .screen-title { font-size: var(--text-lg); line-height: var(--text-lg-lh); font-weight: 600; margin: 0 0 var(--space-3); }
  /* The theme's decorative divider below „Zutaten" and the step title (§5.5). */
  .divider { margin: 0 0 var(--space-4); height: 0; border-bottom: 2px solid var(--accent); width: 42px; }
  .check-list { list-style: none; margin: 0; padding: 0; }
  .check-row { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4) 0;
               border-top: 1px solid var(--line);
               font-size: var(--text-lg); line-height: var(--text-lg-lh); }
  .check-row:first-child { border-top: none; }
  .check-row input[type="checkbox"] { width: 24px; height: 24px; accent-color: var(--accent); cursor: pointer; flex: none; }
  .check-row .qty { flex: 1; min-width: 0; cursor: pointer; overflow-wrap: anywhere; }
  /* A checked row goes muted; its text is NOT crossed out (decided with the user). */
  .check-row input:checked + .qty { color: var(--muted); }

  /* ---- Zubereitung (steps) ---- */
  .step-title { font-size: var(--text-lg); line-height: var(--text-lg-lh); font-weight: 600; margin: 0 0 var(--space-3); }
  .step-wrap { overflow: hidden; }
  .step { display: none; }
  .step.active { display: block; }
  .step.slide-fwd { animation: stepFwd var(--motion-base) ease-out; }
  .step.slide-back { animation: stepBack var(--motion-base) ease-out; }
  @keyframes stepFwd { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes stepBack { from { transform: translateX(-24px); opacity: 0; } to { transform: none; opacity: 1; } }
  /* The ingredient rows and the prose read at arm's length, so both use
     --text-lg. Rows are bulleted; a plain margin separates them from the prose. */
  .step-rows { list-style: none; margin: 0 0 var(--space-6); padding: 0; }
  .step-rows li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0;
                  font-size: var(--text-lg); line-height: var(--text-lg-lh); }
  .step-rows li::before { content: "• "; color: var(--muted); }
  .step-ingredient { min-width: 0; overflow-wrap: anywhere; }
  .step-text { margin: 0; font-size: var(--text-lg); line-height: var(--text-lg-lh); }

  /* ---- Sub-recipe badge (§5.7): all-caps like the web app. ---- */
  .badge { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm);
           font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1;
           padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm);
           background: var(--accent); color: var(--on-accent); text-decoration: none; white-space: nowrap; }
  .badge svg { width: 14px; height: 14px; fill: currentColor; }

  /* ---- Bottom bar (fixed): back · dots · forward on every screen (§5.11) ---- */
  .step-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 0; width: 100%; max-width: 32rem;
              min-height: var(--bar-h); display: flex; align-items: center; gap: var(--space-4);
              padding: var(--space-3) var(--app-padding) calc(var(--space-3) + env(safe-area-inset-bottom));
              background: var(--paper); border-top: 1px solid var(--line); }
  .step-bar .btn { display: inline-flex; align-items: center; gap: var(--space-2); font: inherit; font-weight: 600;
                   font-size: var(--text-md); min-height: 42px; min-width: 90px;
                   padding: var(--space-3) var(--space-5); border-radius: var(--radius-md);
                   border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; }
  .step-bar .btn svg { width: 18px; height: 18px; fill: currentColor; flex: none; }
  .step-bar .btn.next { margin-left: auto; background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .step-bar .btn:disabled { opacity: 0.5; cursor: default; }
  .counter { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
  .counter .dots { display: flex; justify-content: center; gap: var(--space-2); }
  .counter .dot { width: var(--space-3); height: var(--space-3); border-radius: 100%; background: var(--line); }
  .counter .dot.on { background: var(--accent); }

  [hidden] { display: none !important; }

  @media (prefers-reduced-motion: reduce) {
    .step.slide-fwd, .step.slide-back { animation: none; }
  }
`;

/**
 * Generates the self-contained HTML export of a recipe (decision 7).
 *
 * @param recipe a parsed recipe (validated by the caller)
 * @param links optional map of ingredient-recipe title → URL (e.g. the Drive
 *   link of the recipe's own `<title>.html` export). Whenever an ingredient
 *   use — master row, step row or text artifact — names a title present in
 *   this map, its display line carries the „Rezept" badge that opens that
 *   export (recipe_structure.md "The link means", storage_format.md §4).
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

  const intro =
    `<section class="screen intro active" data-screen="intro">\n` +
    renderPhoto(photo) +
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
    `  <meta name="viewport" content="width=device-width, initial-scale=1">\n` +
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
