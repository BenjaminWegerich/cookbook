/**
 * Cookbook export host — serves a recipe's HTML export as the cooking view.
 *
 * Why this exists: the export is a self-contained HTML file in Google Drive, and
 * its size picker and step navigation are an embedded script. A Drive link
 * renders that file *without* letting the script run (observed in Google Keep's
 * in-app browser, where the buttons stay dead) and does not pass the URL's
 * fragment through, so the promised size is lost as well. This web app serves
 * the file from the cookbook owner's own Drive as a normal page: the script
 * runs, and the size arrives as a query parameter this script can read.
 *
 * Request shape (the web app builds these; see packages/core/src/planLink.ts):
 *
 *     https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?f=<exportFileId>
 *     ...&portionen=6     a finished dish, an integer serving count
 *     ...&menge=500g      an ingredient recipe, in the family base unit
 *
 * What it will serve is deliberately narrow: a file must be named `*.html` and
 * live in the folder named `Cookbook`. Knowing an id is not enough.
 *
 * Apps Script has no bundler, so this file cannot import the web app's core
 * module: the parameter names and the preselect element id are spelled out
 * again here and in packages/core/src/planLink.ts, and both sides must change
 * together. Deployment: apps/export-host/README.md.
 */

/** Folder a servable export must live in (apps/web/src/drive/recipeStorage.ts). */
var COOKBOOK_FOLDER_NAME = 'Cookbook';
/** Serving-count parameter (planLink.ts, PLAN_FRAGMENT_SERVINGS). */
var SERVINGS_PARAM = 'portionen';
/** Yield parameter (planLink.ts, PLAN_FRAGMENT_YIELD). */
var YIELD_PARAM = 'menge';
/** Id of the injected preselect style (planLink.ts, PLAN_PRESELECT_ELEMENT_ID). */
var PRESELECT_ID = 'cookbook-preselect';

/**
 * Serves one export file. Called by Google for every request to the web app URL.
 *
 * @param {!Object} request the Apps Script event; `request.parameter` carries the
 *     query parameters (`f`, `portionen`, `menge`).
 * @return {!HtmlService.HtmlOutput} the cooking view, or a readable error page.
 */
function doGet(request) {
  try {
    var fileId = request.parameter.f;
    if (!fileId) {
      return errorPage('Kein Rezept angegeben (Parameter f fehlt).');
    }
    var html = readExportHtml(fileId);
    return HtmlService.createHtmlOutput(preselect(html, request.parameter))
      .setTitle('Cookbook')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    return errorPage(error && error.message ? error.message : String(error));
  }
}

/**
 * Reads the HTML of one servable export.
 *
 * Guards the service against being used as a general file reader: the file must
 * be an `.html` file inside the Cookbook folder. A missing id, a file from
 * another folder and a non-HTML file each answer with a German reason instead of
 * content.
 *
 * @param {string} fileId the export's Drive file id.
 * @return {string} the file's HTML.
 */
function readExportHtml(fileId) {
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    throw new Error('Der Rezept-Export wurde nicht gefunden.');
  }
  if (!/\.html$/i.test(file.getName())) {
    throw new Error('Diese Datei ist kein Rezept-Export.');
  }
  if (!isInCookbookFolder(file)) {
    throw new Error('Diese Datei liegt nicht im Cookbook-Ordner.');
  }
  return file.getBlob().getDataAsString();
}

/**
 * True when the file's parent folder is the Cookbook folder. Checks the folder's
 * *name*, so the script needs no folder id of its own and a moved or renamed
 * folder is found again.
 *
 * @param {!DriveApp.File} file the export file.
 * @return {boolean} whether the file is servable.
 */
function isInCookbookFolder(file) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getName() === COOKBOOK_FOLDER_NAME) {
      return true;
    }
  }
  return false;
}

/**
 * Adds the promised size to the page as a `<style>` element.
 *
 * Why a style and not just a parameter: the cooking view's script reads the size
 * from `window.__COOKBOOK_PLAN_SIZE__` (injected by the bootstrap below) or from
 * the page URL, and selects the matching pre-rendered view. Until that script
 * runs — and if it never runs — the style keeps every view hidden except the
 * promised one, so the page is right from its first paint either way. The script
 * removes the element again when it takes over.
 *
 * @param {string} html the export file's HTML.
 * @param {!Object} params the request's query parameters.
 * @return {string} the HTML with the preselect style and the size bootstrap.
 */
function preselect(html, params) {
  var size = planSize(params);
  if (!size) {
    return html;
  }
  var view = '.serving-view[' + size.attribute + '="' + size.value + '"]';
  var head =
    '<style id="' + PRESELECT_ID + '">' +
    '.serving-view{display:none!important}' +
    view + '{display:block!important}' +
    '</style>\n' +
    '<script>window.__COOKBOOK_PLAN_SIZE__=' +
    JSON.stringify(size.query) +
    ';<\/script>\n';
  return html.replace('</head>', head + '</head>');
}

/**
 * The requested size in the three forms the host needs it, or null when the
 * request names none:
 *
 * - `query` — the size as the page's script reads it (`portionen=6`,
 *   `menge=500g`, in the family base unit);
 * - `attribute` / `value` — the pre-rendered view's attribute and value, for the
 *   preselect style.
 *
 * A yield is normalized to the family base unit (`kg`/`l` → `g`/`ml`) exactly as
 * the page does, so both the script and the selector agree on the value.
 *
 * @param {!Object} params the request's query parameters.
 * @return {?{query: string, attribute: string, value: string}} the size, or null.
 */
function planSize(params) {
  var servings = params[SERVINGS_PARAM];
  if (servings && /^\d+$/.test(servings)) {
    return {
      query: SERVINGS_PARAM + '=' + servings,
      attribute: 'data-servings',
      value: servings,
    };
  }
  var yieldParam = params[YIELD_PARAM];
  if (yieldParam) {
    var match = /^(\d+(?:[.,]\d+)?)(kg|l|g|ml)$/i.exec(yieldParam);
    if (match) {
      var amount = Number(match[1].replace(',', '.'));
      var unit = match[2].toLowerCase();
      var baseUnit = unit === 'kg' || unit === 'g' ? 'g' : 'ml';
      if (unit === 'kg' || unit === 'l') {
        amount = amount * 1000;
      }
      var quantity = String(amount);
      return {
        query: YIELD_PARAM + '=' + quantity + baseUnit,
        attribute: 'data-yield',
        value: quantity,
      };
    }
  }
  return null;
}

/**
 * A small German error page. The audience is the cook at the stove, not a
 * developer, so the reason is a sentence and not a stack trace.
 *
 * @param {string} message the reason.
 * @return {!HtmlService.HtmlOutput} the error page.
 */
function errorPage(message) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Cookbook</title></head>' +
      '<body style="font-family: system-ui, sans-serif; padding: 1rem">' +
      '<p role="alert">Die Kochansicht konnte nicht geladen werden. ' +
      escapeHtml(message) +
      '</p></body></html>'
  ).setTitle('Cookbook');
}

/**
 * Escapes text for the error page.
 *
 * @param {string} text the text to escape.
 * @return {string} the escaped text.
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
