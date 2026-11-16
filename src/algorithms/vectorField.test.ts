import { describe, expect, it } from 'vitest';
import { VectorFieldSim } from './vectorField';

const SIZE = 64; // 4 x 4 cells at spacing = 16

/** Cell (col 2, row 1): its center is c = 0.508 - 0.508i, inside the set's disc. */
const CELL = 1 * 4 + 2;

function sim(iter: number, size = SIZE, spacing = 16): VectorFieldSim {
  const s = new VectorFieldSim(size, size, spacing);
  s.advanceTo(iter);
  return s;
}

describe('VectorFieldSim', () => {
  it('points from c to c^2 after one iteration', () => {
    const { fx, fy } = sim(1);
    // c = (a, -a): c^2 = (0, -2a^2), so straight "down" the imaginary axis
    expect(fx[CELL]).toBeCloseTo(0);
    expect(fy[CELL]).toBeLessThan(0);
  });

  it('points from c to z_n, which updates as iter goes up', () => {
    const a = (40 - 32) / (63 / 4);
    const cRe = a;
    const cIm = -a;
    const z1Re = cRe * cRe - cIm * cIm + cRe;
    const z1Im = 2 * cRe * cIm + cIm;
    const z2Re = z1Re * z1Re - z1Im * z1Im + cRe;
    const z2Im = 2 * z1Re * z1Im + cIm;

    const s = sim(2);
    expect(s.fx[CELL]).toBeCloseTo(z2Re - cRe);
    expect(s.fy[CELL]).toBeCloseTo(z2Im - cIm);
  });

  it('clears escaped particles to zero', () => {
    const early = sim(1);
    const late = sim(60);
    const nonZero = (s: VectorFieldSim) => {
      let n = 0;
      for (let i = 0; i < s.fx.length; i++) {
        if (s.fx[i] !== 0 || s.fy[i] !== 0) n++;
      }
      return n;
    };
    expect(nonZero(late)).toBeLessThan(nonZero(early));
  });

  it('gives the same field in one go as in pieces', () => {
    const direct = sim(20);
    const pieces = new VectorFieldSim(SIZE, SIZE, 16);
    pieces.advanceTo(5);
    pieces.advanceTo(12);
    pieces.advanceTo(20);
    expect(Array.from(pieces.fx)).toEqual(Array.from(direct.fx));
    expect(Array.from(pieces.fy)).toEqual(Array.from(direct.fy));
  });

  it('re-simulates from the start when iter goes down', () => {
    const fresh = sim(10);
    const back = new VectorFieldSim(SIZE, SIZE, 16);
    back.advanceTo(30);
    back.advanceTo(10);
    expect(Array.from(back.fx)).toEqual(Array.from(fresh.fx));
    expect(Array.from(back.fy)).toEqual(Array.from(fresh.fy));
  });

  it('only a small share of the particles stay live as iterations grow', () => {
    const s = new VectorFieldSim(480, 480, 16);
    const live: number[] = [];
    for (const n of [1, 3, 10, 50, 100]) {
      s.advanceTo(n);
      live.push(s.liveCount() / s.particleCount);
    }
    for (let i = 1; i < live.length; i++) expect(live[i]).toBeLessThanOrEqual(live[i - 1]);
    expect(live[0]).toBeGreaterThan(0.25);
    expect(live[live.length - 1]).toBeGreaterThan(0.04);
    expect(live[live.length - 1]).toBeLessThan(0.15);
  });

  it('only the ~9% of vectors inside the set still change from iter 49 to 50', () => {
    const s = new VectorFieldSim(480, 480, 16);
    s.advanceTo(49);
    const prevFx = Float64Array.from(s.fx);
    const prevFy = Float64Array.from(s.fy);

    s.advanceTo(50);
    let changed = 0;
    for (let i = 0; i < s.fx.length; i++) {
      if (s.fx[i] !== prevFx[i] || s.fy[i] !== prevFy[i]) changed++;
    }
    const ratio = changed / s.particleCount;
    expect(changed).toBeGreaterThan(s.liveCount() * 0.8);
    expect(ratio).toBeGreaterThan(0.06);
    expect(ratio).toBeLessThan(0.14);
  });
});
