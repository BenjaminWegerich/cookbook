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
 * Puts a dish on the meal plan, replacing the entries of the same recipe.
 *
 * `entry` is the complete line to add (recipe title plus size suffix, built by
 * `mealPlanEntryText` in @cookbook/core); `replace` are the exact texts of the
 * entries the app recognized as the same recipe, checked or not. The app owns
 * that recognition rule — it needs the recipe's type and family unit — so the
 * gateway only executes the action.
 *
 * The answer is the meal plan after the write, so the caller can update it
 * without a second request. Only that list comes back: it is the one the action
 * changed, and asking the gateway for the shopping list too would let an
 * unrelated, missing note turn a successful write into an error.
 */
export async function addMealPlanEntry(
  gatewayToken: string,
  entry: string,
  replace: readonly string[],
): Promise<KeepChecklist> {
  const body = await requestJson('/keep/mealplan', gatewayToken, {
    method: 'POST',
    body: { add: entry, remove: [...replace] },
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
  if (error instanceof KeepClientError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
