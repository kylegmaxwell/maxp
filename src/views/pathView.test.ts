import { describe, expect, it } from 'vitest';
import { PathView, pixelToComplex } from './pathView';

interface RecordedBezier {
  x0: number;
  y0: number;
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  x: number;
  y: number;
}

function makeMockCtx() {
  const beziers: RecordedBezier[] = [];
  const lines: Array<[number, number]> = [];
  let lastMove: [number, number] = [0, 0];

  const ctx = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    moveTo: (x: number, y: number) => {
      lastMove = [x, y];
    },
    lineTo: (x: number, y: number) => {
      lines.push([x, y]);
    },
    bezierCurveTo: (
      cp1x: number,
      cp1y: number,
      cp2x: number,
      cp2y: number,
      x: number,
      y: number,
    ) => {
      beziers.push({ x0: lastMove[0], y0: lastMove[1], cp1x, cp1y, cp2x, cp2y, x, y });
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, beziers, lines };
}

describe('pixelToComplex', () => {
  it('maps center to (0, 0) and corners to (-2, -2) and (2, 2)', () => {
    expect(pixelToComplex(50, 50, 100, 100)).toEqual([0, 0]);
    expect(pixelToComplex(0.5, 0.5, 100, 100)).toEqual([-2, -2]);
    expect(pixelToComplex(99.5, 99.5, 100, 100)).toEqual([2, 2]);
  });
});

describe('PathView', () => {
  it('keeps the final escaping segment once the orbit has ended', () => {
    // c = (1, 0): z0 = 1, z1 = 2 (escapes). At iter = 20 (step = 2, t = 0), segment 0->1 must still draw.
    const view = new PathView(1, 0, 201, 201, 20);
    const mock = makeMockCtx();
    view.render(mock.ctx);
    expect(mock.beziers.length + mock.lines.length).toBeGreaterThan(0);
  });

  it('does not pop the active segment when advancing to the next step', () => {
    // At iter = 5 (step = 0, t = 0.5) the first segment starts at z0 with the same initial tangent
    // as when completed at iter = 10 (step = 1, t = 0).
    const view = new PathView(-0.5, 0.5, 201, 201, 5);
    const mid = makeMockCtx();
    view.render(mid.ctx);

    view.iter = 10;
    const done = makeMockCtx();
    view.render(done.ctx);

    expect(mid.beziers).toHaveLength(1);
    expect(done.beziers).toHaveLength(1);
    // Initial tangent direction (cp1 - p0) is parallel (same curve, just split at t = 0.5)
    const m = mid.beziers[0];
    const d = done.beziers[0];
    expect(m.x0).toBeCloseTo(d.x0);
    expect(m.y0).toBeCloseTo(d.y0);
    const cross = (m.cp1x - m.x0) * (d.cp1y - d.y0) - (m.cp1y - m.y0) * (d.cp1x - d.x0);
    expect(cross).toBeCloseTo(0);
  });
});
