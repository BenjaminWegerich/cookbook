/**
 * Recipe overview sheet (home screen → tap a card).
 *
 * Tapping a card opens this bottom sheet over the list. With the Keep
 * integration there are three card types (decided with the user); they share
 * the same sheet, hero and close behaviour and differ only in their details
 * block and their action row:
 *
 * 1. **Known recipe, not on the meal plan** — the unchanged base case: photo,
 *    title, description, times, and one action row with "Jetzt kochen"
 *    (primary, growing), "Einplanen" and "Mehr". "Einplanen" opens the
 *    meal-plan overlay (./MealPlanSheet), which asks for the size to cook.
 * 2. **Known recipe on the meal plan** — the same details, plus the size the
 *    meal-plan entry states as a "Geplant" caption/value item in the existing
 *    meta row (`formatPlannedAmount` in @cookbook/core), and "Einplanen" becomes "Umplanen" with
 *    the calendar-and-pencil glyph. "Umplanen" opens the same overlay in its
 *    replan mode, which pre-selects the plan's size and changes the entry with
 *    "Menge ändern" (./MealPlanSheet). "Vom Plan entfernen" does not sit in the
 *    action row: it is the last entry of this variant's "Mehr" menu (decided
 *    with the user), painted in the danger colour, and it *checks* the Keep line
 *    rather than deleting it. The "Eingeplant" badge appears only when
 *    the card was opened from the "Sammlung" tab (target `source`
 *    `collection`): in "Essensplan" the tab itself already states that the dish
 *    is planned. The badge sits on its own line under the title, not inline
 *    with it: in the cards an inline badge works because the title is clamped
 *    to two lines, while the overview's heading is the full, freely wrapping
 *    name, where an inline badge would land mid-wrap and read as part of the
 *    name (decided with the user).
 * 3. **Unrecognized meal-plan entry** — no recipe behind it: the entry's
 *    complete text is the title, the shared letter avatar is the hero, and the
 *    danger "Kein Cookbook-Rezept" badge marks it. It carries exactly one
 *    constructive action, "Eintrag ersetzen" (accent fill, growing), which
 *    opens a menu with "Bestehendes Rezept auswählen", "Rezept manuell
 *    anlegen" and "Rezept mit KI anlegen"; next to it "Vom Plan entfernen"
 *    (outlined, danger colour) drops the line from the meal plan. The two sit
 *    on a wrapping row, because both labels are full phrases and do not share
 *    one phone line (decided with the user). The trigger carries no caret
 *    (decided with the user): this sheet marks a menu with the three-dot glyph,
 *    and "Eintrag ersetzen" names an outcome that cannot be executed without a
 *    choice, so it reads as opening a chooser the way a "Teilen" button does.
 *    "Jetzt kochen" and the "Mehr" menu do not exist here: there is nothing to
 *    cook or edit yet.
 *
 * The three variants are modelled as one `RecipeOverviewTarget` union: a
 * recognized card carries its recipe plus the meal-plan context, an
 * unrecognized entry carries only its text. App builds the target, because
 * only App holds the recipe list, the Drive token and the resolved meal plan.
 *
 * Further decisions that hold for every variant:
 * - modal bottom sheet over the list (not a full-screen view);
 * - large square 1:1 photo (recipe photos are stored square, nothing is cropped);
 * - times (Arbeitszeit / Gesamtzeit) are shown, but not the recipe's own
 *   servings/yield or type — the "Geplant" value is the *meal plan's* size, so
 *   it appears only when an entry actually states one;
 * - one action row: "Jetzt kochen" (skillet) is the primary action, growing to
 *   fill the row so it is as wide as possible, next to "Einplanen"/"Umplanen"
 *   (calendar with plus / with pencil) and the "Mehr" button (vertical three
 *   dots), which stay only as wide as their labels need. "Jetzt kochen" and the
 *   three "Eintrag ersetzen" entries are placeholders for now: they report that
 *   the feature is not built yet instead of silently doing nothing.
 * - a recognized recipe's plan state is rendered from the *live* plan App
 *   derives (`livePlan`), not only from the snapshot the target was opened with.
 *   Every action here ends the whole flow (the two overlay writes and "Vom Plan
 *   entfernen"), but the plan can still move while the sheet is open — the
 *   previous notice's "Rückgängig", or the meal plan resolving after the sheet
 *   was opened — so its badge, its "Geplant" value and its travel action follow
 *   the plan rather than a stale snapshot. The snapshot stays the fallback for
 *   the moment between a write and the re-resolved plan (and when Keep is off,
 *   where nothing is planned anyway).
 * - the meal-plan overlay is a layer of this sheet, not a screen of its own:
 *   Escape and the browser Back close it first and the sheet only after it
 *   (RecipeOverviewHandle), and a recipe is only offered once its file has been
 *   read, because the overlay needs the written size and the reference
 *   ingredients.
 * - "Einplanen"/"Umplanen" is the meal-plan action: it puts the dish on the
 *   meal plan. Building the shopping list is deliberately not its job — that is
 *   a separate flow over several recipes at once (decided with the user), so
 *   the overview's per-recipe action must not be named "Zur Liste hinzufügen".
 * - "Mehr" (and, for an unrecognized entry, "Eintrag ersetzen") opens its
 *   actions as a small popover above the row: "Manuell bearbeiten" opens the
 *   editor, "Mit KI bearbeiten" opens the AI-edit screen, and a planned recipe
 *   additionally offers "Vom Plan entfernen". The menu is closed by an outside
 *   tap, Escape and any chosen entry.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';

import {
  displayTimeText,
  formatPlannedAmount,
  type PlannedAmount,
  type Recipe,
} from '@cookbook/core';

import { readRecipe, type StoredRecipe } from '../drive/recipeStorage';
import { useEscapeTrigger } from '../hooks/useLeaveGuard';
import {
  CalendarAddIcon,
  CalendarEditIcon,
  CloseIcon,
  ErrorIcon,
  EventAvailableIcon,
  EventBusyIcon,
  MenuBookIcon,
  MoreVertIcon,
  PencilIcon,
  SkilletIcon,
  SparkleIcon,
  SwapHorizIcon,
} from './icons';
import MealPlanSheet from './MealPlanSheet';
import RecipeThumb from './RecipeThumb';
import TitleThumb from './TitleThumb';

/**
 * What the overview sheet shows. A recognized card (from either list tab)
 * carries its recipe and the meal-plan context the sheet renders; an
 * unrecognized meal-plan entry carries only its complete text, because there is
 * no recipe behind it.
 */
