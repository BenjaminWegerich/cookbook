# Design — Web App UI/UX

## 1. Purpose and authority

**What this document is.** The single source of truth for how the Cookbook web app looks
and behaves: the visual system (colour, type, geometry, motion), the components built from
it, the cross-screen interaction patterns, the UI copy rules, the accessibility
requirements and the screen inventory. Where this document and any other document disagree
about the interface, this one wins.

**What it is not.** It does not describe the software's structure
([ARCHITECTURE.md](ARCHITECTURE.md)), the canonical recipe data
([storage_format.md](storage_format.md)) or how code and documentation are written
([CODING_CONVENTIONS.md](CODING_CONVENTIONS.md)). Those documents point here for anything
a user sees or touches, and do not restate it.

**How it binds.** This is a specification, not a description: the code follows the
document, not the other way round. A screen that deviates is either a bug in the screen or
a decision that was never written down — in both cases the document changes first (see
§11) and the code second. Every value it names lives as a CSS custom property in
`apps/web/src/styles/tokens.css`: this document owns the rules and their meaning, the
token file owns the numbers, and no component introduces a value that is not rooted here.

**How it is written.** Written for machine readers as much as for people: one rule per
sentence, short and unconditional, no restatement of another section.

**How it is read.** Sections 4 and 5 define the vocabulary (foundations first, then the
components built from them); section 6 defines the behaviour that spans several
components; sections 7 to 9 define language, accessibility and the screens as the user
meets them; section 10 maps every rule to the file that implements it. A rule marked
*decided with the user* was settled in discussion and is not renegotiated by an
implementation detail.

## 2. Scope

**Surfaces.** The web app in full, plus the exported cooking view (`.html`). A rule that
applies to both is written here once.

**Devices.** Smartphones in portrait and laptops/desktops. One responsive layout serves
both: no separate desktop design, no tablet layout, no smart-display layout for the web
app.

## 3. Design principles

*Applies to: both surfaces. Rule tags: `[Both]`, `[App]` (web app), `[Export]` (cooking
view).*

1. **[Export] The kitchen decides.** The user has one wet hand, one thumb and a dish in
   progress: large targets, few decisions, no precision required.
2. **[Both] The content is the interface.** Photos, titles and quantities carry the screen;
   chrome stays quiet and gets out of the way.
3. **[Both] Readability first.** Text is legible at arm's length, with generous size and
   spacing.
4. **[App] Warm and flat.** Warm kitchen colours only, no cold hues; every surface is one
   flat, fully opaque colour — no translucency, no blur.
5. **[Both] One pattern per job.** The same action looks the same, reads the same and sits
   in the same place on every screen; a second variant needs a decision in this document
   first.
6. **[Both] Nothing stays hidden.** Every state is visible: what can be done, what is
   running, what just happened, and what it means for the user's data.
7. **[Export] Same bones, different skin.** Every recipe's cooking view has one structure and
   the same controls in the same places; only the theme — typeface, colours and decorative
   details — changes with the recipe.

When two principles collide, the earlier one wins.

## 4. Foundations

### 4.1 Color

*Applies to: web app.*

**Warm only.** Every colour is warm and edible: paper, ink, clay, olive, ochre, walnut. No
cold hue and no blue enters the interface.

**One source.** Every colour is a CSS custom property in `apps/web/src/styles/tokens.css`;
components reference tokens, never a raw value.

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#faf5ec` | page background |
| `--color-surface` | `#fffcf6` | cards, panels, sticky bars |
| `--color-ink` | `#2b241d` | primary text |
| `--color-ink-muted` | `#6e6255` | secondary text, captions, meta |
| `--color-line` | `#e6dbc8` | hairlines, dividers, borders |
| `--color-accent` | `#b85c38` | clay: primary action, active state, selection |
| `--color-olive` | `#6b7a4a` | herb: secondary accent — selected and secondary states, media grounds, success tone |
| `--color-danger` | `#a63b2c` | destructive actions and errors |
| `--color-on-accent` | `#fffcf6` | text on accent surfaces |
| `--placeholder-0` … `--placeholder-3` | `#b85c38`, `#6b7a4a`, `#c08a3e`, `#8a6d4f` | deterministic placeholder grounds (§5.8), each with a `-fg` partner for its symbol |

**Rules**

- A new colour is a new token in this table, never a literal in a component.
- Accent is the primary signal: primary action, active state, selection. As text it is
  reserved for links and text buttons.
- Olive is the second accent, used widely for selected and secondary states; it is not
  reserved for success.
- Colour never carries a meaning alone: success is olive **plus** the check symbol, an error
  is danger plus its symbol or an explicit sentence.
- Every accent surface takes `--color-on-accent` as its text colour.
- Placeholder colours are derived from the recipe title, not chosen per render (§5.8).

*Applies to: cooking view.*

**Light only.** The cooking view is always light; it does not follow the OS dark preference.

**Themed.** Every colour of the export comes from the recipe's theme, or from its fixed and
derived companions (§4.8); a recipe without theme data uses the web app's palette. The theme
tokens are the only source — no raw colour appears in the export's styles.

### 4.2 Typography

*Applies to: web app.*

**One typeface.** Source Sans 3 Variable, self-hosted and bundled at build time through
`@fontsource`: no runtime font fetch, no server. Token: `--font-sans`.

**Four sizes, each with a fixed line height** — every value a ladder step (§4.3):

| Token | Size | Line height | Role |
| --- | --- | --- | --- |
| `--text-xl` | 32px | 42px | screen title (`h1`) |
| `--text-lg` | 24px | 32px | card and section titles (`h2`) |
| `--text-md` | 18px | 24px | body text, the base size (`h3` and everything unmarked) |
| `--text-sm` | 14px | 18px | captions, meta, transient notices |

**Rules**

- Body text is 18px on 24px. There is no 16px in the ladder and no smaller body size.
- Titles and emphasis are weight 600, body text is weight 400. No other weight.
- Size and line height are one pair: a text style never takes one without the other.
- A size is chosen by the text's role, never by how much room is left.

*Applies to: cooking view.*

**One typeface per recipe**, from the theme's `font`, self-hosted and embedded in the export —
no runtime font fetch. The default typeface is Source Sans 3.

**Four sizes**, each with its fixed line height, every value a ladder step:

| Token | Size | Line height | Role |
| --- | --- | --- | --- |
| `--text-xl` | 32px | 42px | the intro title (`h1`) |
| `--text-lg` | 24px | 32px | the Zutaten heading, the step title, step prose, step ingredients, check-list rows |
| `--text-md` | 18px | 24px | the bottom-bar buttons — the base size |
| `--text-sm` | 14px | 18px | captions (the recipe-title caption, the size-picker caption), meta |

Titles and captions are weight 600, body text weight 400. Step prose, its ingredient rows and
the check-list read at arm's length and use `--text-lg`; the step title „Schritt x von y" shares
that size.

### 4.3 Geometry: pixel ladder and spacing

*Applies to: web app.*

**Every pixel value comes from one two-tier ladder.** Spacing, font size, line height,
radius, size and shadow offsets all use these values; no other pixel value exists in the
interface.

**Preferred steps** — the default:

`1 · 2 · 3 · 4 · 6 · 8 · 10 · 14 · 18 · 24 · 32 · 42 · 56 · 74 · 100`

**Second-priority steps** — fallbacks only:

`5 · 7 · 9 · 12 · 16 · 20 · 28 · 36 · 48 · 64 · 86`

**Rules**

