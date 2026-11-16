/** Common interface for step-based or iteration-based simulations. */
export interface Simulation {
  /** Current step or iteration count since the last reset. */
  readonly steps: number;
  /** Advance (or re-simulate from 0 if `n < steps`) to step `n`. */
  advanceTo(n: number): void;
  /** Reset the simulation back to step 0. */
  reset(): void;
}

/** A 2D scalar grid in [0, 1] produced by a `Simulation`. */
export interface ScalarGrid extends Simulation {
  readonly width: number;
  readonly height: number;
  /** Normalized cell values in [0, 1], row by row (`width * height`). */
  readonly values: Float32Array;
}