export type RecipeOverviewTarget =
  | {
      kind: 'recipe';
      recipe: StoredRecipe;
      /**
       * The tab the card was opened from. The "Eingeplant" badge appears only
       * for `collection` — on the "Essensplan" tab the tab itself says it.
       */
      source: 'collection' | 'mealplan';
      /** The recipe is on the meal plan: the travel action reads "Umplanen". */
      onMealPlan: boolean;
      /** The size the meal-plan entry states, when it states one. */
      planned: PlannedAmount | null;
    }
  | {
      kind: 'unknown';
      /** The unrecognized entry's complete text — the exact Keep line. */
      text: string;
      /**
       * The same entry without its export URL, for the title and the avatar. A
       * Cookbook-written line is `<Titel>: <URL>`; showing it raw would put a
       * long link on the sheet. The removal action keeps using `text`.
       */
      displayText: string;
    };

interface RecipeOverviewProps {
  /** Drive access token, needed to read the recipe and download its photo. */
  token: string;
  /** The card that was tapped (see RecipeOverviewTarget). */
  target: RecipeOverviewTarget;
  /** Closes the sheet (backdrop, close button, browser Back). */
  onClose: () => void;
  /** Opens the recipe in the editor ("Mehr" → "Manuell bearbeiten"). */
  onEdit: (recipe: StoredRecipe) => void;
  /** Opens the AI-edit screen ("Mehr" → "Mit KI bearbeiten"). */
  onAiEdit: (recipe: StoredRecipe) => void;
  /**
   * Performs the meal-plan write for the size chosen in the "Einplanen"
   * overlay (App owns the meal-plan state, so it also knows which entries to
   * replace and builds the entry text). Resolves when the dish is planned;
   * rejects with the reason when it failed. Planning ends the whole flow.
   */
  onAddToMealPlan: (planned: PlannedAmount) => Promise<void>;
  /**
   * Performs the "Umplanen" write for the size chosen in the overlay: replaces
   * the recipe's entries with one at the new size. Resolves when the plan holds
   * the new size — App then closes the whole flow back to the list, exactly like
   * planning — and rejects with the reason when it failed.
   */
  onChangeAmount: (planned: PlannedAmount) => Promise<void>;
  /**
   * Takes the open meal-plan entry off the plan: a recognized recipe's "Mehr" →
   * "Vom Plan entfernen", or the unrecognized entry's own danger button. App
   * owns the Keep write and the undo notice; this callback only closes the menu
   * (where there is one) and hands over, because the entry cannot report a
   * failure itself. On success App closes the whole flow.
   */
  onRemoveFromMealPlan: () => void;
  /**
   * The recipe's *current* plan state, derived by App from the live meal plan,
   * or null while none is resolved (Keep off or loading, or the recipe is the
   * unrecognized variant). The sheet prefers it over the target's own snapshot:
   * the plan can move while the sheet is open — a previous notice's
   * "Rückgängig", or the meal plan resolving after the sheet was opened — so its
   * badge, its "Geplant" value and its travel action must follow the plan while
   * it is visible. The snapshot stays the fallback for the moment between a
   * write and the re-resolved plan (see App).
   */
  livePlan: { onMealPlan: boolean; planned: PlannedAmount | null } | null;
  /** Browser-back consumer handle (React 19: ref is a regular prop). */
  ref?: Ref<RecipeOverviewHandle>;
}

