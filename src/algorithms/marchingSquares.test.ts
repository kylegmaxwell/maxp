import { describe, expect, it } from 'vitest';
import { mandelbrotSmooth, smoothEscape } from './mandelbrot';
import {
  BandContourGrid,
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

  it('BandContourGrid matches full dense Marching Squares while evaluating only the active band', () => {
    const field = (re: number, im: number) => 2.5 - Math.hypot(re - 0.2, im + 0.1);
    const band = new BandContourGrid(field, 16, 4); // 65x65 fine grid
    const bandContours = band.extract(1.5);

    const fullGrid = new Float32Array(65 * 65);
    const step = 4 / 64;
    for (let r = 0; r < 65; r++) {
      for (let c = 0; c < 65; c++) {
        fullGrid[r * 65 + c] = field(-2 + c * step, -2 + r * step);
      }
    }
    const fullContours = marchingSquares(fullGrid, 65, 65, 1.5);

    expect(bandContours).toHaveLength(1);
    expect(fullContours).toHaveLength(1);
    expect(bandContours[0].points.length).toBe(fullContours[0].points.length);
    expect(contourPerimeter(bandContours[0])).toBeCloseTo(Math.PI * 2, 2);

    // Most fine grid entries outside the active band should remain unevaluated (NaN)
    let evaluated = 0;
    for (let i = 0; i < band.fineValues.length; i++) {
      if (!Number.isNaN(band.fineValues[i])) evaluated++;
    }
    expect(evaluated).toBeLessThan(band.fineValues.length * 0.6);
  });

  it('produces a single clean radius-2 circle at Mandelbrot level 1 with no interior diamond', () => {
    const maxIter = 52;
    const field = (re: number, im: number) => smoothEscape(re, im, maxIter);
    const band = new BandContourGrid(field, 64, 4);
    const raw = band.extract(1);
    const connected = connectAndRefineContours(raw, 1, field, 4 / band.fineCells);

    expect(connected).not.toBeNull();
    expect(connected!.closed).toBe(true);
    for (const [x, y] of connected!.points) {
      expect(Math.hypot(x, y)).toBeGreaterThan(1.95);
      expect(Math.hypot(x, y)).toBeLessThan(2.05);
    }
  });

  it('produces no long cross-set chord segments on Mandelbrot levels 10..50', () => {
    const maxIter = 55;
    const field = (re: number, im: number) => smoothEscape(re, im, maxIter);
    const band = new BandContourGrid(field, 64, 4);

    for (const level of [10, 25, 40, 50]) {
      const raw = band.extract(level);
      const connected = connectAndRefineContours(raw, level, field, 4 / band.fineCells);
      expect(connected).not.toBeNull();
      const pts = connected!.points;
      let maxSeg = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        const seg = Math.hypot(x1 - x0, y1 - y0);
        if (seg > maxSeg) maxSeg = seg;
      }
      expect(maxSeg).toBeLessThan(0.15);
    }
  });

  it('BFS border-crossing propagation follows a thin sub-coarse filament across coarse cell borders', () => {
    // Narrow horizontal ridge along y = 0.12 (between coarse grid lines on an 8x8 coarse grid where step = 0.5)
    // extending from x = -0.8 to x = 0.8 so its coarse corners all fall outside the narrow ridge.
    const field = (x: number, y: number): number => {
      const mainHub = 15 * Math.exp(-((x + 0.5) ** 2 + (y - 0.12) ** 2) / 0.12);
      const thinSpike = x >= -0.5 && x <= 0.8 ? 12 * Math.exp(-((y - 0.12) ** 2) / 0.002) : 0;
      return Math.max(mainHub, thinSpike);
    };

    const band = new BandContourGrid(field, 8, 8);
    const contours = band.extract(10);
    expect(contours).toHaveLength(1);
    expect(contours[0].closed).toBe(true);

    // Contour must reach all the way to the tip of the thin spike at x ≈ 0.8 without clipping
    const maxX = Math.max(...contours[0].points.map(([x]) => x));
    expect(maxX).toBeGreaterThan(0.75);
  });
});
