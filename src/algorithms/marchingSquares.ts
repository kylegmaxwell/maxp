/** A stitched contour polyline in complex-plane coordinates `[-2, 2] x [-2, 2]`. */
export interface Contour {
  /** Ordered vertices `[re, im]` along the contour. */
  points: Array<[number, number]>;
  /** True if the contour forms a closed loop; false if it begins and ends on the grid boundary. */
  closed: boolean;
}

/**
 * Lookup table mapping each 4-bit cell corner mask (0..15) to pairs of cell edges `[eA, eB]`.
 *
 * Corner bits:
 * - bit 3 (8): top-left     (c, r)
 * - bit 2 (4): top-right    (c + 1, r)
 * - bit 1 (2): bottom-right (c + 1, r + 1)
 * - bit 0 (1): bottom-left  (c, r + 1)
 *
 * Cell edges:
 * - 0: top    (top-left to top-right)
 * - 1: right  (top-right to bottom-right)
 * - 2: bottom (bottom-right to bottom-left)
 * - 3: left   (bottom-left to top-left)
 *
 * Saddle cases 5 and 10 are resolved dynamically using the cell center average.
 */
const SINGLE_SEGMENTS: ReadonlyArray<readonly [number, number] | null> = [
  null, // 0
  [3, 2], // 1
  [2, 1], // 2
  [3, 1], // 3
  [0, 1], // 4
  null, // 5 (saddle)
  [0, 2], // 6
  [3, 0], // 7
  [3, 0], // 8
  [0, 2], // 9
  null, // 10 (saddle)
  [0, 1], // 11
  [3, 1], // 12
  [2, 1], // 13
  [3, 2], // 14
  null, // 15
];

/**
 * Extract exact level-set contours at `level` from a `width x height` scalar grid
 * covering `[-2, 2] x [-2, 2]` row by row, using Marching Squares and edge stitching.
 */
export function marchingSquares(
  values: Float32Array | Float64Array,
  width: number,
  height: number,
  level: number,
): Contour[] {
  const cols = width - 1;
  const rows = height - 1;
  if (cols <= 0 || rows <= 0) return [];

  const cstep = 4 / cols;
  const rstep = 4 / rows;
  const vOffset = height * cols;

  // Map from canonical edge ID -> interpolated [re, im] vertex
  const vertices = new Map<number, [number, number]>();
  // Adjacency map from canonical edge ID -> neighbor edge IDs (at most 2)
  const adj = new Map<number, number[]>();

  const getHEdge = (r: number, c: number): number => {
    const id = r * cols + c;
    if (!vertices.has(id)) {
      const idx = r * width + c;
      const va = values[idx];
      const vb = values[idx + 1];
      const denom = vb - va;
      const t = denom === 0 ? 0.5 : Math.min(1, Math.max(0, (level - va) / denom));
      vertices.set(id, [-2 + (c + t) * cstep, -2 + r * rstep]);
    }
    return id;
  };

  const getVEdge = (r: number, c: number): number => {
    const id = vOffset + r * width + c;
    if (!vertices.has(id)) {
      const idx = r * width + c;
      const va = values[idx];
      const vb = values[idx + width];
      const denom = vb - va;
      const t = denom === 0 ? 0.5 : Math.min(1, Math.max(0, (level - va) / denom));
      vertices.set(id, [-2 + c * cstep, -2 + (r + t) * rstep]);
    }
    return id;
  };

  const cellEdgeId = (r: number, c: number, edge: number): number => {
    switch (edge) {
      case 0:
        return getHEdge(r, c);
      case 1:
        return getVEdge(r, c + 1);
      case 2:
        return getHEdge(r + 1, c);
      default:
        return getVEdge(r, c);
    }
  };

  const addSegment = (idA: number, idB: number): void => {
    let listA = adj.get(idA);
    if (!listA) {
      listA = [];
      adj.set(idA, listA);
    }
    listA.push(idB);

    let listB = adj.get(idB);
    if (!listB) {
      listB = [];
      adj.set(idB, listB);
    }
    listB.push(idA);
  };

  for (let r = 0; r < rows; r++) {
    const rowOffset = r * width;
    const nextRowOffset = (r + 1) * width;
    for (let c = 0; c < cols; c++) {
      const v0 = values[rowOffset + c];
      const v1 = values[rowOffset + c + 1];
      const v2 = values[nextRowOffset + c + 1];
      const v3 = values[nextRowOffset + c];

      const mask =
        (v0 >= level ? 8 : 0) |
        (v1 >= level ? 4 : 0) |
        (v2 >= level ? 2 : 0) |
        (v3 >= level ? 1 : 0);

      if (mask === 0 || mask === 15) continue;

      const single = SINGLE_SEGMENTS[mask];
      if (single) {
        addSegment(cellEdgeId(r, c, single[0]), cellEdgeId(r, c, single[1]));
      } else {
        const centerHigh = 0.25 * (v0 + v1 + v2 + v3) >= level;
        if ((mask === 5 && centerHigh) || (mask === 10 && !centerHigh)) {
          addSegment(cellEdgeId(r, c, 3), cellEdgeId(r, c, 0));
          addSegment(cellEdgeId(r, c, 2), cellEdgeId(r, c, 1));
        } else {
          addSegment(cellEdgeId(r, c, 0), cellEdgeId(r, c, 1));
          addSegment(cellEdgeId(r, c, 3), cellEdgeId(r, c, 2));
        }
      }
    }
  }

  // Stitch segments into ordered polylines
  const visited = new Set<number>();
  const contours: Contour[] = [];

  const walk = (startId: number, closed: boolean): void => {
    const points: Array<[number, number]> = [];
    let curr: number | undefined = startId;
    while (curr !== undefined && !visited.has(curr)) {
      visited.add(curr);
      points.push(vertices.get(curr)!);
      const neighbors = adj.get(curr)!;
      let next: number | undefined;
      for (let i = 0; i < neighbors.length; i++) {
        if (!visited.has(neighbors[i])) {
          next = neighbors[i];
          break;
        }
      }
      curr = next;
    }
    if (points.length >= 2) {
      contours.push({ points, closed });
    }
  };

  // First walk all open paths starting at degree-1 boundary nodes
  for (const [id, neighbors] of adj) {
    if (neighbors.length === 1 && !visited.has(id)) {
      walk(id, false);
    }
  }

  // Remaining unvisited nodes form closed loops (all degree 2)
  for (const [id] of adj) {
    if (!visited.has(id)) {
      walk(id, true);
    }
  }

  return contours;
}

