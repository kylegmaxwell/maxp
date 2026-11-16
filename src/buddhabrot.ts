import type { Renderer } from './renderer';

/**
 * Buddhabrot: a histogram of the points visited by orbits that escape,
 * ported from kylegmaxwell.github.io/demos/fractal/buddhabrot.js.
 *
 * The paint-mode option from the original is not ported.
 */
export class Buddhabrot implements Renderer {
  constructor(
    public width: number,
    public height: number,
    public iter: number,
  ) {}

  render(pixels: Uint8ClampedArray): void {
    const { width, height } = this;
    const h4 = (height - 1) / 4;
    const w4 = (width - 1) / 4;
    const h2 = height / 2;
    const w2 = width / 2;
    const rstep = 4 / (height - 1);
    const cstep = 4 / (width - 1);
    const count = new Float64Array(width * height);

    // For each starting point, walk its orbit and accumulate visit counts
    let b = -2;
    for (let r = 0; r < height; r++) {
      let a = -2;
      for (let c = 0; c < width; c++) {
        let x = a;
        let y = b;
        let x2 = a * a;
        let y2 = b * b;

        for (let i = 0; i < this.iter && x2 + y2 < 4; i++) {
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

    // Log-scale the counts and find the maximum so they can be normalized
    let max = 0;
    for (let i = 0; i < count.length; i++) {
      count[i] = Math.log(count[i] + 1);
      if (count[i] > max) max = count[i];
    }

    for (let i = 0; i < count.length; i++) {
      const v = max > 0 ? (count[i] / max) * 255 : 0;
      const p = i * 4;
      pixels[p] = v;
      pixels[p + 1] = v;
      pixels[p + 2] = v;
      pixels[p + 3] = 255;
    }
  }
}

