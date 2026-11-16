/** A fractal mode that renders itself onto a 2D canvas context. */
export interface Renderable {
  /** Maximum number of iterations. */
  iter: number;
  render(ctx: CanvasRenderingContext2D): void;
}

/**
 * Helper for modes that compute RGBA pixel data (0 to 255):
 * fills a pixel buffer with `fill` and puts it on the canvas.
 */
export function drawPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fill: (pixels: Uint8ClampedArray) => void,
): void {
  const image = ctx.createImageData(width, height);
  fill(image.data);
  ctx.putImageData(image, 0, 0);
}
