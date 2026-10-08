/**
 * Shared helpers for the pantry sheet's typed-number fields.
 *
 * Both the row's "Kaufen" amounts and the stock chips' keyboard input read a
 * number the user typed with German typography, so the parsing and the
 * thousandth-rounding live here in one place (components/PantrySelect and
 * components/StockChips).
 */

/**
 * Parses a typed number with German typography: the comma is the decimal
 * separator and a dot may separate thousands ("1.200" is 1200, "1,2" is 1.2).
 * Anything else is ignored, so a typed unit or a stray space does not spoil the
 * input ("1200 g"). NaN for an input without a number — the caller keeps the
 * previous value then.
 */
export function parseInput(text: string): number {
  return Number(
    text
      .replace(/[^\d.,]/g, '')
      .replaceAll('.', '')
      .replace(',', '.'),
  );
}

/** One thousandth — the precision the sheet rounds a stock to. */
export function roundThousandths(value: number): number {
  return Math.round(value * 1000) / 1000;
}
