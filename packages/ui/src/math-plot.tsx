import { useEffect, useId, useMemo, useState } from 'react';
import JXG from 'jsxgraph';

import type { MathPlotContract, MathPlotSeries } from './math-plot-contract.js';
import { integratePhaseTrajectory } from './math-plot-sampling.js';
import { compileSafeMathExpression, type SafeMathEvaluator } from './safe-math-expression.js';

const tones = {
  accent: '#b9683d',
  blue: '#286f9b',
  green: '#3d7d68',
  purple: '#735f9b',
  orange: '#c27a28',
  red: '#a84e4e',
} as const;
const automaticTones = ['accent', 'blue', 'green', 'purple', 'orange', 'red'] as const;

interface PlotBoard {
  create(type: string, parents: unknown, attributes?: Record<string, unknown>): unknown;
  resizeContainer?(width: number, height: number, dontSetCanvasSize?: boolean): void;
}

interface PlotView3d {
  create(type: string, parents: unknown, attributes?: Record<string, unknown>): unknown;
}

function lineAttributes(series: MathPlotSeries, index: number): Record<string, unknown> {
  const tone = series.tone ?? automaticTones[index % automaticTones.length] ?? 'accent';
  return {
    name: series.label ?? '',
    withLabel: false,
    strokeColor: tones[tone],
    highlightStrokeColor: tones[tone],
    strokeWidth: 2.5,
    fixed: true,
    dash: series.lineStyle === 'dashed' ? 2 : series.lineStyle === 'dotted' ? 1 : 0,
  };
}

function finite(evaluate: SafeMathEvaluator, scope: Readonly<Record<string, number>>): number {
  return evaluate(scope) ?? Number.NaN;
}

function equationEvaluators(equation: string): readonly [SafeMathEvaluator, SafeMathEvaluator] {
  const parts = equation.split('=');
  if (parts.length > 2) throw new Error('implicit_equation_invalid');
  const left = compileSafeMathExpression(parts[0]?.trim() || '0', ['x', 'y']);
  const right = compileSafeMathExpression(parts[1]?.trim() || '0', ['x', 'y']);
  return [left, right];
}

function vectorComponents(
  xExpression: string,
  yExpression: string,
  normalize: boolean,
): readonly [(x: number, y: number) => number, (x: number, y: number) => number] {
  const xEvaluator = compileSafeMathExpression(xExpression, ['x', 'y']);
  const yEvaluator = compileSafeMathExpression(yExpression, ['x', 'y']);
  const vector = (x: number, y: number): readonly [number, number] => {
    const dx = xEvaluator({ x, y });
    const dy = yEvaluator({ x, y });
    if (dx === undefined || dy === undefined) return [0, 0];
    const magnitude = Math.hypot(dx, dy);
    if (magnitude === 0) return [0, 0];
    const divisor = normalize ? magnitude : Math.max(1, magnitude);
    return [dx / divisor, dy / divisor];
  };
  return [(x, y) => vector(x, y)[0], (x, y) => vector(x, y)[1]];
}

