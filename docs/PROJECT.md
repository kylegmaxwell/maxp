# Project Overview (`maxp`)

Interactive fractal explorer and 3D-printable Mandelbrot dish generator built with TypeScript, HTML5 Canvas, Three.js, and Vite. The app renders a 2D fractal canvas alongside a 3D Three.js viewport (`index.html`), controlled by a `lil-gui` panel.

---

## Modes

The 2D canvas maps the complex plane `[-2, 2]^2` and supports five modes:

| Mode | 2D Visual | Click / Drag Overlay |
|---|---|---|
| `mandelbrot` | Escape-time grayscale grid | Escape level-set contour |
| `buddhabrot` | Escape-trajectory density grid | Escape level-set contour |
| `partibrot` | Animated orbit particle lattice (`dots`) | Interpolated level-set contour |
| `linebrot` | Fading Bezier orbit trails (`trails`) | Single-point Catmull-Rom orbit path |
| `vectorbrot` | Directional orbit vector field (`vectors`) | Single-point Catmull-Rom orbit path |

The 3D viewport (`Curve3DView`) supports two `view3d` modes:
- `mesh`: Solid, watertight terraced dish geometry on a `180 x 180 mm` Bambu A1 mini build plate (`1 unit = 1 mm`) with an outer rim, scale-reference US Quarter, multi-color print-preview layers, wireframe toggle (`w`), and Z-up binary `.stl` export.
- `curves`: Stacked 3D level-set contour lines.

---

## Algorithms & View System

- **Simulations (`src/algorithms/`):** Pure math/simulation modules decoupled from DOM and Three.js. Grid and particle simulations implement `Simulation` (`advanceTo(n)` / `reset()`), so playback (`play` / `step`) advances incrementally without recomputing from scratch unless `iter` decreases or `mode` changes.
- **Level-Set Contours:** `smoothEscape` + Marching Squares extract closed contour islands at fractional or integer escape levels for both 2D overlays and 3D terrace stacks (`2..5` in steps of `1`, then `>5` in steps of `10`).
- **2D Compositing (`src/main.ts`, `src/views/`):** Base fractal output renders onto an offscreen `baseCanvas` via `Renderable.render(ctx)`. Pointer drags update only the overlay (`LevelView` or `PathView`) and re-composite onto `#canvas` at 60 fps without re-running the base simulation.
- **3D Scene (`Curve3DView`):** Rebuilds 3D geometry from the active level stack (`2 .. maxLevel`) and exports binary STL rotated to Z-up for 3D slicers.
