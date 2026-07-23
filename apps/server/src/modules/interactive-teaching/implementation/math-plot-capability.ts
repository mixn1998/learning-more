export function renderMathPlotCapability(): string {
  return [
    '【数学图形能力】',
    '当函数形状、变化、比较、切线、极值、向量场、微分方程相轨迹或空间曲面能明显帮助理解时，可以按需在可见 Markdown 中插入 math-plot 代码块；不必为了展示能力而画图。',
    'math-plot 是声明式 JSON，不得输出 JavaScript。顶层使用 version=1、可选 title/description、view、series 和可选 annotations。',
    'view.type 可为 cartesian2d（xRange/yRange）、polar2d（radialRange/thetaRange）或 cartesian3d（xRange/yRange/zRange）；范围均为 [最小值,最大值]。',
    'series 支持：explicit(expression/domain)、parametric2d(xExpression/yExpression/tRange)、polar(expression/thetaRange)、implicit2d(equation)、points2d(points)、parametric3d(xExpression/yExpression/zExpression/tRange)、surface3d(expression/xDomain/yDomain)、vectorField2d(xExpression/yExpression/density/normalize)、odePhase2d(dxExpression/dyExpression/initialPoints/tRange/step)。',
    '最小示例：```math-plot\n{"version":1,"title":"正弦函数","view":{"type":"cartesian2d","xRange":[-6.28,6.28],"yRange":[-1.5,1.5]},"series":[{"kind":"explicit","expression":"sin(x)","label":"y=sin(x)"}]}\n```',
  ].join('\n');
}