/**
 * Find the contour with a vertex closest to `(re, im)`, or `null` if `contours` is empty.
 */
export function closestContour(contours: Contour[], re: number, im: number): Contour | null {
  let best: Contour | null = null;
  let bestDist2 = Infinity;
  for (const contour of contours) {
    for (const [px, py] of contour.points) {
      const dx = px - re;
      const dy = py - im;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        best = contour;
      }
    }
  }
  return best;
}

/** Total Euclidean arc length (perimeter) of a contour. */
export function contourPerimeter(contour: Contour): number {
  const { points, closed } = contour;
  const n = points.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    sum += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  if (closed && n > 2) {
    sum += Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  }
  return sum;
}

/** Return the contour with the largest perimeter, or `null` if `contours` is empty. */
export function largestContour(contours: Contour[]): Contour | null {
  let best: Contour | null = null;
  let bestPerim = -1;
  for (const c of contours) {
    const p = contourPerimeter(c);
    if (p > bestPerim) {
      bestPerim = p;
      best = c;
    }
  }
  return best;
}

/** Shoelace signed area of a closed polygon (positive = CCW in standard (x, y) coords). */
function signedArea(points: ReadonlyArray<[number, number]>): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  return 0.5 * area;
}

/** Return a copy of `points` oriented counter-clockwise (`signedArea >= 0`). */
function ensureCCW(points: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const copy = points.map(([x, y]): [number, number] => [x, y]);
  if (signedArea(copy) < 0) copy.reverse();
  return copy;
}

/**
 * Construct a subdivided doubled bridge between `pA` and `pB` that climbs the
 * scalar field gradient onto the connecting filament ridge / level contour.
 */