/**
 * Browser-back consumer of the overview sheet (App's popstate handler). The
 * meal-plan overlay is a layer *inside* the sheet, so it has to consume the
 * Back before the sheet itself closes — the same contract the editor and the
 * AI sheet use.
 */
export interface RecipeOverviewHandle {
  /** Closes the meal-plan overlay if it is open; true when it consumed the Back. */
  notifyBack: () => boolean;
}

/** The one menu that can be open at a time (each variant owns one trigger). */
type OverviewMenu = 'more' | 'replace';

/**
 * The overview sheet (see file header). For a recognized recipe the list entry
 * already carries title and photo, so the hero renders immediately; times and
 * description are read from the recipe file and fill in when the load finishes.
 * An unrecognized entry has no file to read and renders completely at once.
 */
function RecipeOverview({
  token,
  target,
  onClose,
  onEdit,
  onAiEdit,
  onAddToMealPlan,
  onChangeAmount,
  onRemoveFromMealPlan,
  livePlan,
  ref,
}: RecipeOverviewProps) {
  /** The full recipe; null while it is being read from Drive (recipe target). */
  const [details, setDetails] = useState<Recipe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Feedback line for the placeholder actions (null = nothing tapped yet). */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The meal-plan overlay ("Einplanen" of a known recipe that is not planned).
   * It is a layer of this sheet, not a screen of its own: it renders above the
   * sheet and closes back onto it (see RecipeOverviewHandle, MealPlanSheet).
   */
  const [planOpen, setPlanOpen] = useState(false);
  /**
   * The open popover: "Mehr" for a recognized recipe or "Eintrag ersetzen" for
   * an unrecognized entry. Both variants exist exclusively, so one state and
   * one wrapper ref serve both. Closed by an outside tap, Escape, choosing an
   * entry or closing the whole sheet.
   */
  const [openMenu, setOpenMenu] = useState<OverviewMenu | null>(null);
  /** The open trigger's wrapper: what the outside-tap check must not close. */
  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  /** The recognized recipe, or null for an unrecognized entry. */
  const recipe = target.kind === 'recipe' ? target.recipe : null;
  /** File to read for the details; null for an unrecognized entry (no read). */
  const fileId = recipe?.fileId ?? null;
  /**
   * The plan state the sheet renders: the live derivation when App has one, the
   * snapshot the target was opened with otherwise (see the prop's doc). Both
   * fields belong together, so one expression decides them.
   */
  const onMealPlan =
    target.kind === 'recipe'
      ? livePlan !== null
        ? livePlan.onMealPlan
        : target.onMealPlan
      : false;
  const planned: PlannedAmount | null =
    target.kind === 'recipe' ? (livePlan !== null ? livePlan.planned : target.planned) : null;

  // Read the recipe file for the details the list entry does not carry. The
  // sheet unmounts when it closes, so every open starts from the initial null
  // state; state is only set in the promise callbacks, never synchronously
  // (same rule as App's startup load). An unrecognized entry has no file, so
  // the effect does nothing for it.
  useEffect(() => {
    if (fileId === null) return;
    let cancelled = false;
    void readRecipe(token, fileId)
      .then((loaded) => {
        if (!cancelled) setDetails(loaded);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token, fileId]);

  // Escape closes the topmost layer of the sheet through the shared exit
  // trigger (useLeaveGuard), the same one the editor, the AI screen and the
  // create menu use: the meal-plan overlay first, the sheet itself after that.
  // A backdrop tap and the browser Back button (App's history integration)
  // close the same layers in the same order. No confirmation: the overview is
  // read-only and the overlay holds nothing but a size choice.
  useEscapeTrigger(() => {
    if (planOpen) {
      setPlanOpen(false);
      return;
    }
    onClose();
  });

  // Browser-back consumer (see RecipeOverviewHandle and App's popstate
  // handler): the meal-plan overlay is the one layer inside this sheet, so it
  // must be able to consume the Back before the sheet closes. The handle is
  // refreshed on every render, so it always sees the current layer state.
  useImperativeHandle(ref, () => ({
    notifyBack: (): boolean => {
      if (!planOpen) return false;
      setPlanOpen(false);
      return true;
    },
  }));

  // Escape closes the overflow menu before it reaches the sheet: the shared
  // escape trigger closes whatever layer it is wired to, so the popover installs
  // its own listener (capture) that consumes the key while it is open. The
  // cleanup order guarantees the menu listener is removed before the sheet's.
  useEffect(() => {
    if (openMenu === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpenMenu(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [openMenu]);

  // A tap anywhere outside the open menu (and outside its trigger) closes it.
  // This runs after the click finished its own handling, so the tapped element —
  // the sheet's close button, the backdrop, another action — still does its job
  // once and only the menu additionally closes (decided with the user:
  // progressive dismissal, the tap is never swallowed).
  useEffect(() => {
    if (openMenu === null) return;
    const onDocumentClick = (event: MouseEvent): void => {
      const targetNode = event.target;
      if (targetNode instanceof Node && menuWrapRef.current?.contains(targetNode) === true) return;
      setOpenMenu(null);
    };
    document.addEventListener('click', onDocumentClick);
    return () => {
      document.removeEventListener('click', onDocumentClick);
    };
  }, [openMenu]);

  /** Reports a not-yet-built action instead of letting the tap do nothing. */
  const notBuiltYet = (label: string): void => {
    setNotice(`„${label}“ folgt in einer späteren Version.`);
  };

  /** A chosen menu entry: closes the menu and reports the placeholder action. */
  const chooseMenuEntry = (label: string): void => {
    setOpenMenu(null);
    notBuiltYet(label);
  };

  /** "Manuell bearbeiten": closes the menu and hands over to the editor. */
  const openManualEdit = (): void => {
    setOpenMenu(null);
    if (recipe !== null) onEdit(recipe);
  };

  /** "Mit KI bearbeiten": closes the menu and opens the AI-edit screen. */
  const openAiEdit = (): void => {
    setOpenMenu(null);
    if (recipe !== null) onAiEdit(recipe);
  };

  /**
   * "Vom Plan entfernen": closes the menu (when the button sits in one) and
   * hands the write to App, which owns the Keep action and the undo notice. App
   * closes the whole flow on success, so the user lands back on the list — the
   * card there has lost its "Eingeplant" badge, or is gone from "Essensplan".
   */
  const removeFromPlan = (): void => {
    setOpenMenu(null);
    onRemoveFromMealPlan();
  };

  const title =
    target.kind === 'unknown' ? target.displayText : (details?.title ?? target.recipe.title);
  const description = details?.description;
  // Times use the core display helper, so number and unit are joined with the
  // narrow no-break space like everywhere else (docs/CODING_CONVENTIONS.md).
  const prepTime =
    details !== null && details.prep_time !== '' ? displayTimeText(details.prep_time) : null;
  const totalTime =
    details?.total_time !== undefined && details.total_time !== ''
      ? displayTimeText(details.total_time)
      : null;
  /** The meal-plan size as display text (recipe target only), or null. */
  const plannedText = planned !== null ? formatPlannedAmount(planned) : null;
  /**
   * The "Eingeplant" badge is shown only when a planned recipe was opened from
   * "Sammlung": on the "Essensplan" tab the tab already carries that statement.
   * Like the size above it follows the live plan, so taking the dish off the
   * plan removes the badge while this sheet is still open.
   */
  const showPlannedBadge = target.kind === 'recipe' && target.source === 'collection' && onMealPlan;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} role="presentation" />
      <div
        className="sheet overview-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-title"
      >
        <button
          type="button"
          className="overview-close"
          aria-label="Schließen"
          onClick={onClose}
          autoFocus
        >
          <CloseIcon />
        </button>

        {/* List entry data: renders before the file read finishes. The wrapper
            carries the hero size; the square thumb fills it (see the row-sizing
            note in recipe-overview.css). An unrecognized entry has no photo, so
            it gets the same letter avatar the list card shows. */}
        <div className="overview-hero">
          {target.kind === 'unknown' ? (
            <TitleThumb title={target.displayText} />
          ) : (
            <RecipeThumb recipe={target.recipe} token={token} />
          )}
        </div>

        <div className="overview-body">
          <h2 className="overview-title" id="overview-title">
            {title}
          </h2>

          {/* Plan status on its own line under the title (see the file header):
              the positive "Eingeplant" badge for a planned collection recipe, the
              danger "Kein Cookbook-Rezept" badge for an unrecognized entry. */}
          {target.kind === 'unknown' ? (
            <div className="overview-badges">
              <span className="recipe-badge recipe-badge-unknown">
                <ErrorIcon className="recipe-badge-icon" />
                <span>Kein Cookbook-Rezept</span>
              </span>
            </div>
          ) : (
            showPlannedBadge && (
              <div className="overview-badges">
                <span className="recipe-badge recipe-badge-planned">
                  <EventAvailableIcon className="recipe-badge-icon" />
                  <span>Eingeplant</span>
                </span>
              </div>
            )
          )}

          {target.kind === 'recipe' && description !== undefined && description !== '' && (
            <p className="overview-description">{description}</p>
          )}

          {/* Caption/value row under the description. "Geplant" leads (decided
              with the user): when a dish is on the plan, the size to cook is
              what this opening is about, and the plan fact should be read
              before the recipe's own timing. Arbeitszeit and Gesamtzeit follow
              as the recipe's lookup values after the description introduced the
              dish. The shared row gives the plan size the app's established
              caption/value look with no new visual language. */}
          {target.kind === 'recipe' &&
            (prepTime !== null || totalTime !== null || plannedText !== null) && (
              <dl className="overview-meta">
                {plannedText !== null && (
                  <div className="overview-meta-item">
                    <dt>Geplant</dt>
                    <dd>{plannedText}</dd>
                  </div>
                )}
                {prepTime !== null && (
                  <div className="overview-meta-item">
                    <dt>Arbeitszeit</dt>
                    <dd>{prepTime}</dd>
                  </div>
                )}
                {totalTime !== null && (
                  <div className="overview-meta-item">
                    <dt>Gesamtzeit</dt>
                    <dd>{totalTime}</dd>
                  </div>
                )}
              </dl>
            )}

          {target.kind === 'recipe' && details === null && loadError === null && (
            <p className="overview-loading" role="status">
              Details werden geladen …
            </p>
          )}
          {target.kind === 'recipe' && loadError !== null && (
            <p className="overview-error" role="alert">
              {loadError}
            </p>
          )}
        </div>

        {/* The action row. A recognized recipe keeps its known shape: "Jetzt
            kochen" grows, "Einplanen"/"Umplanen" and "Mehr" stay at content
            width. An unrecognized entry has no cook or edit action: its row
            carries "Eintrag ersetzen" (accent, growing, opens its menu) and
            "Vom Plan entfernen" (outlined, danger) and may wrap, because both
            labels are long phrases (see the file header). */}
        <div
          className={
            target.kind === 'unknown' ? 'overview-actions is-wrapping' : 'overview-actions'
          }
        >
          {target.kind === 'unknown' ? (
            <>
              <div className="overview-more is-primary" ref={menuWrapRef}>
                <button
                  type="button"
                  className={
                    openMenu === 'replace'
                      ? 'overview-action is-primary is-open'
                      : 'overview-action is-primary'
                  }
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'replace'}
                  onClick={() => setOpenMenu((open) => (open === 'replace' ? null : 'replace'))}
                >
                  <SwapHorizIcon />
                  <span>Eintrag ersetzen</span>
                </button>

                {openMenu === 'replace' && (
                  <div className="overview-menu" role="menu" aria-label="Eintrag ersetzen">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => chooseMenuEntry('Bestehendes Rezept auswählen')}
                    >
                      <MenuBookIcon />
                      <span>Bestehendes Rezept auswählen</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => chooseMenuEntry('Rezept manuell anlegen')}
                    >
                      <PencilIcon />
                      <span>Rezept manuell anlegen</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => chooseMenuEntry('Rezept mit KI anlegen')}
                    >
                      <SparkleIcon />
                      <span>Rezept mit KI anlegen</span>
                    </button>
                  </div>
                )}
              </div>
              {/* An unrecognized entry has no "Mehr" menu, so its removal keeps
                  its own danger button. It runs the same App write as a planned
                  recipe's menu entry: the entry's complete Keep line is ticked
                  off (not deleted) and the flow closes back to the list. */}
              <button type="button" className="overview-action is-danger" onClick={removeFromPlan}>
                <EventBusyIcon />
                <span>Vom Plan entfernen</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="overview-action is-primary"
                onClick={() => notBuiltYet('Jetzt kochen')}
              >
                <SkilletIcon />
                <span>Jetzt kochen</span>
              </button>
              {onMealPlan ? (
                // "Umplanen" opens the same overlay in its replan mode: the size
                // the plan states is pre-selected and "Menge ändern" replaces the
                // entry. It needs the parsed recipe just like "Einplanen" (the
                // written size for the reference readout, the pre-selected size
                // from the plan), so it stays unavailable until the file read
                // finishes — the loading or error line above it is the cause.
                // Taking the dish off the plan is not here but behind "Mehr".
                <button
                  type="button"
                  className="overview-action"
                  onClick={() => setPlanOpen(true)}
                  disabled={details === null}
                >
                  <CalendarEditIcon />
                  <span>Umplanen</span>
                </button>
              ) : (
                // "Einplanen" opens the meal-plan overlay, which needs the
                // parsed recipe (its written size and its reference
                // ingredients). Until the file read finishes the button stays
                // unavailable: the loading or error line just above it is the
                // visible cause (docs/CODING_CONVENTIONS.md, unavailable
                // buttons).
                <button
                  type="button"
                  className="overview-action"
                  onClick={() => setPlanOpen(true)}
                  disabled={details === null}
                >
                  <CalendarAddIcon />
                  <span>Einplanen</span>
                </button>
              )}
              <div className="overview-more" ref={menuWrapRef}>
                <button
                  type="button"
                  className={openMenu === 'more' ? 'overview-action is-open' : 'overview-action'}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'more'}
                  onClick={() => setOpenMenu((open) => (open === 'more' ? null : 'more'))}
                >
                  <MoreVertIcon />
                  <span>Mehr</span>
                </button>

                {openMenu === 'more' && (
                  <div className="overview-menu" role="menu" aria-label="Weitere Aktionen">
                    <button type="button" role="menuitem" onClick={openManualEdit}>
                      <PencilIcon />
                      <span>Manuell bearbeiten</span>
                    </button>
                    <button type="button" role="menuitem" onClick={openAiEdit}>
                      <SparkleIcon />
                      <span>Mit KI bearbeiten</span>
                    </button>
                    {/* "Vom Plan entfernen" is a planned recipe's destructive
                        action, so it sits last and in the danger colour. It only
                        exists while the dish is on the plan: the menu is built
                        from the live plan state, so the entry disappears the
                        moment the dish is taken off. The action *checks* the Keep
                        line (App owns that write and the undo notice) — it does
                        not delete it. */}
                    {onMealPlan && (
                      <button
                        type="button"
                        role="menuitem"
                        className="danger-text"
                        onClick={removeFromPlan}
                      >
                        <EventBusyIcon />
                        <span>Vom Plan entfernen</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {notice !== null && (
          <p className="overview-notice" role="status">
            {notice}
          </p>
        )}
      </div>

      {/* The meal-plan overlay: a layer above this sheet, opened by "Einplanen"
          (known recipe, not planned) or "Umplanen" (planned). It closes back
          onto the sheet. The mode follows the live plan: a planned dish gets
          the replan form, which pre-selects the plan's size. The overlay hands
          the chosen size to App, which builds the Keep line there (the export
          link, shortened when possible).

          Both modes end the flow in App on success (App closes the overview
          there, like "Zum Essensplan hinzufügen" always did), so only
          "Abbrechen" leads back to the overview. A failure rejects, the overlay
          catches it and stays open with the reason next to its button. */}
      {planOpen && details !== null && target.kind === 'recipe' && (
        <MealPlanSheet
          mode={onMealPlan ? 'replan' : 'plan'}
          recipe={details}
          previous={planned}
          onClose={() => setPlanOpen(false)}
          onConfirm={onMealPlan ? onChangeAmount : onAddToMealPlan}
        />
      )}
    </>
  );
}

export default RecipeOverview;
