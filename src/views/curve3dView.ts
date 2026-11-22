import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
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
  Shape,
  ShapeUtils,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { largestContour, marchingSquares, type Contour } from '../algorithms/marchingSquares';
import {
  PRINT_PREVIEW_PALETTE,
  VIEW3D_MODES,
  type View3DMode,
} from '../config';
import { extractLevelContour, extractLevelIslands } from './levelView';

export { VIEW3D_MODES, type View3DMode };

/** Real-world metric scale: 1 Three.js unit = 1 mm (50 mm per complex unit => Level 2 is 150 mm long). */
export const MM_PER_UNIT = 50;
/** Shift complex real axis by -0.5 so Level 2 (re in [-2, 1]) is centered on the build plate. */
export const CENTER_RE = -0.5;
/** Bambu A1 mini build plate size in mm. */
export const BUILD_PLATE_SIZE_MM = 180;
/** US Quarter dimensions in mm (24.26 mm diameter x 1.75 mm thickness). */
export const QUARTER_RADIUS_MM = 12.13;
export const QUARTER_THICKNESS_MM = 1.75;
/** Default terrace layer step height in mm (10 layers at 0.20 mm print layer height). */
export const DEFAULT_LAYER_HEIGHT = 2.0;
/** Dedicated outer rim wall expansion in mm (5 walls with a 0.4 mm nozzle). */
export const OUTER_RIM_OFFSET_MM = 2.0;

export const DEFAULT_AXIS_HEIGHT = 90;
export const DEFAULT_BASE_HEIGHT = 45;

export interface LevelCurveEntry {
  level: number;
  contour: Contour;
  islands?: Contour[];
}

interface ContourStackCache {
  coarseCells: number;
  subdiv: number;
  maxIter: number;
  byLevel: Map<number, { contour: Contour | null; islands: Contour[] }>;
}

let stackCache: ContourStackCache | null = null;

function getCachedLevelContour(
  level: number,
  maxIter: number,
  coarseCells: number,
  subdiv: number,
): { contour: Contour | null; islands: Contour[] } {
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
  const islands = extractLevelIslands(key, maxIter, coarseCells, subdiv);
  const entry = { contour, islands };
  stackCache.byLevel.set(key, entry);
  return entry;
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
    const { contour, islands } = getCachedLevelContour(lvl, effectiveMaxIter, coarseCells, subdiv);
    if (contour && contour.points.length >= 2) {
      entries.push({ level: lvl, contour, islands });
    }
  }

  return entries;
}

/**
 * Convert a 2D complex-plane contour (`[re, im]` in `[-2, 2]^2`) at `level`
 * into flat 3D metric `[x, y, z]` coordinates (in mm) with `x = (re - centerRe) * mmPerUnit`,
 * `z = im * mmPerUnit`, and `y = baseHeight - levelToDepth(level) * heightScale`.
 */
export function contourToPositions(
  contour: Contour,
  level: number,
  heightScale = DEFAULT_LAYER_HEIGHT,
  baseHeight = DEFAULT_BASE_HEIGHT,
  mmPerUnit = MM_PER_UNIT,
  centerRe = CENTER_RE,
): Float32Array {
  const pts = contour.points;
  const out = new Float32Array(pts.length * 3);
  const y = baseHeight - levelToDepth(level) * heightScale;
  for (let i = 0; i < pts.length; i++) {
    const [re, im] = pts[i];
    const j = i * 3;
    out[j] = (re - centerRe) * mmPerUnit;
    out[j + 1] = y;
    out[j + 2] = im * mmPerUnit;
  }
  return out;
}

/**
 * Iteratively prune duplicate vertices, 180-degree backtracking spikes (`A -> B -> A`),
 * and nearly-collinear midpoints from a closed 2D polygon in mm so Earcut never emits
 * zero-area triangles whose Float32 normal flips upside-down.
 */
