# Coding Conventions for Cookbook

## Language

- **Write code in English.** This includes, but is not limited to variables, classes, files, comments.
- **Write documentation in English.** This includes comments, the `README.md`, as well as all files in docs/.
- **Write the UI in German.** An English version of the UI is not necessary, neither are other languages.
- **Actual recipe data will be in German.** This includes the recipes as well as ingredient units and other user-entered data.
- **Write Git commits in English.**

## Coding Conventions

- **Programming Languages:** TypeScript for the web app and the core logic module. The
  Google Keep backend is Python (isolated, see [ARCHITECTURE.md](ARCHITECTURE.md)).
  Recipe content is German data.
- **Naming Conventions and Casing:** camelCase for variables and functions, PascalCase for
  React components and types, kebab-case for file names, UPPER_SNAKE_CASE for constants.
  Python is the one exception: an importable package needs snake_case modules
  (`apps/keep-gateway/keep_gateway/keep_client.py`), while standalone Python scripts loaded
  by path keep kebab-case names (`keep-spike.py`).
- **Quantity-domain abbreviations:** identifiers for the quantity-domain terms use the
  abbreviations defined in [additional_quantity_specifications.md](additional_quantity_specifications.md)
  §2 — `aq` (additional quantity), `au` (additional unit), `bq` (base quantity), `bu` (base
  unit) — consistently in function names, parameters, and properties (e.g. `roundToAQ`,
  `selectAQ`, `renderAQS`). Entity/type names and master-data collections keep descriptive
  forms (`AdditionalUnit`, `INGREDIENT_MAPPINGS`). The full terms are used in prose and docs.
- **Indentation and Brace Placement:** 2 spaces, no tabs; braces on the same line (1TBS),
  matching Prettier defaults.
- **Git Activities**: *Document branch conventions here when decided.* Use conventional commits.

## Design Conventions

- **Smartphone + laptop/desktop:** the web app targets smartphones (portrait, thumb-reachable)
  and laptops/desktops with the same responsive layout — no separate desktop design. There
  is no smart display layout for the app; the cooking experience lives in the exported
  `.html` file, not the web app.
- **Pixel ladder:** every pixel value (spacing, radius, font size, icon/thumbnail size,
  shadow offset) must come from the preferred-number ladder
  `1 / 2 / 3 / 4 / 6 / 8 / 10 / 14 / 18 / 24 / 32 / 42 / 56 / 74 / 100`. No other pixel
  value may be introduced without revisiting this scale. The only structural exception is
  `100%` radii (circles, e.g. the floating action button).
- **Single source of truth:** design tokens live in `apps/web/src/styles/tokens.css` as CSS
  custom properties; components reference the tokens, never raw values.
- **One symbol library for every icon: Material Symbols (Rounded), weight 400.** Every symbol
  and icon comes from Material Symbols — the new Material Design Symbols set
  (`symbols/.../materialsymbolsrounded/` in `google/material-design-icons`), never the older
  Material Icons set, never a hand-drawn or third-party glyph. All share one style (Rounded),
  one 24 dp / 960-unit grid and the same **weight 400** (grade 0, optical size 24); a state
  difference is shown by colour or by the same symbol's fill, never by a different weight or
  style. Single source: `apps/web/src/components/icons.tsx` (import from there, never inline
  an `<svg>`). Font characters (`+`, `−`, `×`) are never used in place of a symbol: wherever a
  symbol acts as an icon, it comes from that file.
- **The app icon (favicon) is the one weight exception.** `apps/web/public/favicon.svg` draws
  the Material Symbols Rounded "skillet" — the same glyph as `SkilletIcon` in
  `apps/web/src/components/icons.tsx` (the "Jetzt kochen" button) — on the paper tile
  (`#faf5ec`) in the clay accent (`#b85c38`). It is the one deliberate deviation from the
  weight rule above: at favicon sizes the weight-400 steam curls collapse into a single blob,
  so the icon uses Google's own weight-500 drawing of the same symbol
  (`skillet_wght500_24px.svg`, same repository, same settings). The path data stays verbatim
  and the deviation is recorded in the file's header comment. In-app UI icons keep weight 400.
