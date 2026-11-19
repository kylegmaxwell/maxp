import { describe, expect, it } from 'vitest';
import { mandelbrotSmooth } from './mandelbrot';
import { closestContour, marchingSquares } from './marchingSquares';

describe('marchingSquares', () => {
  it('returns no contours when the grid is uniformly above or below the level', () => {
    const grid = new Float32Array(25).fill(3);
    expect(marchingSquares(grid, 5, 5, 1)).toEqual([]);
    expect(marchingSquares(grid, 5, 5, 5)).toEqual([]);
  });

  it('extracts a single closed circular loop at |c| = 1 from a radial field', () => {
    const size = 41;
    const grid = new Float32Array(size * size);
    const step = 4 / (size - 1);
    let idx = 0;
    for (let r = 0; r < size; r++) {
      const y = -2 + r * step;
      for (let c = 0; c < size; c++) {
        const x = -2 + c * step;
        // High inside radius 1, low outside
        grid[idx++] = 2 - Math.hypot(x, y);
      }
    }

    const contours = marchingSquares(grid, size, size, 1);
    expect(contours).toHaveLength(1);
    expect(contours[0].closed).toBe(true);
    expect(contours[0].points.length).toBeGreaterThan(20);

    for (const [x, y] of contours[0].points) {
      expect(Math.hypot(x, y)).toBeCloseTo(1, 1);
    }
  });

  it('contours the step-1 Mandelbrot circle |c| = 1.5 at iter = 2, level = 1.25', () => {
    // At iter = 2, for |c| <= 2, smoothEscape(c, 2) = 1 + (1 - |c| / 2) = 2 - |c| / 2.
    // Level 1.25 corresponds to |c| = 1.5.
    const size = 65;
    const grid = mandelbrotSmooth(size, size, 2);
    const contours = marchingSquares(grid, size, size, 1.25);

    expect(contours).toHaveLength(1);
    expect(contours[0].closed).toBe(true);
    for (const [x, y] of contours[0].points) {
      expect(Math.hypot(x, y)).toBeCloseTo(1.5, 1);
    }
  });

  it('finds the closest contour to a query point', () => {
    const contours = [
      { points: [[-1, -1] as [number, number], [-1, -0.5] as [number, number]], closed: false },
      { points: [[1, 1] as [number, number], [1.2, 1] as [number, number]], closed: false },
    ];
    expect(closestContour(contours, 0.9, 1.1)).toBe(contours[1]);
    expect(closestContour(contours, -0.9, -0.8)).toBe(contours[0]);
    expect(closestContour([], 0, 0)).toBeNull();
  });
});
