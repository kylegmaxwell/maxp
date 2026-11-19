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
  return extractFromIndexedCells(values, width, height, level);
}

/**
 * Core Marching Squares extractor operating either on all cells of `values`
 * or on an explicit list of active coarse cell blocks `(cr, cc)` subdivided by `subdiv`.
 */
function extractFromIndexedCells(
  values: Float32Array | Float64Array,
  width: number,
  height: number,
  level: number,
  activeCoarseCells?: ReadonlyArray<readonly [number, number]>,
  subdiv = 1,
): Contour[] {
  const cols = width - 1;
  const rows = height - 1;
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

  const processCell = (r: number, c: number): void => {
    const rowOffset = r * width;
    const nextRowOffset = (r + 1) * width;
    const v0 = values[rowOffset + c];
    const v1 = values[rowOffset + c + 1];
    const v2 = values[nextRowOffset + c + 1];
    const v3 = values[nextRowOffset + c];

    const mask =
      (v0 >= level ? 8 : 0) |
      (v1 >= level ? 4 : 0) |
      (v2 >= level ? 2 : 0) |
      (v3 >= level ? 1 : 0);

    if (mask === 0 || mask === 15) return;

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
  };

  if (activeCoarseCells) {
    for (const [cr, cc] of activeCoarseCells) {
      const r0 = cr * subdiv;
      const c0 = cc * subdiv;
      for (let dr = 0; dr < subdiv; dr++) {
        for (let dc = 0; dc < subdiv; dc++) {
          processCell(r0 + dr, c0 + dc);
        }
      }
    }
  } else {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        processCell(r, c);
      }
    }
  }

  // Stitch segments into ordered polylines
  const visited = new Set<number>();
  const contours: Contour[] = [];
  const openPaths: Array<Array<[number, number]>> = [];

  const walkPoints = (startId: number): Array<[number, number]> => {
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
    return points;
  };

  // Collect all open paths starting at degree-1 boundary nodes
  for (const [id, neighbors] of adj) {
    if (neighbors.length === 1 && !visited.has(id)) {
      const pts = walkPoints(id);
      if (pts.length >= 2) openPaths.push(pts);
    }
  }

  // Chain open boundary arcs (e.g. when a contour grazes the [-2, 2] box edges at (-2, 0) or level = 1)
  // by repeatedly joining the closest boundary endpoints instead of closing each arc with an interior chord.
  while (openPaths.length > 0) {
    const chain = openPaths.shift()!;
    while (openPaths.length > 0) {
      const tail = chain[chain.length - 1];
      let bestIdx = -1;
      let bestReverse = false;
      let bestD2 = Infinity;

      for (let i = 0; i < openPaths.length; i++) {
        const cand = openPaths[i];
        const headCand = cand[0];
        const tailCand = cand[cand.length - 1];
        const dHead2 = (headCand[0] - tail[0]) ** 2 + (headCand[1] - tail[1]) ** 2;
        if (dHead2 < bestD2) {
          bestD2 = dHead2;
          bestIdx = i;
          bestReverse = false;
        }
        const dTail2 = (tailCand[0] - tail[0]) ** 2 + (tailCand[1] - tail[1]) ** 2;
        if (dTail2 < bestD2) {
          bestD2 = dTail2;
          bestIdx = i;
          bestReverse = true;
        }
      }

      // Only chain open arcs whose boundary endpoints meet near the same boundary touch point
      const dSelf2 = (chain[0][0] - tail[0]) ** 2 + (chain[0][1] - tail[1]) ** 2;
      if (bestIdx < 0 || dSelf2 <= bestD2) break;

      const nextArc = openPaths.splice(bestIdx, 1)[0];
      if (bestReverse) nextArc.reverse();
      chain.push(...nextArc);
    }
    const head = chain[0];
    const tail = chain[chain.length - 1];
    const closedOnBoundary = Math.hypot(head[0] - tail[0], head[1] - tail[1]) < 0.25;
    contours.push({ points: chain, closed: closedOnBoundary });
  }

  // Remaining unvisited nodes form closed loops (all degree 2)
  for (const [id] of adj) {
    if (!visited.has(id)) {
      const pts = walkPoints(id);
      if (pts.length >= 2) contours.push({ points: pts, closed: true });
    }
  }

  return contours;
}

/**
 * Coarse-to-fine (band) Marching Squares cache.
 * Evaluates a coarse `(coarseCells + 1)^2` grid upfront, then on `extract(level)`
 * lazily subdivides only the narrow band of coarse cells near `level` into
 * `subdiv x subdiv` fine sub-cells on a conformal `(coarseCells * subdiv + 1)^2` lattice.
 */
export class BandContourGrid {
  readonly coarseSize: number;
  readonly fineCells: number;
  readonly fineSize: number;
  readonly coarseValues: Float32Array;
  readonly fineValues: Float32Array;
  private readonly fineStep: number;

