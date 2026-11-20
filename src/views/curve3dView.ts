import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Contour } from '../algorithms/marchingSquares';
import { extractLevelContour } from './levelView';

export const VIEW3D_MODES = ['curves'] as const;
export type View3DMode = (typeof VIEW3D_MODES)[number];

export const DEFAULT_AXIS_HEIGHT = 2.6;
export const DEFAULT_BASE_HEIGHT = DEFAULT_AXIS_HEIGHT / 2;

export interface LevelCurveEntry {
  level: number;
  contour: Contour;
}

interface ContourStackCache {
  coarseCells: number;
  subdiv: number;
  maxIter: number;
  byLevel: Map<number, Contour | null>;
}

let stackCache: ContourStackCache | null = null;

function getCachedLevelContour(
  level: number,
  maxIter: number,
  coarseCells: number,
  subdiv: number,
): Contour | null {
  if (
    !stackCache ||
    stackCache.coarseCells !== coarseCells ||
    stackCache.subdiv !== subdiv ||
    stackCache.maxIter !== maxIter
  ) {
    stackCache = {
      coarseCells,
      subdiv,
      maxIter,
      byLevel: new Map(),
    };
  }
  const key = Math.round(level * 1e4) / 1e4;
  if (stackCache.byLevel.has(key)) {
    return stackCache.byLevel.get(key)!;
  }
  const contour = extractLevelContour(key, maxIter, coarseCells, subdiv);
  stackCache.byLevel.set(key, contour);
  return contour;
}

/**
 * Map a contour `level` to vertical depth units:
 * linear (`1:1`) up to level `6`, then compressed `10:1` above `6` so high levels
 * advance by 1 vertical step per 10 levels.
 */
export function levelToDepth(level: number): number {
  if (level <= 6) return level;
  return 6 + (level - 6) / 10;
}

/**
 * Extract level-set contours from level `2` up to `maxLevel`:
 * - levels `2 .. 6` in steps of `1`
 * - levels `> 6` in steps of `10` (`16, 26, ...`)
 * - plus `maxLevel` itself when not already included.
 */
export function buildLevelStack(
  maxLevel: number,
  maxIter: number,
  res = 1,
  subdiv = 4,
): LevelCurveEntry[] {
  const clampedMax = Math.max(0, maxLevel);
  if (clampedMax < 2) return [];

  const coarseCells = Math.max(16, Math.round(128 * res));
  const effectiveMaxIter = Math.max(maxIter, 52, Math.ceil(clampedMax) + 1);
  const entries: LevelCurveEntry[] = [];

  const sampledLevels: number[] = [];
  for (let lvl = 2; lvl <= Math.min(6, Math.floor(clampedMax)); lvl++) {
    sampledLevels.push(lvl);
  }
  for (let lvl = 16; lvl <= Math.floor(clampedMax); lvl += 10) {
    sampledLevels.push(lvl);
  }
  const lastSampled = sampledLevels.length > 0 ? sampledLevels[sampledLevels.length - 1] : 0;
  if (clampedMax - lastSampled > 1e-3) {
    sampledLevels.push(clampedMax);
  }

  for (const lvl of sampledLevels) {
    const contour = getCachedLevelContour(lvl, effectiveMaxIter, coarseCells, subdiv);
    if (contour && contour.points.length >= 2) {
      entries.push({ level: lvl, contour });
    }
  }

  return entries;
}

/**
 * Convert a 2D complex-plane contour (`[re, im]` in `[-2, 2]^2`) at `level`
 * into flat 3D `[x, y, z]` vertex coordinates with `x = re`, `z = im`,
 * and `y = baseHeight - levelToDepth(level) * heightScale` (starting at half the axis
 * and carving downward toward `y = 0` as level increases).
 */
