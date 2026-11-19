import { describe, expect, it } from 'vitest';
import { LevelView } from './levelView';

function makeMockCtx() {
  const moves: Array<[number, number]> = [];
  const lines: Array<[number, number]> = [];
  let closedCount = 0;
  let arcCount = 0;

  const ctx = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    lineJoin: 'round',
    lineCap: 'round',
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    stroke: () => {},
    fill: () => {},
    closePath: () => {
      closedCount++;
    },
    arc: () => {
      arcCount++;
    },
    moveTo: (x: number, y: number) => {
      moves.push([x, y]);
    },
    lineTo: (x: number, y: number) => {
      lines.push([x, y]);
    },
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    moves,
    lines,
    get closedCount() {
      return closedCount;
    },
    get arcCount() {
      return arcCount;
    },
  };
}

describe('LevelView', () => {
  it('extracts a contour passing near the clicked point and draws straight polyline segments', () => {
    const clickRe = 0.8;
    const clickIm = 0.6;
    const view = new LevelView(clickRe, clickIm, 129, 129, 20, 1);
    const { contours, primary } = view.extractContours(32, 4);

    expect(contours.length).toBeGreaterThan(0);
    expect(primary).not.toBeNull();

    // Primary contour should pass close to the clicked point
    let minDist = Infinity;
    for (const [x, y] of primary!.points) {
      minDist = Math.min(minDist, Math.hypot(x - clickRe, y - clickIm));
    }
    expect(minDist).toBeLessThan(0.15);

    const mock = makeMockCtx();
    view.render(mock.ctx);
    expect(mock.moves.length).toBe(contours.length);
    expect(mock.lines.length).toBeGreaterThan(10);
    expect(mock.arcCount).toBe(1); // clicked point marker
  });

  it('extracts the explicit nth level contour without a click point', () => {
    const view = new LevelView(null, null, 129, 129, 10, 1, 5);
    expect(view.level).toBe(5);
    const { contours, primary } = view.extractContours(32, 4);
    expect(contours).toHaveLength(1);
    expect(primary).toBe(contours[0]);
    expect(primary!.closed).toBe(true);

    const mock = makeMockCtx();
    view.render(mock.ctx);
    expect(mock.moves.length).toBe(1);
    expect(mock.arcCount).toBe(0); // no clicked point marker
  });
});
