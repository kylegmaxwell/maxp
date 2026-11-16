import type { ScalarGrid } from '../algorithms/simulation';
import { drawPixels, type Renderable } from './renderable';

/** Renders any `ScalarGrid` ([0, 1] values) as a grayscale 2D image. */
export class GridView implements Renderable {
  constructor(
    private readonly grid: ScalarGrid,
    public iter: number,
  ) {}

  /** Implements `Renderable.render`. */
  render(ctx: CanvasRenderingContext2D): void {
    this.grid.advanceTo(this.iter);
    const { width, height, values } = this.grid;
    drawPixels(ctx, width, height, (pixels) => {
      for (let i = 0; i < values.length; i++) {
        const v = values[i] * 255;
        const p = i * 4;
        pixels[p] = v;
        pixels[p + 1] = v;
        pixels[p + 2] = v;
        pixels[p + 3] = 255;
      }
    });
  }
}