function createCartesian2d(board: PlotBoard, spec: MathPlotContract): void {
  if (spec.view.type !== 'cartesian2d') return;
  const { xRange, yRange } = spec.view;

  spec.series.forEach((series, index) => {
    const attributes = lineAttributes(series, index);
    if (series.kind === 'explicit') {
      const evaluator = compileSafeMathExpression(series.expression, ['x']);
      board.create(
        'functiongraph',
        [(x: number) => finite(evaluator, { x }), ...(series.domain ?? xRange)],
        attributes,
      );
      return;
    }
    if (series.kind === 'parametric2d') {
      const xEvaluator = compileSafeMathExpression(series.xExpression, ['t']);
      const yEvaluator = compileSafeMathExpression(series.yExpression, ['t']);
      board.create(
        'curve',
        [
          (t: number) => finite(xEvaluator, { t }),
          (t: number) => finite(yEvaluator, { t }),
          ...series.tRange,
        ],
        attributes,
      );
      return;
    }
    if (series.kind === 'implicit2d') {
      const [left, right] = equationEvaluators(series.equation);
      board.create(
        'implicitcurve',
        [
          (x: number, y: number) => finite(left, { x, y }) - finite(right, { x, y }),
          xRange,
          yRange,
        ],
        { ...attributes, resolutionOuter: 10, resolutionInner: 10 },
      );
      return;
    }
    if (series.kind === 'points2d') {
      series.points.forEach(([x, y], pointIndex) => {
        board.create('point', [x, y], {
          ...attributes,
          name: pointIndex === 0 ? (series.label ?? '') : '',
          size: 3,
          withLabel: pointIndex === 0 && Boolean(series.label),
        });
      });
      return;
    }
    if (series.kind === 'vectorField2d') {
      const [dx, dy] = vectorComponents(series.xExpression, series.yExpression, series.normalize);
      const scale =
        0.42 *
        Math.min(
          (xRange[1] - xRange[0]) / series.density,
          (yRange[1] - yRange[0]) / series.density,
        );
      board.create(
        'vectorfield',
        [
          [dx, dy],
          [xRange[0], series.density, xRange[1]],
          [yRange[0], series.density, yRange[1]],
        ],
        {
          ...attributes,
          strokeWidth: 1.2,
          scale,
          arrowHead: { enabled: true, size: 5, angle: Math.PI / 8 },
        },
      );
      return;
    }
    if (series.kind === 'odePhase2d') {
      const dx = compileSafeMathExpression(series.dxExpression, ['x', 'y', 't']);
      const dy = compileSafeMathExpression(series.dyExpression, ['x', 'y', 't']);
      series.initialPoints.forEach((initial) => {
        const trajectory = integratePhaseTrajectory({
          dx,
          dy,
          initial,
          tRange: series.tRange,
          step: series.step,
          bounds: [xRange[0], yRange[1], xRange[1], yRange[0]],
        });
        board.create(
          'curve',
          [trajectory.map((point) => point[0]), trajectory.map((point) => point[1])],
          attributes,
        );
        board.create('point', initial, { ...attributes, name: '', size: 2, withLabel: false });
      });
    }
  });
}

function createPolar2d(board: PlotBoard, spec: MathPlotContract): void {
  if (spec.view.type !== 'polar2d') return;
  spec.series.forEach((series, index) => {
    if (series.kind !== 'polar') return;
    const evaluator = compileSafeMathExpression(series.expression, ['theta']);
    const radius = (theta: number) => finite(evaluator, { theta });
    board.create(
      'curve',
      [
        (theta: number) => radius(theta) * Math.cos(theta),
        (theta: number) => radius(theta) * Math.sin(theta),
        ...series.thetaRange,
      ],
      lineAttributes(series, index),
    );
  });
}

function createCartesian3d(board: PlotBoard, spec: MathPlotContract): void {
  if (spec.view.type !== 'cartesian3d') return;
  const view = board.create(
    'view3d',
    [
      [-6, -3],
      [8, 8],
      [spec.view.xRange, spec.view.yRange, spec.view.zRange],
    ],
    {
      xPlaneRear: { visible: false },
      yPlaneRear: { visible: false },
      zPlaneRear: { visible: false },
    },
  ) as PlotView3d;

  spec.series.forEach((series, index) => {
    const attributes = lineAttributes(series, index);
    if (series.kind === 'parametric3d') {
      const xEvaluator = compileSafeMathExpression(series.xExpression, ['t']);
      const yEvaluator = compileSafeMathExpression(series.yExpression, ['t']);
      const zEvaluator = compileSafeMathExpression(series.zExpression, ['t']);
      view.create(
        'curve3d',
        [
          (t: number) => finite(xEvaluator, { t }),
          (t: number) => finite(yEvaluator, { t }),
          (t: number) => finite(zEvaluator, { t }),
          series.tRange,
        ],
        attributes,
      );
      return;
    }
    if (series.kind === 'surface3d') {
      const evaluator = compileSafeMathExpression(series.expression, ['x', 'y']);
      view.create(
        'functiongraph3d',
        [(x: number, y: number) => finite(evaluator, { x, y }), series.xDomain, series.yDomain],
        { ...attributes, stepsU: 45, stepsV: 45, strokeWidth: 0.8 },
      );
    }
  });

  spec.annotations.forEach((annotation) => {
    if (annotation.z === undefined) return;
    view.create('point3d', [annotation.x, annotation.y, annotation.z], {
      name: annotation.label,
      withLabel: true,
      fixed: true,
      size: 3,
      color: tones.accent,
    });
  });
}