function pruneCollinearPoints(pts: Vector2[]): Vector2[] {
  let out = pts.map((p) => new Vector2(Math.fround(p.x), Math.fround(p.y)));
  let changed = true;
  while (changed && out.length >= 4) {
    changed = false;
    const nextOut: Vector2[] = [];
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const prev = nextOut.length > 0 ? nextOut[nextOut.length - 1] : out[(i - 1 + n) % n];
      const curr = out[i];
      const next = out[(i + 1) % n];

      const ux = prev.x - curr.x;
      const uy = prev.y - curr.y;
      const vx = next.x - curr.x;
      const vy = next.y - curr.y;
      const uLen = Math.hypot(ux, uy);
      const vLen = Math.hypot(vx, vy);

      if (uLen <= 1e-4 || vLen <= 1e-4 || Math.hypot(prev.x - next.x, prev.y - next.y) <= 1e-4) {
        changed = true;
        continue;
      }

      const dot = (ux * vx + uy * vy) / (uLen * vLen);
      const cross = Math.abs(ux * vy - uy * vx) / (uLen * vLen);
      // Drop strictly collinear midpoints (dot < -0.9999, cross < 1e-4)
      if (dot < -0.9999 && cross < 1e-4) {
        changed = true;
        continue;
      }

      nextOut.push(curr);
    }
    if (nextOut.length > 1) {
      const first = nextOut[0];
      const last = nextOut[nextOut.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-3) {
        nextOut.pop();
        changed = true;
      }
    }
    out = nextOut;
  }
  return out;
}

/**
 * Convert a complex-plane contour into cleaned 2D metric `(x, z)` points in mm,
 * pruning duplicate points, collinear midpoints, and 180-degree backtracking hair spikes
 * (`A -> B -> A`) that would create non-manifold edges or zero-area reversed faces.
 */
function cleanContourPointsMm(
  points: ReadonlyArray<[number, number]>,
  mmPerUnit = MM_PER_UNIT,
  centerRe = CENTER_RE,
): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < points.length; i++) {
    const x = (points[i][0] - centerRe) * mmPerUnit;
    const y = points[i][1] * mmPerUnit;
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(x - prev.x, y - prev.y) > 1e-3) {
      out.push(new Vector2(x, y));
    }
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-3) {
      out.pop();
    }
  }

  return pruneCollinearPoints(out);
}

/**
 * Expand a closed 2D polygon outward by `offsetMm` using Marching Squares on a scanline
 * Euclidean distance grid (Minkowski dilation by a circle of radius `offsetMm`),
 * guaranteeing a non-self-intersecting outer rim with uniform minimum wall thickness.
 */
export function expandContourOutward(pts: ReadonlyArray<Vector2>, offsetMm: number): Vector2[] {
  if (pts.length < 3 || offsetMm <= 0) return [...pts];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const pad = offsetMm * 2.5;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // Subsample dense contours to ~180 segments for fast distance queries
  const maxSegs = 180;
  const step = Math.max(1, Math.floor(pts.length / maxSegs));
  const sub: Vector2[] = [];
  for (let i = 0; i < pts.length; i += step) {
    sub.push(pts[i]);
  }
  const n = sub.length;

  const gridSize = 96;
  const field = new Float32Array(gridSize * gridSize);
  const dxStep = spanX / (gridSize - 1);
  const dyStep = spanY / (gridSize - 1);
  const maxCheckDist = offsetMm * 2.2;

  for (let r = 0; r < gridSize; r++) {
    const y = minY + r * dyStep;
    // Scanline X intersections for fast inside/outside check along row r
    const xInts: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = sub[i].y;
      const yj = sub[j].y;
      if (yi > y !== yj > y) {
        xInts.push(((sub[j].x - sub[i].x) * (y - yi)) / (yj - yi) + sub[i].x);
      }
    }
    xInts.sort((a, b) => a - b);

    for (let c = 0; c < gridSize; c++) {
      const x = minX + c * dxStep;
      let inside = false;
      for (let k = 0; k < xInts.length; k++) {
        if (x < xInts[k]) break;
        inside = !inside;
      }

      if (inside) {
        field[r * gridSize + c] = offsetMm * 2;
        continue;
      }

      let minD2 = maxCheckDist * maxCheckDist;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = sub[j].x;
        const ay = sub[j].y;
        const bx = sub[i].x;
        const by = sub[i].y;
        if (
          Math.min(ay, by) - y > maxCheckDist ||
          y - Math.max(ay, by) > maxCheckDist ||
          Math.min(ax, bx) - x > maxCheckDist ||
          x - Math.max(ax, bx) > maxCheckDist
        ) {
          continue;
        }
        const abx = bx - ax;
        const aby = by - ay;
        const len2 = abx * abx + aby * aby;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * abx + (y - ay) * aby) / len2)) : 0;
        const px = ax + t * abx;
        const py = ay + t * aby;
        const d2 = (x - px) ** 2 + (y - py) ** 2;
        if (d2 < minD2) minD2 = d2;
      }

      field[r * gridSize + c] = offsetMm * 2 - Math.sqrt(minD2);
    }
  }

  const raw = marchingSquares(field, gridSize, gridSize, offsetMm);
  const best = largestContour(raw);
  if (!best || best.points.length < 3) return [...pts];

  const out: Vector2[] = pruneCollinearPoints(
    best.points.map(
      ([nx, ny]) => new Vector2(minX + ((nx + 2) / 4) * spanX, minY + ((ny + 2) / 4) * spanY),
    ),
  );
  return ShapeUtils.isClockWise(out) ? out.reverse() : out;
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
 * Build a sharp terraced 3D mesh in millimeters (`1 unit = 1 mm`) sitting on `y = 0`:
 * - Prepends a dedicated outer rim shell expanded outward by `outerRimOffsetMm` (`2.0 mm`)
 *   around the outermost level.
 * - Mathematical levels `2 .. maxLevel` step downward by `heightScale` (`2.0 mm`) per layer,
 *   with a `heightScale` solid floor sitting directly on the `y = 0` build plate.
 * - Layers are colored from bottom (base) to top for 4-color print preview:
 *   base green, then black, then gray, then white.
 */
