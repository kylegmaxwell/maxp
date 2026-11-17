import { inBounds, type Bounds } from './particles';

/**
 * Trace the trajectory (orbit) of a single particle under `z -> z^2 + c`
 * starting at `z_0 = c`.
 *
 * Returns a flat array `[x0, y0, x1, y1, ...]` of up to `steps + 1` points,
 * stopping after the first step that leaves `bounds`.
 */
export function traceOrbit(
  cRe: number,
  cIm: number,
  steps: number,
  bounds: Bounds = 'disc',
): Float64Array {
  const pts: number[] = [cRe, cIm];
  let x = cRe;
  let y = cIm;

  for (let i = 0; i < steps; i++) {
    if (!inBounds(bounds, x, y)) break;
    const x2 = x * x;
    const y2 = y * y;
    const ny = 2 * x * y + cIm;
    const nx = x2 - y2 + cRe;
    pts.push(nx, ny);
    x = nx;
    y = ny;
  }

  return Float64Array.from(pts);
}
