import { describe, expect, it } from 'vitest';

import { integratePhaseTrajectory, sampleExpression } from './math-plot-sampling.js';

describe('math plot sampling', () => {
  it('splits an explicit curve at undefined values', () => {
    const points = sampleExpression(
      (scope) => {
        const x = scope.x ?? Number.NaN;
        return x === 0 ? undefined : 1 / x;
      },
      [-1, 1],
      5,
    );
    expect(points.map((point) => point?.[1] ?? null)).toEqual([-1, -2, null, 2, 1]);
  });

  it('integrates a stable harmonic oscillator with bounded RK4 error', () => {
    const trajectory = integratePhaseTrajectory({
      dx: ({ y }) => y,
      dy: ({ x = Number.NaN }) => -x,
      initial: [1, 0],
      tRange: [0, Math.PI / 2],
      step: 0.02,
      bounds: [-2, 2, 2, -2],
    });
    const last = trajectory.at(-1);
    expect(last?.[0]).toBeCloseTo(0, 2);
    expect(last?.[1]).toBeCloseTo(-1, 2);
    expect(trajectory.length).toBeLessThanOrEqual(4_001);
  });

  it('stops integration when the trajectory leaves the protected viewport', () => {
    const trajectory = integratePhaseTrajectory({
      dx: () => 100,
      dy: () => 0,
      initial: [0, 0],
      tRange: [0, 10],
      step: 0.1,
      bounds: [-1, 1, 1, -1],
    });
    expect(trajectory.length).toBeLessThan(10);
  });
});