  constructor(
    readonly field: (re: number, im: number) => number,
    readonly coarseCells = 128,
    readonly subdiv = 8,
  ) {
    this.coarseSize = coarseCells + 1;
    this.fineCells = coarseCells * subdiv;
    this.fineSize = this.fineCells + 1;
    this.fineStep = 4 / this.fineCells;
    this.coarseValues = new Float32Array(this.coarseSize * this.coarseSize);
    this.fineValues = new Float32Array(this.fineSize * this.fineSize);
    this.fineValues.fill(NaN);

    const coarseStep = 4 / coarseCells;
    for (let cr = 0; cr <= coarseCells; cr++) {
      const im = -2 + cr * coarseStep;
      const fr = cr * subdiv;
      for (let cc = 0; cc <= coarseCells; cc++) {
        const re = -2 + cc * coarseStep;
        const v = field(re, im);
        this.coarseValues[cr * this.coarseSize + cc] = v;
        this.fineValues[fr * this.fineSize + cc * subdiv] = v;
      }
    }
  }

  /** Extract Marching Squares contours at `level` at full fine resolution (`fineSize x fineSize`). */
  extract(level: number): Contour[] {
    const { coarseCells, coarseSize, subdiv, fineSize, fineStep, coarseValues, fineValues, field } =
      this;
    const inQueue = new Uint8Array(coarseCells * coarseCells);
    const queue: number[] = [];
    const active: Array<[number, number]> = [];

    const enqueue = (cr: number, cc: number): void => {
      const idx = cr * coarseCells + cc;
      if (inQueue[idx]) return;
      inQueue[idx] = 1;
      queue.push(idx);
    };

    // Seed with coarse cells whose 3x3 coarse neighborhood straddles `level`
    for (let cr = 0; cr < coarseCells; cr++) {
      const rMin = Math.max(0, cr - 1);
      const rMax = Math.min(coarseCells, cr + 2);
      for (let cc = 0; cc < coarseCells; cc++) {
        const cMin = Math.max(0, cc - 1);
        const cMax = Math.min(coarseCells, cc + 2);
        let vMin = Infinity;
        let vMax = -Infinity;
        for (let r = rMin; r <= rMax; r++) {
          const rowOff = r * coarseSize;
          for (let c = cMin; c <= cMax; c++) {
            const v = coarseValues[rowOff + c];
            if (v < vMin) vMin = v;
            if (v > vMax) vMax = v;
          }
        }

        // Seed if coarse vertices straddle `level`, OR if the neighborhood has a steep
        // filament shoulder (`vMax >= 6` and `vMax - vMin >= 2.5`) whose fine core may reach `level`
        const hasFilament = vMax >= 6 && vMax - vMin >= 2.5;
        if (vMin <= level && (vMax >= level || hasFilament)) {
          enqueue(cr, cc);
        }
      }
    }

    // BFS propagation: populate fine vertices and expand across any border that straddles `level`
    // so a fine contour can NEVER be clipped at an active/inactive coarse cell boundary.
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const cr = Math.floor(idx / coarseCells);
      const cc = idx % coarseCells;
      active.push([cr, cc]);

      const fr0 = cr * subdiv;
      const fc0 = cc * subdiv;
      for (let dr = 0; dr <= subdiv; dr++) {
        const fr = fr0 + dr;
        const fRowOff = fr * fineSize;
        const im = -2 + fr * fineStep;
        for (let dc = 0; dc <= subdiv; dc++) {
          const fc = fc0 + dc;
          const fIdx = fRowOff + fc;
          if (Number.isNaN(fineValues[fIdx])) {
            fineValues[fIdx] = field(-2 + fc * fineStep, im);
          }
        }
      }

      // Check top border (dr = 0)
      if (cr > 0) {
        let hasLow = false;
        let hasHigh = false;
        const fRowOff = fr0 * fineSize;
        for (let dc = 0; dc <= subdiv; dc++) {
          if (fineValues[fRowOff + fc0 + dc] >= level) hasHigh = true;
          else hasLow = true;
        }
        if (hasLow && hasHigh) enqueue(cr - 1, cc);
      }

      // Check bottom border (dr = subdiv)
      if (cr + 1 < coarseCells) {
        let hasLow = false;
        let hasHigh = false;
        const fRowOff = (fr0 + subdiv) * fineSize;
        for (let dc = 0; dc <= subdiv; dc++) {
          if (fineValues[fRowOff + fc0 + dc] >= level) hasHigh = true;
          else hasLow = true;
        }
        if (hasLow && hasHigh) enqueue(cr + 1, cc);
      }

      // Check left border (dc = 0)
      if (cc > 0) {
        let hasLow = false;
        let hasHigh = false;
        for (let dr = 0; dr <= subdiv; dr++) {
          if (fineValues[(fr0 + dr) * fineSize + fc0] >= level) hasHigh = true;
          else hasLow = true;
        }
        if (hasLow && hasHigh) enqueue(cr, cc - 1);
      }

      // Check right border (dc = subdiv)
      if (cc + 1 < coarseCells) {
        let hasLow = false;
        let hasHigh = false;
        const fcRight = fc0 + subdiv;
        for (let dr = 0; dr <= subdiv; dr++) {
          if (fineValues[(fr0 + dr) * fineSize + fcRight] >= level) hasHigh = true;
          else hasLow = true;
        }
        if (hasLow && hasHigh) enqueue(cr, cc + 1);
      }
    }

