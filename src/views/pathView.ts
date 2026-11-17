import { Vector2 } from 'three';
import { traceOrbit } from '../algorithms/orbit';
import { catmullRomSegment, easeInOutQuad, splitBezier } from '../math/curves';
import type { Renderable } from './renderable';

/** Convert a canvas pixel `(px, py)` to complex plane coordinates in `[-2, 2]`. */
export function pixelToComplex(
  px: number,
  py: number,
  width: number,
  height: number,
): [number, number] {
  const w4 = (width - 1) / 4;
  const h4 = (height - 1) / 4;
  return [(px - width / 2) / w4, (py - height / 2) / h4];
}

/**
 * Overlay view that draws a single clicked point's orbit path as a smooth
 * Catmull-Rom curve with iteration markers up to `iter`.
 */
export class PathView implements Renderable {
  private readonly steps = 10;
  private readonly w4: number;
  private readonly h4: number;
  private readonly w2: number;
  private readonly h2: number;

  constructor(
    public readonly cRe: number,
    public readonly cIm: number,
    public width: number,
    public height: number,
    public iter: number,
  ) {
    this.w4 = (width - 1) / 4;
    this.h4 = (height - 1) / 4;
    this.w2 = width / 2;
    this.h2 = height / 2;
  }

  private toPixel(x: number, y: number): Vector2 {
    return new Vector2(x * this.w4 + this.w2, y * this.h4 + this.h2);
  }

  /** Implements `Renderable.render`. */
  render(ctx: CanvasRenderingContext2D): void {
    const step = Math.floor(this.iter / this.steps);
    const t = easeInOutQuad(
      Math.max(Math.min((this.iter % this.steps) / this.steps, 1), 0),
      0,
      1,
      1,
    );

    // Trace two steps ahead so `v3` is already known for the active segment (no tangent pop)
    const raw = traceOrbit(this.cRe, this.cIm, step + 2, 'disc');
    const count = raw.length / 2;
    const pts: Vector2[] = [];
    for (let i = 0; i < count; i++) {
      pts.push(this.toPixel(raw[i * 2], raw[i * 2 + 1]));
    }

    // Draw smooth Catmull-Rom curve with a per-step color gradient so order is easy to read.
    // Segments before `step` are complete; if the orbit hasn't ended yet, segment `step` animates with `t`.
    const lastSeg = Math.min(step, count - 2);
    ctx.save();
    ctx.lineWidth = 2;

    for (let i = 0; i <= lastSeg; i++) {
      const v1 = pts[i];
      const v2 = pts[i + 1];
      // Extrapolate virtual neighbours at the ends so the first/last hops still curve
      const v0 = i > 0 ? pts[i - 1] : v1.clone().multiplyScalar(2).sub(v2);
      const v3 = i + 2 < count ? pts[i + 2] : v2.clone().multiplyScalar(2).sub(v1);

      const hue = (45 + i * 28) % 360;
      ctx.strokeStyle = `hsla(${hue}, 90%, 62%, 0.9)`;
      ctx.beginPath();

      const seg = catmullRomSegment(v0, v1, v2, v3, 0.5);
      const inProgress = i === step && step < count - 1;
      if (!inProgress) {
        if (seg) {
          ctx.moveTo(seg[0].x, seg[0].y);
          ctx.bezierCurveTo(seg[1].x, seg[1].y, seg[2].x, seg[2].y, seg[3].x, seg[3].y);
        } else {
          ctx.moveTo(v1.x, v1.y);
          ctx.lineTo(v2.x, v2.y);
        }
      } else if (t > 0) {
        if (seg) {
          const [left] = splitBezier(seg[0], seg[1], seg[2], seg[3], t);
          ctx.moveTo(left[0].x, left[0].y);
          ctx.bezierCurveTo(left[1].x, left[1].y, left[2].x, left[2].y, left[3].x, left[3].y);
        } else {
          const head = v1.clone().lerp(v2, t);
          ctx.moveTo(v1.x, v1.y);
          ctx.lineTo(head.x, head.y);
        }
      }
      ctx.stroke();
    }

    // Draw iteration markers up to the current completed step
    const dotCount = Math.min(step + 1, count);
    for (let i = 0; i < dotCount; i++) {
      const p = pts[i];
      const hue = (45 + i * 28) % 360;
      ctx.fillStyle = `hsl(${hue}, 95%, 70%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
