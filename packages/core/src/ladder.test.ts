import { describe, expect, it } from 'vitest';

import { LADDER_RUNGS } from './ladderData.js';
import { difference, getRung, pos, roundedBQ, scale } from './ladder.js';

describe('ladder data', () => {
  it('covers x = −16 … 48 exactly once', () => {
    const xs = LADDER_RUNGS.map((rung) => rung.x);
    expect(xs).toHaveLength(65);
    for (let x = -16; x <= 48; x++) {
      expect(xs).toContain(x);
    }
    expect(new Set(xs).size).toBe(65);
  });

  it('has strictly increasing exact values (the geometric ladder)', () => {
    for (let i = 1; i < LADDER_RUNGS.length; i++) {
      expect(LADDER_RUNGS[i - 1]!.exact).toBeLessThan(LADDER_RUNGS[i]!.exact);
    }
  });

  it('has unique BQ values (required for the pos lookup)', () => {
    const bqs = LADDER_RUNGS.map((rung) => rung.bq);
    expect(new Set(bqs).size).toBe(bqs.length);
  });
});

describe('pos', () => {
  it('returns the documented rung positions', () => {
    expect(pos(1)).toBe(0);
    expect(pos(1.2)).toBe(1);
    expect(pos(1.5)).toBe(2);
    expect(pos(4)).toBe(10);
    expect(pos(6)).toBe(12);
    expect(pos(9)).toBe(15);
    expect(pos(10)).toBe(16);
    expect(pos(50)).toBe(27);
    expect(pos(300)).toBe(40);
    expect(pos(400)).toBe(42);
    expect(pos(500)).toBe(43);
    expect(pos(600)).toBe(44);
    expect(pos(700)).toBe(45);
    expect(pos(800)).toBe(46);
    expect(pos(1000)).toBe(48);
  });

  it('normalizes values outside the table by whole decades', () => {
    expect(pos(0.1)).toBe(-16);
    expect(pos(0.09)).toBe(-17);
    expect(pos(0.05)).toBe(-21);
    expect(pos(1200)).toBe(49);
    expect(pos(10_000)).toBe(64);
    // Decades below the table must not be corrupted by thousandths rounding
    // (docs/quantity_scaling.md §3: the ladder is closed under scaling).
    expect(pos(0.0012)).toBe(-47);
    expect(pos(0.0009)).toBe(-49);
    expect(pos(0.00012)).toBe(-63);
    expect(pos(0.0001)).toBe(-64);
  });

  it('round-trips every table rung: pos(bq) === x', () => {
    for (const rung of LADDER_RUNGS) {
      expect(pos(rung.bq)).toBe(rung.x);
    }
  });

  it('rejects non-standard numbers', () => {
    for (const invalid of [0, -5, 450, 11, 1.3, 3.2, 0.21, 0.0011, NaN, Infinity]) {
      expect(() => pos(invalid)).toThrow();
    }
  });
});

describe('scale', () => {
  it('moves quantities by the documented step counts', () => {
    // 4 → 6 people (Δx = +2)
    expect(scale(400, 2)).toBe(600);
    // 4 → 6 people, additional unit via base-unit equivalent (5 tbsp → 7 tbsp)
    expect(scale(50, 2)).toBe(70);
    // 4 → 5 people (Δx = +1): 5 tbsp → 6 tbsp (replaces the mathematical 6.25)
    expect(scale(50, 1)).toBe(60);
    // 6 → 9 people (Δx = +3): 700 g → 1000 g
    expect(scale(700, 3)).toBe(1000);
    // 6 → 4 people (Δx = −2): 600 ml → 400 ml
    expect(scale(600, -2)).toBe(400);
    // Sub-recipe: Béchamelsauce required amount and its Milch (Δx_sub = +3)
    expect(scale(500, 3)).toBe(800);
    expect(scale(300, 3)).toBe(500);
  });

  it('stays on the ladder beyond the table edges via the decade rule', () => {
    expect(scale(1000, 1)).toBe(1200);
    expect(scale(1000, -1)).toBe(900);
    expect(scale(1000, -2)).toBe(800);
    expect(scale(0.1, 1)).toBe(0.12);
    expect(scale(0.1, -1)).toBe(0.09);
  });

  it('returns the input unchanged for Δx = 0', () => {
    expect(scale(400, 0)).toBe(400);
    expect(scale(0.5, 0)).toBe(0.5);
  });

  it('rejects non-standard amounts and non-integer step counts', () => {
    expect(() => scale(450, 1)).toThrow();
    expect(() => scale(0, 1)).toThrow();
    expect(() => scale(400, 0.5)).toThrow();
  });
});

describe('difference', () => {
  it('computes Δx between two targets', () => {
    expect(difference(4, 6)).toBe(2);
    expect(difference(6, 9)).toBe(3);
    expect(difference(6, 4)).toBe(-2);
    expect(difference(4, 5)).toBe(1);
    expect(difference(4, 4)).toBe(0);
  });

  it('rejects non-standard targets', () => {
    expect(() => difference(4, 11)).toThrow();
  });
});

describe('roundedBQ and getRung', () => {
  it('returns the table values inside the table', () => {
    expect(roundedBQ(0)).toBe(1);
    expect(roundedBQ(10)).toBe(4);
    expect(roundedBQ(42)).toBe(400);
    expect(roundedBQ(-16)).toBe(0.1);
  });

  it('applies the decade rule outside the table', () => {
    expect(roundedBQ(49)).toBe(1200);
    expect(roundedBQ(64)).toBe(10_000);
    expect(roundedBQ(-17)).toBe(0.09);
  });

  it('applies the decade rule to the exact column (approximate, CSV-rounded)', () => {
    expect(getRung(16).exact).toBe(10);
    expect(getRung(17).exact).toBeCloseTo(11.5, 1);
    expect(getRung(-17).exact).toBeCloseTo(0.0866, 3);
  });

  it('exposes the AQ fraction form of a rung (for the upcoming additional-unit logic)', () => {
    expect(getRung(1).aq).toBe('1+1/4');
    expect(getRung(-6).aq).toBe('2/5');
    expect(getRung(-5).aq).toBe('1/2');
  });
});

describe('ladder closedness (docs/quantity_scaling.md §3)', () => {
  it('scaling any ladder value by any integer step count yields a ladder value', () => {
    for (const rung of LADDER_RUNGS) {
      for (let deltaX = -48; deltaX <= 48; deltaX++) {
        const scaled = scale(rung.bq, deltaX);
        expect(pos(scaled)).toBe(rung.x + deltaX);
      }
    }
  });
});
