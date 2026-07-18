import { z } from 'zod';

const MAX_SERIES = 12;
const MAX_POINTS = 500;
const MAX_ODE_STEPS = 4_000;

const finiteNumber = z.number().finite();
const expression = z.string().trim().min(1).max(500);
const label = z.string().trim().min(1).max(120).optional();
const tone = z.enum(['accent', 'blue', 'green', 'purple', 'orange', 'red']).optional();
const lineStyle = z.enum(['solid', 'dashed', 'dotted']).optional();
const range = z
  .tuple([finiteNumber, finiteNumber])
  .refine(([start, end]) => start < end && end - start <= 1_000_000, 'range_invalid');
const point2d = z.tuple([finiteNumber, finiteNumber]);

const cartesian2dView = z.object({
  type: z.literal('cartesian2d'),
  xRange: range,
  yRange: range,
  xLabel: z.string().trim().max(40).optional(),
  yLabel: z.string().trim().max(40).optional(),
});

const polar2dView = z.object({
  type: z.literal('polar2d'),
  radialRange: range.refine(([start]) => start >= 0, 'radial_range_negative'),
  thetaRange: range,
});

const cartesian3dView = z.object({
  type: z.literal('cartesian3d'),
  xRange: range,
  yRange: range,
  zRange: range,
  xLabel: z.string().trim().max(40).optional(),
  yLabel: z.string().trim().max(40).optional(),
  zLabel: z.string().trim().max(40).optional(),
});

const commonSeries = { label, tone, lineStyle };

const explicitSeries = z.object({
  kind: z.literal('explicit'),
  expression,
  domain: range.optional(),
  ...commonSeries,
});

const parametric2dSeries = z.object({
  kind: z.literal('parametric2d'),
  xExpression: expression,
  yExpression: expression,
  tRange: range,
  ...commonSeries,
});

const polarSeries = z.object({
  kind: z.literal('polar'),
  expression,
  thetaRange: range,
  ...commonSeries,
});

const implicit2dSeries = z.object({
  kind: z.literal('implicit2d'),
  equation: expression,
  ...commonSeries,
});

const points2dSeries = z.object({
  kind: z.literal('points2d'),
  points: z.array(point2d).min(1).max(MAX_POINTS),
  ...commonSeries,
});

const parametric3dSeries = z.object({
  kind: z.literal('parametric3d'),
  xExpression: expression,
  yExpression: expression,
  zExpression: expression,
  tRange: range,
  ...commonSeries,
});

const surface3dSeries = z.object({
  kind: z.literal('surface3d'),
  expression,
  xDomain: range,
  yDomain: range,
  ...commonSeries,
});

const vectorField2dSeries = z.object({
  kind: z.literal('vectorField2d'),
  xExpression: expression,
  yExpression: expression,
  density: z.number().int().min(4).max(25).default(14),
  normalize: z.boolean().default(true),
  ...commonSeries,
});

const odePhase2dSeries = z
  .object({
    kind: z.literal('odePhase2d'),
    dxExpression: expression,
    dyExpression: expression,
    initialPoints: z.array(point2d).min(1).max(12),
    tRange: range.refine(([start, end]) => start <= 0 && end >= 0, 'ode_range_must_include_zero'),
    step: finiteNumber.min(0.001).max(0.5).default(0.03),
    ...commonSeries,
  })
  .refine(
    ({ tRange, step }) => Math.ceil((tRange[1] - tRange[0]) / step) <= MAX_ODE_STEPS,
    'ode_step_limit_exceeded',
  );

const series = z.discriminatedUnion('kind', [
  explicitSeries,
  parametric2dSeries,
  polarSeries,
  implicit2dSeries,
  points2dSeries,
  parametric3dSeries,
  surface3dSeries,
  vectorField2dSeries,
  odePhase2dSeries,
]);

const annotation = z.object({
  x: finiteNumber,
  y: finiteNumber,
  z: finiteNumber.optional(),
  label: z.string().trim().min(1).max(120),
});

const contract = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(600).optional(),
    view: z.discriminatedUnion('type', [cartesian2dView, polar2dView, cartesian3dView]),
    series: z.array(series).min(1).max(MAX_SERIES),
    annotations: z.array(annotation).max(24).default([]),
  })
  .superRefine((value, context) => {
    const allowed =
      value.view.type === 'cartesian3d'
        ? new Set(['parametric3d', 'surface3d'])
        : value.view.type === 'polar2d'
          ? new Set(['polar'])
          : new Set([
              'explicit',
              'parametric2d',
              'implicit2d',
              'points2d',
              'vectorField2d',
              'odePhase2d',
            ]);
    value.series.forEach((item, index) => {
      if (!allowed.has(item.kind)) {
        context.addIssue({
          code: 'custom',
          path: ['series', index, 'kind'],
          message: 'view_series_mismatch',
        });
      }
    });
  });

export type MathPlotContract = z.infer<typeof contract>;
export type MathPlotSeries = MathPlotContract['series'][number];

export type MathPlotContractErrorCode =
  'json_invalid' | 'unsupported_version' | 'contract_invalid' | 'view_series_mismatch';

export type MathPlotContractResult =
  | { readonly ok: true; readonly value: MathPlotContract }
  | { readonly ok: false; readonly code: MathPlotContractErrorCode; readonly detail: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseMathPlotContract(source: string): MathPlotContractResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, code: 'json_invalid', detail: '函数图像描述不是有效 JSON。' };
  }

  const version = record(raw)?.version;
  if (version !== 1) {
    return { ok: false, code: 'unsupported_version', detail: '函数图像协议版本不受支持。' };
  }

  const parsed = contract.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const mismatch = parsed.error.issues.some((issue) => issue.message === 'view_series_mismatch');
  return {
    ok: false,
    code: mismatch ? 'view_series_mismatch' : 'contract_invalid',
    detail: mismatch ? '图像类型与坐标系不匹配。' : '函数图像描述缺少必要信息。',
  };
}
