import { smoothEscape } from '../algorithms/mandelbrot';
import {
  BandContourGrid,
  connectAndRefineContours,
  type Contour,
} from '../algorithms/marchingSquares';
import type { Renderable } from './renderable';

interface BandCache {
  coarseCells: number;
  subdiv: number;
  maxIter: number;
  grid: BandContourGrid;
}

let cachedBand: BandCache | null = null;

function getBandGrid(coarseCells: number, subdiv: number, maxIter: number): BandContourGrid {
  if (
    cachedBand &&
    cachedBand.coarseCells === coarseCells &&
    cachedBand.subdiv === subdiv &&
    cachedBand.maxIter === maxIter
  ) {
    return cachedBand.grid;
  }
  const grid = new BandContourGrid(
    (re, im) => smoothEscape(re, im, maxIter),
    coarseCells,
    subdiv,
  );
  cachedBand = { coarseCells, subdiv, maxIter, grid };
  return grid;
}

/**
 * Overlay view that computes a Marching Squares scalar field at the current iteration
 * and extracts the level-set contour passing through the clicked point.
 */
export class LevelView implements Renderable {
  private readonly w4: number;
  private readonly h4: number;
  private readonly w2: number;
  private readonly h2: number;

  /**
   * @param cRe Clicked point real part in `[-2, 2]`, or `null` when driven solely by `targetLevel`
   * @param cIm Clicked point imaginary part in `[-2, 2]`, or `null` when driven solely by `targetLevel`
   * @param width Canvas width in pixels
   * @param height Canvas height in pixels
   * @param iter Current GUI iteration counter
   * @param steps Sub-steps per Mandelbrot iteration (`1` for grid modes, `10` for particle modes)
   * @param targetLevel Optional explicit contour level `n` (overrides sampling at `(cRe, cIm)`)
   */
  constructor(
    public readonly cRe: number | null,
    public readonly cIm: number | null,
    public width: number,
    public height: number,
    public iter: number,
    public readonly steps = 1,
    public targetLevel?: number,
  ) {
    this.w4 = (width - 1) / 4;
    this.h4 = (height - 1) / 4;
    this.w2 = width / 2;
    this.h2 = height / 2;
  }

  /** Effective Mandelbrot iteration depth for the active mode. */
  get effectiveIter(): number {
    const base =
      this.steps > 1 ? Math.max(2, Math.floor(this.iter / this.steps) + 2) : Math.max(2, this.iter);
    return this.targetLevel !== undefined
      ? Math.max(base, 52, Math.ceil(this.targetLevel) + 1)
      : base;
  }

  /** Target level value for contour extraction. */
  get level(): number {
    const maxIter = this.effectiveIter;
    const raw =
      this.targetLevel !== undefined
        ? this.targetLevel
        : this.cRe !== null && this.cIm !== null
          ? smoothEscape(this.cRe, this.cIm, maxIter)
          : 1;
    return Math.min(maxIter - 1e-4, Math.max(1e-4, raw));
  }

  /**
   * Extract and bridge the coarse-to-fine Marching Squares contours at the active level
   * into a single closed loop (defaults to `128 * 4 = 512` fine cells across `[-2, 2]`).
   */
  extractContours(
    coarseCells = 128,
    subdiv = 4,
  ): { contours: Contour[]; primary: Contour | null; level: number } {
    const maxIter = this.effectiveIter;
    const level = this.level;
    const bandGrid = getBandGrid(coarseCells, subdiv, maxIter);
    const rawContours = bandGrid.extract(level);
    const connected = connectAndRefineContours(
      rawContours,
      level,
      bandGrid.field,
      4 / bandGrid.fineCells,
    );
    const contours = connected ? [connected] : [];
    return { contours, primary: connected, level };
  }

  /** Implements `Renderable.render`. */
  render(ctx: CanvasRenderingContext2D): void {
    const { contours, primary } = this.extractContours();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const contour of contours) {
      if (contour.points.length < 2) continue;
      const isPrimary = primary === null || contour === primary;
      ctx.strokeStyle = isPrimary ? 'rgba(0, 240, 255, 0.95)' : 'rgba(0, 240, 255, 0.35)';
      ctx.lineWidth = isPrimary ? 2 : 1.25;

      ctx.beginPath();
      const [firstX, firstY] = contour.points[0];
      ctx.moveTo(firstX * this.w4 + this.w2, firstY * this.h4 + this.h2);
      for (let i = 1; i < contour.points.length; i++) {
        const [x, y] = contour.points[i];
        ctx.lineTo(x * this.w4 + this.w2, y * this.h4 + this.h2);
      }
      if (contour.closed) {
        ctx.closePath();
      }
      ctx.stroke();
    }

    if (this.cRe !== null && this.cIm !== null) {
      const px = this.cRe * this.w4 + this.w2;
      const py = this.cIm * this.h4 + this.h2;
      ctx.fillStyle = 'rgba(255, 230, 80, 0.95)';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
