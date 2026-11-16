import { Vector2 } from 'three';
import { inBounds, ParticleSim, pixelLattice, STRIDE } from '../algorithms/particles';
import { VectorFieldSim } from '../algorithms/vectorField';
import {
  catmullRomSegment,
  easeInOutQuad,
  splitBezier,
  type CubicBezier,
} from '../math/curves';
import { drawPixels, type Renderable } from './renderable';

export type ParticleStyle = 'dots' | 'trails' | 'vectors';

/** Quasi-random color from a seed, as [r, g, b] (0 to 255). */
function color(i: number): [number, number, number] {
  return [(i % 200) + 30, ((i + 234567) % 7) * 24 + 24, (i % 57) + 75];
}

/**
 * Unified view for particle-based simulations:
 * - `dots`: interpolated particle positions (Partibrot)
 * - `trails`: Bezier curves across the last 4 states (Linebrot)
 * - `vectors`: directional vector field (Vectorbrot)
 */
export class ParticleView implements Renderable {
  private readonly sim: ParticleSim | VectorFieldSim;
  private readonly h4: number;
  private readonly w4: number;
  private readonly h2: number;
  private readonly w2: number;

  // Partibrot (`dots`) sub-steps per iteration
  private readonly steps = 10;
  // Linebrot (`trails`) sampling and minimum pixel movement
  private readonly skip = 7;
  private readonly delta = 1;
  private prevIter = 0;
  private skipCache: number[] | null = null;

  constructor(
    public width: number,
    public height: number,
    public iter: number,
    private readonly style: ParticleStyle,
  ) {
    this.h4 = (height - 1) / 4;
    this.w4 = (width - 1) / 4;
    this.h2 = height / 2;
    this.w2 = width / 2;

    if (style === 'vectors') {
      this.sim = new VectorFieldSim(width, height);
    } else if (style === 'trails') {
      this.sim = new ParticleSim(pixelLattice(width, height), 4, 'box');
    } else {
      this.sim = new ParticleSim(pixelLattice(width, height), 1, 'disc');
    }
  }

  /** Advance the simulation by one Mandelbrot step every `steps` frames and return the eased [0, 1] blend. */
  private stepAndEase(): number {
    this.sim.advanceTo(Math.floor(this.iter / this.steps));
    const t = Math.max(Math.min((this.iter % this.steps) / this.steps, 1), 0);
    return easeInOutQuad(t, 0, 1, 1);
  }

  /** Implements `Renderable.render`. */
  render(ctx: CanvasRenderingContext2D): void {
    switch (this.style) {
      case 'dots':
        drawPixels(ctx, this.width, this.height, (pixels) => this.renderDots(pixels));
        break;
      case 'trails':
        this.renderTrails(ctx);
        break;
      case 'vectors':
        this.renderVectors(ctx);
        break;
    }
  }