export function buildTerracedMeshGeometry(
  entries: ReadonlyArray<LevelCurveEntry>,
  heightScale = DEFAULT_LAYER_HEIGHT,
  mmPerUnit = MM_PER_UNIT,
  centerRe = CENTER_RE,
  outerRimOffsetMm = OUTER_RIM_OFFSET_MM,
): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  if (entries.length === 0) {
    const empty = new BufferGeometry();
    empty.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    return empty;
  }

  const colorFromBottom = (layerFromBottom: number): [number, number, number] => {
    const idx = Math.min(layerFromBottom, PRINT_PREVIEW_PALETTE.length - 1);
    const c = new Color(PRINT_PREVIEW_PALETTE[idx]);
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

  const levelIslands = entries.map((e) => {
    const srcIslands = e.islands && e.islands.length > 0 ? e.islands : [e.contour];
    return srcIslands
      .map((c) => cleanContourPointsMm(c.points, mmPerUnit, centerRe))
      .filter((pts) => pts.length >= 3 && Math.abs(ShapeUtils.area(pts)) >= 0.25);
  });

  const rawRings: Vector2[][][] = [];
  if (outerRimOffsetMm > 0 && levelIslands[0].length > 0) {
    rawRings.push([expandContourOutward(levelIslands[0][0], outerRimOffsetMm)]);
  }
  for (const islands of levelIslands) {
    if (islands.length > 0) {
      rawRings.push(islands);
    }
  }

  const totalLayers = rawRings.length;
  // Dish sits directly on y = 0: deepest floor is at y = heightScale, top rim at y = totalLayers * heightScale
  const rings = rawRings.map((islands, idx) => ({
    y: (totalLayers - idx) * heightScale,
    islands,
    rgb: colorFromBottom(totalLayers - 1 - idx),
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
    const earcutOuter = ccwOuter.map((p) => new Vector2(-p.x, -p.y));
    const earcutHoles = cwHoles.map((h) => h.map((p) => new Vector2(-p.x, -p.y)));
    const tris = ShapeUtils.triangulateShape(earcutOuter, earcutHoles);
    const area2 = (i0: number, i1: number, i2: number): number => {
      const p0 = allPts[i0];
      const p1 = allPts[i1];
      const p2 = allPts[i2];
      return (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
    };

    // Unfold any degenerate/reflex sliver ear (area2 <= 0) by flipping its shared diagonal
    // with the adjacent triangle in the quad, preserving 100% manifold boundary half-edges.
    for (let pass = 0; pass < 3; pass++) {
      let fixed = false;
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        if (area2(t[0], t[1], t[2]) > 1e-7) continue;

        for (let e = 0; e < 3; e++) {
          const ia = t[(e + 2) % 3];
          const ib = t[e];
          const ic = t[(e + 1) % 3];
          let found = false;
          for (let j = 0; j < tris.length; j++) {
            if (j === i) continue;
            const nTri = tris[j];
            for (let ne = 0; ne < 3; ne++) {
              if (nTri[ne] === ia && nTri[(ne + 1) % 3] === ic) {
                const id = nTri[(ne + 2) % 3];
                if (area2(ia, ib, id) > 1e-7 && area2(ib, ic, id) > 1e-7) {
                  tris[i] = [ia, ib, id];
                  tris[j] = [ib, ic, id];
                  fixed = true;
                  found = true;
                }
                break;
              }
            }
            if (found) break;
          }
          if (found) break;
        }
      }
      if (!fixed) break;
    }
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
        const ccwHole = ShapeUtils.isClockWise(hole) ? [...hole].reverse() : hole;
        addWall(ccwHole, curr.y, next.y, curr.rgb, true);
      }
    }
  }

  // Deepest contour islands are capped flat at their own height (no extra double-drop)
  const deepest = rings[rings.length - 1];
  for (const island of deepest.islands) {
    addCap(island, [], deepest.y, deepest.rgb, true);
  }

  // Outer wall subdivided at every layer height plus one solid floor step below deepest.y
  const rawOutermost = rings[0]?.islands[0];
  const outermost =
    rawOutermost && ShapeUtils.isClockWise(rawOutermost)
      ? [...rawOutermost].reverse()
      : rawOutermost;
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
      addWall(outermost, top.y, bot.y, top.rgb, false);
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
 * Convert a Y-up Three.js `BufferGeometry` (in mm, sitting on `y = 0`) into a binary STL
 * `ArrayBuffer` rotated `+90°` around X (`(x, y, z) -> (x, -z, y)`) so the dish sits flat
 * on the `Z = 0` build plate in Bambu Studio / 3D slicers with outward normals preserved.
 */
export function geometryToBinarySTL(geometry: BufferGeometry): ArrayBuffer {
  const pos = geometry.getAttribute('position');
  const numTris = Math.floor(pos.count / 3);
  const buffer = new ArrayBuffer(84 + numTris * 50);
  const view = new DataView(buffer);

  const header = 'Mandelbrot Soap Dish (mm)';
  for (let i = 0; i < header.length && i < 80; i++) {
    view.setUint8(i, header.charCodeAt(i));
  }
  view.setUint32(80, numTris, true);

  let offset = 84;
  for (let t = 0; t < numTris; t++) {
    const i0 = t * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;

    // Rotate Y-up (x, y, z) -> Z-up (x, -z, y)
    const ax = pos.getX(i0);
    const ay = -pos.getZ(i0);
    const az = pos.getY(i0);

    const bx = pos.getX(i1);
    const by = -pos.getZ(i1);
    const bz = pos.getY(i1);

    const cx = pos.getX(i2);
    const cy = -pos.getZ(i2);
    const cz = pos.getY(i2);

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen > 0) {
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
    }

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);

    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);

    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);

    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return buffer;
}

