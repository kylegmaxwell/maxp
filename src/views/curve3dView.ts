import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshPhysicalMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShapeUtils,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Contour } from '../algorithms/marchingSquares';
import { extractLevelContour } from './levelView';

export const VIEW3D_MODES = ['curves', 'mesh'] as const;
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
 * linear (`1:1`) up to level `5`, then compressed `10:1` above `5` so high levels
 * advance by 1 vertical step per 10 levels (`15 -> 6`, `25 -> 7`, ...).
 */
export function levelToDepth(level: number): number {
  if (level <= 5) return level;
  return 5 + (level - 5) / 10;
}

/**
 * Extract level-set contours from level `2` up to `maxLevel`:
 * - levels `2 .. 5` in steps of `1`
 * - levels `> 5` in steps of `10` (`15, 25, ...`)
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
  for (let lvl = 2; lvl <= Math.min(5, Math.floor(clampedMax)); lvl++) {
    sampledLevels.push(lvl);
  }
  for (let lvl = 15; lvl <= Math.floor(clampedMax); lvl += 10) {
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

/** Remove consecutive near-duplicate points from a closed contour. */
function cleanContourPoints(points: ReadonlyArray<[number, number]>): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(x - prev.x, y - prev.y) > 1e-6) {
      out.push(new Vector2(x, y));
    }
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) {
      out.pop();
    }
  }
  return out;
}

function pushTri(
  positions: number[],
  colors: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  g: number,
  b: number,
): void {
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  colors.push(r, g, b, r, g, b, r, g, b);
}

/**
 * Build a sharp terraced 3D mesh from stacked level-set contours:
 * - Each consecutive pair `(k, k+1)` gets a flat horizontal terrace at `y_k`
 *   (from outer contour `k` to inner hole `k+1`) and a vertical drop wall along `k+1`
 *   from `y_k` down to `y_{k+1}`.
 * - The deepest contour is capped flat at `y_last` (its own level height).
 * - The outer contour extrudes down through every layer height to `y_last - heightScale`
 *   and is capped flat at the bottom, giving a solid floor of thickness `heightScale`.
 * - Each layer uses a flat (non-interpolated) rotating rainbow vertex color.
 */
