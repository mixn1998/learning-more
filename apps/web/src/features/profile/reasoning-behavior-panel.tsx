import type { PortraitReasoningBehaviorAnalysis } from '@learning-more/contracts';
import { Badge, Panel, SectionHeader } from '@learning-more/ui';

export function ReasoningBehaviorPanel(props: {
  readonly analysis?: PortraitReasoningBehaviorAnalysis;
}) {
  const analysis = props.analysis;
  if (analysis === undefined) return null;
  const counts = new Map(
    analysis.snapshot.dimensions.map((dimension) => [dimension.dimensionId, dimension]),
  );
  const dimensions = [...analysis.dimensions].sort((left, right) => {
    const rightCount = counts.get(right.dimensionId)?.episodeCount ?? 0;
    const leftCount = counts.get(left.dimensionId)?.episodeCount ?? 0;
    return rightCount - leftCount || left.label.localeCompare(right.label, 'zh-CN');
  });

  return (
    <Panel className="reasoning-behavior-panel">
      <SectionHeader
        title="思维行为观察"
        description="基于可追溯的对话行为形成的当前统计切片；它不定义人格、能力或固定学习类型。"
        actions={
          <Badge tone={analysis.snapshot.status === 'usable' ? 'success' : 'warning'}>
            {analysis.snapshot.status === 'usable' ? '证据可用' : '证据暂定'}
          </Badge>
        }
      />
      {dimensions.length === 0 ? (
        <p>当前尚未形成可解释的思维行为维度；继续积累对话证据后会再分析。</p>
      ) : (
        <ol className="lm-stack">
          {dimensions.map((dimension) => {
            const count = counts.get(dimension.dimensionId);
            return (
              <li key={dimension.dimensionId}>
                <strong>{dimension.label}</strong>
                <p>{dimension.description}</p>
                <small>
                  已观察 {count?.episodeCount ?? 0} 次，来自{' '}
                  {count?.independentSourceGroupCount ?? 0} 个独立来源；自发出现{' '}
                  {count?.spontaneousCount ?? 0} 次，教学引导下出现 {count?.elicitedCount ?? 0} 次。
                </small>
              </li>
            );
          })}
        </ol>
      )}
      {analysis.snapshot.limitations.length === 0 ? null : (
        <small>解读限制：{analysis.snapshot.limitations.join('；')}</small>
      )}
    </Panel>
  );
}
