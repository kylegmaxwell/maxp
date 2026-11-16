import type { ScalarGrid } from './simulation';

/**
 * Buddhabrot: a histogram of the points visited by orbits that escape,
 * ported from kylegmaxwell.github.io/demos/fractal/buddhabrot.js.
 */

/**
 * Count how many orbit positions land in each pixel.
 * Every pixel is used as a starting point c, and its orbit is followed
 * until it leaves the radius-2 disc or `iter` steps have been taken.
 * @returns width * height raw visit counts, row by row
 */
export function buddhabrotCounts(width: number, height: number, iter: number): Float64Array {
  const h4 = (height - 1) / 4;
  const w4 = (width - 1) / 4;
  const h2 = height / 2;
  const w2 = width / 2;
  const rstep = 4 / (height - 1);
  const cstep = 4 / (width - 1);
  const count = new Float64Array(width * height);

  let b = -2;
  for (let r = 0; r < height; r++) {
    let a = -2;
    for (let c = 0; c < width; c++) {
      let x = a;
      let y = b;
      let x2 = a * a;
      let y2 = b * b;

      for (let i = 0; i < iter && x2 + y2 < 4; i++) {
        const rr = Math.floor(y * h4 + h2);
        const cc = Math.floor(x * w4 + w2);
        if (rr >= 0 && rr < height && cc >= 0 && cc < width) {
          count[rr * width + cc]++;
        }
        y = 2 * x * y + b;
        x = x2 - y2 + a;
        x2 = x * x;
        y2 = y * y;
      }
      a += cstep;
    }
    b += rstep;
  }
  return count;
}

/** `ScalarGrid` simulation of the Buddhabrot histogram, log-scaled to [0, 1]. */
export class BuddhabrotGrid implements ScalarGrid {
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
    const count = buddhabrotCounts(this.width, this.height, n);
    let max = 0;
    for (let i = 0; i < count.length; i++) {
      count[i] = Math.log(count[i] + 1);
      if (count[i] > max) max = count[i];
    }
    for (let i = 0; i < count.length; i++) {
      this.values[i] = max > 0 ? count[i] / max : 0;
    }
  }
}