  private renderDots(pixels: Uint8ClampedArray): void {
    const sim = this.sim as ParticleSim;
    const t = this.stepAndEase();
    const { width, height, h4, w4, h2, w2 } = this;
    const tm = 1 - t;
    const cur = sim.current;
    const prev = sim.past(1);

    const sum = new Uint32Array(width * height * 3);
    const hit = new Uint8Array(width * height);

    for (let i = 0; i < cur.length; i += STRIDE) {
      const x = tm * prev[i] + t * cur[i];
      const y = tm * prev[i + 1] + t * cur[i + 1];
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

  private toPixel(x: number, y: number): Vector2 {
    return new Vector2(Math.floor(x * this.w4 + this.w2), Math.floor(y * this.h4 + this.h2));
  }

  private renderTrails(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim as ParticleSim;
    if (this.iter < this.prevIter) this.skipCache = null;
    const t = this.stepAndEase();
    this.prevIter = this.iter;

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, this.width, this.height);

    if (!this.skipCache) {
      const cache: number[] = [];
      let skipI = 0;
      const prevPrev = sim.past(2);
      for (let p = 0; p < sim.count; p++) {
        const o = p * STRIDE;
        if (!inBounds('box', prevPrev[o], prevPrev[o + 1])) continue;
        if (skipI % this.skip === 0) {
          this.drawCurve(ctx, sim, p, cache.length, t);
          cache.push(p);
        }
        skipI++;
      }
      this.skipCache = cache;
    } else {
      for (let i = 0; i < this.skipCache.length; i++) {
        this.drawCurve(ctx, sim, this.skipCache[i], i, t);
      }
    }
  }

  private drawCurve(
    ctx: CanvasRenderingContext2D,
    sim: ParticleSim,
    p: number,
    index: number,
    t: number,
  ): void {
    const o = p * STRIDE;
    const s0 = sim.current;
    const s1 = sim.past(1);
    const s2 = sim.past(2);
    const s3 = sim.past(3);
    const s4 = sim.past(4);

    // Previous segment (s3 -> s2) and current segment (s2 -> s1) stay fixed during the step;
    // we draw [t, 1] of the previous segment and [0, t] of the current one so the trail snakes along the spline.
    const prevSeg = this.splineSegment(s4[o], s4[o + 1], s3[o], s3[o + 1], s2[o], s2[o + 1], s1[o], s1[o + 1]);
    const curSeg = this.splineSegment(s3[o], s3[o + 1], s2[o], s2[o + 1], s1[o], s1[o + 1], s0[o], s0[o + 1]);
    if (!prevSeg && !curSeg) return;

    const [r, g, b] = color(index);
    const mx = 0.5 * s0[o] + 0.5 * s1[o];
    const my = 0.5 * s0[o + 1] + 0.5 * s1[o + 1];
    const refLen = curSeg ? curSeg[0].distanceTo(curSeg[3]) : prevSeg![0].distanceTo(prevSeg![3]);
    let alpha = (1000 - refLen) / 1000;
    alpha *= 1 - (mx * mx + my * my) * 0.25;
    alpha = Math.min(Math.max(alpha, 0.2), 0.75);
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;

    ctx.beginPath();
    if (prevSeg && t < 1) {
      const [, right] = splitBezier(prevSeg[0], prevSeg[1], prevSeg[2], prevSeg[3], t);
      ctx.moveTo(right[0].x, right[0].y);
      ctx.bezierCurveTo(right[1].x, right[1].y, right[2].x, right[2].y, right[3].x, right[3].y);
    }
    if (curSeg && t > 0) {
      const [left] = splitBezier(curSeg[0], curSeg[1], curSeg[2], curSeg[3], t);
      ctx.moveTo(left[0].x, left[0].y);
      ctx.bezierCurveTo(left[1].x, left[1].y, left[2].x, left[2].y, left[3].x, left[3].y);
    }
    ctx.stroke();
  }

  /** Project 4 world points to screen space and build a Catmull-Rom Bezier segment. */
  private splineSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ): CubicBezier | null {
    if (!inBounds('box', x1, y1)) return null;
    return catmullRomSegment(
      this.toPixel(x0, y0),
      this.toPixel(x1, y1),
      this.toPixel(x2, y2),
      this.toPixel(x3, y3),
      this.delta,
    );
  }

  private renderVectors(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim as VectorFieldSim;
    const t = this.stepAndEase();
    const tm = 1 - t;
    const { cols, rows, fx, fy, prevFx, prevFy, spacing } = sim;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);

    const full = spacing * 0.85;
    ctx.lineWidth = 1.25;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = r * cols + c;
        const vx = tm * prevFx[cell] + t * fx[cell];
        const vy = tm * prevFy[cell] + t * fy[cell];
        const mag = Math.hypot(vx, vy);
        if (mag === 0) continue;

        const len = full * Math.min(mag / 1.5, 1);
        if (len < 0.5) continue;

        const ux = vx / mag;
        const uy = vy / mag;
        const hue = ((Math.atan2(uy, ux) * 180) / Math.PI + 360) % 360;
        ctx.strokeStyle = `hsl(${hue},85%,60%)`;

        const mx = (c + 0.5) * spacing;
        const my = (r + 0.5) * spacing;
        const hx = (ux * len) / 2;
        const hy = (uy * len) / 2;

        ctx.beginPath();
        ctx.moveTo(mx - hx, my - hy);
        ctx.lineTo(mx + hx, my + hy);
        ctx.stroke();
      }
    }
  }
}

