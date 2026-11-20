import { describe, expect, it } from 'vitest';
import {
  buildLevelStack,
  buildTerracedMeshGeometry,
  contourToPositions,
  createReferenceAxes,
  levelToDepth,
} from './curve3dView';

describe('curve3dView', () => {
  it('maps levels 1:1 up to 6 and 10:1 above 6', () => {
    expect(levelToDepth(1)).toBe(1);
    expect(levelToDepth(6)).toBe(6);
    expect(levelToDepth(16)).toBe(7);
    expect(levelToDepth(26)).toBe(8);
  });

  it('converts a 2D contour into 3D [x=re, y=baseHeight-depth*heightScale, z=im] positions', () => {
    const contour = {
      points: [
        [-2, -1] as [number, number],
        [1.5, 0.5] as [number, number],
      ],
      closed: true,
    };
    const pos = contourToPositions(contour, 16, 0.05, 1.3);
    // level 16 -> depth 7 -> y = 1.3 - 0.35 = 0.95
    expect(pos).toEqual(new Float32Array([-2, 0.95, -1, 1.5, 0.95, 0.5]));
  });

  it('drops levels 0 and 1 and samples 2..6 by 1 then steps of 10', () => {
    const stack = buildLevelStack(28, 50, 0.5);
    expect(stack.map((e) => e.level)).toEqual([2, 3, 4, 5, 6, 16, 26, 28]);
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

  it('builds a sharp terraced mesh with bottom cap one level below the deepest contour', () => {
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
    // Deepest contour is level 3 -> y = 1.0 - 0.3 = 0.7; bottom cap is one step below at y = 0.6
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
    }
    expect(minY).toBeCloseTo(0.6, 5);
  });
});
