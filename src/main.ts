import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { BuddhabrotGrid } from './algorithms/buddhabrot';
import { MandelbrotGrid } from './algorithms/mandelbrot';
import { GridView } from './views/gridView';
import { ParticleView } from './views/particleView';
import type { Renderable } from './views/renderable';

const MODES = ['mandelbrot', 'buddhabrot', 'partibrot', 'linebrot', 'vectorbrot'] as const;
type Mode = (typeof MODES)[number];

/** Playback stops when the iteration count reaches this. */
const MAX_ITER = 500;

// Values controlled by the GUI
const params: { mode: Mode; iter: number; fps: number; play: boolean } = {
  mode: 'mandelbrot',
  iter: 50,
  fps: 10,
  play: false,
};

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let renderer: Renderable;

function createRenderable(mode: Mode, size: number): Renderable {
  switch (mode) {
    case 'mandelbrot':
      return new GridView(new MandelbrotGrid(size, size), params.iter);
    case 'buddhabrot':
      return new GridView(new BuddhabrotGrid(size, size), params.iter);
    case 'partibrot':
      return new ParticleView(size, size, params.iter, 'dots');
    case 'linebrot':
      return new ParticleView(size, size, params.iter, 'trails');
    case 'vectorbrot':
      return new ParticleView(size, size, params.iter, 'vectors');
  }
}

/** Start over: new canvas size, new renderer, and a full render at `params.iter`. */
function rebuild(): void {
  // The viewport is square, so use the shorter window side
  const size = Math.floor(Math.min(window.innerWidth, window.innerHeight));
  canvas.width = size;
  canvas.height = size;

  // Linebrot fades what is already on the canvas, so give it a black backdrop
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  renderer = createRenderable(params.mode, size);
  renderer.render(ctx);
}

/**
 * Advance one iteration on the existing renderer (cheap for the modes that keep state).
 * @returns whether there are more iterations to go
 */
function stepIter(): boolean {
  if (params.iter >= MAX_ITER) return false;
  params.iter++;
  renderer.iter = params.iter;
  renderer.render(ctx);
  iterController.updateDisplay();
  return params.iter < MAX_ITER;
}

// Playback: the loop only exists while playing, so nothing runs when idle
let rafId: number | null = null;
let lastTick = 0;

function loop(now: number): void {
  rafId = requestAnimationFrame(loop);
  if (now - lastTick < 1000 / params.fps) return;
  lastTick = now;
  if (!stepIter()) pause();
}

function play(): void {
  if (params.iter >= MAX_ITER) {
    pause(); // nothing left to play
    return;
  }
  params.play = true;
  playController.updateDisplay();
  if (rafId === null) {
    lastTick = 0;
    rafId = requestAnimationFrame(loop);
  }
}

function pause(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  params.play = false;
  playController.updateDisplay();
}

const gui = new GUI({ title: 'Fractal' });
gui.add(params, 'mode', [...MODES]).onChange(rebuild);
// Setting the iteration directly re-simulates from the start at that value
const iterController = gui.add(params, 'iter', 1, MAX_ITER, 1).onFinishChange(rebuild);
const playController = gui
  .add(params, 'play')
  .onChange((on: boolean) => (on ? play() : pause()));
gui.add(
  {
    step: () => {
      pause();
      stepIter();
    },
  },
  'step',
);
gui.add(params, 'fps', 1, 60, 1);

window.addEventListener('resize', rebuild);
rebuild();
