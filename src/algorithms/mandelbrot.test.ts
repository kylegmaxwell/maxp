import { describe, expect, it } from 'vitest';
import { escapeIteration, mandelbrotEscape } from './mandelbrot';

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