- Reach for a preferred step first.
- Use a second-priority step only after the preferred step directly below and the one
  directly above have been tried and judged too small and too large respectively.
- A `100%` radius (circles, e.g. the floating action button) is a shape, not a distance —
  the one structural exception.
- An icon may use a second-priority step, or a value outside the ladder, when its library
  supports that optical size (§4.5).
- An image's aspect ratio and pixel size are not ladder values; they come from the common
  photographic set (§5.8).

**Spacing tokens** name the steps used for gaps, padding and margins:

| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `--space-1` | 4px | | `--space-6` | 18px |
| `--space-2` | 6px | | `--space-7` | 24px |
| `--space-3` | 8px | | `--space-8` | 32px |
| `--space-4` | 10px | | `--space-9` | 42px |
| `--space-5` | 14px | | `--space-10` | 56px |

- Any gap, padding or margin is a `--space-*` token, never a literal.
- Use the smallest step that separates two things clearly; related items sit closer than
  unrelated ones.
- A heading takes more space above than below.
- Screen gutters are `--app-padding` (18px), the same on every screen.
- Inline icons are `--icon-size` (24px), the floating action button `--fab-size` (56px).
- A second-priority step gets a `--space-*` token only when a repeated need appears, not in
  advance.

*Applies to: cooking view.*

The same pixel ladder and `--space-*` tokens as the web app. Screen gutters are `--app-padding`
(18px). Every tappable control is at least 42px tall. No other pixel value exists.

### 4.4 Shape, elevation and surfaces

*Applies to: web app.*

**Surfaces are flat, filled and opaque.** Every surface — page, card, sticky bar, sheet — is
one opaque colour from the palette (§4.1), painted over its whole footprint, edge to edge.

**Radius has four steps plus the circle:**

| Token | Value | Role |
| --- | --- | --- |
| `--radius-sm` | 6px | small elements: chips, badges, tags |
| `--radius-md` | 10px | controls: buttons, inputs, list rows, card media tiles |
| `--radius-lg` | 18px | containers: cards, panels |
| `--radius-xl` | 32px | sheets: bottom sheets |
| `100%` or `100px` | — | circles and pills: the floating action button, pill buttons |

**Elevation has two steps, both warm and low-contrast:**

| Token | Value | Role |
| --- | --- | --- |
| `--shadow-sm` | `0 3px 10px rgba(43, 36, 29, 0.06)` | raised surfaces: cards, panels |
| `--shadow-md` | `0 6px 18px rgba(43, 36, 29, 0.08)` | layers over content: sheets, the notice, a sticky bar |

**Rules**

- Nothing shows through a surface: no translucent fill, no gradient, no blur.
- Translucency is reserved for the layers that are meant to lie over content: the press
  wash (§5.1), the modal scrims and the shadows.
- A shadow is the palette's ink at low opacity, never black.
- Elevation expresses layering, not decoration: a surface is either flat or raised, and the
  two steps are never mixed on one element.
- A sticky bar covers the screen gutters too (negative inline margin plus `--app-padding`)
  and masks the gap above itself, so scrolling content never peeks around its edges.
- **Nested corners are not concentric.** Both the radius and the padding of a nested
  surface follow the pixel ladder (§4.3), as a fixed pair: 32px radius with 18px inner
  padding, 18px radius with 10px inner padding. The inner padding equals the radius of the
  elements inside it. Examples: the recipe card takes the 18px/10px pair — 18px radius,
  10px padding, 10px image radius; the recipe overview sheet takes the 32px/18px pair —
  32px radius, 18px padding, 18px image radius.
- Atomic elements — buttons, badges, chips — are the exception: they never nest, so each
  one always carries the same radius.

*Applies to: cooking view.*

