import { describe, expect, it } from 'vitest';
import { mandelbrotSmooth } from './mandelbrot';
import {
  closestContour,
  connectAndRefineContours,
  contourPerimeter,
  largestContour,
  marchingSquares,
  type Contour,
} from './marchingSquares';

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

  it('bridges and refines multiple disconnected islands into a single watertight closed loop', () => {
    // Field with two high peaks at (-0.8, 0) and (0.8, 0) connected by a curved ridge along y = 0.2*(1 - (x/0.8)^2)
    const field = (x: number, y: number): number => {
      const peakA = 2.0 * Math.exp(-((x + 0.8) ** 2 + y ** 2) / 0.08);
      const peakB = 1.6 * Math.exp(-((x - 0.8) ** 2 + y ** 2) / 0.05);
      const ridgeY = 0.25 * Math.max(0, 1 - (x / 0.8) ** 2);
      const ridge = 0.95 * Math.exp(-((y - ridgeY) ** 2) / 0.008) * Math.max(0, 1 - (x / 0.9) ** 2);
      return Math.max(peakA, peakB, ridge);
    };

    const size = 41;
    const grid = new Float32Array(size * size);
    const step = 4 / (size - 1);
    let idx = 0;
    for (let r = 0; r < size; r++) {
      const y = -2 + r * step;
      for (let c = 0; c < size; c++) {
        const x = -2 + c * step;
        grid[idx++] = field(x, y);
      }
    }

    const raw = marchingSquares(grid, size, size, 1.0);
    expect(raw.length).toBe(2); // Two separate islands before bridging
    expect(largestContour(raw)).not.toBeNull();

    const connected = connectAndRefineContours(raw, 1.0, field, step);
    expect(connected).not.toBeNull();
    expect(connected!.closed).toBe(true);
    expect(contourPerimeter(connected!)).toBeGreaterThan(
      contourPerimeter(raw[0]) + contourPerimeter(raw[1]),
    );

    // Bridge vertices near x = 0 should have climbed onto the curved ridge near y = 0.25
    const midBridgePts = connected!.points.filter(([x]) => Math.abs(x) < 0.15);
    expect(midBridgePts.length).toBeGreaterThan(0);
    for (const [, y] of midBridgePts) {
      expect(y).toBeGreaterThan(0.1);
    }
  });

  it('chains a sequence of islands A -> B -> C sequentially instead of star-connecting C to A', () => {
    // Large island A at x = 0.5, medium island B at x = -0.3 (offset y = 0), small island C at x = -1.0 (offset y = 0.6)
    // C is much closer to B than to A, so C must bridge to B after B bridges to A.
    const makeCircle = (cx: number, cy: number, r: number, n = 16): Contour => {
      const points: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return { points, closed: true };
    };

    const islandA = makeCircle(0.5, 0, 0.35, 24);
    const islandB = makeCircle(-0.3, 0, 0.15, 16);
    const islandC = makeCircle(-0.9, 0.4, 0.1, 12);

    const connected = connectAndRefineContours(
      [islandC, islandA, islandB],
      1.0,
      () => 1.0,
      0.05,
    );
    expect(connected).not.toBeNull();

    // Every adjacent step along the connected loop must be small (<= 0.15), proving no long jump from C to A
    const pts = connected!.points;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(0.16);
    }
  });
});
