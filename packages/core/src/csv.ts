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
 * Delimiter: ';' is the canonical form and the only one the serializers write,
 * but the master data is user data that is edited in a spreadsheet, and
 * spreadsheet apps export "CSV" comma-separated in an English locale. The
 * header row therefore decides the delimiter: the candidate delimiters are
 * tried in canonical-first order and the one whose header equals an accepted
 * header wins; the data rows are then split with that delimiter. A
 * comma-separated file is only ever read — the next write emits the canonical
 * semicolon form, so the file upgrades itself. A German decimal comma inside a
 * comma-separated file must be quoted (spreadsheet exports quote such cells);
 * in a semicolon file it needs no quotes, because the comma is not the
 * delimiter there.
 *
 * Cells may be wrapped in double quotes (the spreadsheet way of protecting a
 * cell that contains the delimiter or a quote), with `""` as an escaped quote
 * inside. A field never spans lines in this data, so splitting stays
 * line-based.
 *
 * This module owns that protocol once, so the codecs cannot drift apart. It
 * knows nothing about the meaning of any column — all cell validation stays
 * with the caller.
 */

/**
 * Candidate cell delimiters, canonical first. The order matters only for a
 * header that would match under both delimiters (which no accepted header
 * does): the canonical form wins, so a semicolon file is never misread.
 */
const DELIMITERS = [';', ','] as const;

/**
 * Splits one line into its trimmed cells. A cell may be wrapped in double
 * quotes to protect a delimiter or a quote inside it; `""` inside a quoted cell
 * is one literal quote. Whitespace around an unquoted cell is trimmed, and so
 * is whitespace between the start of a cell and its opening quote — spreadsheet
 * exports are sloppy about that.
 */
function splitCells(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is an escaped literal quote.
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else if (char === '"' && cell.trim() === '') {
      // A quote only opens a quoted cell at its beginning; the whitespace that
      // may precede it is not part of the content.
      cell = '';
      quoted = true;
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Drops one trailing empty cell from a header line (a line ending in the
 * delimiter, common in spreadsheet exports) — never the header's only cell.
 * The column count is not known yet, so any trailing empty cell is tolerated
 * here; the accepted-header match then decides the column count.
 */
function dropHeaderTrailingEmptyCell(cells: string[]): string[] {
  if (cells.length > 1 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

/**
 * Drops one trailing empty cell from a data row. Unlike the header, the
 * expected column count is known, so only a row with exactly one extra
 * (empty) cell is shortened: a _missing_ cell must still reach the caller's
 * own column validation, where the meaningful German error for an empty
 * first cell ("leerer Store", "leere Zutat", "leerer Meldebestand") lives.
 */
function dropRowTrailingEmptyCell(cells: string[], columnCount: number): string[] {
  if (cells.length === columnCount + 1 && cells[cells.length - 1] === '') {
    cells.pop();
  }
  return cells;
}

/** The delimiter a header line uses, with its cells and the expected column count. */
interface MatchedHeader {
  /** The delimiter the file uses (canonical `;` or the spreadsheet `,`). */
  readonly delimiter: string;
  /** The header's cells (trailing empty cell already dropped). */
  readonly header: string[];
  /** Number of cells every data row must have. */
  readonly columnCount: number;
}

/**
 * Finds the delimiter by matching the header against the accepted headers:
 * each candidate delimiter splits the header row, and the first one whose
 * `join(';')` equals an accepted header wins. Reading the delimiter from the
 * header (instead of sniffing the data rows) keeps the decision deterministic
 * and survives cells that contain the other delimiter.
 *
 * Returns undefined when no candidate produces an accepted header — the caller
 * then reports the unexpected header.
 */
function matchHeader(
  headerLine: string,
  acceptedHeaders: readonly string[],
): MatchedHeader | undefined {
  for (const delimiter of DELIMITERS) {
    const header = dropHeaderTrailingEmptyCell(splitCells(headerLine, delimiter));
    const actualHeader = header.join(';');
    if (acceptedHeaders.includes(actualHeader)) {
      // The accepted header is written with ';', so its cell count is the
      // column count — independent of which delimiter the file uses.
      return { delimiter, header, columnCount: actualHeader.split(';').length };
    }
  }
  return undefined;
}

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
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new Error('Datei ist leer.');
  }
  const headerLine = lines[0]!;
  const matched = matchHeader(headerLine, acceptedHeaders);
  if (matched === undefined) {
    // The message shows the header as the file has it: splitting with the
    // canonical delimiter leaves a comma-separated header in one cell, so the
    // user sees the commas — the visible hint that the file was exported with
    // the wrong delimiter (and that no accepted header matches).
    const shown = splitCells(headerLine, ';').join(';');
    throw new Error(`unerwartete Kopfzeile "${shown}".`);
  }
  const { delimiter, header, columnCount } = matched;
  const rows: string[][] = [];
  for (const line of lines.slice(1)) {
    const cells = dropRowTrailingEmptyCell(splitCells(line, delimiter), columnCount);
    if (cells.length !== columnCount) {
      throw new Error(
        `unerwartete Spaltenzahl in Zeile "${cells.join(';')}" (erwartet ${columnCount}).`,
      );
    }
    rows.push(cells);
  }
  return { header, rows };
}