export function buildTerracedMeshGeometry(
  entries: ReadonlyArray<LevelCurveEntry>,
  heightScale = 0.08,
  baseHeight = DEFAULT_BASE_HEIGHT,
): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  if (entries.length === 0) {
    const empty = new BufferGeometry();
    empty.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    return empty;
  }

  const roygbiv = [0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x3b82f6, 0x4f46e5, 0xa855f7];
  const layerColor = (idx: number): [number, number, number] => {
    const c = new Color(roygbiv[idx % roygbiv.length]);
    return [c.r, c.g, c.b];
  };

  const pointInPoly = (pt: Vector2, poly: Vector2[]): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x;
      const yi = poly[i].y;
      const xj = poly[j].x;
      const yj = poly[j].y;
      if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  const rings = entries.map((e, idx) => ({
    y: baseHeight - (2 + idx) * heightScale,
    islands: [cleanContourPoints(e.contour.points)].filter((pts) => pts.length >= 3),
    rgb: layerColor(idx),
  }));

  const addCap = (
    outer: Vector2[],
    holes: Vector2[][],
    y: number,
    rgb: [number, number, number],
    flip: boolean,
  ): void => {
    if (outer.length < 3) return;
    const ccwOuter = ShapeUtils.isClockWise(outer) ? [...outer].reverse() : outer;
    const cwHoles = holes.map((h) => (ShapeUtils.isClockWise(h) ? h : [...h].reverse()));
    const allPts = ccwOuter.concat(...cwHoles);
    const tris = ShapeUtils.triangulateShape(ccwOuter, cwHoles);
    const [r, g, b] = rgb;
    for (const [ia, ib, ic] of tris) {
      const va = allPts[ia];
      const vb = allPts[ib];
      const vc = allPts[ic];
      if (flip) {
        pushTri(positions, colors, va.x, y, va.y, vc.x, y, vc.y, vb.x, y, vb.y, r, g, b);
      } else {
        pushTri(positions, colors, va.x, y, va.y, vb.x, y, vb.y, vc.x, y, vc.y, r, g, b);
      }
    }
  };

  const addWall = (
    pts: Vector2[],
    yTop: number,
    yBot: number,
    rgb: [number, number, number],
    flip = false,
  ): void => {
    const n = pts.length;
    const [r, g, b] = rgb;
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      if (flip) {
        pushTri(positions, colors, p0.x, yTop, p0.y, p1.x, yBot, p1.y, p1.x, yTop, p1.y, r, g, b);
        pushTri(positions, colors, p0.x, yTop, p0.y, p0.x, yBot, p0.y, p1.x, yBot, p1.y, r, g, b);
      } else {
        pushTri(positions, colors, p0.x, yTop, p0.y, p1.x, yTop, p1.y, p1.x, yBot, p1.y, r, g, b);
        pushTri(positions, colors, p0.x, yTop, p0.y, p1.x, yBot, p1.y, p0.x, yBot, p0.y, r, g, b);
      }
    }
  };

  for (let k = 0; k < rings.length - 1; k++) {
    const curr = rings[k];
    const next = rings[k + 1];
    for (const outer of curr.islands) {
      const holes = next.islands.filter((hole) => {
        // Test interior points (including centroid / sample points) so boundary touch at (-2, 0) doesn't miss
        let insideCount = 0;
        const step = Math.max(1, Math.floor(hole.length / 8));
        let tested = 0;
        for (let i = 0; i < hole.length; i += step) {
          tested++;
          if (pointInPoly(hole[i], outer)) insideCount++;
        }
        return insideCount > tested / 2;
      });
      addCap(outer, holes, curr.y, curr.rgb, true);
      for (const hole of holes) {
        addWall(hole, curr.y, next.y, curr.rgb);
      }
    }
  }

  // Deepest contour islands are capped flat at their own height (no extra double-drop)
  const deepest = rings[rings.length - 1];
  for (const island of deepest.islands) {
    addCap(island, [], deepest.y, deepest.rgb, true);
  }

  // Outer wall subdivided at every layer height plus one solid floor step below deepest.y
  const outermost = rings[0]?.islands[0];
  const dishBaseY = deepest.y - heightScale;
  if (outermost && outermost.length >= 3) {
    const outerSlices: Array<{ y: number; rgb: [number, number, number] }> = rings.map((r) => ({
      y: r.y,
      rgb: r.rgb,
    }));
    outerSlices.push({ y: dishBaseY, rgb: deepest.rgb });

    for (let s = 0; s < outerSlices.length - 1; s++) {
      const top = outerSlices[s];
      const bot = outerSlices[s + 1];
      addWall(outermost, top.y, bot.y, top.rgb, true);
    }
    addCap(outermost, [], dishBaseY, deepest.rgb, false);
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geom.computeVertexNormals();
  return geom;
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, DEFAULT_BASE_HEIGHT * 0.6, 0);
    this.controls.update();
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(createReferenceAxes());

    const ambient = new AmbientLight(0xffffff, 0.35);
    const keyLight = new DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(4.5, 3.2, 4.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -2.6;
    keyLight.shadow.camera.right = 2.6;
    keyLight.shadow.camera.top = 2.6;
    keyLight.shadow.camera.bottom = -2.6;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.bias = -0.0005;
    const fillLight = new DirectionalLight(0x88bbff, 0.3);
    fillLight.position.set(-4, 3, -3);
    this.scene.add(ambient, keyLight, fillLight);

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

  /** Remove and dispose all existing 3D geometries and materials. */
  private clearCurves(): void {
    while (this.curveGroup.children.length > 0) {
      const obj = this.curveGroup.children.pop()!;
      if (obj instanceof Line || obj instanceof Mesh) {
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
   * Rebuild the 3D geometry for levels `2 .. maxLevel` and render a frame.
   */
  update(
    maxLevel: number,
    maxIter: number,
    res = 1,
    viewMode: View3DMode = 'mesh',
    wireframe = false,
  ): void {
    this.clearCurves();

    const entries = buildLevelStack(maxLevel, maxIter, res);
    const topLevel = entries.length > 0 ? entries[entries.length - 1].level : 0;

    if (viewMode === 'mesh') {
      if (entries.length > 0) {
        const geometry = buildTerracedMeshGeometry(entries, this.heightScale, this.baseHeight);
        const material = new MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.78,
          metalness: 0.0,
          clearcoat: 0,
          vertexColors: true,
          wireframe,
          side: DoubleSide,
          flatShading: true,
        });
        const mesh = new Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.curveGroup.add(mesh);
      }
      this.render();
      return;
    }

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
