/** Common interface for the fractal modes that write into a pixel buffer. */
export interface Renderer {
  /** Maximum number of iterations. */
  iter: number;
  /** Write RGBA pixel data (0 to 255) into `pixels`. */
  render(pixels: Uint8ClampedArray): void;
}

