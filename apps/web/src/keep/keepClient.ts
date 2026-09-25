/**
 * Browser client for the Keep gateway (`apps/keep-gateway/`).
 *
 * The app never talks to Google Keep itself: the master token that could edit
 * the notes can only live in the gateway (a static bundle cannot keep a
 * secret), so this module is the whole HTTP boundary the UI knows about. It
 * stays deliberately thin and action-shaped — the gateway's own model (note
 * ids, sort ids, account details) never crosses it.
 *
 * Two facts decide whether Keep features exist at all (N5, the core never
 * depends on Keep):
 *
 * - the gateway URL comes from the build-time environment
 *   (`VITE_KEEP_GATEWAY_URL`, see .env.example). Without it the feature is
 *   "off" and the app must stay fully usable;
 * - the caller proves itself with its Google sign-in for the `openid email`
 *   scope, sent as `Authorization: Bearer` (see ../auth/googleAuth). That token
 *   opens no file: it exists so the gateway can check the address against its
 *   allowlist, and it is why the Drive token never leaves the app.
 *
 * Every failure is mapped onto one `KeepClientError` with a stable `code`, so
 * the UI can tell "sign-in refused" (sign in again) from "gateway down" (retry)
 * from "operator must re-mint the credential" (nothing the app can do). The
 * gateway's error contract (`{"error": {"code", "message"}}`) is documented in
 * apps/keep-gateway/README.md.
 */

/** Gateway URL from the build environment; undefined when the build has none. */
export const KEEP_GATEWAY_URL: string | undefined = import.meta.env.VITE_KEEP_GATEWAY_URL;

/**
 * How long one gateway request may take before it counts as unreachable. The
 * gateway's own cold sync is ~1 s; the margin absorbs a Cloud Run cold start
 * without leaving the UI in a "checking" state forever.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** One checklist item as the gateway reports it (user-visible facts only). */
export interface KeepItem {
  /** The line's text, exactly as in the Keep app. */
  text: string;
  /** True when the user ticked the item off in Keep. */
  checked: boolean;
  /** True for an indented sub-item. */
  indented: boolean;
}

/** One Keep checklist (the meal plan or the shopping list). */
export interface KeepChecklist {
  title: string;
  /** Items in the order the Keep app shows them. */
  items: KeepItem[];
}

/** The two notes the gateway reads for app start. */
export interface KeepState {
  mealplan: KeepChecklist;
  shopping: KeepChecklist;
}

/**
 * Stable failure codes: the gateway's own codes (see
 * apps/keep-gateway/README.md) plus the two cases only the client can see
 * (the request never arrived, or the answer was not the expected JSON).
 */
export type KeepErrorCode =
  | 'gateway_not_configured'
  | 'unauthorized'
  | 'identity_unavailable'
  | 'origin_not_allowed'
  | 'keep_auth_rejected'
  | 'keep_unreachable'
  | 'keep_list_missing'
  | 'keep_api_error'
  | 'not_implemented'
  | 'bad_request'
  | 'internal_error'
  | 'shortening_disabled'
  | 'shorten_failed'
  | 'unreachable'
  | 'invalid_response'
  | 'http_error';

/** A failed gateway call, carrying the branchable code and a German message. */
export class KeepClientError extends Error {
  readonly code: KeepErrorCode;
  /** HTTP status when there was a response, null for a transport failure. */
  readonly status: number | null;

  constructor(code: KeepErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'KeepClientError';
    this.code = code;
    this.status = status;
  }
}

/** The configured gateway base URL (no trailing slash), or null when unset. */
function gatewayBaseUrl(): string | null {
  if (typeof KEEP_GATEWAY_URL !== 'string') return null;
  const trimmed = KEEP_GATEWAY_URL.trim().replace(/\/+$/, '');
  return trimmed === '' ? null : trimmed;
}

/** True when the build knows a gateway — the switch for every Keep feature. */
export function isKeepConfigured(): boolean {
  return gatewayBaseUrl() !== null;
}

/** True for a plain JSON object (the gateway's response envelope). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The `error.code` of a gateway error response, when it carries one. */
function errorCodeOf(body: unknown): KeepErrorCode | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const code = body.error.code;
  return typeof code === 'string' ? (code as KeepErrorCode) : null;
}

/** The `error.message` of a gateway error response, when it carries one. */
function errorMessageOf(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const message = body.error.message;
  return typeof message === 'string' && message.trim() !== '' ? message : null;
}

/** Options of one gateway call: the HTTP method and an optional JSON body. */
interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

/**
 * Performs one gateway call and decodes its JSON. A missing configuration, a
 * transport failure, a non-2xx status and an unreadable body each become a
 * `KeepClientError` with the matching code — no raw fetch error and no
 * response text ever reaches the UI.
 */
