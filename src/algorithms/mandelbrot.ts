import type { ScalarGrid } from './simulation';

/**
 * Escape-time Mandelbrot, ported from
 * kylegmaxwell.github.io/demos/fractal/mandelbrot.js.
 * The viewport is the square from <-2,-2> to <2,2>.
 */

/**
 * Iteration at which the point c = cRe + cIm*i escapes (|z|^2 > 4),
 * or -1 if it has not escaped within `iter` iterations.
 */
export function escapeIteration(cRe: number, cIm: number, iter: number): number {
  let x = 0;
  let y = 0;
  for (let i = 0; i < iter; i++) {
    const x2 = x * x;
    const y2 = y * y;
    if (x2 + y2 > 4) return i;
    y = 2 * x * y + cIm;
    x = x2 - y2 + cRe;
  }
  return -1;
}

/**
 * Continuous escape field for c = cRe + cIm*i up to `iter` steps.
 * - For points that escape at step `i` (`1 <= i < iter`), returns `i - frac` in `[i - 1, i)`,
 *   equaling `i` right on the discrete bailout boundary `|z_i| = 2`.
 * - For points still bounded at `i = iter - 1` (`|z_{iter-1}| <= 2`), smoothly continues
 *   into `[iter - 1, iter]` via `(iter - 1) + (1 - |z_{iter-1}| / 2)`.
 */
export function smoothEscape(cRe: number, cIm: number, iter: number): number {
  if (iter <= 0) return 0;
  let x = 0;
  let y = 0;
  let lastR2 = 0;
  for (let i = 0; i < iter; i++) {
    const x2 = x * x;
    const y2 = y * y;
    const r2 = x2 + y2;
    if (r2 > 4) {
      const logZ = 0.5 * Math.log(r2);
      const frac = Math.min(1, Math.max(0, Math.log(logZ / Math.LN2) / Math.LN2));
      return i - frac;
    }
    lastR2 = r2;
    y = 2 * x * y + cIm;
    x = x2 - y2 + cRe;
  }
  return iter - 1 + (1 - Math.sqrt(lastR2) / 2);
}

/**
 * Continuous escape value for every grid point in <-2,-2> to <2,2>, row by row.
 */
export function mandelbrotSmooth(width: number, height: number, iter: number): Float32Array {
  const out = new Float32Array(width * height);
  const rstep = 4 / (height - 1);
  const cstep = 4 / (width - 1);
  let index = 0;
  let b = -2;
  for (let r = 0; r < height; r++) {
    let a = -2;
    for (let c = 0; c < width; c++) {
      out[index++] = smoothEscape(a, b, iter);
      a += cstep;
    }
    b += rstep;
  }
  return out;
}

/**
 * Escape iteration for every pixel, row by row (see `escapeIteration`).
 * @returns width * height values; -1 where the point never escaped
 */
export function mandelbrotEscape(width: number, height: number, iter: number): Int32Array {
  const out = new Int32Array(width * height);
  const rstep = 4 / (height - 1);
  const cstep = 4 / (width - 1);
  let index = 0;
  let b = -2;
  for (let r = 0; r < height; r++) {
    let a = -2;
    for (let c = 0; c < width; c++) {
      out[index++] = escapeIteration(a, b, iter);
      a += cstep;
    }
    b += rstep;
  }
  return out;
}

/** `ScalarGrid` simulation of Mandelbrot escape iterations, normalized to [0, 1]. */
export class MandelbrotGrid implements ScalarGrid {
  readonly values: Float32Array;
  private currentIter = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.values = new Float32Array(width * height);
  }

  get steps(): number {
    return this.currentIter;
  }

  reset(): void {
    this.values.fill(0);
    this.currentIter = 0;
  }

  advanceTo(n: number): void {
    if (n === this.currentIter) return;
    this.currentIter = n;
    const escape = mandelbrotEscape(this.width, this.height, n);
    for (let i = 0; i < escape.length; i++) {
      this.values[i] = escape[i] < 0 ? 0 : Math.pow(escape[i] / n, 0.15);
    }
  }
}

