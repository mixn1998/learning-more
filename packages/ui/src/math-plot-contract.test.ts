import { describe, expect, it } from 'vitest';

import { parseMathPlotContract } from './math-plot-contract.js';

describe('parseMathPlotContract', () => {
  it('accepts every supported mathematical series and strips inert metadata', () => {
    const parsed = parseMathPlotContract(
      JSON.stringify({
        version: 1,
        title: '完整函数图像',
        ignoredMetadata: { phase: 'internal' },
        view: { type: 'cartesian2d', xRange: [-6, 6], yRange: [-6, 6] },
        series: [
          { kind: 'explicit', expression: 'x^2', label: '抛物线' },
          { kind: 'parametric2d', xExpression: 'cos(t)', yExpression: 'sin(t)', tRange: [0, 6.28] },
          { kind: 'implicit2d', equation: 'x^2+y^2=4' },
          {
            kind: 'points2d',
            points: [
              [0, 0],
              [1, 1],
            ],
          },
          { kind: 'vectorField2d', xExpression: 'y', yExpression: '-x', density: 12 },
          {
            kind: 'odePhase2d',
            dxExpression: 'y',
            dyExpression: '-x',
            initialPoints: [[1, 0]],
            tRange: [-5, 5],
            step: 0.05,
          },
        ],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.series).toHaveLength(6);
    expect(parsed.value).not.toHaveProperty('ignoredMetadata');
  });

  it('accepts polar and three-dimensional series in their matching views', () => {
    const polar = parseMathPlotContract(
      JSON.stringify({
        version: 1,
        view: { type: 'polar2d', radialRange: [0, 4], thetaRange: [0, 6.283] },
        series: [{ kind: 'polar', expression: '2*cos(3*theta)', thetaRange: [0, 6.283] }],
      }),
    );
    const spatial = parseMathPlotContract(
      JSON.stringify({
        version: 1,
        view: {
          type: 'cartesian3d',
          xRange: [-3, 3],
          yRange: [-3, 3],
          zRange: [-3, 3],
        },
        series: [
          {
            kind: 'parametric3d',
            xExpression: 'cos(t)',
            yExpression: 'sin(t)',
            zExpression: 't/3',
            tRange: [-6, 6],
          },
          {
            kind: 'surface3d',
            expression: 'sin(x)*cos(y)',
            xDomain: [-3, 3],
            yDomain: [-3, 3],
          },
        ],
      }),
    );

    expect(polar.ok).toBe(true);
    expect(spatial.ok).toBe(true);
  });

  it('rejects unknown versions, unknown series, incompatible views, and excessive integration', () => {
    const base = {
      version: 1,
      view: { type: 'cartesian2d', xRange: [-5, 5], yRange: [-5, 5] },
    };

    expect(
      parseMathPlotContract(JSON.stringify({ ...base, version: 2, series: [] })),
    ).toMatchObject({
      ok: false,
      code: 'unsupported_version',
    });
    expect(
      parseMathPlotContract(
        JSON.stringify({ ...base, series: [{ kind: 'javascript', code: 'alert(1)' }] }),
      ),
    ).toMatchObject({ ok: false, code: 'contract_invalid' });
    expect(
      parseMathPlotContract(
        JSON.stringify({
          ...base,
          series: [{ kind: 'surface3d', expression: 'x+y', xDomain: [-1, 1], yDomain: [-1, 1] }],
        }),
      ),
    ).toMatchObject({ ok: false, code: 'view_series_mismatch' });
    expect(
      parseMathPlotContract(
        JSON.stringify({
          ...base,
          series: [
            {
              kind: 'odePhase2d',
              dxExpression: 'y',
              dyExpression: '-x',
              initialPoints: [[1, 0]],
              tRange: [-100, 100],
              step: 0.001,
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, code: 'contract_invalid' });
  });
});
