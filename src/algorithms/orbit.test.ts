import { describe, expect, it } from 'vitest';
import { traceOrbit } from './orbit';

describe('traceOrbit', () => {
  it('starts at c and stays bounded for points in the set', () => {
    const pts = traceOrbit(-1, 0, 4);
    // Period-2 cycle: -1 -> 0 -> -1 -> 0 -> -1
    expect(Array.from(pts)).toEqual([-1, 0, 0, 0, -1, 0, 0, 0, -1, 0]);
  });

  it('stops after the first step that leaves bounds', () => {
    // c = 1: z0 = 1, z1 = 2 (on disc edge -> out), stops
    const pts = traceOrbit(1, 0, 10, 'disc');
    expect(Array.from(pts)).toEqual([1, 0, 2, 0]);
  });

  it('returns only c if c starts outside bounds', () => {
    const pts = traceOrbit(3, 0, 10, 'disc');
    expect(Array.from(pts)).toEqual([3, 0]);
  });

  it('returns only c when steps is 0', () => {
    const pts = traceOrbit(0.25, -0.5, 0);
    expect(Array.from(pts)).toEqual([0.25, -0.5]);
  });
});
