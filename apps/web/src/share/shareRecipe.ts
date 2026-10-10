/**
 * Sharing one recipe: the system's own share sheet, and the clipboard as its
 * own, explicit action (decided with the user).
 *
 * The two are deliberately separate entry points and separate menu entries in
 * the recipe overview's "Mehr" menu — "Link kopieren" first, "Teilen" only where
 * the browser really has a share sheet (`hasShareSheet`) — because a "Teilen"
 * that silently copied would contradict its own label. Both send the same text,
 * built by one function.
 *
 * What is sent is the recipe's name and the link to its HTML export, separated
 * by ": " — `Kürbissuppe: https://<host>?f=<fileId>`. That is the shape a
 * meal-plan line uses (`<Titel>: <URL>`, packages/core/src/mealPlan.ts), only
 * without a size: sharing asks for the recipe itself, so the link carries
 * neither `portionen` nor `menge` and the cooking view opens at the size the
 * recipe is written in. The link points at the export file, which every save
 * rewrites in place (same Drive file id, ../drive/recipeStorage.ts), so one
 * shared link stays valid and always shows the current version of the recipe.
 */

/**
 * True when this browser offers the system's share sheet. The overview's menu
 * shows its "Teilen" entry only then: the entry names that sheet, and where
 * there is none the explicit "Link kopieren" entry is the whole answer.
 *
 * Read at render time rather than cached in a module constant: the capability
 * belongs to the document's environment, and a component must not depend on
 * when this module happened to be evaluated.
 */
export function hasShareSheet(): boolean {
  return typeof navigator.share === 'function';
}

/**
 * The text that is shared or copied: the recipe's name, a colon, the link.
 *
 * One builder for both actions, so a shared message and a copied link can never
 * read differently — and deliberately the app's own "<Titel>: <URL>" form for "a
 * recipe and its link" (core's `mealPlanEntryText` without a size, so a copied
 * text looks exactly like a meal-plan line).
 */
export function recipeShareText(title: string, url: string): string {
  return `${title}: ${url}`;
}

/**
 * Hands one recipe to the system's share sheet and resolves when the sheet is
 * done with it. Rejects with a German sentence when the sheet refused; the
 * caller reports that, and its "Link kopieren" entry is the way out.
 *
 * A dismissed sheet (the user changed their mind) is *not* a rejection: it is a
 * decision, so it resolves silently and nothing is copied behind the user's
 * back.
 *
 * The sheet is used from the caller's own gesture: `navigator.share` needs the
 * tap's transient activation, and an `await` before the call would spend that
 * activation, after which the browser refuses the share.
 */
export async function shareRecipe(title: string, url: string): Promise<void> {
  try {
    await navigator.share({ text: recipeShareText(title, url) });
  } catch (error) {
    if (isAbort(error)) return;
    throw new Error(`Das Teilen-Menü ließ sich nicht öffnen: ${reason(error)}`);
  }
}

/**
 * Puts one recipe's share text on the clipboard. Rejects with a German sentence
 * when the clipboard could not be filled — the one failure this action has, and
 * the reason it reports itself instead of failing silently.
 */
export async function copyRecipeLink(title: string, url: string): Promise<void> {
  const text = recipeShareText(title, url);
  if (typeof navigator.clipboard?.writeText !== 'function') {
    throw new Error('Dieser Browser stellt keine Zwischenablage bereit.');
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    throw new Error(`Die Zwischenablage ließ sich nicht füllen: ${reason(error)}`);
  }
}

/**
 * True for the `AbortError` a dismissed share sheet rejects with. Checked by
 * name rather than by class, because the rejection is a `DOMException` in the
 * browsers the app runs in but is not guaranteed to be one.
 */
function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** The message of an unknown error, for a sentence that has to name it. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