async function requestJson(
  path: string,
  gatewayToken?: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const base = gatewayBaseUrl();
  if (base === null) {
    throw new KeepClientError(
      'gateway_not_configured',
      'Das Keep-Gateway ist in dieser Installation nicht eingerichtet.',
    );
  }
  const headers: Record<string, string> = {};
  if (gatewayToken !== undefined) headers.Authorization = `Bearer ${gatewayToken}`;
  // A body always travels as JSON: the gateway rejects anything else as a
  // bad request, and the write actions are the only calls that carry one.
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new KeepClientError('unreachable', 'Das Keep-Gateway ist nicht erreichbar.');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = errorCodeOf(body) ?? (response.status === 401 ? 'unauthorized' : 'http_error');
    const message =
      errorMessageOf(body) ?? `Das Keep-Gateway meldet einen Fehler (HTTP ${response.status}).`;
    throw new KeepClientError(code, message, response.status);
  }
  if (body === null) {
    throw new KeepClientError('invalid_response', 'Das Keep-Gateway hat unerwartet geantwortet.');
  }
  return body;
}

/**
 * Decodes one checklist from the gateway's JSON. A malformed answer is a
 * hard error (not an empty list): showing "no dishes planned" when the
 * gateway actually failed would quietly hide a real problem.
 */
function parseChecklist(value: unknown): KeepChecklist | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items: KeepItem[] = [];
  for (const entry of value.items) {
    if (!isRecord(entry) || typeof entry.text !== 'string') return null;
    items.push({
      text: entry.text,
      checked: entry.checked === true,
      indented: entry.indented === true,
    });
  }
  return { title: typeof value.title === 'string' ? value.title : '', items };
}

/**
 * Decodes the gateway's state shape (both checklists). A malformed answer is a
 * hard error (not an empty list): showing "no dishes planned" when the gateway
 * actually failed would quietly hide a real problem.
 */
function parseState(body: unknown): KeepState {
  if (!isRecord(body)) {
    throw new KeepClientError('invalid_response', 'Das Keep-Gateway hat unerwartet geantwortet.');
  }
  const mealplan = parseChecklist(body.mealplan);
  const shopping = parseChecklist(body.shopping);
  if (mealplan === null || shopping === null) {
    throw new KeepClientError('invalid_response', 'Das Keep-Gateway hat unerwartet geantwortet.');
  }
  return { mealplan, shopping };
}

/**
 * Reads the meal plan and the shopping list. Requires the caller's Google
 * sign-in (the identity token from ../auth/googleAuth); a refused sign-in is a
 * `KeepClientError` with code `unauthorized`, which the hook answers by signing
 * in again (see ./useKeep).
 */
export async function fetchKeepState(gatewayToken: string): Promise<KeepState> {
  return parseState(await requestJson('/keep/state', gatewayToken));
}

/**
 * Writes the meal plan: puts `add` at the top, replacing the `remove` entries.
 *
 * `add` are the complete lines to place, in reading order (top first):
 * `mealPlanEntryText` for the ordinary write ("Kürbissuppe: <Export-URL>#portionen=6",
 * or the linkless "Kürbissuppe (6 Portionen)" when the recipe has no export
 * file), or the lines a previous write replaced when the app restores them
 * (undo). `remove` are the exact texts of the entries the app recognized as the
 * same recipe, checked or not. The app owns that recognition rule — it needs the
 * recipe's type and family unit — so the gateway only executes the action.
 *
 * The answer is the meal plan after the write, so the caller can update it
 * without a second request. Only that list comes back: it is the one the action
 * changed, and asking the gateway for the shopping list too would let an
 * unrelated, missing note turn a successful write into an error.
 */
export async function writeMealPlan(
  gatewayToken: string,
  add: readonly string[],
  remove: readonly string[],
): Promise<KeepChecklist> {
  const body = await requestJson('/keep/mealplan', gatewayToken, {
    method: 'POST',
    // A single line goes as the plain string the endpoint has always accepted.
    // The list form is only what the undo needs (several restored lines, or none
    // for a first-time plan), so a bundle deployed ahead of the gateway keeps its
    // ordinary write working instead of failing on a payload shape the old
    // gateway does not parse.
    body: {
      add: add.length === 1 ? add[0]! : [...add],
      remove: [...remove],
    },
  });
  const mealplan = isRecord(body) ? parseChecklist(body.mealplan) : null;
  if (mealplan === null) {
    throw new KeepClientError('invalid_response', 'Das Keep-Gateway hat unerwartet geantwortet.');
  }
  return mealplan;
}

