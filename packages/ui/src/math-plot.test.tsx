// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseMathPlotContract } from './math-plot-contract.js';

const graph = vi.hoisted(() => {
  const viewCreate = vi.fn();
  const boardCreate = vi.fn((type: string) => (type === 'view3d' ? { create: viewCreate } : {}));
  const board = { create: boardCreate, resizeContainer: vi.fn() };
  return {
    viewCreate,
    boardCreate,
    board,
    initBoard: vi.fn(() => board),
    freeBoard: vi.fn(),
  };
});

vi.mock('jsxgraph', () => ({
  default: {
    JSXGraph: { initBoard: graph.initBoard, freeBoard: graph.freeBoard },
  },
}));

import { MathPlot } from './math-plot.js';

function contract(raw: unknown) {
  const parsed = parseMathPlotContract(JSON.stringify(raw));
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.value;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MathPlot', () => {
  it('creates explicit, implicit, vector-field, phase-trajectory, and annotation elements', () => {
    const spec = contract({
      version: 1,
      title: '二维动力系统',
      view: { type: 'cartesian2d', xRange: [-4, 4], yRange: [-4, 4] },
      series: [
        { kind: 'explicit', expression: 'x^2' },
        { kind: 'implicit2d', equation: 'x^2+y^2=4' },
        { kind: 'vectorField2d', xExpression: 'y', yExpression: '-x', density: 8 },
        {
          kind: 'odePhase2d',
          dxExpression: 'y',
          dyExpression: '-x',
          initialPoints: [[1, 0]],
          tRange: [-2, 2],
          step: 0.05,
        },
      ],
      annotations: [{ x: 1, y: 1, label: '观察点' }],
    });

    render(<MathPlot spec={spec} />);

    expect(graph.initBoard).toHaveBeenCalledOnce();
    expect(graph.boardCreate.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['functiongraph', 'implicitcurve', 'vectorfield', 'curve', 'point']),
    );
    expect(screen.getByText('二维动力系统')).toBeVisible();
    expect(screen.getByText(/dx\/dt=y/)).toBeInTheDocument();
  });

  it('creates a 3D view with parametric curves, surfaces, and points', () => {
    const spec = contract({
      version: 1,
      title: '空间函数',
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
      annotations: [{ x: 0, y: 0, z: 0, label: '原点' }],
    });

    render(<MathPlot spec={spec} />);

    expect(graph.boardCreate).toHaveBeenCalledWith('view3d', expect.anything(), expect.anything());
    expect(graph.viewCreate.mock.calls.map(([type]) => type)).toEqual([
      'curve3d',
      'functiongraph3d',
      'point3d',
    ]);
  });

  it('frees the JSXGraph board when the message leaves the page', () => {
    const spec = contract({
      version: 1,
      view: { type: 'polar2d', radialRange: [0, 4], thetaRange: [0, 6.28] },
      series: [{ kind: 'polar', expression: '2*cos(theta)', thetaRange: [0, 6.28] }],
    });
    const rendered = render(<MathPlot spec={spec} />);

    rendered.unmount();

    expect(graph.freeBoard).toHaveBeenCalledWith(graph.board);
  });
});