/**
 * Create a Three.js metric reference group (`1 unit = 1 mm`) with:
 * - A `180 x 180 mm` Bambu A1 mini build plate (`y in [-1.2, 0]`) with front cutout notch
 *   and front L-shaped calibration test print lines
 * - A `180 x 180 mm` grid with `10 mm` divisions on `y = 0.05`
 * - Colored `+X` (Re), `+Y` (Height), and `+Z` (Im) axis lines
 * - A scale-reference US Quarter (`24.26 mm` diameter x `1.75 mm` thick) at the front-right corner
 */
export function createReferenceAxes(): Group {
  const group = new Group();
  const half = BUILD_PLATE_SIZE_MM / 2; // 90 mm

  // Build plate shape in (x, -z) with rounded corners, rear wiper tab, and front notch cutout
  const plateShape = new Shape();
  const notchHalf = 28;
  const notchDepth = 4;
  plateShape.moveTo(-half, -half);
  plateShape.lineTo(-notchHalf, -half);
  plateShape.lineTo(-notchHalf + 3, -half + notchDepth);
  plateShape.lineTo(notchHalf - 3, -half + notchDepth);
  plateShape.lineTo(notchHalf, -half);
  plateShape.lineTo(half, -half);
  plateShape.lineTo(half, half);
  // Rear tab
  plateShape.lineTo(22, half);
  plateShape.lineTo(18, half + 6);
  plateShape.lineTo(-18, half + 6);
  plateShape.lineTo(-22, half);
  plateShape.lineTo(-half, half);
  plateShape.closePath();

  const plateGeom = new ExtrudeGeometry(plateShape, {
    depth: 1.2,
    bevelEnabled: false,
  });
  // Rotate from XY extrusion into XZ plane with top face at y = 0 and bottom at y = -1.2
  plateGeom.rotateX(-Math.PI / 2);
  plateGeom.translate(0, -1.2, 0);

  const plateMat = new MeshPhysicalMaterial({
    color: 0x22252b,
    roughness: 0.85,
    metalness: 0.15,
  });
  const plateMesh = new Mesh(plateGeom, plateMat);
  plateMesh.receiveShadow = true;
  group.add(plateMesh);

  // Front calibration test print / purge lines (along z = +82..84 mm near the front cutout)
  const makeTestLine = (pts: number[], color: number): Line => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    return new Line(geom, new LineBasicMaterial({ color }));
  };
  group.add(
    makeTestLine(
      [-75, 0.12, 83, -32, 0.12, 83, -32, 0.12, 81, -70, 0.12, 81],
      0x22c55e,
    ),
  );

  // 180 x 180 mm grid with 10 mm squares
  const grid = new GridHelper(BUILD_PLATE_SIZE_MM, 18, 0x3b4d5e, 0x2c303a);
  grid.position.y = 0.05;
  group.add(grid);

  const makeAxisLine = (end: [number, number, number], color: number): Line => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0.1, 0, ...end]), 3));
    const mat = new LineBasicMaterial({ color });
    return new Line(geom, mat);
  };

  // +X = Re (red), +Y = Height (green), +Z = Im (blue)
  group.add(makeAxisLine([half + 8, 0.1, 0], 0xff5555));
  group.add(makeAxisLine([0, DEFAULT_AXIS_HEIGHT, 0], 0x55dd77));
  group.add(makeAxisLine([0, 0.1, half + 8], 0x5599ff));

  // US Quarter scale reference (24.26 mm diameter x 1.75 mm thick) on front-right corner
  const quarterGeom = new CylinderGeometry(
    QUARTER_RADIUS_MM,
    QUARTER_RADIUS_MM,
    QUARTER_THICKNESS_MM,
    48,
  );
  const quarterMat = new MeshPhysicalMaterial({
    color: 0xd4d8de,
    roughness: 0.35,
    metalness: 0.85,
  });
  const quarterMesh = new Mesh(quarterGeom, quarterMat);
  quarterMesh.position.set(68, QUARTER_THICKNESS_MM / 2, 68);
  quarterMesh.castShadow = true;
  quarterMesh.receiveShadow = true;
  group.add(quarterMesh);

  return group;
}

