import type { Vector2 } from 'three';

/** Four control points `[p0, c1, c2, p1]` of a cubic Bezier segment. */
export type CubicBezier = [Vector2, Vector2, Vector2, Vector2];

/** Ease in/out quadratic retiming (http://gizma.com/easing/). */
export function easeInOutQuad(t: number, b: number, c: number, d: number): number {
  t /= d / 2;
  if (t < 1) return (c / 2) * t * t + b;
  t--;
  return (-c / 2) * (t * (t - 2) - 1) + b;
}

/** Split a cubic Bezier at `t` in [0, 1] using de Casteljau's algorithm. */
export function splitBezier(
  p0: Vector2,
  p1: Vector2,
  p2: Vector2,
  p3: Vector2,
  t: number,
): [CubicBezier, CubicBezier] {
  const q0 = p0.clone().lerp(p1, t);
  const q1 = p1.clone().lerp(p2, t);
  const q2 = p2.clone().lerp(p3, t);
  const r0 = q0.clone().lerp(q1, t);
  const r1 = q1.clone().lerp(q2, t);
  const s = r0.clone().lerp(r1, t);
  return [
    [p0, q0, r0, s],
    [s, r1, q2, p3],
  ];
}

/**
 * Compute Catmull-Rom cubic Bezier control points `[v1, cv1, cv2, v2]`
 * for the segment between `v1` and `v2`, or `null` if any segment distance is `<= minDelta`.
 */
export function catmullRomSegment(
  v0: Vector2,
  v1: Vector2,
  v2: Vector2,
  v3: Vector2,
  minDelta = 0,
): CubicBezier | null {
  const d12 = v1.distanceTo(v2);
  const d02 = v0.distanceTo(v2);
  const d13 = v1.distanceTo(v3);
  const d01 = v0.distanceTo(v1);
  if (d01 <= minDelta || d12 <= minDelta || d02 <= minDelta || d13 <= minDelta) {
    return null;
  }

  const tan02 = v2.clone().sub(v0).multiplyScalar((0.5 * d12) / d02);
  const tan31 = v1.clone().sub(v3).multiplyScalar((0.5 * d12) / d13);
  return [v1, v1.clone().add(tan02), v2.clone().add(tan31), v2];
}

