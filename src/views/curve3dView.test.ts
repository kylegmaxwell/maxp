import { describe, expect, it } from 'vitest';
import {
  buildLevelStack,
  buildTerracedMeshGeometry,
  contourToPositions,
  createReferenceAxes,
  levelToDepth,
} from './curve3dView';

describe('curve3dView', () => {
  it('maps levels 1:1 up to 5 and 10:1 above 5', () => {
    expect(levelToDepth(2)).toBe(2);
    expect(levelToDepth(5)).toBe(5);
    expect(levelToDepth(15)).toBe(6);
    expect(levelToDepth(25)).toBe(7);
  });

  it('converts a 2D contour into 3D [x=re, y=baseHeight-depth*heightScale, z=im] positions', () => {
    const contour = {
      points: [
        [-2, -1] as [number, number],
        [1.5, 0.5] as [number, number],
      ],
      closed: true,
    };
    const pos = contourToPositions(contour, 15, 0.05, 1.3);
    // level 15 -> depth 6 -> y = 1.3 - 0.30 = 1.0
    expect(pos).toEqual(new Float32Array([-2, 1.0, -1, 1.5, 1.0, 0.5]));
  });

  it('drops levels 0 and 1 and samples 2..5 by 1 then steps of 10', () => {
    const stack = buildLevelStack(28, 50, 0.5);
    expect(stack.map((e) => e.level)).toEqual([2, 3, 4, 5, 15, 25, 28]);
    for (const entry of stack) {
      expect(entry.contour.closed).toBe(true);
      expect(entry.contour.points.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('includes the fractional top level when maxLevel is non-integer', () => {
    const stack = buildLevelStack(2.5, 50, 0.5);
    expect(stack.map((e) => e.level)).toEqual([2, 2.5]);
  });

  it('creates a reference axes group containing grid and X/Y/Z axis lines', () => {
    const axes = createReferenceAxes();
    expect(axes.children.length).toBe(4); // GridHelper + 3 axis lines
  });

  it('builds a sharp terraced mesh for level 3 with 1 cutout and 2 outer bands (including bottom floor)', () => {
    const outer = {
      points: [
        [-2, -2] as [number, number],
        [2, -2] as [number, number],
        [2, 2] as [number, number],
        [-2, 2] as [number, number],
      ],
      closed: true,
    };
    const inner = {
      points: [
        [-1, -1] as [number, number],
        [1, -1] as [number, number],
        [1, 1] as [number, number],
        [-1, 1] as [number, number],
      ],
      closed: true,
    };
    const geom = buildTerracedMeshGeometry(
      [
        { level: 2, contour: outer },
        { level: 3, contour: inner },
      ],
      0.1,
      1.0,
    );
    const pos = geom.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);

    // Level 2 is at y = 0.8, Level 3 cutout floor is at y = 0.7, solid outer base is at y = 0.6
    const yValues = new Set<number>();
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = Math.round(pos.getY(i) * 1e5) / 1e5;
      yValues.add(y);
      minY = Math.min(minY, y);
    }
    expect(minY).toBeCloseTo(0.6, 5);
    expect([...yValues].sort((a, b) => a - b)).toEqual([0.6, 0.7, 0.8]);

    // Every triangle has identical vertex colors across its 3 corners (no interpolation)
    const col = geom.getAttribute('color');
    for (let i = 0; i < col.count; i += 3) {
      expect(col.getX(i)).toBeCloseTo(col.getX(i + 1), 6);
      expect(col.getX(i)).toBeCloseTo(col.getX(i + 2), 6);
    }
  });

  it('keeps the interior cutout open for Mandelbrot level stack 2..10', () => {
    const stack = buildLevelStack(10, 90, 1);
    expect(stack.map((e) => e.level)).toEqual([2, 3, 4, 5, 10]);

    const geom = buildTerracedMeshGeometry(stack, 0.08, 1.3);
    const pos = geom.getAttribute('position');

    // No triangle on any terrace above the deepest level (levels 2, 3, 4, 5) should cover the origin (0, 0)
    for (let k = 0; k < stack.length - 1; k++) {
      const terraceY = 1.3 - (2 + k) * 0.08;
      let originCovered = false;
      for (let i = 0; i < pos.count; i += 3) {
        const y0 = pos.getY(i);
        const y1 = pos.getY(i + 1);
        const y2 = pos.getY(i + 2);
        if (
          Math.abs(y0 - terraceY) > 1e-4 ||
          Math.abs(y1 - terraceY) > 1e-4 ||
          Math.abs(y2 - terraceY) > 1e-4
        ) {
          continue;
        }
        const ax = pos.getX(i), az = pos.getZ(i);
        const bx = pos.getX(i + 1), bz = pos.getZ(i + 1);
        const cx = pos.getX(i + 2), cz = pos.getZ(i + 2);
        const d1 = -ax * (bz - az) + az * (bx - ax);
        const d2 = -bx * (cz - bz) + bz * (cx - bx);
        const d3 = -cx * (az - cz) + cz * (ax - cx);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(hasNeg && hasPos)) {
          originCovered = true;
          break;
        }
      }
      expect(originCovered, `terrace k=${k} (level ${stack[k].level}) covered origin`).toBe(false);
    }
  });
});
