import { Buddhabrot } from './buddhabrot';
import { Mandelbrot } from './mandelbrot';
import { Partibrot } from './partibrot';
import type { Renderer } from './renderer';

type Mode = 'mandelbrot' | 'buddhabrot' | 'partibrot';

// Hard-coded for now: change these to switch what is rendered
const MODE: Mode = 'mandelbrot';
const ITER = 50;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function createRenderer(mode: Mode, size: number): Renderer {
  switch (mode) {
    case 'mandelbrot':
      return new Mandelbrot(size, size, ITER);
    case 'buddhabrot':
      return new Buddhabrot(size, size, ITER);
    case 'partibrot':
      return new Partibrot(size, size, ITER);
  }
}

function render(): void {
  // The viewport is square, so use the shorter window side
  const size = Math.floor(Math.min(window.innerWidth, window.innerHeight));
  canvas.width = size;
  canvas.height = size;

  const image = ctx.createImageData(size, size);
  createRenderer(MODE, size).render(image.data);
  ctx.putImageData(image, 0, 0);
}

window.addEventListener('resize', render);
render();
