import type { Simulation } from './simulation';

/** Numbers stored per particle: x, y, start a, start b. */
export const STRIDE = 4;

/** Which region counts as "still bounded". */
export type Bounds = 'disc' | 'box';

/** True if the point is inside the radius-2 disc, or the <-2,-2> to <2,2> box. */
export function inBounds(bounds: Bounds, x: number, y: number): boolean {
  return bounds === 'disc' ? x * x + y * y < 4 : x > -2 && x < 2 && y < 2 && y > -2;
}

/** Starting points c of the particles. */
export interface Lattice {
  cx: Float64Array;
  cy: Float64Array;
}

/** One starting point per pixel, covering <-2,-2> to <2,2>, row by row. */
export function pixelLattice(width: number, height: number): Lattice {
  const rstep = 4 / (height - 1);
  const cstep = 4 / (width - 1);
  const cx = new Float64Array(width * height);
  const cy = new Float64Array(width * height);
  let i = 0;
  let b = -2;
  for (let r = 0; r < height; r++) {
    let a = -2;
    for (let c = 0; c < width; c++) {
      cx[i] = a;
      cy[i] = b;
      i++;
      a += cstep;
    }
    b += rstep;
  }
  return { cx, cy };
}

/** One starting point at the center of each `step`-pixel cell, row by row. */
export function cellLattice(width: number, height: number, step: number): Lattice {
  const w4 = (width - 1) / 4;
  const h4 = (height - 1) / 4;
  const w2 = width / 2;
  const h2 = height / 2;
  const nx = Math.ceil(width / step);
  const ny = Math.ceil(height / step);
  const cx = new Float64Array(nx * ny);
  const cy = new Float64Array(nx * ny);
  let i = 0;
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      cx[i] = ((c + 0.5) * step - w2) / w4;
      cy[i] = ((r + 0.5) * step - h2) / h4;
      i++;
    }
  }
  return { cx, cy };
}

/**
 * Particles driven by the Mandelbrot iteration z -> z^2 + c, where each
 * particle's c is its own starting point.
 *
 * Keeps the current state and the last `history` states. A particle only
 * moves while it is in bounds, so once it leaves it stays put.
 */
export class ParticleSim implements Simulation {
  /** Number of particles. */
  readonly count: number;
  /** states[0] is the current state, states[k] the state k steps ago. */
  private readonly states: Float64Array[];
  private readonly lattice: Lattice;
  private readonly bounds: Bounds;
  private taken = 0;

  constructor(lattice: Lattice, history: number, bounds: Bounds) {
    this.lattice = lattice;
    this.bounds = bounds;
    this.count = lattice.cx.length;
    this.states = [];
    for (let k = 0; k <= history; k++) {
      this.states.push(new Float64Array(this.count * STRIDE));
    }
    this.reset();
  }

  /** Steps taken since the last reset. */
  get steps(): number {
    return this.taken;
  }

  /** Current state: x, y, a, b per particle (see `STRIDE`). */
  get current(): Float64Array {
    return this.states[0];
  }

  /** State `k` steps ago (k = 0 is the current state). */
  past(k: number): Float64Array {
    return this.states[k];
  }

  /** Put every particle back at its starting point, in all stored states. */
  reset(): void {
    const first = this.states[0];
    for (let i = 0; i < this.count; i++) {
      const o = i * STRIDE;
      first[o] = this.lattice.cx[i];
      first[o + 1] = this.lattice.cy[i];
      first[o + 2] = this.lattice.cx[i];
      first[o + 3] = this.lattice.cy[i];
    }
    for (let k = 1; k < this.states.length; k++) this.states[k].set(first);
    this.taken = 0;
  }

  /** Advance every in-bounds particle by one Mandelbrot step. */
  step(): void {
    const next = this.states.pop()!; // oldest state is recycled as the new one
    const cur = this.states[0];
    for (let o = 0; o < cur.length; o += STRIDE) {
      let x = cur[o];
      let y = cur[o + 1];
      const a = cur[o + 2];
      const b = cur[o + 3];
      if (inBounds(this.bounds, x, y)) {
        const x2 = x * x;
        const y2 = y * y;
        y = 2 * x * y + b;
        x = x2 - y2 + a;
      }
      next[o] = x;
      next[o + 1] = y;
      next[o + 2] = a;
      next[o + 3] = b;
    }
    this.states.unshift(next);
    this.taken++;
  }

  /** Step up to `n` total steps, restarting from the beginning if `n` is lower than now. */
  advanceTo(n: number): void {
    if (n < this.taken) this.reset();
    while (this.taken < n) this.step();
  }

  /** Number of particles currently in bounds. */
  liveCount(): number {
    const cur = this.states[0];
    let n = 0;
    for (let o = 0; o < cur.length; o += STRIDE) {
      if (inBounds(this.bounds, cur[o], cur[o + 1])) n++;
    }
    return n;
  }
}