/**
 * Side-by-side Three.js 3D view that renders stacked level-set curves or a printable terraced
 * soap-dish mesh in real-world millimeters (`1 unit = 1 mm`) on a `180 x 180 mm` build plate.
 */
export class Curve3DView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  private readonly curveGroup: Group;

  constructor(
    readonly canvas: HTMLCanvasElement,
    public heightScale = DEFAULT_LAYER_HEIGHT,
    public baseHeight = DEFAULT_BASE_HEIGHT,
  ) {
    this.scene = new Scene();
    this.scene.background = new Color(0x14161c);

    this.camera = new PerspectiveCamera(45, 1, 1, 2000);
    this.camera.position.set(145, 135, 185);

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 10, 0);
    this.controls.update();
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(createReferenceAxes());

    const ambient = new AmbientLight(0xffffff, 0.35);
    const keyLight = new DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(180, 130, 180);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -110;
    keyLight.shadow.camera.right = 110;
    keyLight.shadow.camera.top = 110;
    keyLight.shadow.camera.bottom = -110;
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 600;
    keyLight.shadow.bias = -0.0005;
    const fillLight = new DirectionalLight(0x88bbff, 0.3);
    fillLight.position.set(-160, 120, -120);
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
        const geometry = buildTerracedMeshGeometry(entries, this.heightScale);
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

  /**
   * Build and download a binary `.stl` file of the terraced soap dish for the given level stack.
   */
  exportSTL(maxLevel: number, maxIter: number, res = 1): void {
    const entries = buildLevelStack(maxLevel, maxIter, res);
    if (entries.length === 0) return;

    const geometry = buildTerracedMeshGeometry(entries, this.heightScale);
    const stlBuffer = geometryToBinarySTL(geometry);
    geometry.dispose();

    const blob = new Blob([stlBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mandelbrot-dish-L${Math.round(maxLevel)}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
