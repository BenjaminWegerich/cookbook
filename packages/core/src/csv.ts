/**
 * The CSV row protocol shared by the master-data codecs
 * (ingredientCsv.ts, shoppingRouteCsv.ts) — docs/storage_format.md §9.
 *
 * Every master-data file is a semicolon CSV with the same protocol:
 * - one header row; the header must equal one of the caller's accepted headers
 *   exactly, and the matched header's cell count is the expected cell count of
 *   every following row. Supporting an older format that lacks a trailing
 *   column therefore means passing its header here, too — the row validation
 *   follows the matched header, so such files keep parsing until they are
 *   written back in the current format;
 * - CRLF line endings, blank lines and a leading UTF-8 BOM (spreadsheet
 *   exports) are tolerated;
 * - one trailing empty cell per row (a line ending in ';', common in
 *   spreadsheet exports) is dropped; a meaningful empty cell inside the row is
 *   kept and reaches the caller's own column validation.
 *
 * This module owns that protocol once, so the codecs cannot drift apart. It
 * knows nothing about the meaning of any column — all cell validation stays
 * with the caller.
 */

/**
 * Splits the text into the header and its data rows; tolerates CRLF and blank
 * lines and a leading UTF-8 BOM (spreadsheet exports). Throws on an empty file
 * and on a header that is not one of `acceptedHeaders`.
 *
 * The returned cells are trimmed; `rows` never contains the header.
 */
export function parseCsvRows(
  text: string,
  acceptedHeaders: readonly string[],
): { header: string[]; rows: string[][] } {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(';').map((cell) => cell.trim()));
  if (rows.length === 0) {
    throw new Error('Datei ist leer.');
  }
  const header = rows[0]!;
  // A single trailing empty cell on the header (a line ending in ';', common
  // in spreadsheet exports) is dropped before the header text is matched; the
  // per-row loop below drops it for every other row.
  if (header.length > 1 && header[header.length - 1] === '') {
    header.pop();
  }
  const actualHeader = header.join(';');
  const matchedHeader = acceptedHeaders.find((candidate) => candidate === actualHeader);
  if (matchedHeader === undefined) {
    throw new Error(`unerwartete Kopfzeile "${actualHeader}".`);
  }
  const columnCount = matchedHeader.split(';').length;
  for (const cells of rows) {
    // Drop exactly one trailing empty cell produced by spreadsheet exports
    // (e.g. a row or the header ending in ';'); a meaningful empty cell inside
    // stays.
    if (cells.length === columnCount + 1 && cells[cells.length - 1] === '') {
      cells.pop();
    }
    if (cells.length !== columnCount) {
      throw new Error(
        `unerwartete Spaltenzahl in Zeile "${cells.join(';')}" (erwartet ${columnCount}).`,
      );
    }
  }
  return { header, rows: rows.slice(1) };
}