function buildLightningBridge(
  pA: [number, number],
  pB: [number, number],
  level: number,
  field: (re: number, im: number) => number,
  stepSize: number,
): { outgoing: Array<[number, number]>; returning: Array<[number, number]> } {
  const dist = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
  const segments = Math.max(2, Math.min(48, Math.ceil(dist / Math.max(1e-4, stepSize))));
  const spine: Array<[number, number]> = [];
  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    spine.push([pA[0] + t * (pB[0] - pA[0]), pA[1] + t * (pB[1] - pA[1])]);
  }

  const h = Math.max(1e-4, stepSize * 0.2);
  const iterations = 16;

  // Relax interior spine vertices onto the connecting filament ridge (uphill toward `level`)
  for (let iter = 0; iter < iterations; iter++) {
    // Decaying step size prevents medium-frequency oscillation on steep/high-level ridges
    const maxStep = stepSize * 0.65 * (1 - 0.6 * (iter / iterations));

    for (let k = 1; k < segments; k++) {
      const prev = spine[k - 1];
      const next = spine[k + 1];
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-8) continue;

      const tx = dx / len;
      const ty = dy / len;
      const nx = ty;
      const ny = -tx;

      // Tangential centering + gentle normal fairing keeps the bridge smooth
      const midX = 0.5 * (prev[0] + next[0]);
      const midY = 0.5 * (prev[1] + next[1]);
      const curr = spine[k];
      const dmx = midX - curr[0];
      const dmy = midY - curr[1];
      const tangShift = (dmx * tx + dmy * ty) * 0.5;
      const normSmooth = (dmx * nx + dmy * ny) * 0.15;
      let x = curr[0] + tangShift * tx + normSmooth * nx;
      let y = curr[1] + tangShift * ty + normSmooth * ny;

      // Climb normal gradient toward `level` (or ridge peak if saddle < `level`)
      const v0 = field(x, y);
      const vp = field(x + h * nx, y + h * ny);
      const vm = field(x - h * nx, y - h * ny);
      const gn = (vp - vm) / (2 * h);

      if (Math.abs(gn) > 1e-5) {
        const rawDelta = (level - v0) / gn;
        const delta = Math.max(-maxStep, Math.min(maxStep, rawDelta));
        for (const scale of [1, 0.5, 0.25]) {
          const cx = x + delta * scale * nx;
          const cy = y + delta * scale * ny;
          const vc = field(cx, cy);
          if (Math.abs(vc - level) < Math.abs(v0 - level) || (v0 < level && vc > v0)) {
            x = cx;
            y = cy;
            break;
          }
        }
      }

      spine[k] = [x, y];
    }
  }

  // Build outgoing and return walls offset slightly along right/left normals
  const wallOffset = stepSize * 0.1;
  const outgoing: Array<[number, number]> = [];
  const returning: Array<[number, number]> = [];

  for (let k = 1; k < segments; k++) {
    const prev = spine[k - 1];
    const next = spine[k + 1];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    // Right-hand normal of pA -> pB
    const nx = dy / len;
    const ny = -dx / len;
    const [sx, sy] = spine[k];
    outgoing.push([sx + wallOffset * nx, sy + wallOffset * ny]);
    returning.push([sx - wallOffset * nx, sy - wallOffset * ny]);
  }

  returning.reverse();
  return { outgoing, returning };
}

/**
 * Connect all closed contour islands into a single watertight closed loop by
 * iteratively bridging the closest unconnected island into the growing perimeter
 * (Prim's Minimum Spanning Tree order, so island chains connect sequentially).
 */
export function connectAndRefineContours(
  contours: Contour[],
  level: number,
  field: (re: number, im: number) => number,
  cellSize = 4 / 256,
): Contour | null {
  if (contours.length === 0) return null;

  const main = largestContour(contours);
  if (!main) return null;

  // Keep all non-degenerate islands caught by Marching Squares resolution, oriented CCW
  const remaining = contours
    .filter((c) => c !== main && c.points.length >= 3)
    .map((c) => ensureCCW(c.points));
  let mainPoints = ensureCCW(main.points);

  const stepSize = cellSize * 0.5;

  while (remaining.length > 0) {
    let bestLoopIdx = -1;
    let bestMainVert = -1;
    let bestSubVert = -1;
    let bestDist2 = Infinity;

    for (let l = 0; l < remaining.length; l++) {
      const subPts = remaining[l];
      for (let i = 0; i < mainPoints.length; i++) {
        const [ax, ay] = mainPoints[i];
        for (let j = 0; j < subPts.length; j++) {
          const dx = subPts[j][0] - ax;
          const dy = subPts[j][1] - ay;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestLoopIdx = l;
            bestMainVert = i;
            bestSubVert = j;
          }
        }
      }
    }

    if (bestLoopIdx < 0) break;

    const subPoints = remaining.splice(bestLoopIdx, 1)[0];
    const pA = mainPoints[bestMainVert];
    const pB = subPoints[bestSubVert];

    const { outgoing, returning } = buildLightningBridge(pA, pB, level, field, stepSize);

    // Splice `subPoints` into `mainPoints` via the doubled bridge so subsequent islands
    // can chain off this newly attached island rather than jumping back to the core
    mainPoints = [
      ...mainPoints.slice(0, bestMainVert + 1),
      ...outgoing,
      ...subPoints.slice(bestSubVert),
      ...subPoints.slice(0, bestSubVert + 1),
      ...returning,
      ...mainPoints.slice(bestMainVert),
    ];
  }

  return { points: mainPoints, closed: true };
}