- **Surfaces are flat, filled and opaque.** Every surface — page, card, sticky bar,
  sheet — is one fully opaque colour from the token palette, painted over its whole
  footprint, edge to edge. Nothing shows through a surface: no translucent or gradient
  surface fills and no blur. A bar that sticks over scrolling content (the recipe search,
  the editor header) therefore covers the screen gutters too (negative inline margin plus
  the app padding as its own) and masks the gap it leaves above itself, so a card
  scrolling up can never peek around the bar's left or right edge. Translucency stays
  reserved for the layers that are *meant* to lie over content: the shared press wash
  (`--color-press-overlay`), the modal scrims (`.fab-backdrop`, `.sheet-backdrop`) and the
  warm shadows.
- **Warm palette:** warm, appetizing colors ("kitchen / durable surfaces"); no cold or blue
  hues. Primary text is espresso ink, accents are clay/terracotta and olive.
- **Typography:** readability first; body text is `18px` (the ladder has no `16px`). One
  self-hosted typeface, Source Sans 3 (variable), bundled at build time via `@fontsource` —
  no runtime font fetch and no server.
- **Number and unit are inseparable:** user-visible text joins a number and its unit with a
  narrow no-break space (U+202F), so they never wrap apart: `300 g`, `1,5 kg`, `500 ml`.
  Durations use it between every token, so `1 h 30 min` renders as one unbreakable unit
  (including between `h` and `30`). Stored recipe files always keep plain ASCII spaces — the
  narrow no-break space is a display-layer rule only. Reuse the core helpers (`formatBQ`,
  `renderAQS`, `formatTimeDisplay`, `displayTimeText`, `NNBSP`) instead of joining numbers
  and units by hand.
- **German decimal comma on the display layer:** fractional numbers in user-visible text use
  the comma as decimal separator (`1,5 kg`, `0,25 l`), never a dot. Applies to every frontend
  surface (web app UI and the exported cooking view). Stored recipe files keep their canonical
  plain forms (whole g/ml family values; the parsers accept both `,` and `.` on read). Always
  format display numbers through the core helpers (`formatDecimal`, or formatters built on it —
  `formatBQ`, `renderAQS`) — never build numbers into strings by hand.
- **Mandatory vs. optional fields:** mandatory fields keep a plain label; optional fields
  append a single muted, italic marker `(optional)` (class `optional-mark`) to their label.
  No asterisks, no `Pflichtfeld` wording — required is the implicit default, only the
  exception is named.
- **Inline badges lead with a symbol:** every inline badge — the small marker that
  sits directly after a value to label its state, i.e. the ingredient tags (`Neu`,
  `Rezept`, `Referenz`) — carries a symbol in front of its text, so a badge is
  readable at a glance and never plain coloured text. The symbol comes from the
  shared icon set (`components/icons.tsx`) and follows the badge's meaning, not its
  colour: `Neu` = "new releases" (the name is not in the master data yet), `Rezept`
  = "link" (opens the ingredient's own recipe), `Referenz` = filled "star" (mirrors
  the star toggle). A badge's own controls follow the same rule as any other icon
  (an icon-only control like the reference tag's × never replaces the badge's
  leading symbol). Badges keep one shared style and the text stays a short noun in
  source case — the all caps are a CSS effect, as with `.field-label`.
- **Field captions are all caps:** form labels above inputs/controls (`.field-label`) are
  displayed in all caps via `text-transform: uppercase` in the CSS. Keep the markup and
  stored strings in normal German case (`"Titel"`, not `"TITEL"`) — the caps are purely
  visual, so source text stays readable and screen readers announce the normal form. The
  muted `(optional)` marker stays lowercase.
