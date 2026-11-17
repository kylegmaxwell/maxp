import { Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { catmullRomSegment, easeInOutQuad, splitBezier } from './curves';

/** Evaluate a cubic Bezier at u in [0, 1]. */
function evalBezier(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, u: number): Vector2 {
  const m = 1 - u;
  return new Vector2()
    .addScaledVector(p0, m * m * m)
    .addScaledVector(p1, 3 * m * m * u)
    .addScaledVector(p2, 3 * m * u * u)
    .addScaledVector(p3, u * u * u);
}

describe('splitBezier', () => {
  const p0 = new Vector2(0, 0);
  const p1 = new Vector2(10, 40);
  const p2 = new Vector2(50, -20);
  const p3 = new Vector2(80, 10);

  it('at t = 0 and t = 1 collapses one side and preserves the full curve on the other', () => {
    const [l0, r0] = splitBezier(p0, p1, p2, p3, 0);
    expect(l0[0]).toEqual(p0);
    expect(l0[3]).toEqual(p0);
    expect(r0).toEqual([p0, p1, p2, p3]);

    const [l1, r1] = splitBezier(p0, p1, p2, p3, 1);
    expect(l1).toEqual([p0, p1, p2, p3]);
    expect(r1[0]).toEqual(p3);
    expect(r1[3]).toEqual(p3);
  });

  it('splits into two sub-curves that lie exactly on the original fixed Bezier', () => {
    const t = 0.37;
    const [left, right] = splitBezier(p0, p1, p2, p3, t);

    const join = evalBezier(p0, p1, p2, p3, t);
    expect(left[3].x).toBeCloseTo(join.x);
    expect(left[3].y).toBeCloseTo(join.y);
    expect(right[0].x).toBeCloseTo(join.x);
    expect(right[0].y).toBeCloseTo(join.y);

    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const lPt = evalBezier(left[0], left[1], left[2], left[3], u);
      const origL = evalBezier(p0, p1, p2, p3, t * u);
      expect(lPt.x).toBeCloseTo(origL.x);
      expect(lPt.y).toBeCloseTo(origL.y);

      const rPt = evalBezier(right[0], right[1], right[2], right[3], u);
      const origR = evalBezier(p0, p1, p2, p3, t + (1 - t) * u);
      expect(rPt.x).toBeCloseTo(origR.x);
      expect(rPt.y).toBeCloseTo(origR.y);
    }
  });
});

describe('catmullRomSegment', () => {
  it('returns null when points are within minDelta', () => {
    const p = new Vector2(5, 5);
    expect(catmullRomSegment(p, p, new Vector2(10, 10), new Vector2(20, 20), 1)).toBeNull();
  });

  it('returns endpoints matching v1 and v2', () => {
    const v0 = new Vector2(0, 0);
    const v1 = new Vector2(10, 0);
    const v2 = new Vector2(20, 10);
    const v3 = new Vector2(30, 10);
    const seg = catmullRomSegment(v0, v1, v2, v3, 1);
    expect(seg).not.toBeNull();
    expect(seg![0]).toEqual(v1);
    expect(seg![3]).toEqual(v2);
  });
});

describe('easeInOutQuad', () => {
  it('hits start, midpoint, and end symmetrically', () => {
    expect(easeInOutQuad(0, 0, 1, 1)).toBe(0);
    expect(easeInOutQuad(0.5, 0, 1, 1)).toBe(0.5);
    expect(easeInOutQuad(1, 0, 1, 1)).toBe(1);
    // Symmetric around 0.5
    expect(easeInOutQuad(0.25, 0, 1, 1) + easeInOutQuad(0.75, 0, 1, 1)).toBeCloseTo(1);
  });
});

