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
