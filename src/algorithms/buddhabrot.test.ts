import { describe, expect, it } from 'vitest';
import { buddhabrotCounts, BuddhabrotGrid } from './buddhabrot';

describe('buddhabrotCounts', () => {
  it('has one count per pixel and no negative or non-finite values', () => {
    const counts = buddhabrotCounts(9, 9, 20);
    expect(counts).toHaveLength(81);
    for (const n of counts) {
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('with one iteration counts each starting point inside the disc once', () => {
    // 9 pixels gives an exact step of 0.5, so points on |c| = 2 are cleanly excluded
    const size = 9;
    let inside = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const a = -2 + c * 0.5;
        const b = -2 + r * 0.5;
        if (a * a + b * b < 4) inside++;
      }
    }
    const total = buddhabrotCounts(size, size, 1).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(inside);
  });

  it('never loses counts as the iteration cap goes up', () => {
    const lower = buddhabrotCounts(15, 15, 5);
    const higher = buddhabrotCounts(15, 15, 30);
    for (let i = 0; i < lower.length; i++) {
      expect(higher[i]).toBeGreaterThanOrEqual(lower[i]);
    }
  });
});

describe('BuddhabrotGrid', () => {
  it('log-normalizes counts to [0, 1] with peak 1 and supports reset', () => {
    const grid = new BuddhabrotGrid(9, 9);
    grid.advanceTo(15);
    expect(grid.steps).toBe(15);

    let max = 0;
    for (const v of grid.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > max) max = v;
    }
    expect(max).toBeCloseTo(1);

    grid.reset();
    expect(grid.steps).toBe(0);
    expect(grid.values.every((v) => v === 0)).toBe(true);
  });
});

