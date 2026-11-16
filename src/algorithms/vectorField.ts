import { cellLattice, inBounds, ParticleSim, STRIDE } from './particles';
import type { Simulation } from './simulation';

/**
 * Vector field of displacements from each cell center `c` to its Mandelbrot
 * orbit position `z_n` after `iter` iterations. Escaped particles are zeroed out.
 */
export class VectorFieldSim implements Simulation {
  /** Grid size in cells. */
  readonly cols: number;
  readonly rows: number;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  readonly prevFx: Float64Array;
  readonly prevFy: Float64Array;

  private readonly sim: ParticleSim;
  private taken = 0;

  /** @param spacing Pixels per grid cell (one vector per cell) */
  constructor(
    readonly width: number,
    readonly height: number,
    readonly spacing = 8,
  ) {
    this.cols = Math.ceil(width / spacing);
    this.rows = Math.ceil(height / spacing);
    this.sim = new ParticleSim(cellLattice(width, height, spacing), 1, 'disc');

    const cells = this.cols * this.rows;
    this.fx = new Float64Array(cells);
    this.fy = new Float64Array(cells);
    this.prevFx = new Float64Array(cells);
    this.prevFy = new Float64Array(cells);
  }

  /** Steps taken since the last reset. */
  get steps(): number {
    return this.taken;
  }

  /** Number of particles still inside the radius-2 disc. */
  liveCount(): number {
    return this.sim.liveCount();
  }

  /** Total number of simulated particles. */
  get particleCount(): number {
    return this.sim.count;
  }

  /** Reset the field and underlying particles back to step 0. */
  reset(): void {
    this.sim.reset();
    this.fx.fill(0);
    this.fy.fill(0);
    this.prevFx.fill(0);
    this.prevFy.fill(0);
    this.taken = 0;
  }

  /** Simulate up to `iter` iterations, restarting if `iter` is lower than now. */
  advanceTo(iter: number): void {
    if (iter < this.taken) this.reset();
    while (this.taken < iter) {
      this.prevFx.set(this.fx);
      this.prevFy.set(this.fy);
      this.sim.step();
      this.update();
      this.taken++;
    }
  }

  /** Update each cell's displacement vector from the latest step. */
  private update(): void {
    const cur = this.sim.current;
    const prev = this.sim.past(1);

    for (let i = 0; i < this.sim.count; i++) {
      const o = i * STRIDE;
      if (!inBounds('disc', prev[o], prev[o + 1])) continue; // already escaped

      const nx = cur[o];
      const ny = cur[o + 1];
      if (!inBounds('disc', nx, ny)) {
        this.fx[i] = 0;
        this.fy[i] = 0;
        continue;
      }

      this.fx[i] = nx - cur[o + 2];
      this.fy[i] = ny - cur[o + 3];
    }
  }
}