function createBoard(containerId: string, spec: MathPlotContract): JXG.Board {
  const is3d = spec.view.type === 'cartesian3d';
  const range =
    spec.view.type === 'cartesian2d'
      ? ([
          spec.view.xRange[0],
          spec.view.yRange[1],
          spec.view.xRange[1],
          spec.view.yRange[0],
        ] as const)
      : spec.view.type === 'polar2d'
        ? ([
            -spec.view.radialRange[1],
            spec.view.radialRange[1],
            spec.view.radialRange[1],
            -spec.view.radialRange[1],
          ] as const)
        : ([-8, 8, 8, -8] as const);
  const board = JXG.JSXGraph.initBoard(containerId, {
    boundingbox: [...range],
    axis: !is3d,
    showCopyright: false,
    showNavigation: true,
    pan: { enabled: true, needTwoFingers: true },
    zoom: { wheel: true, needShift: false },
    keepAspectRatio: spec.view.type !== 'cartesian2d',
  });
  try {
    const plotBoard = board as unknown as PlotBoard;
    if (spec.view.type === 'cartesian2d') createCartesian2d(plotBoard, spec);
    if (spec.view.type === 'polar2d') createPolar2d(plotBoard, spec);
    if (spec.view.type === 'cartesian3d') createCartesian3d(plotBoard, spec);

    if (spec.view.type !== 'cartesian3d') {
      spec.annotations.forEach((annotation) => {
        plotBoard.create('point', [annotation.x, annotation.y], {
          name: annotation.label,
          withLabel: true,
          fixed: true,
          size: 3,
          color: tones.accent,
        });
      });
    }
  } catch (error) {
    JXG.JSXGraph.freeBoard(board);
    throw error;
  }
  return board;
}

function seriesSummary(series: MathPlotSeries): string {
  const name = series.label ? `${series.label}：` : '';
  switch (series.kind) {
    case 'explicit':
    case 'polar':
    case 'surface3d':
      return `${name}${series.expression}`;
    case 'parametric2d':
      return `${name}x=${series.xExpression}，y=${series.yExpression}`;
    case 'implicit2d':
      return `${name}${series.equation}`;
    case 'points2d':
      return `${name}${series.points.length} 个离散点`;
    case 'parametric3d':
      return `${name}x=${series.xExpression}，y=${series.yExpression}，z=${series.zExpression}`;
    case 'vectorField2d':
      return `${name}向量场 (${series.xExpression}, ${series.yExpression})`;
    case 'odePhase2d':
      return `${name}dx/dt=${series.dxExpression}，dy/dt=${series.dyExpression}`;
  }
}

export function MathPlot(props: { readonly spec: MathPlotContract }): React.JSX.Element {
  const reactId = useId();
  const boardId = useMemo(() => `lm-math-plot-${reactId.replaceAll(':', '')}`, [reactId]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let board: JXG.Board | undefined;
    let observer: ResizeObserver | undefined;
    try {
      board = createBoard(boardId, props.spec);
      const container = document.getElementById(boardId);
      if (container && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(([entry]) => {
          const width = Math.floor(entry?.contentRect.width ?? 0);
          const height = Math.floor(entry?.contentRect.height ?? 0);
          if (width > 0 && height > 0) {
            (board as unknown as PlotBoard | undefined)?.resizeContainer?.(width, height);
          }
        });
        observer.observe(container);
      }
    } catch {
      setError(true);
    }

    return () => {
      observer?.disconnect();
      if (board) JXG.JSXGraph.freeBoard(board);
    };
  }, [boardId, props.spec]);

  return (
    <figure className="lm-math-plot" aria-label={props.spec.title ?? '交互式函数图像'}>
      {props.spec.title ? <figcaption>{props.spec.title}</figcaption> : null}
      {props.spec.description ? (
        <p className="lm-math-plot-description">{props.spec.description}</p>
      ) : null}
      {error ? (
        <div className="lm-math-plot-board lm-math-plot-runtime-fallback">
          <p className="lm-math-plot-runtime-error">函数图像暂时无法渲染，请参考下方表达式。</p>
        </div>
      ) : (
        <div
          id={boardId}
          className={`lm-math-plot-board jxgbox ${props.spec.view.type === 'cartesian3d' ? 'is-3d' : ''}`}
        />
      )}
      <details className="lm-math-plot-summary">
        <summary>查看图中表达式</summary>
        <ul>
          {props.spec.series.map((series, index) => (
            <li key={`${series.kind}-${index}`}>{seriesSummary(series)}</li>
          ))}
        </ul>
      </details>
    </figure>
  );
}
