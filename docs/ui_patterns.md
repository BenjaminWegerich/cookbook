# UI Patterns

Reusable UI patterns of the web app, specified in enough detail to build the
next instance the same way. The page's job is to keep a pattern that appears in
several screens from drifting into several slightly different ones.

Patterns documented here:

1. [Snackbar](#1-snackbar) — the transient notice at the bottom of the screen,
   with an optional action ("Rückgängig").

The visual ground rules the patterns sit on are binding and live in
[CODING_CONVENTIONS.md](CODING_CONVENTIONS.md) (Design Conventions): the pixel
ladder, the flat opaque surfaces, the one icon set (Material Symbols Rounded,
weight 400), the one pressed look, the German UI copy. This page only specifies
what is specific to a pattern; it never restates or overrides those rules.

---

## 1. Snackbar

**What it is.** A small, non-modal card that slides in at the bottom of the
screen after an action finished, says what just happened, and — where there is a
real way back — offers one action. It is the app's confirmation layer for work
that has already been done and has closed the screen it was done on.

**The one instance so far.** Adding a dish to the meal plan from the recipe
overview: the meal-plan overlay closes and the list shows

> `<Titel> (<Größe>) zum Essensplan hinzugefügt. Die Einkaufsliste bleibt unverändert.`
> with the action **Rückgängig**.

### 1.1 When to use it — and when not

Use a snackbar for **the outcome of a completed action that needs no further
decision**, especially when the outcome is reversible or its side effects are
worth stating once.

Do **not** use it for:

- **form validation** — the problem belongs next to the field or in the sheet's
  own banner, where the user is still looking (see the validation rules in
  [storage_format.md](storage_format.md) §7);
- **a decision that blocks the flow** — a "really delete?" question is a sheet
  with two buttons, not a passing card;
- **a permanent state** — a state ("Keep off", a planned dish) is a badge, a
  caption or a tab, never a notice that disappears after six seconds;
- **more than one message at a time** — the pattern deliberately queues (see
  §1.5); a burst of rapid actions must not stack cards over the list.

### 1.2 Anatomy

```
┌──────────────────────────────────────────────────────────┐
│  ✓   Kürbissuppe (6 Portionen) zum Essensplan            │
│      hinzugefügt. Die Einkaufsliste bleibt unverändert.  │   Rückgängig
└──────────────────────────────────────────────────────────┘
   ▲                        ▲                                    ▲
   tone symbol        message (wraps freely)                action (optional)
```

| Part | Content | Notes |
| --- | --- | --- |
| Card | one fully opaque paper surface | `--color-surface`, hairline border `--color-line`, `--radius-lg`, `--shadow-md`; no scrim, no translucency, no blur |
| Tone symbol | `CheckCircleIcon` (success) / `ErrorIcon` (error) | from `components/icons.tsx`, never inlined; olive on success, danger on error |
| Message | one complete German sentence | `--text-sm`, ink; may wrap over several lines |
| Action | optional, a labelled button | `.text-button` shape, clay accent, semibold; may lead with a symbol (the meal-plan notice uses `UndoIcon`) |

The card **never** carries a close button and **never** a countdown. Six seconds
and one action are the whole interaction (§1.5).

### 1.3 Tones

| Tone | Symbol / colour | ARIA | Used for |
| --- | --- | --- | --- |
| `success` (default) | `CheckCircleIcon`, olive | `role="status"` (polite) | an action finished as asked |
| `error` | `ErrorIcon`, danger | `role="alert"` (assertive) | an action could not be completed and the user should notice now |

A tone changes the leading symbol and the live-region politeness — never the
surface, the radius or the placement. There is no third tone; a new meaning is a
deliberate addition to this table, not a colour chosen at the call site.

### 1.4 Copy

- **German, complete sentences.** The message is a statement about the past, not
  a label: `… hinzugefügt. Die Einkaufsliste bleibt unverändert.` — not
  `Erfolgreich!`.
- **The first part names the object in the form the user recognises it.** The
  meal-plan notice uses the written entry text (recipe title plus size suffix,
  built by `mealPlanEntryText`), because that is exactly what the meal plan now
  shows.
- **The second sentence states an effect the user might otherwise worry about.**
  "Die Einkaufsliste bleibt unverändert." is deliberate: the write touches only
  the meal plan, and saying so once removes the doubt. Only add such a sentence
  when it answers a real question.
- **The action is a verb phrase**, same wording as every other instance of that
  action in the app (`Rückgängig`), and it repeats in the busy label
  (`Wird rückgängig gemacht …`, the shared ellipsis-means-running rule).
- Number and unit inside the message follow the typography rules
  ([CODING_CONVENTIONS.md](CODING_CONVENTIONS.md)): the entry text already joins
  them with a narrow no-break space, so the message is never re-joined by hand.

### 1.5 Behaviour

- **One at a time, in order.** A notice enqueues; the head of the queue is the
  one on screen. A second message waits its turn instead of overwriting a notice
  that may still be holding an undo.
- **Auto-dismiss after 6 s** (`SNACKBAR_DURATION_MS`). Every notice gets a fresh
  full countdown.
- **Paused on interaction.** A pointer over the card, or keyboard focus inside
  it, stops the countdown; leaving it starts a fresh 6 s. This is what makes the
  action reachable: the card never vanishes while a finger or a Tab is on it.
- **The action runs as a promise.** While it runs, the host is busy: the button
  is disabled, shows its busy label with `aria-busy="true"`, and the countdown is
  suspended. When the promise settles — success or failure — the notice closes.
- **The action owns its failure.** A rejected action is not silently dropped and
  not shown by the snackbar chrome: the action's own `run` reports the problem by
  enqueuing an `error` notice, which then becomes the visible one as the success
  notice closes. This is how "Rückgängig" reports a gateway that went away.
- **No manual dismissal.** There is no close button, no swipe-away and no
  Escape binding. Escape belongs to the sheets ([CODING_CONVENTIONS.md](CODING_CONVENTIONS.md),
  browser Back / exit guard); a passing, non-modal report must not compete for
  it. Six seconds, a pause on interaction and the action are the whole story.
- **No stacking and no reordering.** The queue is FIFO and unbounded; in
  practice a person performs one such action at a time.

### 1.6 Placement and geometry

The card floats above the list, clear of the floating action button, inset from
both screen edges — a bottom card, not a full-bleed bar (decided with the user).

| Property | Value | Why |
| --- | --- | --- |
| Position | `fixed`, `left`/`right: --app-padding` | floats, never touches the edges |
| Bottom | `--space-7 + --fab-size + --space-5 + safe-area-inset-bottom` | clears the FAB by the same gap the extended-FAB menu uses above it; the FAB stays reachable |
| Width | `max-width: 42rem`, centered | the app's content width, shared with the sheets |
| Stacking | `z-index: 50` | above every sheet layer (the meal-plan overlay tops out at 41): the notice reports the action that just closed those layers |
| Padding | `--space-4 --space-5` | |
| Gap | `--space-3` | symbol / message / action |
| Symbol | `--icon-size` (24 px) | the standalone symbol size |
| Message | `--text-sm` | a transient secondary report; the 18 px body size is reserved for content |
| Action | `.text-button` shape | borderless, clay, semibold |
| Motion | 180 ms rise-and-fade | same entrance as the create menu; disabled under `prefers-reduced-motion: reduce` |

Every value comes from `apps/web/src/styles/tokens.css`. The card adds no token
and no new colour: it is built entirely from the existing palette.

### 1.7 Accessibility

- The card is a **live region**: `role="status"` for success, `role="alert"` for
  errors. A new message remounts the region (React `key`), so a screen reader
  announces it even if the previous notice was still on screen.
- **Focus is never moved** to the notice and never trapped: it is non-modal, and
  stealing focus would interrupt typing. The action is reachable with Tab; focus
  pauses the countdown so it does not disappear under a keyboard user.
- The action is a real `<button>` with a visible label; its symbol is
  decorative (`aria-hidden`), as everywhere.
- Known trade-off: 6 s is short for a keyboard-only user who has to Tab to the
  action. The notice is polite and non-blocking, and the action is a
  convenience, not the only way to reach the state again (the meal plan can be
  edited normally). If a future action is the *only* way back, it needs a
  longer/focused form rather than this pattern.

### 1.8 Undo semantics ("Rückgängig")

The meal-plan write replaces every line naming the same recipe, so its undo is a
**full restore**, not just a deletion (decided with the user):

- the line that was just added is removed;
- the exact lines the write replaced are put back, as one block at the top of
  the plan, in their original reading order (or nothing, when the dish had not
  been planned before).

Both texts are captured where the write happens (`App.addToMealPlan`), because
only that callback knows what actually changed; the snackbar itself is generic
and knows nothing about the meal plan.

The gateway supports this with one contract (`POST /keep/mealplan`):

```jsonc
{ "add": ["Kürbissuppe: https://…/view#portionen=4", "Kürbissuppe"],  // string or list; may be []
  "remove": ["Kürbissuppe: https://…/view#portionen=6"] }             // may be []
```

The added line is what the app wants to see in Keep, and it is opaque text to the
gateway: a Cookbook-written entry carries the recipe's export link, with the chosen
size in the link's fragment. That shape is why the meal-plan notice can name a
dish whose line would otherwise read as a URL (see `mealPlanEntryLabel`).

A write that neither adds nor removes is refused; a pure removal (`add: []` with
a non-empty `remove`) is the undo of a first-time plan. The gateway places the
added lines above every remaining item and verifies the result before answering,
so a restored block reappears in order and a write is never reported as
successful unverified.

**Honest limits, to keep in mind when reusing the pattern:**

- The restore brings the texts back at the **top** of the list, not at their old
  sort position — Keep's sort ids stay inside the gateway, and a meal plan reads
  newest-first anyway.
- A **checked** state of a replaced line is not restored; restored lines come
  back unchecked (checked meal-plan lines are not shown as cards).
- The undo is a snapshot of what the app last wrote. Changes made in Keep in the
  meantime are not reconciled; the notice's 6 s window is the realistic scope.
- The undo is available only while the notice is on screen. After that, the
  normal meal-plan actions apply ("Vom Plan entfernen", re-planning).

### 1.9 Implementation map

| Layer | File | Responsibility |
| --- | --- | --- |
| Host (queue, countdown, action state) | `apps/web/src/hooks/useSnackbar.ts` | `show` / `runAction` / `dismiss` / `setPaused`; the 6 s constant |
| Look and ARIA | `apps/web/src/components/Snackbar.tsx` | renders the head of the queue; tones, symbols, action button |
| Styles | `apps/web/src/styles/snackbar.css` | card, placement, tone symbols, entrance |
| Symbols | `apps/web/src/components/icons.tsx` | `CheckCircleIcon`, `UndoIcon` (Material Symbols Rounded from the set's own source) |
| The meal-plan notice | `apps/web/src/App.tsx` | enqueues it after a successful write; wires `Rückgängig` |
| Write + undo client | `apps/web/src/keep/keepClient.ts` (`writeMealPlan`), `apps/web/src/keep/useKeep.ts` (`planMeal`, `undoMealPlan`) | the one write shape both directions use |
| Gateway | `apps/keep-gateway/keep_gateway/app.py`, `keep_client.py` | accepts one or several added lines, verifies the result |

The host is rendered once at the app root (`<Snackbar host={snackbar} />`), so
any screen can report an outcome without owning a layer.

### 1.10 Adding a new notice

1. Call `showSnackbar({ text, tone?, action? })` where the action completes.
   `showSnackbar` is the stable `show` from the root's `useSnackbar()`.
2. Write the copy as a complete sentence (§1.4); include a second sentence only
   if it answers a real question.
3. Add an action only if there is a genuine way back. The action's `run` must
   report its own failure as an `error` notice (§1.5).
4. Pass a symbol for the action from `components/icons.tsx` when the meaning has
   an established one (undo, delete); otherwise leave the label bare.
5. Do not add a second snackbar render site, a second timer or a stacking
   container — extend the host instead.