Surfaces are flat, opaque `paper`. Radius follows the same steps: `--radius-md` (10px) for
buttons and rows, `--radius-sm` (6px) for badges and chips, pills (100px) where pill-shaped.
No translucency, no gradient, no blur. A hairline (the theme's `line`) separates the bottom
step bar from the content.

### 4.5 Iconography

*Applies to: web app.*

**One library: Material Symbols (Rounded), weight 400, grade 0.** Every symbol is the same
style and weight; a state is never shown by another weight or another style. The optical
size is chosen per rendered size.

**One source.** `apps/web/src/components/icons.tsx` holds the paths verbatim from
`google/material-design-icons` →
`symbols/android/<name>/materialsymbolsrounded/<name>_<size>px.xml` and renders them on the
family's native `0 0 960 960` grid with `fill="currentColor"`. Components import from that
file and never inline an `<svg>`.

**The app icon is a brand mark, not a control.** `apps/web/public/favicon.svg` draws the
same library's „Menu Book 2" in the clay accent on the paper tile; it lives outside
`icons.tsx` because it carries the brand rather than a meaning.

**Sizes** are ladder values, chosen by where the symbol sits, and each carries the optical
size drawn for it:

| Size | Token | Drawable | Where |
| --- | --- | --- | --- |
| 24px | `--icon-size` | `<name>_24px.xml` | standalone symbols, list rows |
| 18px | `--icon-md` | `<name>_20px.xml` | inside a button, next to its label |
| 14px | `--icon-sm` | `<name>_20px.xml` | inside a chip, tag or badge |

**Rules**

- A symbol ships the drawable of every size it is rendered at: 14 and 18px share the 20px
  drawing, 24px uses the 24px drawing.
- A state difference is colour, or the same symbol's own filled pair (`star` / `star_fill1`);
  every other symbol is unfilled.
- A symbol is always decorative (`aria-hidden`): it sits next to a visible label, or its
  button carries an `aria-label`.
- Font characters (`+`, `−`, `×`) are never used in place of a symbol.
- A symbol larger than 24px uses the family's matching optical size (40 or 48) even when that
  value is not a ladder step (§4.3).
- Optical size corrects legibility, never weight: a drawing that reads too light or too heavy
  at its size is replaced by the drawing for that size, not by another weight.

*Applies to: cooking view.*

Icons are inline SVG (no icon font, no runtime fetch), drawn on the Material Symbols Rounded
family's grid, weight 400, `fill="currentColor"` — the same family as the web app. The export
uses these symbols: the sub-recipe badge's link glyph beside its visible „Rezept" label, the
back/forward arrows on every navigation button (left = back, right = forward), and the Cookbook
brand mark (menu book 2) beside „Erstellt mit Cookbook". The check-list checkbox is a native
`<input type="checkbox">` styled with the theme, never a hand-drawn glyph.

### 4.6 Motion

*Applies to: web app.*

**Motion is feedback, not decoration.** Movement shows where something came from or that a
state changed; nothing moves to entertain.

**Two durations, one easing curve:**

| Token | Value | Where |
| --- | --- | --- |
| `--motion-fast` | 120ms | fading a press highlight out after release |
| `--motion-base` | 180ms | entrances and state changes: the create menu rising, the notice sliding in, the FAB's plus turning into an × |
| easing | `ease-out` | every animation |

**Rules**

- Feedback appears with the finger: a press never waits for a transition (§5.1); only its
  fade-out is animated, and it stays within `--motion-fast`.
- Entrances are short and directional — a small rise or a fade. Nothing bounces, springs or
  overshoots.
- Every animation is disabled under `prefers-reduced-motion: reduce`, which leaves the start
  or the end state visible.
- No animation delays the user: a screen is usable the moment it appears.

*Applies to: cooking view.*

Motion is subdued and never steals time: a step change may slide one step's width in the
direction of travel over `--motion-base` (180ms) `ease-out`; a screen change fades over the
same duration. Nothing bounces or overshoots. Every animation is disabled under
`prefers-reduced-motion: reduce`, leaving the end state visible.

### 4.7 Layout and responsiveness

*Applies to: web app.*

**One layout, no separate desktop design.** The app is phone-first and fluid; a wide viewport
gets more columns and the same components, never a second arrangement.

**Breakpoints are content-driven and expressed in rem**, so they follow the user's font size.
A ladder number is used where one fits; the ladder does not own breakpoints. There are two:

| Breakpoint | Roughly | Effect |
| --- | --- | --- |
| base | phone portrait | the recipe list is a two-column grid |
| `42rem` | 672px | the recipe list becomes three columns |
| `74rem` | 1184px | the recipe list becomes four columns |

**The page** uses the full width with `--app-padding` (18px) gutters, the same on every
screen. Floating elements add the safe-area inset at the bottom
(`env(safe-area-inset-bottom)`).

**Sheets** are capped at `42rem` and centred, so a wide viewport never stretches a photo, a
reading row or a form field (§5.6).

**Rules**

- Layout is fluid: no fixed page width, and no horizontal scrolling at any viewport.
- A breakpoint is a rem value placed where the content stops working, never a fixed device
  width; a component that only works at another width is a component problem first.
- A grid or flex child that holds text carries `min-width: 0`, so one unbreakable word cannot
  widen its container.
- Sticky bars span the full width including the gutters (§4.4); floating elements clear the
  FAB by its own gap (§5.10).

*Applies to: cooking view.*

Phone-first, one column, `max-width: 42rem` centred, `--app-padding` gutters — the same measure
as the app's sheets. No horizontal scrolling at any viewport. The three screens (§5.11) are
states of one page; the bottom step bar is fixed, full-bleed, and adds
`env(safe-area-inset-bottom)`.

### 4.8 Recipe theme

*Applies to: cooking view.*

**A theme is a recipe's visual skin, stored with the recipe** (storage_format.md, `theme`): a
typeface and a small palette, plus optional decorative details. It changes nothing about the
structure of the cooking view — every recipe uses the same screens, the same controls and the
same order (§3.7) — only the look.

**Tokens.** A theme defines five values, each optional and each falling back to the default
theme independently:

| Token | Default (the app palette) | Role |
| --- | --- | --- |
| `font` | Source Sans 3 | the one typeface of the export |
| `accent` | `#b85c38` (clay) | active state, the forward actions, the sub-recipe badge, links |
| `paper` | `#faf5ec` | page background |
| `ink` | `#2b241d` | primary text |
| `line` | `#e6dbc8` | hairlines, borders, dividers |

**Fixed and derived colours.** `muted` (secondary text, captions, meta) is `ink` blended 40%
toward `paper` (solid — no opacity). `on-accent` (text on a filled accent surface) is derived
for contrast: `ink` when the accent is light, `paper` otherwise — the choice whose contrast
against `accent` reaches WCAG AA.

**Theme font.** The `font` token names one typeface from the export font shortlist. The
shortlist holds eleven typefaces, deliberately unlike each other, spanning a wide range of
genres — sans, serif, slab, condensed, handwriting, monospace. A typeface need not be warm or
humanist, and it need not harmonise with the web app's palette; a theme's colours are chosen
independently of its typeface. *decided with the user*

| Typeface | Vibe |
| --- | --- |
| Source Sans 3 | humanist sans — the default |
| Inter | neutral grotesque sans |
| Montserrat | geometric sans |
| Nunito | rounded, friendly sans |
| Source Serif 4 | transitional book serif |
| Fraunces | soft, expressive serif |
| Playfair Display | elegant didone serif |
| Bitter | slab serif |
| IBM Plex Sans Condensed | condensed headline |
| Caveat | handwriting |
| IBM Plex Mono | monospace |

A typeface joins the shortlist only when it meets every requirement:

- **Embeddable and offline.** Self-hostable and inlined into the standalone `.html`; no CDN,
  no runtime fetch, no server. Subset to the required coverage so the inlined font stays
  practical in size.
- **Redistributable.** The export is a shareable file, so the license permits embedding and
  redistribution (SIL OFL or equivalent).
- **Weights 400 and 600.** The typeface offers both weights of §4.2; a variable font and two
  static files satisfy this equally. *decided with the user*
- **Character coverage.** Native glyphs for Basic Latin and Latin-1 (the German letters
  `ä ö ü ß Ä Ö Ü` included), the typographic punctuation the content uses (`„ " ' – — …`). Fraction
  glyphs and the narrow no-break space are not required: fractions render in the slash form
  (§7), and a missing narrow no-break space degrades invisibly.
- **Legible at arm's length** at the four sizes of §4.2 within their fixed line-heights, with
  clear figures. A typeface may be expressive in any genre, but body text (18–24 px) that
  fails at arm's length is out.

**Rules**

- The default theme is the web app's palette and typeface: a recipe without `theme` data
  renders in the app's look.
- A recipe's `font` is one of the shortlist's eleven typefaces; no other typeface is selectable.
- A recipe may override any subset; the rest fall back to the default.
- The theme may carry decorative details but never changes the placement, size or wording of
  any control.
- Sub-recipes carry their own theme; the parent's theme is not inherited.

## 5. Components

### 5.1 Buttons and action rows

*Applies to: web app.*

**Four button variants, each with one job:**

| Variant | Look | Used for |
| --- | --- | --- |
| Primary | accent fill, `--color-on-accent` label | the one forward action of a screen or sheet („Speichern") |
| Danger | danger fill, `--color-on-accent` label | a destructive action („Rezept löschen", „Entfernen") |
| Outlined | surface fill, hairline border, ink label | secondary actions in a row („Einplanen", „Mehr") |
| Text | no fill, no border, muted label | navigation („Zurück") and quiet answers („Abbrechen", „Rückgängig") |

**Geometry.** Action buttons: `--radius-md`, padding `--space-3` / `--space-6`, label
`--text-md` weight 600, `--space-2` gap to an 18px symbol (`--icon-md`). Text buttons:
`--radius-sm`, padding `--space-2`, label `--text-sm`. Icon-only buttons keep the geometry of
their variant and carry an `aria-label`.

**States**

- **Pressed:** one shared translucent ink wash over the whole click area, defined once in
  `index.css`. No component defines its own `:active` rule. Feedback is immediate; a fade-out
  on release stays within `--motion-fast`.
- **Unavailable:** `opacity: var(--opacity-disabled)`, no press feedback, cursor default. This
  look is allowed only while the cause is visible next to the button.
- **Busy:** the unavailable look plus an ellipsis label („Speichert …") and `aria-busy="true"`.
  The ellipsis means running, never not allowed.

**Action rows.** A sheet ends in one bottom row: answers right-aligned in the order no | yes,
the primary last. A danger button leaves that order and sits at the left end of the row. A
page has no cancel in its row — its navigation exit is „Zurück" at the top left (§6.1).

**Rules**

- One primary action per decision; a row never shows two accent-filled buttons.
- Every action button is at least 42px tall, so a change of leading can never shrink a target
  below thumb reach.
- A chip is not a button variant: it stays compact and takes its own hit area (§5.2).
- Never disable a button for a reason that is not visible next to it; run the check on press
  and show the problem instead (§5.3).
- Labels follow §7: sentence case, a verb in the infinitive, the same action worded the same
  everywhere.

*Applies to: cooking view.*

Every navigation control lives in the one fixed bottom bar, not on the screens. The forward
action is the bar's primary button — accent fill, `on-accent` label, `--radius-md`, at least
42px tall, with a leading right arrow: „Weiter" on every screen except the last step, where the
button is removed. The bar's back button is outlined (surface fill, hairline border, ink
label), at least 42px, with a leading left arrow: „Zurück" on every screen except the intro,
where it is hidden.

### 5.2 Chips and segmented controls

*Applies to: web app.*

**A chip is one value in a wrapping row.** Look: pill (`100px` radius), `--color-bg` fill,
hairline border, `--text-sm` label. A row of chips wraps and never scrolls sideways.

| State | Look | Meaning |
| --- | --- | --- |
| default | background fill, hairline border, ink label | an available value |
| selected | accent fill, accent border, `--color-on-accent` label | the chosen value |
| olive outline + check symbol | olive border and label | the special answer („Nichts zu kaufen") |
| dashed, muted, close symbol | dashed hairline, muted label, 14px symbol | clears an optional value |

**A segmented control is one exclusive mode.** Track: `--color-bg` fill, hairline border,
`--radius-md`, `--space-1` padding and gap. Option: `--radius-sm`, `--text-sm`, muted label;
the active option is an olive fill with an `--color-on-accent` label. Used for two or three
exclusive modes (Typ, Einheit, KI-Modus), never for a longer list.

**Chip or segmented?**

- A chip is a *value* the user picks, in a row of alternatives that may wrap.
- A segmented control is a *mode* the screen is in, drawn as one connected track.

**Rules**

- A chosen value is clay; an active mode is olive. The two never swap.
- A chip's visible pill is compact (about 32px); its hit area is at least 42px, and the row's
  gap is wide enough that two hit areas never overlap.
- A chip's label is a value or a short noun, never a sentence; a sentence is a button (§5.1).
- A selection takes effect immediately; a chip or segment never needs a confirm step.
- The group carries a German `aria-label` (`role="group"`, or `role="radiogroup"` where the
  choice really is one of a set) (§8).

*Applies to: cooking view.*

The intro's size picker is a wrapping row of chips (pill radius, hairline border, `--text-sm`);
the active size is accent fill with `on-accent`. An ingredient recipe adds the −/+ stepper
beside the chips, exactly as today. The picker lives only on the intro screen.

### 5.3 Form fields, labels and validation

*Applies to: web app.*

**A field is a caption above its control.** The caption is `--text-sm`, weight 600, muted, and
displayed in ALL CAPS by CSS (`text-transform`); the markup and every string keep normal
German case („Titel"), so a screen reader announces the plain word.

**An optional field is marked, a required one is not.** The marker is ` (optional)`, italic,
lowercase, muted, appended to the caption and separated from it by one En space
(`margin-inline-start: 0.5em`, 7px at the caption size — a second-priority ladder step). No
asterisks, no „Pflichtfeld".

**Controls.** Text inputs and text areas: `--color-bg` fill, hairline border, `--radius-md`,
`--text-md` text, padding `--space-3` / `--space-4`. A focused text field shows a solid 2px
accent outline, so the caret's position is always visible — not only for keyboard users. A
text area grows with its content: no scrollbar, no resize grip; an empty one starts at 42px,
a description at 74px.

**A caption may be followed by one quiet hint line** (`--text-sm`, muted) that explains the
field; a hint never repeats the caption.

**Validation feedback comes in two places:**

| Place | Look | When |
| --- | --- | --- |
| Banner | surface fill, danger border, danger text, a bulleted list, `role="alert"` | at the top of the form after a failed save |
| Field error | `--text-sm` danger text under the field, `role="alert"` | next to the exact field |

**Rules**

- A save attempt runs every check, shows the banner and moves focus and scroll to the first
  problem; the primary button stays enabled so it can explain itself (§5.1).
- Every message is German, names the problem and says what to do; it never only says that
  something is wrong.
- A field's error text is bound to the field through `aria-describedby`, and the field is
  marked `aria-invalid` (§8).
- An error is never colour-only: the words carry the message, the danger colour supports it.

*Cooking view: not applicable* (no text entry). The one input is the check-list checkbox (§5.11).

### 5.4 Cards and list items

*Applies to: web app.*

**A card is one surface and one tap target.** Surface fill, hairline border, `--radius-lg`,
`--shadow-sm`. Everything drawn on the card — a badge, a caption, a value — is content, never
a second hitbox: the whole card is the button.

**A recipe card is media above title, inset by one mat.** The card carries `--space-4` (10px)
of padding on all four sides, so the square media area sits inside the border instead of
bleeding into it. The title below starts on the same left edge (its own inline padding is 0),
so media and title read as one column inside one frame.

**Nested corners follow the fixed pairs (§4.4).** The card's mat and its media tile are the
18px/10px pair: `--radius-lg` (18px) on the card, `--space-4` (10px) padding, and the media
tile takes `--radius-md` (10px).

**A list is rows inside one card, not a card per row.** Rows share the container's surface and
are separated by a hairline divider (the first row carries none). A row's text column is
`minmax(0, 1fr)` with `overflow-wrap: anywhere`, so a long unbreakable word wraps instead of
widening the sheet.

**Sections on the home screen** are captioned groups of the same card grid: the caption uses
the field-caption typography (`--text-sm`, weight 600, muted, ALL CAPS by CSS), an optional
action may sit beside it in the same row, and `--space-7` separates two sections.

**Rules**

- A card or row is tappable as a whole; a control inside it (a badge's ×, a checkbox) is the
  only thing that may carry its own target.
- A card title clamps to three lines and is cut with an ellipsis; it is never pushed to a fourth
  line or set in a smaller size to fit.
- A row holds one line of primary text and, where needed, one quieter line (`--text-sm`,
  muted) beneath it.
- An empty list is never a blank area: either it carries the established placeholder, or one
  muted German sentence when §6.3 asks for it.
- Rows are separated by a hairline, never by a shadow or a gap in the surface.
- Cards in one row are equal height; the media row keeps its square height, so every title
  starts on the same line.

*Applies to: cooking view.*

The ingredient check list is rows, not cards: one row per master ingredient — a checkbox, the
quantity line, and (for a sub-recipe) the „Rezept" badge — separated by hairlines, the first
row without one. A row is tappable as a whole to toggle the check.

### 5.5 Headers, titles and sticky bars

*Applies to: web app.*

**A screen with a title opens with it** in `--text-xl` (32px) weight 600, with every default
heading margin reset; the header's own margin sets the distance to what follows. The recipe
list has no title: it opens with the search field and its two section captions (§5.4).

**A header that carries a button sticks; one that carries none scrolls.** The editor, the AI
screen, the shopping steps and the recipe selection carry „Zurück", so their header stays at
the top of the viewport (`z-index: 10`).

**A sticky bar is full-bleed.** It paints edge to edge (negative inline margin plus
`--app-padding` as its own padding) and masks the gap it leaves above itself, so content
scrolling up can never peek around its left or right edge (§4.4). It sits on the page
background or on the surface colour, never on a translucent fill.

**Two header shapes:**

| Shape | Structure | Used by |
| --- | --- | --- |
| bar | one row: one button on each side, no title | the editor |
| stack | „Zurück" on its own line, the title below it (`--space-6` apart) | the AI screen, the shopping steps, the pantry step |

**Sheets** open with a head block — the title plus one optional explanatory line. A browsing
sheet (the recipe overview, the create menu) is left through its scrim or Escape; a sheet that
is a *change* ends in the bottom action row (§5.1, §6.1).

**Rules**

- A screen has at most one title, and it is the `h1`; cards and sections use captions or `h2`
  (§5.4).
- A sticky bar carries at most one row of controls plus the armed confirmation line (§6.1);
  anything more belongs in the scrolling content.
- A button in a header stays reachable at every scroll position — that is what makes the
  header stick.
- A sheet's head is not a sticky bar: the sheet scrolls as a whole (§5.6).

*Applies to: cooking view.*

The intro opens with the recipe title as `h1` (`--text-xl`). The Zutaten screen opens with the
recipe-title caption (`--text-sm`, weight 600, muted, ALL CAPS by CSS), a heading „Zutaten"
(`--text-lg`, 24px, weight 600) and the theme's divider below it (§4.8). The steps screen
carries the same recipe-title caption, a step title „Schritt x von y" (`--text-lg`, weight 600)
with the theme's divider below it — so the current step stays the focus. The bottom bar is the
fixed bottom bar (§5.11), full-bleed.

### 5.6 Sheets, overlays and scrims

*Applies to: web app.*

**A sheet is a bottom sheet.** It is anchored to the bottom edge, spans the width, rounds its
two top corners (`--radius-xl`), sits on the surface colour and casts `--shadow-md`. It grows
with its content up to 85% of the viewport height and then scrolls inside itself.

**It is modal, and the scrim says so.** The backdrop is a flat `rgba(43, 36, 29, 0.4)` ink
wash over the screen behind. Tapping the scrim, pressing Escape or using browser Back leaves
the sheet. A sheet's fields are transient: dismissing it discards them without asking (§6.2).

**Every sheet is a content sheet:** capped at `42rem` and centred. On a phone the cap is wider
than the viewport, so the sheet stays edge to edge; on a wide screen it never stretches a
photo, a reading row or a form field (§4.7).

**Layers are fixed, and each step is a decision:**

| z-index | Layer |
| --- | --- |
| 10 | a sticky header |
| 20 | the first scrim |
| 30 | the first sheet, the FAB and its create menu |
| 40 / 41 | a second scrim and the sheet that opens over the first one (meal-plan overlay, „Eintrag ersetzen") |
| 50 | the transient notice (§5.9) |

**Rules**

- A sheet always opens over content that stays where it is; it never becomes a page — §6.1
  decides whether a screen is a place or a change.
- A second sheet opens only as a sub-decision of the first, and takes the 40/41 pair.
- A sheet's head carries the title plus one optional line; its answers are one bottom row
  (§5.1).
- A sheet's content scrolls inside the sheet and never sideways.
- Below the last control the sheet adds the safe-area inset, so its actions clear the phone's
  gesture bar.

*Cooking view: not applicable.*

### 5.7 Badges and tags

*Applies to: web app.*

**A badge is a small all-caps state marker that leads with a symbol.** Look: `--radius-sm`,
`--text-sm` weight 600, `--color-on-accent` label, one 14px symbol (`--icon-sm`) before the
text, and a fill that carries meaning. Labels are written in normal German case in the source
(„Neu"); the caps are a CSS effect.

| Badge | Symbol | Fill | Meaning |
| --- | --- | --- | --- |
| „Neu" | new releases | danger | the ingredient is not in the master data yet |
| „Rezept" | link | accent | the ingredient has a recipe of its own; the badge itself opens it |
| „Referenz" | outline star | olive | mirrors the star toggle; its × clears the role |
| „Unbekannt" | room service | danger | a meal-plan line the app cannot recognise |

**Rules**

- A badge always leads with a symbol; it is never plain coloured text.
- The symbol follows the badge's meaning, not its colour (§4.1).
- A badge is content first, but it may be the control itself: „Rezept" opens the sub-recipe,
  and „Referenz" carries a × that clears the role. Where a badge is a control, only the badge
  (or its ×) is the target — never the whole row around it.
- A control inside a badge gets its own hit area, extended beyond the glyph when the symbol is
  small.
- A badge's label is a short noun or a state word, never a sentence.
- A state that persists is a badge; a state that just happened is a notice (§5.9).
- A badge's wording matches the action that caused it and the action that undoes it.

*Applies to: cooking view.*

A sub-recipe use (master row, step row or artifact) carries the app's „Rezept" badge: the link
symbol, `--radius-sm`, accent fill, `on-accent` label. It opens the sub-recipe's export in a
new tab. It is the one badge in the export.

### 5.8 Media: photo, thumbnail and placeholder

*Applies to: web app.*

**A recipe's media area is landscape, cropped to 4:3.** It fills its container's width and is
cropped to that ratio (`object-fit: cover`); its radius follows the fixed pair of its container
(§4.4): 10px (`--radius-md`) in a card, 18px (`--radius-lg`) in the recipe overview sheet. One
format serves the card, the overview hero and the editor preview.

**An image is not a ladder value.** Aspect ratios and image pixel sizes come from the common
photographic set (4:3, 3:2, 16:9; 120×90, 160×120, …), not from the UI ladder (§4.3): the
ladder governs the box an image sits in, not the image itself.

**Without a photo, the room-service placeholder.** The app derives a warm ground from the
recipe's title: the title hashed onto one of four palette pairs (`--placeholder-0` …
`--placeholder-3`, each with its `-fg` partner), carrying the serving cloche of `RoomServiceIcon`
at `--placeholder-symbol-size` (42px), centred on the landscape area. The same title always gets
the same colour; the choice is never random and never per render.

**The overview sheet shows a media area only for a recipe with a photo.** A recognized recipe
without a photo starts its body at the sheet's top padding, like an unrecognized entry: the card
that opened the sheet already carried the room-service placeholder, so the sheet does not repeat
it. The card grid keeps the placeholder for recipes without a photo.

**An unrecognised meal-plan line gets the danger media area** with the room-service symbol
instead of a placeholder — that card then needs no badge of its own (§5.7).

**Sizes.** Card media: the full card width, 4:3. Overview hero: the full sheet content width,
4:3. Editor preview: 120 × 90px (4:3).

**Rules**

- A photo inside a card is decorative for assistive tech (`alt=""`): the title beside it
  carries the name. A photo standing alone as a field preview gets a German `alt`.
- Photos are cropped to 4:3, never letterboxed or stretched.
- The placeholder colour comes from the title, so it is stable across screens and reloads.
- Nothing is drawn over the media except a badge (§5.7).
- A missing photo is the room-service placeholder, never an empty grey box or a broken-image
  glyph.

*Applies to: cooking view.*

The intro shows the recipe photo as a 4:3 landscape media area, `--radius-md`,
`object-fit: cover`, at the top of the intro. A recipe without a photo omits the media area
entirely — the intro starts with the title — like the recipe overview sheet. The photo is
decorative (`alt=""`); the title beside it carries the name.

### 5.9 Snackbar and transient notices

*Applies to: web app.*

**A notice reports the outcome of a finished action.** It is a small opaque card that slides in
at the bottom of the screen, states what happened in one German sentence and offers one action
only where there is a real way back („Rückgängig"). It is the app's confirmation layer for work
that is done and whose screen has closed. It is rendered once at the app root, so any screen can
report an outcome.

**Look.** A card on `--color-surface` with a hairline border, `--radius-lg`, `--shadow-md`; a
leading tone symbol, the message in `--text-sm`, then the optional action. No scrim, no
translucency, no close button, no countdown.

| Tone | Symbol | Colour | Live region | Used for |
| --- | --- | --- | --- | --- |
| success (default) | check circle | olive | `role="status"` | the action finished as asked |
| error | error | danger | `role="alert"` | the action failed and the user must notice now |

**Placement.** Fixed above the content, inset by `--app-padding`, bottom offset
`--space-7 + --fab-size + --space-5 + safe-area-inset-bottom`, `max-width: 42rem` centred,
`z-index: 50` — above every sheet. The FAB stays reachable.

**Behaviour**

- One at a time, in order: a FIFO queue, the head of the queue is on screen; notices never stack.
- Auto-dismiss after 6 s; every notice gets a fresh, full countdown.
- A pointer over the card or focus inside it pauses the countdown; leaving restarts a full 6 s.
- The action runs as a promise: the host is busy, the button is disabled, shows its ellipsis
  label with `aria-busy="true"`, and the countdown is suspended.
- A rejected action reports itself as an error notice; the success notice then closes.
- No manual dismissal: no close button, no swipe-away, no Escape. Escape belongs to the sheets.

**Copy**

- One complete German sentence about the past („… zum Essensplan hinzugefügt."), never a label
  like „Erfolgreich!".
- The first part names the object the way the user meets it elsewhere — the meal-plan entry
  text, never a URL.
- A second sentence only when it answers a real question („Die Einkaufsliste bleibt
  unverändert.").
- The action carries the app's established wording for that way back („Rückgängig", busy label
  „Wird rückgängig gemacht …").

**When not to use it**

- Field validation — the problem belongs next to the field (§5.3).
- A decision that blocks the flow — that is a sheet with two buttons (§6.4).
- A permanent state — that is a badge, a caption or a tab (§5.7).

**Accessibility.** The card is a live region, and a new message remounts it (React `key`), so a
screen reader announces it even while the previous one is still up. Focus is never moved or
trapped; the action is reachable with Tab, and focus pauses the countdown.

*Cooking view: not applicable.*

### 5.10 Floating action button and create menu

*Applies to: web app.*

**At most one floating action button per screen.** It is a `--fab-size` (56px) circle in the
clay accent with `--color-on-accent` and `--shadow-md`, fixed `--space-6` from the right edge
and `--space-7` above the safe-area inset. On the recipe list it is the entry point to creating
a recipe.

**The plus becomes an × while the menu is open.** The symbol rotates 45° over `--motion-base`;
the button itself neither moves nor changes colour.

**The menu is extended pills above it:** `--fab-size` tall, `--space-6` inline padding, pill
radius, clay fill, `--text-md` weight 600, one 24px symbol before the label, `--space-3`
between the pills. They rise into place over `--motion-base`.

| Pill | Symbol | Opens |
| --- | --- | --- |
| „Rezept manuell schreiben" | pencil | the empty editor |
| „Rezept mit KI schreiben" | sparkle | the AI create screen |

**The scrim covers the whole screen** in `rgba(43, 36, 29, 0.4)` and is the menu's way out
besides the ×: tapping it closes the menu. It is the one element excluded from the shared press
wash (§5.1) — a scrim must not visibly react to the tap that dismisses it.

**Rules**

- The FAB is the screen's only accent-filled circle and never sits beside a second floating
  control.
- The button sits above its scrim, so tapping it again closes the menu.
- A notice clears the FAB by the same gap the menu uses above it (§5.9).
- The menu holds two or three destinations, each a full action phrase; a longer list belongs in
  the content.
- The menu closes on a scrim tap, on Escape and on choosing a destination.

*Cooking view: not applicable.*

### 5.11 Cooking view screens

*Applies to: cooking view.*

**Three screens, one page, in order.** The cooking view is Intro → Zutaten → Zubereitung.
Each is a full state of the one page; the recipe's theme skins all three. Navigation lives in
the one fixed bottom bar, whose two buttons are the directional „Zurück" (left arrow) and
„Weiter" (right arrow). The view is the same for every reader — owner and friend — no account
and no personalisation.

**Intro.** The first screen: the photo (§5.8), the title (`h1`), the description, the meta line
— „Arbeitszeit …" and „Gesamtzeit …" as caption/value pairs in the recipe overview's look
(all-caps muted captions, bold values) — the size picker under an all-caps „Portionen" /
„Menge" caption (§5.2), and, when the recipe defines reference ingredients, a small muted
readout of them below the picker (the Einplanen sheet's look). Scaling happens here and only
here. A meal-plan link opens this screen with the promised size pre-selected.

**Zutaten.** The check screen: the recipe-title caption, the heading „Zutaten" with the theme's
divider below it (§5.5), the master ingredient list of the chosen size as checkable rows (§5.4),
and the bottom bar. Checks are purely local; a size change discards them, while moving between
screens without changing the size keeps them.

**Zubereitung.** One step at a time: the recipe-title caption, the step title „Schritt x von y"
with the theme's divider below it (§5.5), the step's own bulleted ingredient rows followed by
the step prose, and the bottom bar. The size picker is absent here.

**The footer** „Erstellt mit Cookbook" (the Cookbook brand mark beside the words) sits at the
bottom of the intro screen, left-aligned, above the fixed bottom bar; it scrolls with the
content while the bar stays put.

**The bottom bar** is the fixed bar on every screen: the „Zurück" button on the left, the
primary „Weiter" button on the right, and the flow dots centred in the bar — even when only one
button is present on the first or last screen. The dots span the whole flow — intro, Zutaten
and each step — with the current one lit. „Zurück" is hidden on the
intro (nothing precedes it); „Weiter" is removed on the last step (nothing follows it). A swipe
left goes forward and a swipe right goes back on every screen; the Escape key and the browser
Back button go to the previous step, and from step 1 to the Zutaten screen (browser Forward
returns to the next step). Tapping the step text does not advance.

**Going back.** Every back action moves one node at a time: from a step to the previous step,
from step 1 to Zutaten, from Zutaten to the intro. Changing the size on the intro discards the
checkmarks.

## 6. Patterns and flows

### 6.1 Leaving a screen: place vs. change

### 6.2 Browser Back, Escape and the exit guard

### 6.3 Loading, empty and error states

**Explanatory text only where the empty state needs explaining.** A missing list, field or
value stays as it is — a label, a caption, a counter or the bare em dash of the established
placeholder. A sentence is added only when the user could otherwise be misled or stuck:

| The sentence is due | Example |
| --- | --- |
| the empty state is an error on the app's side | the master data could not be loaded |
| the reason for it is invisible on screen | the recipe file carries no cooking view yet |
| it is a rare state the user reaches by surprise | the plan holds no dish at all |

- **A common, expected outcome gets no sentence.** A search without a match is the case the
  user typed for: the filtered area is simply empty, and the input still names the term, so
  no text repeats it back (§5.4).
- **Loading and failures keep their own rules**: the loading message (§6.3, to be written)
  and the error next to its cause (§5.3, §5.9).

*Cooking view: not applicable.*

### 6.4 Destructive actions and confirmations

*Applies to: web app.*

**One danger look, and a confirmation only when the action cannot be undone.** Every
destructive action wears the same danger styling — the filled `.danger-button` for a labelled
button, danger text for a menu entry. Whether it also asks first is decided by whether the
action can be undone, not by how large it is.

**The look**

- A destructive button is the danger fill with `--color-on-accent` label, the primary button's
  geometry (§5.1); a destructive menu entry is danger text on the surface.
- Danger never decorates: the colour appears only on an action that really removes data, never
  on a quiet answer. „Abbrechen" is always a text button.

**The two-step armed confirm, in place**

- An irreversible action („Rezept löschen") does not open a sheet. The button itself asks: the
  first tap swaps its label for the question — `„<Titel>" wirklich löschen?` — and a second,
  quiet „Abbrechen" appears beside it. The second tap on the danger button performs the action.
- The armed state is a question, so it never lingers: it drops when the button loses focus, when
  „Abbrechen" is tapped, or when any other change to the screen would make the question stale.
- The same armed pair removes a photo and a step in the editor (`„Wirklich entfernen?"`) — an
  empty step, which has nothing to lose, is removed immediately without asking.

**When no confirm is due**

- A reversible removal never asks: it just happens, and the undo is the notice (§5.9). Removing
  a dish from the meal plan and removing an ingredient row are reversible, so they carry the
  danger look and no confirmation.
- The armed discard of unsaved work („Änderungen verwerfen?") is the exit guard's own pattern
  (§6.2), not a destructive confirm: it answers „leave or stay", it never deletes.

**Rules**

- One destructive action per row; the danger button sits at the left end of the action row,
  apart from the primary (§5.1).
- The question names the object — the recipe title — never a generic „Wirklich löschen?".
- „Abbrechen" is the only answer that drops an armed question; it never performs the action and
  never navigates.

*Cooking view: not applicable.*

### 6.5 Undo semantics

*Applies to: web app.*

**Undo exists only where the app can put the data back, and it is always the snackbar action
„Rückgängig" (§5.9).** A success notice carries that action when the write it reports is
reversible; an action that cannot be restored gets a confirmation before it happens (§6.4),
never an undo after. The undo restores the *previous state*, not just a deletion: it removes
what the write added and puts back what the write replaced, in one hop.

**A write captures its own undo.** The snapshot of what changed — the added line and the
replaced lines — is taken where the write happens, because only that callback knows what it
actually touched. The snackbar itself is generic and knows nothing about the meal plan or the
shopping list.

**The meal plan restores, it never deletes.**

- Planning or re-planning a dish is a full restore: the undo removes the line the write added
  and puts back the exact lines it replaced, as one block at the top, in their reading order.
- Replacing an unrecognized entry is a 1:1 restore: the chosen recipe's line leaves, the
  unrecognized entry's line returns.
- „Abhaken" never deletes the line — it ticks it off, so the user still sees in Keep
  what was cooked. Its undo is the inverse tick, so the dish reappears with the size it had.

**The shopping list removes one instance per line, not every match.** A list of things to buy
may hold the same line twice, so „Rückgängig" takes off exactly the instances the app added and
leaves the user's own line standing.

**Honest limits**

- The undo is a snapshot of what the app last wrote; changes made in Keep in the meantime are
  not reconciled.
- A replaced line's checked state is not restored; restored lines come back unchecked.
- The undo lives only while the notice is on screen (6 s); after that the normal actions apply.
- A failed undo is its own error notice — the success notice has already closed.

*Cooking view: not applicable.*

### 6.6 The cooking flow

*Applies to: cooking view.*

The cooking view has one path: Intro → Zutaten → Zubereitung. The forward actions carry it.
Scaling happens once, on the intro, before the first step is shown — the steps screen has no
size control. Every back action (the left step-bar button, Escape, browser Back, a rightward
swipe) moves one node: to the previous step, from step 1 to Zutaten, from Zutaten to the
intro. A size change discards the checkmarks. A sub-recipe opens in a new tab; the parent
keeps its state because it stays in its own tab.

## 7. Language and formatting

*Applies to: web app.*

**The UI is German.** Every string the user reads — buttons, captions, errors, notices, empty
states — is German. Recipe data is German as the user entered it; the app never translates it.
There is no English UI and no locale switch.

**Case is a job, not a decoration.**

- Button labels are sentence case: normal German prose, capital first letter, nouns keep their
  capitals. No Title Case, no all-lowercase, no ALL CAPS in the source string.
- Field captions and data badges display in ALL CAPS, but only by CSS (`text-transform`); the
  stored string stays in normal German case, so a screen reader announces the plain word.

**Actions name what they do.**

- Every button that runs an action carries a verb in the infinitive — „Speichern", „Entfernen",
  „Rezept löschen" — alone or with its object when the verb alone is ambiguous.
- Verbless labels stay reserved for navigation („Zurück"), the menu trigger („Mehr") and
  controls that pick a value or state, never an action.
- The same action is worded the same everywhere; a confirmation is the same button asking a
  question („Wirklich entfernen?"), never a second naming scheme.

**Numbers and units stay together.**

- A number and its unit are joined by a narrow no-break space (U+202F) so they never wrap
  apart: `300 g`, `1,5 kg`, `1 h 30 min`.
- Fractions use the German decimal comma, never a dot: `1,5 kg`, `0,25 l`.
- These are display-layer rules only; stored recipe files keep their canonical plain forms, and
  the shared formatters (`formatBQ`, `renderAQS`, `formatDecimal`, `formatTimeDisplay`) build
  the display text — never hand-joined strings.

**Sentences, not labels.** A message that reports an outcome is a complete German sentence about
the past („… zum Essensplan hinzugefügt."), never a bare label like „Erfolgreich!". Errors name
the problem and say what to do; they never say only that something failed.

The binding details — the exact tokens, the mandatory/optional marker, the browser-Back and busy
state copy — live in `CODING_CONVENTIONS.md` (Design Conventions). This section names the rules
the components follow; it does not override them.

*Applies to: cooking view.*

The cooking view is German, like the app. The bottom bar's two navigation buttons are the
verbless „Zurück" and „Weiter". Its other strings: the step title „Schritt x von y", „Rezept"
(sub-recipe badge), the size-picker captions „Portionen" / „Menge", the time captions
„Arbeitszeit" / „Gesamtzeit", and the footer „Erstellt mit Cookbook" beside the brand mark.
Numbers and units are joined by the narrow no-break space. Quantities show proper fractions
in the slash form — `1/2`, `2/5`, `1 1/4` — never the web app's vulgar-fraction glyphs: the
slash form keeps full-size digits for arm's-length reading and asks no fraction glyphs of the
theme font. A mixed number joins its integer and fraction with the narrow no-break space.

## 8. Accessibility

*Applies to: web app.*

**Every control is operable and announced, nothing relies on colour or shape alone.** The
accessibility rules are not a checklist bolted on after design: they are the same rules the
component sections already state, gathered here as one contract.

**Names and announcements**

- A control always has an accessible name: a visible label, or an `aria-label` that repeats the
  action verbatim on an icon-only button (§4.5). A symbol beside a visible label is decorative
  (`aria-hidden`) and never doubles as the name.
- State is announced where it changes: a snackbar is a live region remounted per message
  (`role="status"` / `role="alert"`), a field error is bound to its field with
  `aria-describedby` and `aria-invalid`, a busy button sets `aria-busy="true"` (§5.1, §5.9).
- Captions and badges read as their source case — the ALL CAPS are a CSS effect, never the
  string a screen reader meets (§7).

**Focus and keyboard**

- Every interactive thing is reachable and usable by keyboard: buttons are real `<button>`
  elements, and the tab order follows the visual order.
- Focus is never moved or trapped by transient UI: a snackbar does not steal focus; its action
  is reached by Tab, and focus pauses the countdown so it cannot vanish under a keyboard user
  (§5.9).
- A focused text field shows a solid accent outline, so the caret is visible without a pointer
  (§5.3). A pressed look is never the only feedback, and a disabled button is never the only
  explanation — the cause is visible next to it (§5.1).

**Perception**

- Colour never carries meaning alone: success is olive plus a symbol, an error is danger plus
  text (§4.1, §5.9). Warm and flat is the palette, not a substitute for contrast.
- Images are decorative where a visible label carries the name (`alt=""`); an image standing
  alone as content gets a German `alt` (§5.8).
- Every animation is disabled under `prefers-reduced-motion: reduce`, leaving the end state
  visible (§4.6).

*Applies to: cooking view.*

Every control is a real `<button>` or a native checkbox, at least 42px, with an accessible name
(visible label or `aria-label`). The step title („Schritt x von y") is `aria-live="polite"`. The check list is a
labelled group; each checkbox carries its row text as its label. Colour never carries meaning
alone. Swipe is an alternative to the buttons, never the only way: step navigation is mirrored
in browser history so Back and Forward move through the screens and steps, and the Escape key
steps back — a keyboard user is never dependent on the buttons. Motion honours
`prefers-reduced-motion`.

## 9. Screen inventory

*Applies to: web app.*

**Every screen is one of three things: the list, a place above it, or a change over it.** The
recipe list is the root layer; a *place* replaces it (§6.1) and takes „Zurück" top left; a
*change* is a sheet that sits over whatever is beneath it and takes „Abbrechen" next to its
primary action; a browsing layer (menu, overview) opens over the list with no pending decision.
The cooking view (`.html`) has its own inventory, written below.

| Screen | State / component | Kind | Exit |
| --- | --- | --- | --- |
| Sign-in | `login-panel` (no token) | root | — |
| Recipe list | `RecipeList` (root, state `null`) | root | — |
| Create menu | `setNav('menu')`, the FAB's menu | browsing layer | scrim, Escape, choice |
| Recipe overview | `setNav('overview')`, `RecipeOverview` | browsing layer | scrim, Escape, Back |
| Recipe editor | `setNav('editor')`, `RecipeEditor` (base + each sub-recipe level) | place | „Zurück" |
| AI create / edit | `setNav('ai')`, `AiCreateSheet` | place | „Zurück" |
| „Einkaufsliste schreiben" | `setNav('shopping')`, `ShoppingListSelect` | place (flow step) | „Zurück" |
| „Vorräte auswählen" | `setNav('pantry')`, `PantrySelect` | place (flow step) | „Zurück" |
| „Zum Essensplan hinzufügen" / „Menge ändern" | `MealPlanSheet` | change | „Abbrechen" |
| „Eintrag ersetzen" | `ReplaceRecipeSheet` | change | „Abbrechen" |
| Ingredient sheet / new ingredient | `IngredientSheet`, `NewIngredientSheet` | change | „Abbrechen" |
| Snackbar | `Snackbar` (app root) | transient, never a layer | none |

The cooking view has its own inventory: one page, three states — **Intro** (scaling, meta,
photo), **Zutaten** (the check list), **Zubereitung** (the steps + step bar). A sub-recipe is
the same page for another recipe, opened in a new tab.

**Reading the table.** A screen is named as the user meets it; the state/component column is the
single implementation hook. The flow steps `shopping` and `pantry` are two places of one bundled
flow: they stay mounted while a sheet, the editor or the AI screen sits above them, so the
checked dishes survive the detour and closing returns to the same step.

## 10. Implementation map

*Applies to: web app.*

**Every value and rule in this document has one implementing file.** The map is written by
section: a rule lives in the file named for its section, and the section is authoritative over
that file.

| Section | Implements in |
| --- | --- |
| §4.1–4.4 tokens | `apps/web/src/styles/tokens.css` (colour, type, spacing, radius, elevation, layout constants) |
| §4.5 Iconography | `apps/web/src/components/icons.tsx` |
| §4.6 Motion | `apps/web/src/index.css` (global press/focus rules), the component stylesheets |
| §4.7 Layout | `apps/web/src/index.css`, `apps/web/src/styles/recipe-list.css` |
| §5.1 Buttons | `apps/web/src/styles/editor.css` (`.primary-button`, `.danger-button`, `.text-button`, `.sheet-actions`) |
| §5.2 Chips and segmented controls | `apps/web/src/styles/editor.css`, `apps/web/src/components/quantityChips.ts` |
| §5.3 Form fields | `apps/web/src/styles/editor.css` (`.field`, `.field-label`, `.field-error`) |
| §5.4 Cards and list items | `apps/web/src/styles/recipe-list.css`, `apps/web/src/components/RecipeList.tsx` |
| §5.5 Headers and sticky bars | `apps/web/src/styles/recipe-list.css` (`.app-header`, `.app-header-stacked`) |
| §5.6 Sheets | `apps/web/src/styles/editor.css` (`.sheet`, `.sheet-backdrop`, `.sheet-actions`) |
| §5.7 Badges and tags | `apps/web/src/styles/editor.css`, `apps/web/src/styles/recipe-list.css` |
| §5.8 Media | `apps/web/src/components/RecipeThumb.tsx`, `apps/web/src/styles/recipe-list.css`, `apps/web/src/styles/recipe-overview.css` |
| §5.9 Snackbar | `apps/web/src/components/Snackbar.tsx`, `apps/web/src/hooks/useSnackbar.ts`, `apps/web/src/styles/snackbar.css` |
| §5.10 FAB and create menu | `apps/web/src/App.tsx`, `apps/web/src/styles/recipe-list.css` |
| §6 Patterns | `apps/web/src/App.tsx` (navigation, flows), `apps/web/src/hooks/useLeaveGuard.ts`, `apps/web/src/components/LeaveConfirmBar.tsx` |
| §7 Language | the component strings (source of truth); the rules bind every component above |
| §8 Accessibility | the components above (`aria-*`, `role`, `alt` live in the markup) |
| §4.1–4.8 cooking view | `packages/core/src/recipe/exportHtml.ts` (inline `<style>`; theme tokens); theme data → `storage_format.md`, `types.ts`, `parse.ts`, `serialize.ts` |
| §5.11 cooking view screens | `packages/core/src/recipe/exportHtml.ts` (structure + embedded script) |
| §4.5 sub-recipe badge | `packages/core/src/recipe/exportHtml.ts` (inline SVG) |
| meal-plan preselect | `packages/core/src/planLink.ts` + `apps/export-host/Code.gs` (land on the intro at the promised size) |

**Reading the map.** A rule that names a component finds its file in the component's own row; a
value with a token name lives in `tokens.css`. Nothing implements a design value inline: a
component references the token, and the token is the only place the number is written.

## 11. Changing the design

**The document changes first, the code second.** A deviation is never fixed in code and left to
the document: either the screen is a bug, or the rule was never written down. In both cases the
change is made here first, then the code follows (§1).

**A change is a decision, and it is recorded.**

- Any change to a rule here is a decision, not a note: state the new rule and delete the old one;
  no struck-through text, no "now / before" commentary left in place.
- A decision reached in discussion is marked *decided with the user* so a later implementation
  detail cannot quietly reopen it.
- A new value enters only through a token in §4: name the token, put the number in
  `tokens.css`, and let every component reference it — never a literal at the call site.

**Before the change, ask the three questions.**

1. Which section owns this rule? A component's behaviour belongs in §5, a cross-screen pattern
   in §6 — if it sits in neither, it may be a new section.
2. Does it contradict an earlier section? When two principles collide, the earlier one wins
   (§3) — a change that breaks that ordering is a new principle, not a small edit.
3. Does it affect the cooking view? A rule marked for the cooking view is written there too, or
   the section stays *Cooking view: not written yet* until it is.

**When two documents disagree, this one wins** (§1). The other document is corrected to point
here, never the other way round.