- **Button labels are sentence case:** a button's visible text is normal German prose
  starting with a capital letter; nouns keep their capitals, nothing else is forced. No
  all-lowercase, no Title Case, no all-caps in the source string — ALL CAPS stays a
  CSS-only effect for data badges and `.field-label`. A leading icon is not a letter and
  never replaces the capital (the add icon in front of `Zutat zur Liste hinzufügen`, the
  close icon in front of `Entfernen`);
  icon-only buttons carry no visible text, only an `aria-label`. A caption above a button
  group is a noun (`.field-label`), never a sentence fragment — so no option ever reads
  as a lowercase sentence continuation.
- **Action buttons name the action (German infinitive):** every button that triggers or
  submits an action contains a verb in the infinitive — alone (`Speichern`, `Entfernen`) or
  with the object it acts on when the verb alone is ambiguous (`Zutat hinzufügen`, `Zur
  Liste hinzufügen`, `Rezept löschen`). Word order is free (the verb may lead or trail), but
  a label is never only its object or destination. Verbless labels stay reserved for the
  three non-action cases: recognised navigation (`Zurück`), the overflow/menu trigger
  (`Mehr`), and controls that pick a value or state instead of running an action (segmented
  options like `Gericht`, quantity and time chips, unit toggles). The same action gets the
  same wording in every context (list, overview, editor, sheet), and an icon-only button
  repeats its verb phrase verbatim in `aria-label` (`Zutat zur Liste hinzufügen`), never a
  bare noun. Confirmation labels stay questions that contain the verb (`Wirklich
  entfernen?`) — a state of the same button, not a second naming scheme. Rationale:
  [NN/g — UI Copy: UX Guidelines for Command Names](https://www.nngroup.com/articles/ui-copy/).
- **Browser Back steps one screen:** every layer above the recipe list (editor, AI-create,
  create menu) and every modal sheet is reflected in the browser history, and the Back button
  closes exactly the topmost layer (NewIngredient sheet → Ingredient sheet → sub-recipe level
  → editor → list). New full-screen views/sheets must go through App's navigation helper
  (`setNav` + the editor's `notifyBack`) instead of toggling React booleans directly.
  The recipe list always keeps one guard entry of its own above the page-load entry, so a
  screen is never the shallowest history entry: a swipe-back then always lands on an entry the
  app owns, and a pop the app consumes re-establishes the entry it consumed. Without that
  guard the browser takes over the gesture, navigates the tab away and the reload lands on the
  login screen (the Drive session is memory-only).
- **Sub-recipe levels stay mounted:** the „REZEPT" badge opens a sub-recipe as another editor
  level above the current one; App keeps every open level mounted and hides the ones below
  (`hidden` on a plain wrapper, plus `visible` to gate Escape). A jump therefore never discards
  unsaved work — Back / „Zurück" reveals the parent level again with its draft intact, and the
  discard confirmation belongs to the level being left, not to the jump.
- **Scroll position belongs to the page, not to the window:** opening a page starts at the
  top, and returning to a page reveals it exactly where it was left. The app swaps pages in
  place in one document, so the browser's single window offset would otherwise carry over;
  App therefore tracks it per page (`useScrollMemory`, keys `list` / `ai` /
  `editor:<level>`) and restores it in a layout effect before paint. The navigation handlers
  capture the leaving page's offset before they change the visible page, and the browser's
  own history scroll restoration stays off (`scrollRestoration = 'manual'`). A page instance
  that no longer exists (a popped sub-recipe level) is forgotten, so opening the same recipe
  again starts at the top. Sheets that overlay the list (recipe overview, create menu) keep
  the list's key — they never move the list scroll behind them.
- **The exit guard is shared by every exit trigger (`useLeaveGuard`):** a screen with unsaved
  work asks its "Änderungen verwerfen?" confirmation through this one hook — never with its own
  dirty check — so all five triggers behave identically: the header's „Zurück" button, a
  backdrop tap, Escape, the browser / device Back button, and the swipe-back gesture (which
  arrives as a browser Back). Two rules keep the confirmation honest, and both live in the hook
  rather than at the call sites:
  - An armed confirmation belongs to the exact work state it was armed for (the
    `workSignature`); any later change invalidates it during render, so the label never claims
    changes will be discarded after they are gone.
  - Closing a modal is "keep working": the screen clears the arm (`reset()`) when it opens or
    closes a transient layer, so a standing confirmation can never be spent by an unrelated
    trigger. Modal form fields are themselves transient — dismissing a modal discards them
    without asking; the screen's committed draft is the unit that gets a confirmation.
  Escape is the keyboard equivalent of the browser Back button: a screen-level Escape trigger
  is registered only while the screen is the visible one (a hidden-but-mounted sheet, e.g. the
  AI screen under the editor, passes `enabled: false`).
- **One pressed look for every button: the whole click area gets the same translucent ink wash.**
  A press is not a second colour per variant but one shared overlay, defined once in `index.css`
  and driven by a single token: `--color-press-overlay`
  (`color-mix(in srgb, var(--color-ink) 12%, transparent)`), painted as a background *layer*
  (`background-image: linear-gradient(...)`) so it stacks on top of whatever fill the button
  already has — accent, outline, surface or none. A filled clay button, an outlined button and a
  borderless text button therefore darken by the same perceptual amount and keep their own colour
  identity while pressed. The wash covers the full border-box (padding included), so the light-up
  traces the click area and not just the label.
  - **No per-component pressed states.** Component stylesheets define no `:active` rules at all; a
    component that seems to need one is a sign that its base look is wrong, not that the press
    needs a special colour. Variant press tokens (`--color-accent-press`, `--color-danger-press`)
    are gone for the same reason.
  - **Always darker toward the ink** — never lighter, never a hue swap, never a whole-button
    transparency change, never a fill or border swap, and no geometry change (no scale, translate
    or shadow) while pressed. Feedback appears immediately with the finger, not after a
    transition; a fade-out on release is allowed but stays ≤ 120 ms.
  - **Disabled buttons never show it** (`:active:not(:disabled)`), matching the shared unavailable
    look below.
  - **One explicit exception, kept in the shared rule:** `.fab-backdrop` is excluded via
    `:not(.fab-backdrop)` — a full-screen scrim must not visibly react to the tap that dismisses
    the create menu. Buttons whose fill encodes a persistent state (`.chip-active`,
    `.tag-reference`, `.overview-action.is-open`) keep that fill and take the same overlay on top.
- **A button that cannot be pressed right now says so — but only when the reason is already
  visible on screen.** Otherwise it stays fully enabled and explains itself when pressed.
  - **One shared unavailable look, no per-component variants:** every genuinely `disabled`
    button renders with `opacity: var(--opacity-disabled)` and `cursor: default`, and shows no
    press feedback (the shared `:active` rule is scoped with `:not(:disabled)`). The rule lives
    once in `index.css`; component stylesheets never define their own `:disabled` styling.
  - **Disabling is only allowed when the cause is visible next to the button:** a control at its
    boundary (the first step cannot move up, the quantity sits at the end of its ladder) or an
    input in the same card that is still empty (the API-key field). The label stays unchanged —
    the muted look alone carries the message.
  - **A cause that is not local never disables.** When the reason lies elsewhere on the screen
    (a form with missing fields), the button keeps its full-strength look: pressing it runs the
    check, shows the validation banner and focuses/scrolls to the first problem. Disabled buttons
    cannot take focus and are skipped by screen readers, so a muted button that cannot explain
    itself is a dead end.
  - **Busy is a second label, not a second look.** While a save / send / delete is running, the
    button keeps the one unavailable look, swaps in an ellipsis label (`Speichert …`,
    `Senden …`) and sets `aria-busy="true"`. The ellipsis means "running", never "not allowed".
