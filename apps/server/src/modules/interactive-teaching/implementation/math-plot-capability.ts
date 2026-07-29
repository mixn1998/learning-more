export function renderMathPlotCapability(): string {
  return [
    '【数学图形能力】',
    '数学内容涉及几何关系、空间结构或变化过程时，只要图示能实质增加理解，就优先用 math-plot 把对象、关系与当前推理对应起来；图示服务于解释，不代替概念和论证。',
    'math-plot 是声明式 JSON，不得输出 JavaScript。顶层使用 version=1、可选 title/description、view、series 和可选 annotations。',
    'view.type 可为 cartesian2d（xRange/yRange）、polar2d（radialRange/thetaRange）或 cartesian3d（xRange/yRange/zRange）；范围均为 [最小值,最大值]。',
    'series 支持：explicit(expression/domain)、parametric2d(xExpression/yExpression/tRange)、polar(expression/thetaRange)、implicit2d(equation)、points2d(points)、parametric3d(xExpression/yExpression/zExpression/tRange)、surface3d(expression/xDomain/yDomain)、vectorField2d(xExpression/yExpression/density/normalize)、odePhase2d(dxExpression/dyExpression/initialPoints/tRange/step)。',
    '最小示例：```math-plot\n{"version":1,"title":"正弦函数","view":{"type":"cartesian2d","xRange":[-6.28,6.28],"yRange":[-1.5,1.5]},"series":[{"kind":"explicit","expression":"sin(x)","label":"y=sin(x)"}]}\n```',
  ].join('\n');
}
