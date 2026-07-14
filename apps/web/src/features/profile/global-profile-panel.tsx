import type { GlobalLearningProfile } from '@learning-more/contracts';
import { Badge, Grid, Panel, SectionHeader } from '@learning-more/ui';

const sufficiencyLabel = {
  insufficient: '证据不足',
  limited: '有限证据',
  sufficient: '证据充分',
} as const;

export function GlobalProfilePanel(props: { readonly profile: GlobalLearningProfile }) {
  const profile = props.profile;
  return (
    <Panel className="global-profile-panel">
      <SectionHeader
        title="全局学习档案"
        description={`观察窗口：${profile.window.from.slice(0, 10)} — ${profile.window.to.slice(0, 10)}`}
        actions={
          <Badge tone={profile.sufficiency.status === 'sufficient' ? 'success' : 'warning'}>
            {sufficiencyLabel[profile.sufficiency.status]}
          </Badge>
        }
      />
      <Grid className="profile-metric-grid" columns={4}>
        <p>
          <strong>{profile.learningVolume.actualSeconds}</strong>
          <small>实际学习秒数</small>
        </p>
        <p>
          <strong>{profile.learningVolume.completedLessonCount}</strong>
          <small>完成课节</small>
        </p>
        <p>
          <strong>{profile.sufficiency.activeEvidenceCount}</strong>
          <small>有效候选证据</small>
        </p>
        <p>
          <strong>{profile.sufficiency.independentSourceGroupCount}</strong>
          <small>独立来源</small>
        </p>
      </Grid>
      <p className="profile-as-of">事实截至：{profile.asOfFactId ?? '空快照'}</p>
    </Panel>
  );
}
