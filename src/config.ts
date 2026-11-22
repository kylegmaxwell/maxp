export const MODES = ['mandelbrot', 'buddhabrot', 'partibrot', 'linebrot', 'vectorbrot'] as const;
export type Mode = (typeof MODES)[number];

export const VIEW3D_MODES = ['curves', 'mesh'] as const;
export type View3DMode = (typeof VIEW3D_MODES)[number];

/** Playback stops when the iteration count reaches this. */
export const MAX_ITER = 500;

export interface AppParams {
  mode: Mode;
  view3d: View3DMode;
  wireframe: boolean;
  iter: number;
  level: number;
  res: number;
  fps: number;
  play: boolean;
}

/** Initial GUI and render state. */
export const DEFAULT_PARAMS: AppParams = {
  mode: 'mandelbrot',
  view3d: 'mesh',
  wireframe: false,
  iter: 90,
  level: 15,
  res: 1,
  fps: 10,
  play: false,
};

/** 3D print-preview filament palette ordered from base (bottom) upward: green, black, black, then gray for the rest. */
export const PRINT_PREVIEW_PALETTE = [0x22c55e, 0x1c1e22, 0x1c1e22, 0x717680] as const;
