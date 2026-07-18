import type { MathScope, SafeMathEvaluator } from './safe-math-expression.js';

export type SampledPoint2d = readonly [number, number] | null;

export function sampleExpression(
  evaluate: SafeMathEvaluator,
  domain: readonly [number, number],
  samples = 320,
): readonly SampledPoint2d[] {
  const count = Math.max(2, Math.min(1_000, Math.floor(samples)));
  const step = (domain[1] - domain[0]) / (count - 1);
  return Array.from({ length: count }, (_, index) => {
    const x = domain[0] + index * step;
    const y = evaluate({ x });
    return y === undefined ? null : ([x, y] as const);
  });
}

export interface PhaseTrajectoryInput {
  readonly dx: SafeMathEvaluator;
  readonly dy: SafeMathEvaluator;
  readonly initial: readonly [number, number];
  readonly tRange: readonly [number, number];
  readonly step: number;
  readonly bounds: readonly [number, number, number, number];
}

function derivative(
  input: Pick<PhaseTrajectoryInput, 'dx' | 'dy'>,
  x: number,
  y: number,
  t: number,
): readonly [number, number] | undefined {
  const scope: MathScope = { x, y, t };
  const dx = input.dx(scope);
  const dy = input.dy(scope);
  return dx === undefined || dy === undefined ? undefined : [dx, dy];
}

function rk4(
  input: Pick<PhaseTrajectoryInput, 'dx' | 'dy'>,
  point: readonly [number, number],
  t: number,
  step: number,
): readonly [number, number] | undefined {
  const k1 = derivative(input, point[0], point[1], t);
  if (!k1) return undefined;
  const k2 = derivative(
    input,
    point[0] + (step * k1[0]) / 2,
    point[1] + (step * k1[1]) / 2,
    t + step / 2,
  );
  if (!k2) return undefined;
  const k3 = derivative(
    input,
    point[0] + (step * k2[0]) / 2,
    point[1] + (step * k2[1]) / 2,
    t + step / 2,
  );
  if (!k3) return undefined;
  const k4 = derivative(input, point[0] + step * k3[0], point[1] + step * k3[1], t + step);
  if (!k4) return undefined;

  const x = point[0] + (step / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  const y = point[1] + (step / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

function inside(
  point: readonly [number, number],
  bounds: readonly [number, number, number, number],
): boolean {
  return (
    point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] <= bounds[1] && point[1] >= bounds[3]
  );
}

function integrateDirection(
  input: PhaseTrajectoryInput,
  target: number,
  direction: -1 | 1,
): readonly (readonly [number, number])[] {
  const points: (readonly [number, number])[] = [input.initial];
  let point = input.initial;
  let t = 0;
  let steps = 0;

  while ((direction > 0 ? t < target : t > target) && steps < 4_000) {
    const remaining = Math.abs(target - t);
    const signedStep = direction * Math.min(input.step, remaining);
    const next = rk4(input, point, t, signedStep);
    if (!next || !inside(next, input.bounds)) break;
    t += signedStep;
    point = next;
    points.push(point);
    steps += 1;
  }
  return points;
}

export function integratePhaseTrajectory(
  input: PhaseTrajectoryInput,
): readonly (readonly [number, number])[] {
  const backward = integrateDirection(input, input.tRange[0], -1).slice(1).reverse();
  const forward = integrateDirection(input, input.tRange[1], 1);
  return [...backward, ...forward].slice(0, 4_001);
}
