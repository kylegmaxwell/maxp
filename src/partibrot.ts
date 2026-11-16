import type { Renderer } from './renderer';

/** Ease in/out animation retiming (http://gizma.com/easing/). */
function easeInOutQuad(t: number, b: number, c: number, d: number): number {
  t /= d / 2;
  if (t < 1) return (c / 2) * t * t + b;
  t--;
  return (-c / 2) * (t * (t - 2) - 1) + b;
}

/** Quasi-random color from a seed, as [r, g, b] (0 to 255). */
function color(i: number): [number, number, number] {
  return [(i % 200) + 30, ((i + 234567) % 7) * 24 + 24, (i % 57) + 75];
}

const STRIDE = 4; // per particle: x, y, start a, start b

/**
 * Partibrot: particles moving through space driven by the Mandelbrot
 * iteration, ported from kylegmaxwell.github.io/demos/fractal/partibrot.js.
 *
 * Every `steps` values of `iter` the particles take one Mandelbrot step,
 * and the frames in between interpolate with easing.
 * The paint-mode option from the original is not ported.
 */
export class Partibrot implements Renderer {
  private readonly steps = 10;
  private readonly rstep: number;
  private readonly cstep: number;
  private particles: Float64Array;
  private prevParticles: Float64Array;
  private prevIter = 0;
  private t = 0;

  constructor(
    public width: number,
    public height: number,
    public iter: number,
  ) {
    this.rstep = 4 / (height - 1);
    this.cstep = 4 / (width - 1);
    this.particles = new Float64Array(width * height * STRIDE);
    this.prevParticles = new Float64Array(width * height * STRIDE);
    this.initBuffer(this.particles);
    this.initBuffer(this.prevParticles);
    this.checkIter();
  }

  /** Place one particle on every pixel of the <-2,-2> to <2,2> square. */
  private initBuffer(buffer: Float64Array): void {
    let index = 0;
    let b = -2;
    for (let r = 0; r < this.height; r++) {
      let a = -2;
      for (let c = 0; c < this.width; c++) {
        buffer[index] = a;
        buffer[index + 1] = b;
        buffer[index + 2] = a;
        buffer[index + 3] = b;
        index += STRIDE;
        a += this.cstep;
      }
      b += this.rstep;
    }
  }

  /** Advance every particle by one Mandelbrot step. */
  private stepBuffer(inBuf: Float64Array, outBuf: Float64Array): void {
    for (let i = 0; i < inBuf.length; i += STRIDE) {
      let x = inBuf[i];
      let y = inBuf[i + 1];
      const a = inBuf[i + 2];
      const b = inBuf[i + 3];
      const x2 = x * x;
      const y2 = y * y;
      // Only update points that are still bounded
      if (x2 + y2 < 4) {
        y = 2 * x * y + b;
        x = x2 - y2 + a;
      }
      outBuf[i] = x;
      outBuf[i + 1] = y;
      outBuf[i + 2] = a;
      outBuf[i + 3] = b;
    }
  }

  /** Step through iterations and/or interpolations up to `this.iter`. */
  private iterate(): void {
    const iterTmp = Math.floor(this.iter / this.steps);
    const prevIterTmp = Math.floor(this.prevIter / this.steps);

    for (let i = prevIterTmp; i < iterTmp; i++) {
      const tmp = this.particles;
      this.stepBuffer(this.particles, this.prevParticles);
      this.particles = this.prevParticles;
      this.prevParticles = tmp; // reuse the array
    }

    const t = Math.max(Math.min((this.iter % this.steps) / this.steps, 1), 0);
    this.t = easeInOutQuad(t, 0, 1, 1);
    this.prevIter = this.iter;
  }

  /** Handle a change to `iter`, restarting the simulation if it went down. */
  private checkIter(): void {
    if (this.iter < this.prevIter) {
      this.prevIter = 0;
      this.initBuffer(this.particles);
      this.initBuffer(this.prevParticles);
      this.iterate();
    } else if (this.iter > this.prevIter) {
      this.iterate();
    }
  }

  render(pixels: Uint8ClampedArray): void {
    this.checkIter();
    const { width, height, t } = this;
    const h4 = (height - 1) / 4;
    const w4 = (width - 1) / 4;
    const h2 = height / 2;
    const w2 = width / 2;
    const tm = 1 - t;

    // Sum particle colors per pixel (Uint8ClampedArray clamps on write)
    const sum = new Uint32Array(width * height * 3);
    const hit = new Uint8Array(width * height);

    for (let i = 0; i < this.particles.length; i += STRIDE) {
      const x = tm * this.prevParticles[i] + t * this.particles[i];
      const y = tm * this.prevParticles[i + 1] + t * this.particles[i + 1];
      if (x * x + y * y >= 4) continue;

      const rr = Math.floor(y * h4 + h2);
      const cc = Math.floor(x * w4 + w2);
      if (rr < 0 || rr >= height || cc < 0 || cc >= width) continue;

      const pixel = rr * width + cc;
      const [r, g, b] = color(i / STRIDE);
      sum[pixel * 3] += r;
      sum[pixel * 3 + 1] += g;
      sum[pixel * 3 + 2] += b;
      hit[pixel] = 1;
    }

    for (let p = 0; p < width * height; p++) {
      const o = p * 4;
      pixels[o] = hit[p] ? sum[p * 3] : 0;
      pixels[o + 1] = hit[p] ? sum[p * 3 + 1] : 0;
      pixels[o + 2] = hit[p] ? sum[p * 3 + 2] : 0;
      pixels[o + 3] = 255;
    }
  }
}

