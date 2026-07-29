import { useEffect, useState } from 'react';

import { AiContent } from '@learning-more/ui';

const mathPlotMarkdown = `
## 完整数学图像能力

### 显函数与离散点

\`\`\`math-plot
{"version":1,"title":"函数与采样点","view":{"type":"cartesian2d","xRange":[-6,6],"yRange":[-4,8]},"series":[{"kind":"explicit","label":"抛物线","expression":"x^2 / 4 - 1"},{"kind":"points2d","label":"样本","points":[[-2,0],[0,-1],[2,0]]}]}
\`\`\`

### 向量场与微分方程相图

\`\`\`math-plot
{"version":1,"title":"旋转系统的相图","view":{"type":"cartesian2d","xRange":[-4,4],"yRange":[-4,4]},"series":[{"kind":"vectorField2d","label":"方向场","xExpression":"-y","yExpression":"x","density":12,"normalize":true},{"kind":"odePhase2d","label":"轨线","dxExpression":"-y","dyExpression":"x","initialPoints":[[1,0],[2,0],[3,0]],"tRange":[-6.28,6.28],"step":0.04}]}
\`\`\`

### 三维曲面

\`\`\`math-plot
{"version":1,"title":"马鞍面","view":{"type":"cartesian3d","xRange":[-3,3],"yRange":[-3,3],"zRange":[-6,6]},"series":[{"kind":"surface3d","label":"z=x²-y²","expression":"x^2-y^2","xDomain":[-2.5,2.5],"yDomain":[-2.5,2.5]}]}
\`\`\`
`;

export function MathPlotFixture() {
  const [renderVersion, setRenderVersion] = useState(0);

  useEffect(() => {
    const rerender = () => setRenderVersion((version) => version + 1);
    window.addEventListener('lm:math-plot-fixture-rerender', rerender);
    return () => window.removeEventListener('lm:math-plot-fixture-rerender', rerender);
  }, []);

  return (
    <main
      className="visual-page visual-page-narrow"
      data-math-plot-render-version={renderVersion}
    >
      <AiContent markdown={mathPlotMarkdown} />
    </main>
  );
}
