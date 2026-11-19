import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { BuddhabrotGrid } from './algorithms/buddhabrot';
import { MandelbrotGrid } from './algorithms/mandelbrot';
import { GridView } from './views/gridView';
import { LevelView } from './views/levelView';
import { ParticleView } from './views/particleView';
import { PathView, pixelToComplex } from './views/pathView';
import type { Renderable } from './views/renderable';

const MODES = ['mandelbrot', 'buddhabrot', 'partibrot', 'linebrot', 'vectorbrot'] as const;
type Mode = (typeof MODES)[number];

/** Playback stops when the iteration count reaches this. */
const MAX_ITER = 500;

// Values controlled by the GUI
const params: { mode: Mode; iter: number; level: number; res: number; fps: number; play: boolean } = {
  mode: 'mandelbrot',
  iter: 50,
  level: 0,
  res: 1,
  fps: 10,
  play: false,
};

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
// Offscreen buffer holding the latest base fractal render so dragging the trace
// overlay composites at 60fps without re-running the underlying simulation.
const baseCanvas = document.createElement('canvas');
const baseCtx = baseCanvas.getContext('2d')!;

let renderer: Renderable;
let tracePoint: [number, number] | null = null;
let trace: PathView | LevelView | null = null;

function isLineMode(mode: Mode): boolean {
  return mode === 'linebrot' || mode === 'vectorbrot';
}

function createTrace(width: number, height: number): PathView | LevelView | null {
  if (isLineMode(params.mode)) {
    return tracePoint ? new PathView(tracePoint[0], tracePoint[1], width, height, params.iter) : null;
  }
  const steps = params.mode === 'partibrot' ? 10 : 1;
  if (tracePoint) {
    return new LevelView(
      tracePoint[0],
      tracePoint[1],
      width,
      height,
      params.iter,
      steps,
      undefined,
      params.res,
    );
  }
  if (params.level > 0) {
    return new LevelView(null, null, width, height, params.iter, steps, params.level, params.res);
  }
  return null;
}

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

function composeFrame(): void {
  ctx.drawImage(baseCanvas, 0, 0);
  if (trace) {
    trace.iter = params.iter;
    trace.render(ctx);
  }
}

function renderFrame(): void {
  renderer.iter = params.iter;
  renderer.render(baseCtx);
  composeFrame();
}

/** Start over: new canvas size, new renderer, and a full render at `params.iter`. */
function rebuild(): void {
  // The viewport is square, so use the shorter window side
  const size = Math.floor(Math.min(window.innerWidth, window.innerHeight));
  canvas.width = size;
  canvas.height = size;
  baseCanvas.width = size;
  baseCanvas.height = size;

  // Linebrot fades what is already on the canvas, so give it a black backdrop
  baseCtx.fillStyle = '#000';
  baseCtx.fillRect(0, 0, size, size);

  renderer = createRenderable(params.mode, size);
  trace = createTrace(size, size);
  renderFrame();
}

/**
 * Advance one iteration on the existing renderer (cheap for the modes that keep state).
 * @returns whether there are more iterations to go
 */
function stepIter(): boolean {
  if (params.iter >= MAX_ITER) return false;
  params.iter++;
  renderFrame();
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
const levelController = gui.add(params, 'level', 0, MAX_ITER/10, 1).onChange((n: number) => {
  tracePoint = null;
  trace = !isLineMode(params.mode) && n > 0 ? createTrace(canvas.width, canvas.height) : null;
  composeFrame();
});
gui.add(params, 'res', 0.5, 4, 0.5).onChange(() => {
  trace = createTrace(canvas.width, canvas.height);
  composeFrame();
});
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
gui.add(
  {
    clearTrace: () => {
      tracePoint = null;
      trace = null;
      params.level = 0;
      levelController.updateDisplay();
      composeFrame();
    },
  },
  'clearTrace',
);

let dragging = false;

function updateTrace(e: PointerEvent): void {
  tracePoint = pixelToComplex(e.offsetX, e.offsetY, canvas.width, canvas.height);
  trace = createTrace(canvas.width, canvas.height);
  if (trace instanceof LevelView) {
    params.level = Math.round(trace.level);
    levelController.updateDisplay();
  }
  composeFrame();
}

canvas.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.button !== 0) return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  updateTrace(e);
});

canvas.addEventListener('pointermove', (e: PointerEvent) => {
  if (!dragging) return;
  updateTrace(e);
});

canvas.addEventListener('pointerup', () => {
  dragging = false;
});

canvas.addEventListener('pointercancel', () => {
  dragging = false;
});

canvas.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault();
  if (!trace) return;
  tracePoint = null;
  trace = null;
  params.level = 0;
  levelController.updateDisplay();
  composeFrame();
});

window.addEventListener('resize', rebuild);
rebuild();