    if (active.length === 0) return [];
    return extractFromIndexedCells(fineValues, fineSize, fineSize, level, active, subdiv);
  }
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
 * Connect contour islands into a single watertight closed loop by building a
 * Euclidean Minimum Spanning Tree (Prim's algorithm) across the islands and
 * splicing them via a depth-first Euler tour over refined doubled bridges.
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

  // Put `main` at index 0, followed by all non-degenerate satellite islands
  const loops: Array<Array<[number, number]>> = [
    ensureCCW(main.points),
    ...contours
      .filter((c) => c !== main && c.points.length >= 3)
      .map((c) => ensureCCW(c.points)),
  ];

  const kCount = loops.length;
  if (kCount === 1) {
    return { points: loops[0], closed: true };
  }

  // Precompute axis-aligned bounding boxes for fast loop-to-loop distance pruning
  const boxes = loops.map((pts) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  });

  const boxDist2 = (a: number, b: number): number => {
    const ba = boxes[a];
    const bb = boxes[b];
    const dx = Math.max(0, ba.minX - bb.maxX, bb.minX - ba.maxX);
    const dy = Math.max(0, ba.minY - bb.maxY, bb.minY - ba.maxY);
    return dx * dx + dy * dy;
  };

  // Prim's MST state: for each unconnected loop `u`, track its closest attachment to the tree
  const inTree = new Uint8Array(kCount);
  const bestDist2 = new Float64Array(kCount).fill(Infinity);
  const bestParentLoop = new Int32Array(kCount).fill(-1);
  const bestParentVert = new Int32Array(kCount).fill(-1);
  const bestChildVert = new Int32Array(kCount).fill(-1);

  interface ChildAttachment {
    childLoop: number;
    parentVert: number;
    childVert: number;
    outgoing: Array<[number, number]>;
    returning: Array<[number, number]>;
  }

  const childrenByLoop: ChildAttachment[][] = Array.from({ length: kCount }, () => []);
  const stepSize = cellSize * 0.5;

  const updateDistancesFrom = (treeLoop: number): void => {
    const treePts = loops[treeLoop];
    for (let u = 1; u < kCount; u++) {
      if (inTree[u]) continue;
      if (boxDist2(treeLoop, u) >= bestDist2[u]) continue;

      const subPts = loops[u];
      let d2Min = bestDist2[u];
      let iBest = bestParentVert[u];
      let jBest = bestChildVert[u];
      let improved = false;

      for (let i = 0; i < treePts.length; i++) {
        const [ax, ay] = treePts[i];
        for (let j = 0; j < subPts.length; j++) {
          const dx = subPts[j][0] - ax;
          const dy = subPts[j][1] - ay;
          const d2 = dx * dx + dy * dy;
          if (d2 < d2Min) {
            d2Min = d2;
            iBest = i;
            jBest = j;
            improved = true;
          }
        }
      }

      if (improved) {
        bestDist2[u] = d2Min;
        bestParentLoop[u] = treeLoop;
        bestParentVert[u] = iBest;
        bestChildVert[u] = jBest;
      }
    }
  };

  inTree[0] = 1;
  updateDistancesFrom(0);

  for (let step = 1; step < kCount; step++) {
    let nextLoop = -1;
    let minD2 = Infinity;
    for (let u = 1; u < kCount; u++) {
      if (!inTree[u] && bestDist2[u] < minD2) {
        minD2 = bestDist2[u];
        nextLoop = u;
      }
    }
    if (nextLoop < 0) break;

    inTree[nextLoop] = 1;
    const pLoop = bestParentLoop[nextLoop];
    const pVert = bestParentVert[nextLoop];
    const cVert = bestChildVert[nextLoop];
    const pA = loops[pLoop][pVert];
    const pB = loops[nextLoop][cVert];
    const { outgoing, returning } = buildLightningBridge(pA, pB, level, field, stepSize);

    childrenByLoop[pLoop].push({
      childLoop: nextLoop,
      parentVert: pVert,
      childVert: cVert,
      outgoing,
      returning,
    });

    updateDistancesFrom(nextLoop);
  }

  // Depth-first Euler tour splices all child loops into a single closed polygon
  // without ever shifting or invalidating parent vertex indices
  const out: Array<[number, number]> = [];

  const emitLoop = (loopIdx: number, startVert: number): void => {
    const pts = loops[loopIdx];
    const n = pts.length;
    const attachments = childrenByLoop[loopIdx];

    for (let offset = 0; offset < n; offset++) {
      const v = (startVert + offset) % n;
      out.push(pts[v]);

      for (let a = 0; a < attachments.length; a++) {
        const att = attachments[a];
        if (att.parentVert === v) {
          for (const p of att.outgoing) out.push(p);
          emitLoop(att.childLoop, att.childVert);
          out.push(loops[att.childLoop][att.childVert]);
          for (const p of att.returning) out.push(p);
          out.push(pts[v]);
        }
      }
    }
  };

  emitLoop(0, 0);
  return { points: out, closed: true };
}
