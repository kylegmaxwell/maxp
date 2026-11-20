import { describe, expect, it } from 'vitest';
import {
  buildLevelStack,
  buildTerracedMeshGeometry,
  contourToPositions,
  createReferenceAxes,
  geometryToBinarySTL,
  levelToDepth,
} from './curve3dView';

describe('curve3dView', () => {
  it('maps levels 1:1 up to 5 and 10:1 above 5', () => {
    expect(levelToDepth(2)).toBe(2);
    expect(levelToDepth(5)).toBe(5);
    expect(levelToDepth(15)).toBe(6);
    expect(levelToDepth(25)).toBe(7);
  });

  it('converts a 2D contour into metric 3D [x=(re-centerRe)*mm, y=baseHeight-depth*heightScale, z=im*mm] positions', () => {
    const contour = {
      points: [
        [-2, -1] as [number, number],
        [1.0, 0.5] as [number, number],
      ],
      closed: true,
    };
    const pos = contourToPositions(contour, 15, 2.0, 45, 50, -0.5);
    // level 15 -> depth 6 -> y = 45 - 12 = 33; re=-2 -> (-2 - -0.5)*50 = -75, re=1 -> (1 - -0.5)*50 = 75
    expect(pos).toEqual(new Float32Array([-75, 33, -50, 75, 33, 25]));
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

  it('creates a metric reference group with build plate, test print line, grid, X/Y/Z axes, and US Quarter', () => {
    const axes = createReferenceAxes();
    expect(axes.children.length).toBe(7);
  });

  it('builds a sharp terraced mesh sitting on y=0 with dedicated outer rim and uniform layer heights', () => {
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
    // 2 levels + 1 dedicated outer rim = 3 rings -> y values at 0, 2, 4, 6 mm
    const geom = buildTerracedMeshGeometry(
      [
        { level: 2, contour: outer },
        { level: 3, contour: inner },
      ],
      2.0,
      10,
      0,
      2.0,
    );
    const pos = geom.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);

    const yValues = new Set<number>();
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = Math.round(pos.getY(i) * 1e5) / 1e5;
      yValues.add(y);
      minY = Math.min(minY, y);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect([...yValues].sort((a, b) => a - b)).toEqual([0, 2, 4, 6]);

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

    const geom = buildTerracedMeshGeometry(stack, 2.0, 50, -0.5, 2.0);
    const pos = geom.getAttribute('position');

    // Complex (0, 0) maps to metric (x = 25, z = 0)
    const cx0 = 25;
    const cz0 = 0;
    const totalRings = stack.length + 1; // +1 for outer rim

    // No triangle on any terrace above the deepest level should cover the interior center (25, 0)
    for (let k = 0; k < totalRings - 1; k++) {
      const terraceY = (totalRings - k) * 2.0;
      let centerCovered = false;
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
        const ax = pos.getX(i) - cx0, az = pos.getZ(i) - cz0;
        const bx = pos.getX(i + 1) - cx0, bz = pos.getZ(i + 1) - cz0;
        const cx = pos.getX(i + 2) - cx0, cz = pos.getZ(i + 2) - cz0;
        const d1 = -ax * (bz - az) + az * (bx - ax);
        const d2 = -bx * (cz - bz) + bz * (cx - bx);
        const d3 = -cx * (az - cz) + cz * (ax - cx);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(hasNeg && hasPos)) {
          centerCovered = true;
          break;
        }
      }
      expect(centerCovered, `terrace k=${k} at y=${terraceY} covered center`).toBe(false);
    }
  });

  it('exports a Z-up binary STL sitting on Z=0 for Bambu Studio', () => {
    const outer = {
      points: [
        [-2, -2] as [number, number],
        [2, -2] as [number, number],
        [2, 2] as [number, number],
        [-2, 2] as [number, number],
      ],
      closed: true,
    };
    const geom = buildTerracedMeshGeometry([{ level: 2, contour: outer }], 2.0, 10, 0, 2.0);
    const numTris = Math.floor(geom.getAttribute('position').count / 3);
    const buffer = geometryToBinarySTL(geom);

    expect(buffer.byteLength).toBe(84 + numTris * 50);
    const view = new DataView(buffer);
    expect(view.getUint32(80, true)).toBe(numTris);

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let t = 0; t < numTris; t++) {
      const base = 84 + t * 50;
      for (const vOff of [12, 24, 36]) {
        const z = view.getFloat32(base + vOff + 8, true);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    expect(minZ).toBeCloseTo(0, 5);
    expect(maxZ).toBeCloseTo(4.0, 5);
  });
});
