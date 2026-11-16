import type { Renderer } from './renderer';

/**
 * Escape-time Mandelbrot renderer, ported from
 * kylegmaxwell.github.io/demos/fractal/mandelbrot.js.
 *
 * The viewport is the square from <-2,-2> to <2,2>.
 */
export class Mandelbrot implements Renderer {
  constructor(
    public width: number,
    public height: number,
    public iter: number,
  ) {}

  /** Write grayscale RGBA pixel data (0 to 255) into `pixels`. */
  render(pixels: Uint8ClampedArray): void {
    const rstep = 4 / (this.height - 1);
    const cstep = 4 / (this.width - 1);
    let index = 0;
    let b = -2; // imaginary part of c, per row

    for (let r = 0; r < this.height; r++) {
      let a = -2; // real part of c, per column
      for (let c = 0; c < this.width; c++) {
        let x = 0;
        let y = 0;
        let shade = 0; // points that never escape are black

        for (let i = 0; i < this.iter; i++) {
          const x2 = x * x;
          const y2 = y * y;
          if (x2 + y2 > 4) {
            // Diverged: brighter the longer it took to escape
            shade = Math.pow(i / this.iter, 0.15);
            break;
          }
          y = 2 * x * y + b;
          x = x2 - y2 + a;
        }

        const v = shade * 255;
        pixels[index] = v;
        pixels[index + 1] = v;
        pixels[index + 2] = v;
        pixels[index + 3] = 255;
        a += cstep;
        index += 4;
      }
      b += rstep;
    }
  }
}

