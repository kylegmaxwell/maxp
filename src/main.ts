import { Buddhabrot } from './buddhabrot';
import { Linebrot } from './linebrot';
import { Mandelbrot } from './mandelbrot';
import { Partibrot } from './partibrot';
import type { Renderable } from './renderer';

type Mode = 'mandelbrot' | 'buddhabrot' | 'partibrot' | 'linebrot';

// Hard-coded for now: change these to switch what is rendered
const MODE: Mode = 'mandelbrot';
const ITER = 50;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function createRenderable(mode: Mode, size: number): Renderable {
  switch (mode) {
    case 'mandelbrot':
      return new Mandelbrot(size, size, ITER);
    case 'buddhabrot':
      return new Buddhabrot(size, size, ITER);
    case 'partibrot':
      return new Partibrot(size, size, ITER);
    case 'linebrot':
      return new Linebrot(size, size, ITER);
  }
}

function render(): void {
  // The viewport is square, so use the shorter window side
  const size = Math.floor(Math.min(window.innerWidth, window.innerHeight));
  canvas.width = size;
  canvas.height = size;

  // Linebrot fades what is already on the canvas, so give it a black backdrop
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  createRenderable(MODE, size).render(ctx);
}

window.addEventListener('resize', render);
render();
