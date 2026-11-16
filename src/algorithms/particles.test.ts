import { describe, expect, it } from 'vitest';
import { cellLattice, inBounds, ParticleSim, pixelLattice, STRIDE, type Lattice } from './particles';

/** A lattice made of explicit starting points. */
function points(...cs: Array<[number, number]>): Lattice {
  return {
    cx: Float64Array.from(cs.map(([re]) => re)),
    cy: Float64Array.from(cs.map(([, im]) => im)),
  };
}

describe('inBounds', () => {
  it('uses a disc or a box', () => {
    expect(inBounds('disc', 1.5, 1.5)).toBe(false); // |z|^2 = 4.5
    expect(inBounds('box', 1.5, 1.5)).toBe(true);
    expect(inBounds('disc', 2, 0)).toBe(false); // the edge is out
    expect(inBounds('box', 2, 0)).toBe(false);
    expect(inBounds('disc', 0, 0)).toBe(true);
  });
});

describe('lattices', () => {
  it('pixelLattice covers the corners and has one point per pixel', () => {
    const { cx, cy } = pixelLattice(5, 5);
    expect(cx).toHaveLength(25);
    expect([cx[0], cy[0]]).toEqual([-2, -2]);
    expect(cx[24]).toBeCloseTo(2);
    expect(cy[24]).toBeCloseTo(2);
    expect(cx[12]).toBeCloseTo(0); // center pixel
  });

  it('cellLattice puts one point at the center of each cell', () => {
    const { cx, cy } = cellLattice(64, 64, 16); // 4 x 4 cells
    expect(cx).toHaveLength(16);
    // cell (col 2, row 1) has its center at pixel (40, 24)
    expect(cx[1 * 4 + 2]).toBeCloseTo((40 - 32) / (63 / 4));
    expect(cy[1 * 4 + 2]).toBeCloseTo((24 - 32) / (63 / 4));
  });
});

describe('ParticleSim', () => {
  it('starts every particle at its own c, in every stored state', () => {
    const sim = new ParticleSim(points([0.5, 0.25], [-1, 0]), 2, 'disc');
    for (const k of [0, 1, 2]) {
      expect(Array.from(sim.past(k))).toEqual([0.5, 0.25, 0.5, 0.25, -1, 0, -1, 0]);
    }
  });

  it('takes a Mandelbrot step and keeps the previous state', () => {
    const sim = new ParticleSim(points([0.5, 0]), 1, 'disc');
    sim.step();
    // z: 0.5 -> 0.5^2 + 0.5 = 0.75
    expect(sim.current[0]).toBeCloseTo(0.75);
    expect(sim.past(1)[0]).toBeCloseTo(0.5);
    expect(sim.steps).toBe(1);
    sim.step();
    expect(sim.current[0]).toBeCloseTo(0.75 * 0.75 + 0.5);
    expect(sim.past(1)[0]).toBeCloseTo(0.75);
  });

  it('freezes a particle once it leaves the bounds', () => {
    const sim = new ParticleSim(points([1, 0]), 1, 'disc');
    sim.step(); // z = 1 -> 2, which is on the edge and so out
    expect(sim.current[0]).toBe(2);
    expect(sim.liveCount()).toBe(0);
    sim.step();
    sim.step();
    expect(sim.current[0]).toBe(2); // stays put
  });

  it('never moves a particle that starts outside', () => {
    const sim = new ParticleSim(points([3, 0]), 1, 'disc');
    sim.step();
    expect(sim.current[0]).toBe(3);
  });

  it('uses the chosen bounds', () => {
    const disc = new ParticleSim(points([1.6, 1.2]), 1, 'disc');
    const box = new ParticleSim(points([1.6, 1.2]), 1, 'box');
    disc.step();
    box.step();
    expect(disc.current[0]).toBe(1.6); // outside the disc from the start, so it stays
    expect(box.current[0]).not.toBe(1.6); // inside the box, so it moves
  });

  it('advanceTo is the same whether done in one go or in pieces', () => {
    const lattice = pixelLattice(12, 12);
    const direct = new ParticleSim(lattice, 3, 'box');
    const pieces = new ParticleSim(lattice, 3, 'box');
    direct.advanceTo(9);
    pieces.advanceTo(2);
    pieces.advanceTo(5);
    pieces.advanceTo(9);
    for (let k = 0; k <= 3; k++) {
      expect(Array.from(pieces.past(k))).toEqual(Array.from(direct.past(k)));
    }
  });

  it('advanceTo a lower step re-simulates from the start', () => {
    const lattice = pixelLattice(12, 12);
    const fresh = new ParticleSim(lattice, 1, 'disc');
    const back = new ParticleSim(lattice, 1, 'disc');
    fresh.advanceTo(4);
    back.advanceTo(10);
    back.advanceTo(4);
    expect(back.steps).toBe(4);
    expect(Array.from(back.current)).toEqual(Array.from(fresh.current));
  });

  it('keeps the start point c fixed in the state', () => {
    const sim = new ParticleSim(points([0.3, 0.2]), 1, 'disc');
    sim.advanceTo(5);
    expect(sim.current[2]).toBe(0.3);
    expect(sim.current[3]).toBe(0.2);
    expect(sim.current).toHaveLength(STRIDE);
  });

  it('the number of live particles never goes up', () => {
    const sim = new ParticleSim(pixelLattice(40, 40), 1, 'disc');
    let last = sim.liveCount();
    for (let n = 1; n <= 30; n++) {
      sim.step();
      const live = sim.liveCount();
      expect(live).toBeLessThanOrEqual(last);
      last = live;
    }
  });

  it('about 9% of particles are still moving from iter 49 to 50', () => {
    const sim = new ParticleSim(pixelLattice(60, 60), 1, 'disc');
    sim.advanceTo(50);
    const cur = sim.current;
    const prev = sim.past(1);
    let moved = 0;
    for (let i = 0; i < sim.count; i++) {
      const o = i * STRIDE;
      if (cur[o] !== prev[o] || cur[o + 1] !== prev[o + 1]) moved++;
    }
    const ratio = moved / sim.count;
    expect(ratio).toBeGreaterThan(0.06);
    expect(ratio).toBeLessThan(0.14);
  });
});

