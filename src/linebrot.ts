import { Vector2 } from 'three';
import type { Renderable } from './renderer';

const STRIDE = 4; // per particle: x, y, start a, start b

/** Quasi-random color from a seed, as [r, g, b] (0 to 255). */
function color(i: number): [number, number, number] {
  return [(i % 200) + 30, ((i + 234567) % 7) * 24 + 24, (i % 57) + 75];
}

/** True if the point is inside the open square from <-2,-2> to <2,2>. */
function inBounds(x: number, y: number): boolean {
  return x > -2 && x < 2 && y < 2 && y > -2;
}

/**
 * Linebrot: draws smooth curves through successive Mandelbrot iterations
 * of each point, ported from kylegmaxwell.github.io/demos/fractal/linebrot.js.
 *
 * The paint-mode option and the unused arc code from the original are not ported.
 */
export class Linebrot implements Renderable {
  /** Only draw every skip-th line. */
  private readonly skip = 7;
  /** Iterations per frame. */
  private readonly steps = 1;
  /** Particles must move more than this many pixels or they are ignored. */
  private readonly delta = 1;

  private readonly h4: number;
  private readonly w4: number;
  private readonly h2: number;
  private readonly w2: number;
  private readonly rstep: number;
  private readonly cstep: number;

  // Current and the three previous particle states
  private particles: Float64Array;
  private prevParticles: Float64Array;
  private prevPrevParticles: Float64Array;
  private prevPrevPrevParticles: Float64Array;
  private prevIter = 0;
  private skipCache: number[] | null = null;

  constructor(
    public width: number,
    public height: number,
    public iter: number,
  ) {
    this.h4 = (height - 1) / 4;
    this.w4 = (width - 1) / 4;
    this.h2 = height / 2;
    this.w2 = width / 2;
    this.rstep = 4 / (height - 1);
    this.cstep = 4 / (width - 1);

    const size = width * height * STRIDE;
    this.particles = new Float64Array(size);
    this.prevParticles = new Float64Array(size);
    this.prevPrevParticles = new Float64Array(size);
    this.prevPrevPrevParticles = new Float64Array(size);
    this.resetBuffers();
    this.checkIter();
  }

  /** Put every particle at its starting point, in all four states. */
  private resetBuffers(): void {
    this.initBuffer(this.particles);
    this.prevParticles.set(this.particles);
    this.prevPrevParticles.set(this.particles);
    this.prevPrevPrevParticles.set(this.particles);
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
      // Only update points that are still in bounds
      if (inBounds(x, y)) {
        y = 2 * x * y + b;
        x = x2 - y2 + a;
      }
      outBuf[i] = x;
      outBuf[i + 1] = y;
      outBuf[i + 2] = a;
      outBuf[i + 3] = b;
    }
  }

  /** Step through iterations up to `this.iter`. */
  private iterate(): void {
    const iterTmp = this.iter * this.steps;
    const prevIterTmp = this.prevIter * this.steps;

    for (let i = prevIterTmp; i < iterTmp; i++) {
      this.prevPrevPrevParticles.set(this.prevPrevParticles);
      this.prevPrevParticles.set(this.prevParticles);
      const tmp = this.particles;
      this.stepBuffer(this.particles, this.prevParticles);
      this.particles = this.prevParticles;
      this.prevParticles = tmp; // reuse the array
    }
    this.prevIter = this.iter;
  }

  /** Handle a change to `iter`, restarting the simulation if it went down. */
  private checkIter(): void {
    if (this.iter < this.prevIter) {
      this.prevIter = 0;
      this.skipCache = null;
      this.resetBuffers();
      this.iterate();
    } else if (this.iter > this.prevIter) {
      this.iterate();
    }
  }

  /** Convert a point in Mandelbrot space to a screen-space position. */
  private toPixel(x: number, y: number): Vector2 {
    return new Vector2(
      Math.floor(x * this.w4 + this.w2),
      Math.floor(y * this.h4 + this.h2),
    );
  }

  /**
   * Implements `Renderable.render`.
   * Draws the curves between the current and previous states.
   */
  render(ctx: CanvasRenderingContext2D): void {
    this.checkIter();

    // Partially occlude the previous frame
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, this.width, this.height);

    if (!this.skipCache) {
      // First draw: pick which particles to draw, then remember them
      const cache: number[] = [];
      let skipI = 0;
      for (let p = 0; p < this.particles.length / STRIDE; p++) {
        if (!this.isActive(p)) continue;
        if (skipI % this.skip === 0) {
          this.drawOne(ctx, p, cache.length);
          cache.push(p);
        }
        skipI++;
      }
      this.skipCache = cache;
    } else {
      for (let i = 0; i < this.skipCache.length; i++) {
        this.drawOne(ctx, this.skipCache[i], i);
      }
    }
  }

  /** Whether a particle is still inside the bounds a couple of states ago. */
  private isActive(p: number): boolean {
    const o = p * STRIDE;
    return inBounds(this.prevPrevParticles[o], this.prevPrevParticles[o + 1]);
  }

  private drawOne(ctx: CanvasRenderingContext2D, p: number, index: number): void {
    const o = p * STRIDE;
    const cx = this.particles[o];
    const cy = this.particles[o + 1];
    const px = this.prevParticles[o];
    const py = this.prevParticles[o + 1];
    const ppx = this.prevPrevParticles[o];
    const ppy = this.prevPrevParticles[o + 1];
    const pppx = this.prevPrevPrevParticles[o];
    const pppy = this.prevPrevPrevParticles[o + 1];
    const mx = 0.5 * cx + 0.5 * px;
    const my = 0.5 * cy + 0.5 * py;

    if (!inBounds(ppx, ppy)) return;

    const v0 = this.toPixel(pppx, pppy);
    const v1 = this.toPixel(ppx, ppy);
    const v2 = this.toPixel(px, py);
    const v3 = this.toPixel(cx, cy);

    const d12 = v1.distanceTo(v2);
    const d02 = v0.distanceTo(v2);
    const d13 = v1.distanceTo(v3);
    const d01 = v0.distanceTo(v1);
    if (
      d01 <= this.delta ||
      d12 <= this.delta ||
      d02 <= this.delta ||
      d13 <= this.delta
    ) {
      return;
    }

    const [r, g, b] = color(index);
    const maxLen = 1000;
    let alpha = (maxLen - d12) / maxLen;
    alpha *= 1 - (mx * mx + my * my) * 0.25;
    alpha = Math.min(Math.max(alpha, 0.2), 0.75);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;

    // Bezier control points from the neighbouring tangents
    const tan02 = v2.clone().sub(v0).multiplyScalar((0.5 * d12) / d02);
    const tan31 = v1.clone().sub(v3).multiplyScalar((0.5 * d12) / d13);
    const cv1 = v1.clone().add(tan02);
    const cv2 = v2.clone().add(tan31);

    ctx.beginPath();
    ctx.moveTo(v1.x, v1.y);
    ctx.bezierCurveTo(cv1.x, cv1.y, cv2.x, cv2.y, v2.x, v2.y);
    ctx.stroke();
  }
}

