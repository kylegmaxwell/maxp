import { describe, expect, it } from 'vitest';
import {
  escapeIteration,
  mandelbrotEscape,
  MandelbrotGrid,
  mandelbrotSmooth,
  smoothEscape,
} from './mandelbrot';

describe('escapeIteration', () => {
  it('never escapes for points in the set', () => {
    expect(escapeIteration(0, 0, 100)).toBe(-1);
    expect(escapeIteration(-1, 0, 100)).toBe(-1); // period-2 cycle
    expect(escapeIteration(-2, 0, 100)).toBe(-1); // tip of the set, |z|^2 stays exactly 4
    expect(escapeIteration(-0.5, 0, 100)).toBe(-1);
  });

  it('escapes at a known iteration for simple points', () => {
    // c = 1: z = 0, 1, 2, 5 -> |z|^2 first exceeds 4 at i = 3
    expect(escapeIteration(1, 0, 100)).toBe(3);
    // c = 2: z = 0, 2, 6 -> first exceeds 4 at i = 2
    expect(escapeIteration(2, 0, 100)).toBe(2);
  });

  it('reports -1 when the iteration cap is reached first', () => {
    expect(escapeIteration(1, 0, 3)).toBe(-1); // would escape at i = 3, but only 0..2 are checked
    expect(escapeIteration(1, 0, 4)).toBe(3);
  });

  it('escapes later with more iterations, never earlier', () => {
    const at = (iter: number) => escapeIteration(0.5, 0.5, iter);
    const full = at(200);
    expect(full).toBeGreaterThan(0);
    // once the cap is above the escape iteration the answer stops changing
    expect(at(full + 1)).toBe(full);
    expect(at(full)).toBe(-1);
  });
});

describe('mandelbrotEscape', () => {
  it('has one value per pixel, row by row', () => {
    const out = mandelbrotEscape(5, 3, 20);
    expect(out).toHaveLength(15);
  });

  it('maps the center pixel to c = 0 and the corners to c = ±2 ± 2i', () => {
    const size = 5; // pixel 2 is exactly 0
    const out = mandelbrotEscape(size, size, 50);
    expect(out[2 * size + 2]).toBe(-1); // c = 0
    expect(out[0]).toBe(1); // c = -2 - 2i: z1 = c, |c|^2 = 8 > 4
    expect(out[size * size - 1]).toBe(1); // c = 2 + 2i
  });

  it('is symmetric about the real axis', () => {
    const size = 9;
    const out = mandelbrotEscape(size, size, 60);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        expect(out[r * size + c]).toBe(out[(size - 1 - r) * size + c]);
      }
    }
  });
});

describe('MandelbrotGrid', () => {
  it('normalizes escape counts to [0, 1] and tracks steps / reset', () => {
    const grid = new MandelbrotGrid(5, 5);
    expect(grid.steps).toBe(0);

    grid.advanceTo(20);
    expect(grid.steps).toBe(20);
    expect(grid.values[2 * 5 + 2]).toBe(0); // center c = 0 never escapes -> 0
    for (const v of grid.values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }

    grid.reset();
    expect(grid.steps).toBe(0);
    expect(grid.values.every((v) => v === 0)).toBe(true);
  });
});

describe('smoothEscape', () => {
  it('aligns with integer n right at the discrete bailout boundary |z_n| = 2', () => {
    // At i = 1, z_1 = c. For |c| = 2 + eps, smoothEscape approaches 1 from below;
    // for |c| = 2, it does not escape at i = 1 and equals 1 from the interior formula.
    expect(smoothEscape(2, 0, 2)).toBeCloseTo(1, 5);
    expect(smoothEscape(2.0001, 0, 2)).toBeCloseTo(1, 3);
    expect(smoothEscape(1.9999, 0, 2)).toBeCloseTo(1, 3);
  });

  it('increases monotonically from exterior toward the origin', () => {
    const vOuter = smoothEscape(1.8, 0, 10);
    const vMid = smoothEscape(1.0, 0, 10);
    const vInner = smoothEscape(0.5, 0, 10);
    const vOrigin = smoothEscape(0, 0, 10);
    expect(vOuter).toBeLessThan(vMid);
    expect(vMid).toBeLessThan(vInner);
    expect(vInner).toBeLessThan(vOrigin);
    expect(vOrigin).toBeCloseTo(10, 5);
  });
});

describe('mandelbrotSmooth', () => {
  it('produces a symmetric smooth field across the real axis', () => {
    const size = 9;
    const out = mandelbrotSmooth(size, size, 15);
    expect(out).toHaveLength(size * size);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        expect(out[r * size + c]).toBeCloseTo(out[(size - 1 - r) * size + c], 5);
      }
    }
  });
});

