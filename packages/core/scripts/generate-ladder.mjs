#!/usr/bin/env node
/**
 * Generates `src/ladderData.ts` from the authoritative ladder table
 * `docs/standard_numbers.csv` (repository root).
 *
 * The CSV is the single source of truth (see docs/quantity_scaling.md §2);
 * the generated TypeScript module is committed so that the framework-free core
 * package and its consumers (web app, export generator) never parse CSV at
 * runtime.
 *
 * Usage:
 *   npm run generate:ladder   (from packages/core)
 *
 * After every change to docs/standard_numbers.csv, re-run this script and
 * commit the regenerated file.
 *
 * CSV format (canonical): semicolon-separated, dot decimals, header row:
 *   Exact Number;Rounded Number for BQ;Rounded Number for AQ
 * Rungs are x = −16 … 48 (65 rows). The generator tolerates CRLF line endings,
 * a trailing empty field per row, and German comma decimals, so exports from
 * spreadsheet tools (Excel/Calc) are accepted as-is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSV_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/standard_numbers.csv',
);
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/ladderData.ts');

const MIN_X = -16;
const MAX_X = 48;

/** Converts a CSV cell to a number, accepting both '.' and ',' decimals. */
function toNumber(cell) {
  return Number(cell.trim().replace(',', '.'));
}

/** Parses the CSV into rows of [exact, bq, aq]. */
function parseCsv() {
  const text = readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new Error(`${CSV_PATH}: file is empty`);
  }
  const header = lines[0].split(';').map((cell) => cell.trim());
  if (
    header[0] !== 'Exact Number' ||
    header[1] !== 'Rounded Number for BQ' ||
    header[2] !== 'Rounded Number for AQ'
  ) {
    throw new Error(`${CSV_PATH}: unexpected header ${JSON.stringify(header)}`);
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(';');
    // Drop a trailing empty field produced by spreadsheet exports.
    if (cells.length > 3 && cells[cells.length - 1].trim() === '') {
      cells.pop();
    }
    if (cells.length !== 3) {
      throw new Error(`${CSV_PATH}: expected 3 columns, got ${cells.length} in line: ${line}`);
    }
    return [toNumber(cells[0]), toNumber(cells[1]), cells[2].trim()];
  });
}

function buildRungs(rows) {
  if (rows.length !== MAX_X - MIN_X + 1) {
    throw new Error(`${CSV_PATH}: expected ${MAX_X - MIN_X + 1} rungs, got ${rows.length}`);
  }
  const rungs = rows.map(([exact, bq, aq], index) => {
    const x = MIN_X + index;
    if (!Number.isFinite(exact) || !Number.isFinite(bq)) {
      throw new Error(`${CSV_PATH}: non-numeric value in rung ${x}`);
    }
    if (!/^(\d+(\+\d+\/\d+)?|\d+\/\d+)$/.test(aq)) {
      throw new Error(`${CSV_PATH}: invalid AQ fraction '${aq}' in rung ${x}`);
    }
    return { x, exact, bq, aq };
  });
  // Defensive: the exact column must be strictly increasing (the geometric
  // ladder) so that every rung is unambiguous.
  for (let i = 1; i < rungs.length; i++) {
    if (!(rungs[i - 1].exact < rungs[i].exact)) {
      throw new Error(`${CSV_PATH}: exact values not strictly increasing at rung ${rungs[i].x}`);
    }
  }
  // Defensive: BQ values must be unique — the runtime pos() lookup is keyed by
  // BQ, so a duplicate would silently corrupt the ladder.
  const seenBq = new Set();
  for (const rung of rungs) {
    if (seenBq.has(rung.bq)) {
      throw new Error(`${CSV_PATH}: duplicate BQ value ${rung.bq} at rungs ${rung.x}`);
    }
    seenBq.add(rung.bq);
  }
  return rungs;
}

function render(rungs) {
  const lines = [];
  lines.push(`/**`);
  lines.push(` * AUTO-GENERATED from docs/standard_numbers.csv by scripts/generate-ladder.mjs.`);
  lines.push(
    ` * Do not edit by hand — re-run 'npm run generate:ladder' (packages/core) after a CSV change.`,
  );
  lines.push(` */`);
  lines.push(``);
  lines.push(`/** One rung of the quantity ladder (x = −16 … 48). */`);
  lines.push(`export interface LadderRung {`);
  lines.push(`  /** Step index; exact(x) = 10^(x/16). */`);
  lines.push(`  readonly x: number;`);
  lines.push(`  /** Geometric value 10^(x/16); defines the rung positions only. */`);
  lines.push(`  readonly exact: number;`);
  lines.push(
    `  /** Rounded decimal form, used for base quantities (g / kg / ml / l) and serving counts. */`,
  );
  lines.push(`  readonly bq: number;`);
  lines.push(
    `  /** Rounded fraction form for additional-unit display, canonical notation (e.g. "1+1/4"). */`,
  );
  lines.push(`  readonly aq: string;`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export const LADDER_RUNGS: readonly LadderRung[] = [`);
  for (const rung of rungs) {
    lines.push(`  { x: ${rung.x}, exact: ${rung.exact}, bq: ${rung.bq}, aq: '${rung.aq}' },`);
  }
  lines.push(`];`);
  lines.push(``);
  return lines.join('\n');
}

const rungs = buildRungs(parseCsv());
writeFileSync(OUT_PATH, render(rungs), 'utf8');
console.log(`Wrote ${rungs.length} rungs to ${OUT_PATH}`);