export function contourToPositions(
  contour: Contour,
  level: number,
  heightScale = 0.08,
  baseHeight = DEFAULT_BASE_HEIGHT,
): Float32Array {
  const pts = contour.points;
  const out = new Float32Array(pts.length * 3);
  const y = baseHeight - levelToDepth(level) * heightScale;
  for (let i = 0; i < pts.length; i++) {
    const [re, im] = pts[i];
    const j = i * 3;
    out[j] = re;
    out[j + 1] = y;
    out[j + 2] = im;
  }
  return out;
}

/**
 * Create a Three.js coordinate reference group with:
 * - A `[-2, 2] x [-2, 2]` grid on the `y = 0` plane
 * - Colored `+X` (Re), `+Y` (Height), and `+Z` (Im) axis lines from the origin
 */
export function createReferenceAxes(): Group {
  const group = new Group();

  const grid = new GridHelper(4, 8, 0x3b4d5e, 0x23262e);
  group.add(grid);

  const makeAxisLine = (end: [number, number, number], color: number): Line => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, ...end]), 3));
    const mat = new LineBasicMaterial({ color });
    return new Line(geom, mat);
  };

  // +X = Re (red), +Y = Height (green), +Z = Im (blue)
  group.add(makeAxisLine([2.3, 0, 0], 0xff5555));
  group.add(makeAxisLine([0, DEFAULT_AXIS_HEIGHT, 0], 0x55dd77));
  group.add(makeAxisLine([0, 0, 2.3], 0x5599ff));

  return group;
}

/**
 * Side-by-side Three.js 3D view that renders stacked level-set curves from `1` to `level`
 * with interactive OrbitControls and a reference coordinate grid/axes.
 */
export class Curve3DView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  private readonly curveGroup: Group;

  constructor(
    readonly canvas: HTMLCanvasElement,
    public heightScale = 0.08,
    public baseHeight = DEFAULT_BASE_HEIGHT,
  ) {
    this.scene = new Scene();
    this.scene.background = new Color(0x14161c);

    this.camera = new PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(3.4, 3.2, 4.2);

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, DEFAULT_BASE_HEIGHT * 0.6, 0);
    this.controls.update();
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(createReferenceAxes());

    this.curveGroup = new Group();
    this.scene.add(this.curveGroup);
  }

  /** Resize the 3D viewport and update the camera aspect ratio. */
  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** Remove and dispose all existing 3D curve geometries and materials. */
  private clearCurves(): void {
    while (this.curveGroup.children.length > 0) {
      const obj = this.curveGroup.children.pop()!;
      if (obj instanceof Line) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          for (const m of obj.material) m.dispose();
        } else {
          obj.material.dispose();
        }
      }
    }
  }

  /**
   * Rebuild the 3D geometry for levels `1 .. maxLevel` and render a frame.
   */
  update(maxLevel: number, maxIter: number, res = 1, _viewMode: View3DMode = 'curves'): void {
    this.clearCurves();

    const entries = buildLevelStack(maxLevel, maxIter, res);
    const topLevel = entries.length > 0 ? entries[entries.length - 1].level : 0;

    for (let i = 0; i < entries.length; i++) {
      const { level, contour } = entries[i];
      const positions = contourToPositions(contour, level, this.heightScale, this.baseHeight);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));

      const isTop = i === entries.length - 1 && maxLevel > 0;
      const color = new Color();
      if (isTop) {
        color.setHex(0x00f0ff);
      } else if (level === 0) {
        color.setHex(0x4a5568);
      } else {
        const t = topLevel > 1 ? (level - 1) / Math.max(1, topLevel - 1) : 0;
        color.setHSL(0.58 - 0.1 * t, 0.85, 0.35 + 0.25 * t);
      }

      const material = new LineBasicMaterial({
        color,
        transparent: !isTop,
        opacity: isTop ? 1.0 : 0.75,
      });

      const line = contour.closed
        ? new LineLoop(geometry, material)
        : new Line(geometry, material);
      this.curveGroup.add(line);
    }

    this.render();
  }

  /** Render the Three.js scene onto `#canvas3d`. */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