/**
 * Writes the shopping list: puts `add` at the top, deleting the `remove` entries.
 *
 * The mirror image of `writeMealPlan`, and the same division of labour: `add`
 * are the complete lines the app wants to see in "Einkaufsliste" — one per
 * ingredient, in the app's own display form, already rounded up to whole
 * shopping units — and `remove` the exact texts the undo takes back off. That
 * form and that arithmetic live in the app (`packages/core/src/shoppingList.ts`
 * and the pantry sheet); the gateway treats a line as opaque text and only
 * executes the action it is handed.
 *
 * The answer is the shopping list after the write, so the caller can adopt it
 * without a second request — and only that list, because it is the one the
 * action changed (same reasoning as `writeMealPlan`).
 */
export async function writeShoppingList(
  gatewayToken: string,
  add: readonly string[],
  remove: readonly string[],
): Promise<KeepChecklist> {
  const body = await requestJson('/keep/shopping', gatewayToken, {
    method: 'POST',
    // Always the list form: this route has no earlier shape to stay compatible
    // with (it answered 501 until the write existed), so unlike the meal-plan
    // write there is nothing to be lenient about.
    body: { add: [...add], remove: [...remove] },
  });
  const shopping = isRecord(body) ? parseChecklist(body.shopping) : null;
  if (shopping === null) {
    throw new KeepClientError('invalid_response', 'Das Keep-Gateway hat unerwartet geantwortet.');
  }
  return shopping;
}

/**
 * Asks the gateway to shorten one export URL (`POST /shorten`).
 *
 * The meal-plan write uses this so the Keep line stays readable: the line carries the export
 * URL as raw text (Keep has no hyperlink-with-text), and the Apps Script host address plus the
 * Drive file id make it enormous. The promised size is already part of `target`, so the short
 * link's target opens the cooking view at the right size — the app writes the size as the
 * line's parenthetical label, because a short link does not show it.
 *
 * A failure is not an error the caller has to handle: the long export URL still opens the
 * cooking view, so the caller catches this and composes the long line instead. The two new
 * codes (`shortening_disabled`, `shorten_failed`) exist so a caller that wants to distinguish
 * "not configured" from "TinyURL refused" can, without a second error channel.
 */
export async function shortenUrl(gatewayToken: string, target: string): Promise<string> {
  const body = await requestJson('/shorten', gatewayToken, {
    method: 'POST',
    body: { url: target },
  });
  const shortUrl = isRecord(body) && typeof body.shortUrl === 'string' ? body.shortUrl : null;
  if (shortUrl === null || shortUrl.trim() === '') {
    throw new KeepClientError('invalid_response', 'Das Keep-Gateway hat unerwartet geantwortet.');
  }
  return shortUrl;
}

/**
 * Ticks ("checks") or unticks meal-plan lines, changing nothing else.
 *
 * This is the recipe overview's "Vom Plan entfernen" and its undo. Removing a
 * dish from the meal plan deliberately does not delete the Keep line: it is
 * ticked off, so the line stays visible in Keep as "cooked", and the undo ticks
 * it back on. `check` are the exact texts to tick, `uncheck` the exact texts to
 * tick back on. The app owns the rule that decides which lines belong to a
 * recipe — it needs the recipe's type and family unit — so the gateway only
 * executes the action it is handed (same division as `writeMealPlan`).
 *
 * The answer is the meal plan after the write, so the caller can update it
 * without a second request; only that list comes back, because it is the one
 * the action changed (see `writeMealPlan`).
 */
export async function setMealPlanChecked(
  gatewayToken: string,
  check: readonly string[],
  uncheck: readonly string[],
): Promise<KeepChecklist> {
  const body = await requestJson('/keep/mealplan/check', gatewayToken, {
    method: 'POST',
    body: { check: [...check], uncheck: [...uncheck] },
  });
  const mealplan = isRecord(body) ? parseChecklist(body.mealplan) : null;
  if (mealplan === null) {
    throw new KeepClientError('invalid_response', 'Das Keep-Gateway hat unerwartet geantwortet.');
  }
  return mealplan;
}

/**
 * Cheap liveness probe (no Keep call, no token). Used before trying a sign-in,
 * so the UI can tell "the gateway is down" from "we still need a sign-in"
 * without sending an unauthenticated `/keep/state` request.
 */
export async function checkKeepHealth(): Promise<boolean> {
  if (!isKeepConfigured()) return false;
  try {
    await requestJson('/health');
    return true;
  } catch {
    return false;
  }
}

/**
 * The German message for any thrown value from this module. A
 * `KeepClientError` already carries its user-facing text; anything else (a
 * programming error) is shown verbatim so it is not swallowed.
 */
export function keepErrorMessage(error: unknown): string {
  if (error instanceof KeepClientError) {
    // `not_implemented` is the gateway's 501 for a write route that exists as a
    // contract but not as an action yet (see PENDING_ACTIONS in
    // apps/keep-gateway). Its own text names the pending action in English, for
    // an operator; the user-facing reading is the app's job.
    if (error.code === 'not_implemented') {
      return 'Diese Aktion ist im Keep-Gateway noch nicht eingerichtet.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
